import Peer, { type DataConnection } from 'peerjs';
import type {
  Game,
  Player,
  RoundPublic,
  Guess,
  Hint,
  RevealState,
  Category,
  CreateGameResult,
  JoinGameResult,
  GuessResult,
  AdvanceResult,
} from './supabase';

export interface GameSnapshot {
  game: Game | null;
  players: Player[];
  currentRound: RoundPublic | null;
  guesses: Guess[];
  hints: Hint[];
  revealState: RevealState | null;
}

type Listener = (snapshot: GameSnapshot) => void;

const ROUND_DURATION_MS = 90_000;
const JOIN_TIMEOUT_MS = 120_000;
const JOIN_RETRY_MS = 1_000;

export function normalizeAnswer(input: string): string {
  return (input || '')
    .replace(/[.,;:!?"'(){}\[\]#@*&^%$~`|\\/<>_+=\-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getInitial(input: string): string {
  const cleaned = (input || '').trim().replace(/^[^a-zA-Z0-9]+/, '');
  return cleaned.charAt(0).toUpperCase();
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function getSessionId(): string {
  let sid = sessionStorage.getItem('hhm_session_id');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('hhm_session_id', sid);
  }
  return sid;
}

function getPlayerId(): string | null {
  return sessionStorage.getItem('hhm_player_id');
}

function setPlayerId(id: string) {
  sessionStorage.setItem('hhm_player_id', id);
}

function getGameId(): string | null {
  return sessionStorage.getItem('hhm_game_id');
}

function setGameId(id: string) {
  sessionStorage.setItem('hhm_game_id', id);
}

interface SecretRoundAnswers {
  hero: string;
  heroine: string;
  movie: string;
}

interface HostInternalState {
  game: Game;
  players: Player[];
  currentRound: RoundPublic | null;
  secretAnswers: SecretRoundAnswers | null;
  guesses: Guess[];
  hints: Hint[];
  revealState: RevealState | null;
}

type NetworkMessage =
  | {
      type: 'JOIN_REQUEST';
      requestId: string;
      roomCode: string;
      displayName: string;
      sessionId: string;
    }
  | {
      type: 'JOIN_RESPONSE';
      requestId: string;
      success: boolean;
      data?: JoinGameResult;
      snapshot?: GameSnapshot;
      error?: string;
    }
  | {
      type: 'ACTION_REQUEST';
      requestId: string;
      action: string;
      payload: any;
    }
  | {
      type: 'ACTION_RESPONSE';
      requestId: string;
      success: boolean;
      data?: any;
      snapshot?: GameSnapshot;
      error?: string;
    }
  | {
      type: 'SYNC_STATE';
      snapshot: GameSnapshot;
    }
  | {
      type: 'SYNC_REQUEST';
      roomCode: string;
      sessionId: string;
      playerId: string | null;
    }
  | {
      type: 'SET_CONNECTED';
      gameId: string;
      playerId: string;
      connected: boolean;
    };

class GameStore {
  private gameId: string | null = null;
  private playerId: string | null = null;
  private session_id: string;
  private roomCode: string | null = null;
  private isHost: boolean = false;

  private snapshot: GameSnapshot = {
    game: null,
    players: [],
    currentRound: null,
    guesses: [],
    hints: [],
    revealState: null,
  };

  private hostState: HostInternalState | null = null;
  private listeners: Set<Listener> = new Set();
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  // Transports
  private bc: BroadcastChannel | null = null;
  private peer: Peer | null = null;
  private hostConnection: DataConnection | null = null;
  private peerConnections: DataConnection[] = [];
  private pendingJoinMessage: NetworkMessage | null = null;
  private processedRequestIds: Set<string> = new Set();
  private pendingRequests: Map<
    string,
    { resolve: (val: any) => void; reject: (err: any) => void; timeout: ReturnType<typeof setTimeout> }
  > = new Map();

  private storageListener: ((e: StorageEvent) => void) | null = null;

  constructor() {
    this.session_id = getSessionId();
    this.playerId = getPlayerId();
    this.gameId = getGameId();
    this.roomCode = sessionStorage.getItem('hhm_room_code');
    this.isHost = sessionStorage.getItem('hhm_is_host') === 'true';

    this.initStorageListener();
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  getSessionId(): string {
    return this.session_id;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const snap = { ...this.snapshot };
    for (const l of this.listeners) l(snap);
  }

  private setSnapshot(partial: Partial<GameSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    this.notify();
  }

  private updateSnapshotFromHostState() {
    if (!this.hostState) return;
    this.snapshot = {
      game: this.hostState.game ? { ...this.hostState.game } : null,
      players: [...this.hostState.players],
      currentRound: this.hostState.currentRound ? { ...this.hostState.currentRound } : null,
      guesses: [...this.hostState.guesses],
      hints: [...this.hostState.hints],
      revealState: this.hostState.revealState ? { ...this.hostState.revealState } : null,
    };
    this.notify();
  }

  // ---- Transports & Local/Remote Sync ----

  private initStorageListener() {
    if (typeof window === 'undefined') return;
    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
    }

    this.storageListener = (e: StorageEvent) => {
      if (!e.key || !this.roomCode) return;

      // 1. Sync state broadcast from Host
      if (e.key === `hhm_sync_${this.roomCode}` && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && parsed.snapshot) {
            this.setSnapshot(parsed.snapshot);
          }
        } catch {
          // ignore
        }
      }

      // 2. Action request for Host
      if (this.isHost && this.hostState && e.key === `hhm_action_req_${this.roomCode}` && e.newValue) {
        try {
          const msg = JSON.parse(e.newValue) as NetworkMessage;
          if (msg) this.handleIncomingMessage(msg, null);
        } catch {
          // ignore
        }
      }

      // 3. Action response for Client
      if (!this.isHost && e.key === `hhm_action_res_${this.roomCode}` && e.newValue) {
        try {
          const msg = JSON.parse(e.newValue) as NetworkMessage;
          if (msg) this.handleIncomingMessage(msg, null);
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('storage', this.storageListener);
  }

  private initBroadcastChannel(roomCode: string) {
    if (this.bc) {
      try {
        this.bc.close();
      } catch {
        // ignore
      }
    }
    try {
      this.bc = new BroadcastChannel(`hhm_bc_${roomCode.toUpperCase()}`);
      this.bc.onmessage = (event) => {
        this.handleIncomingMessage(event.data, null);
      };
    } catch (e) {
      console.warn('BroadcastChannel notice:', e);
    }
  }

  private initHostPeer(roomCode: string) {
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    try {
      const peerId = `hhm-${roomCode.toUpperCase()}`;
      const peer = new Peer(peerId);
      this.peer = peer;

      peer.on('connection', (conn) => {
        this.peerConnections.push(conn);
        conn.on('open', () => {
          conn.send({
            type: 'SYNC_STATE',
            snapshot: this.snapshot,
          });
        });
        conn.on('data', (data) => {
          this.handleIncomingMessage(data as NetworkMessage, conn);
        });
        conn.on('close', () => {
          this.peerConnections = this.peerConnections.filter((c) => c !== conn);
        });
      });

      peer.on('error', (err) => {
        console.warn('PeerJS host note:', err.type, err.message);
      });
    } catch (e) {
      console.warn('PeerJS host init note:', e);
    }
  }

  private initClientPeer(roomCode: string) {
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    try {
      const peer = new Peer();
      this.peer = peer;
      const hostPeerId = `hhm-${roomCode.toUpperCase()}`;

      const connectToHost = () => {
        if (this.peer !== peer || this.hostConnection) return;

        const conn = peer.connect(hostPeerId, { reliable: true });
        this.hostConnection = conn;

        conn.on('open', () => {
          if (this.pendingJoinMessage) {
            conn.send(this.pendingJoinMessage);
          }
        });
        conn.on('data', (data) => {
          this.handleIncomingMessage(data as NetworkMessage, conn);
        });
        conn.on('error', (err) => {
          console.warn('PeerJS connection note:', err.message);
          this.hostConnection = null;
          if (this.pendingJoinMessage) setTimeout(connectToHost, 500);
        });
        conn.on('close', () => {
          this.hostConnection = null;
          if (this.pendingJoinMessage) setTimeout(connectToHost, 500);
        });
      };

      peer.on('open', () => {
        connectToHost();
      });

      peer.on('error', (err) => {
        console.warn('PeerJS client note:', err.type, err.message);
      });
    } catch (e) {
      console.warn('PeerJS client init note:', e);
    }
  }

  private sendToHost(msg: NetworkMessage) {
    // 1. BroadcastChannel (fast local cross-tab)
    if (this.bc) {
      try {
        this.bc.postMessage(msg);
      } catch (e) {
        console.warn('BC send failed:', e);
      }
    }

    // 2. LocalStorage event (same-origin cross-tab sync)
    if (this.roomCode) {
      try {
        localStorage.setItem(
          `hhm_action_req_${this.roomCode}`,
          JSON.stringify({ ...msg, _ts: Date.now() })
        );
      } catch {
        // ignore
      }
    }

    // 3. PeerJS connection (cross-device WebRTC)
    if (this.hostConnection && this.hostConnection.open) {
      try {
        this.hostConnection.send(msg);
      } catch (e) {
        console.warn('Peer send failed:', e);
      }
    }
  }

  private reply(conn: DataConnection | null, msg: NetworkMessage) {
    // 1. PeerJS
    if (conn && conn.open) {
      try {
        conn.send(msg);
      } catch (e) {
        console.warn('Peer reply failed:', e);
      }
    }

    // 2. BroadcastChannel
    if (this.bc) {
      try {
        this.bc.postMessage(msg);
      } catch (e) {
        console.warn('BC reply failed:', e);
      }
    }

    // 3. LocalStorage
    if (this.roomCode) {
      try {
        localStorage.setItem(
          `hhm_action_res_${this.roomCode}`,
          JSON.stringify({ ...msg, _ts: Date.now() })
        );
      } catch {
        // ignore
      }
    }
  }

  private broadcastSnapshot() {
    this.updateSnapshotFromHostState();
    const syncMsg: NetworkMessage = {
      type: 'SYNC_STATE',
      snapshot: this.snapshot,
    };

    // 1. BroadcastChannel
    if (this.bc) {
      try {
        this.bc.postMessage(syncMsg);
      } catch (e) {
        console.warn('BC broadcast failed:', e);
      }
    }

    // 2. PeerJS
    for (const conn of this.peerConnections) {
      if (conn.open) {
        try {
          conn.send(syncMsg);
        } catch {
          // ignore
        }
      }
    }

    // 3. LocalStorage
    if (this.roomCode && this.hostState) {
      try {
        localStorage.setItem(`hhm_host_state_${this.roomCode}`, JSON.stringify(this.hostState));
        localStorage.setItem(
          `hhm_sync_${this.roomCode}`,
          JSON.stringify({ snapshot: this.snapshot, _ts: Date.now() })
        );
      } catch {
        // ignore
      }
    }
  }

  private handleIncomingMessage(msg: NetworkMessage, conn: DataConnection | null) {
    if (!msg || typeof msg !== 'object') return;

    if (this.isHost && this.hostState) {
      this.handleHostIncomingMessage(msg, conn);
    } else {
      this.handleClientIncomingMessage(msg);
    }
  }

  private handleHostIncomingMessage(msg: NetworkMessage, conn: DataConnection | null) {
    switch (msg.type) {
      case 'JOIN_REQUEST': {
        if (this.processedRequestIds.has(msg.requestId)) {
          // Already processed, re-send response in case caller missed it
          const existingPlayer = this.hostState?.players.find((p) => p.session_id === msg.sessionId);
          if (existingPlayer) {
            this.reply(conn, {
              type: 'JOIN_RESPONSE',
              requestId: msg.requestId,
              success: true,
              data: {
                game_id: this.hostState!.game.id,
                room_code: this.hostState!.game.room_code,
                player_id: existingPlayer.id,
                display_name: existingPlayer.display_name,
                player_order: existingPlayer.player_order,
              },
              snapshot: this.snapshot,
            });
          }
          return;
        }
        this.processedRequestIds.add(msg.requestId);

        try {
          const result = this.hostJoinPlayer(msg.displayName, msg.sessionId);
          this.updateSnapshotFromHostState();
          this.reply(conn, {
            type: 'JOIN_RESPONSE',
            requestId: msg.requestId,
            success: true,
            data: result,
            snapshot: this.snapshot,
          });
          this.broadcastSnapshot();
        } catch (e) {
          this.reply(conn, {
            type: 'JOIN_RESPONSE',
            requestId: msg.requestId,
            success: false,
            error: e instanceof Error ? e.message : 'Could not join game',
          });
        }
        break;
      }

      case 'ACTION_REQUEST': {
        if (this.processedRequestIds.has(msg.requestId)) return;
        this.processedRequestIds.add(msg.requestId);

        try {
          const res = this.handleHostAction(msg.action, msg.payload);
          this.updateSnapshotFromHostState();
          this.reply(conn, {
            type: 'ACTION_RESPONSE',
            requestId: msg.requestId,
            success: true,
            data: res,
            snapshot: this.snapshot,
          });
          this.broadcastSnapshot();
        } catch (e) {
          this.reply(conn, {
            type: 'ACTION_RESPONSE',
            requestId: msg.requestId,
            success: false,
            error: e instanceof Error ? e.message : 'Action failed',
          });
        }
        break;
      }

      case 'SYNC_REQUEST': {
        this.reply(conn, {
          type: 'SYNC_STATE',
          snapshot: this.snapshot,
        });
        if (msg.playerId) {
          const p = this.hostState?.players.find((x) => x.id === msg.playerId);
          if (p) {
            p.connected = true;
            this.broadcastSnapshot();
          }
        }
        break;
      }

      case 'SET_CONNECTED': {
        if (this.hostState) {
          const p = this.hostState.players.find((x) => x.id === msg.playerId);
          if (p) {
            p.connected = msg.connected;
            this.broadcastSnapshot();
          }
        }
        break;
      }
    }
  }

  private handleClientIncomingMessage(msg: NetworkMessage) {
    switch (msg.type) {
      case 'SYNC_STATE': {
        this.setSnapshot(msg.snapshot);
        break;
      }

      case 'JOIN_RESPONSE': {
        const req = this.pendingRequests.get(msg.requestId);
        if (req) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(msg.requestId);
          this.pendingJoinMessage = null;
          if (msg.success && msg.data) {
            if (msg.snapshot) {
              this.setSnapshot(msg.snapshot);
            }
            req.resolve(msg.data);
          } else {
            req.reject(new Error(msg.error || 'Failed to join game'));
          }
        }
        break;
      }

      case 'ACTION_RESPONSE': {
        const req = this.pendingRequests.get(msg.requestId);
        if (req) {
          clearTimeout(req.timeout);
          this.pendingRequests.delete(msg.requestId);
          if (msg.success) {
            if (msg.snapshot) {
              this.setSnapshot(msg.snapshot);
            }
            req.resolve(msg.data);
          } else {
            req.reject(new Error(msg.error || 'Action failed'));
          }
        }
        break;
      }
    }
  }

  private async dispatchAction<T>(action: string, payload: any): Promise<T> {
    if (this.isHost) {
      const res = this.handleHostAction(action, payload);
      this.broadcastSnapshot();
      return res as T;
    }

    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Action timed out waiting for host response.'));
      }, 10000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const msg: NetworkMessage = {
        type: 'ACTION_REQUEST',
        requestId,
        action,
        payload,
      };

      this.sendToHost(msg);

      // Retry every 400ms up to 3 times to ensure delivery
      let retries = 0;
      const retryInterval = setInterval(() => {
        if (!this.pendingRequests.has(requestId) || retries >= 3) {
          clearInterval(retryInterval);
          return;
        }
        retries++;
        this.sendToHost(msg);
      }, 400);
    });
  }

  // ---- Host Game Logic ----

  private hostJoinPlayer(displayName: string, sessionId: string): JoinGameResult {
    if (!this.hostState) throw new Error('Room not found');

    const name = displayName.trim();
    if (!name) throw new Error('Display name cannot be empty');

    // Reconnection check
    const existing = this.hostState.players.find((p) => p.session_id === sessionId);
    if (existing) {
      existing.connected = true;
      return {
        game_id: this.hostState.game.id,
        room_code: this.hostState.game.room_code,
        player_id: existing.id,
        display_name: existing.display_name,
        player_order: existing.player_order,
      };
    }

    if (this.hostState.game.status !== 'LOBBY') {
      throw new Error('Game has already started');
    }

    if (this.hostState.players.length >= this.hostState.game.max_players) {
      throw new Error('Room is full');
    }

    const newOrder = this.hostState.players.length;
    const newPlayer: Player = {
      id: crypto.randomUUID(),
      game_id: this.hostState.game.id,
      display_name: name,
      score: 0,
      player_order: newOrder,
      session_id: sessionId,
      connected: true,
      created_at: new Date().toISOString(),
    };

    this.hostState.players.push(newPlayer);

    return {
      game_id: this.hostState.game.id,
      room_code: this.hostState.game.room_code,
      player_id: newPlayer.id,
      display_name: newPlayer.display_name,
      player_order: newPlayer.player_order,
    };
  }

  private handleHostAction(action: string, payload: any): any {
    if (!this.hostState) throw new Error('No game active');

    switch (action) {
      case 'start_game': {
        const { playerId } = payload;
        if (!this.hostState.players.some((p) => p.id === playerId)) {
          throw new Error('Not a player in this game');
        }
        if (this.hostState.game.status !== 'LOBBY') {
          throw new Error('Game has already started');
        }
        if (this.hostState.players.length < 2) {
          throw new Error('Need at least 2 players to start');
        }

        this.hostState.game.status = 'QUESTION_SELECTION';
        this.hostState.game.current_round = 1;
        this.hostState.game.current_questioner_index = 0;
        this.hostState.game.updated_at = new Date().toISOString();

        const firstQuestioner = this.hostState.players[0];
        this.hostState.currentRound = {
          id: crypto.randomUUID(),
          game_id: this.hostState.game.id,
          round_number: 1,
          questioner_id: firstQuestioner.id,
          hero_initial: null,
          heroine_initial: null,
          movie_initial: null,
          status: 'PENDING',
          started_at: null,
          ends_at: null,
          created_at: new Date().toISOString(),
        };
        return null;
      }

      case 'create_round': {
        const { playerId, hero, heroine, movie } = payload;
        if (this.hostState.game.status !== 'QUESTION_SELECTION') {
          throw new Error('Not in question selection phase');
        }
        const round = this.hostState.currentRound;
        if (!round || round.questioner_id !== playerId) {
          throw new Error('You are not the questioner');
        }
        if (hero.trim().length < 2 || heroine.trim().length < 2 || movie.trim().length < 2) {
          throw new Error('Each answer must have at least 2 characters');
        }

        const heroInit = getInitial(hero);
        const heroineInit = getInitial(heroine);
        const movieInit = getInitial(movie);

        this.hostState.secretAnswers = {
          hero: hero.trim(),
          heroine: heroine.trim(),
          movie: movie.trim(),
        };

        const now = new Date();
        const endsAt = new Date(now.getTime() + ROUND_DURATION_MS);

        round.hero_initial = heroInit;
        round.heroine_initial = heroineInit;
        round.movie_initial = movieInit;
        round.status = 'ACTIVE';
        round.started_at = now.toISOString();
        round.ends_at = endsAt.toISOString();

        this.hostState.guesses = [];
        this.hostState.hints = [];
        this.hostState.revealState = null;
        this.hostState.game.status = 'ROUND_ACTIVE';
        this.hostState.game.updated_at = now.toISOString();
        return null;
      }

      case 'submit_guess': {
        const { playerId, category, guess } = payload;
        return this.hostSubmitGuess(playerId, category, guess);
      }

      case 'request_hint': {
        const { playerId, category } = payload;
        const round = this.hostState.currentRound;
        if (!round || this.hostState.game.status !== 'ROUND_ACTIVE') {
          throw new Error('Round not active');
        }
        if (round.questioner_id === playerId) {
          throw new Error('Questioner cannot request hint');
        }

        const existingPending = this.hostState.hints.some(
          (h) =>
            h.requested_by_player_id === playerId &&
            h.category === category &&
            h.status === 'PENDING'
        );
        if (existingPending) return null;

        const hint: Hint = {
          id: crypto.randomUUID(),
          round_id: round.id,
          requested_by_player_id: playerId,
          category,
          cost: 0.5,
          hint_text: null,
          status: 'PENDING',
          created_at: new Date().toISOString(),
        };
        this.hostState.hints.push(hint);
        return null;
      }

      case 'send_hint': {
        const { playerId, hintId, hintText, cost = 0.5 } = payload;
        const round = this.hostState.currentRound;
        if (!round || round.questioner_id !== playerId) {
          throw new Error('Only the questioner can send hints');
        }
        const hint = this.hostState.hints.find((h) => h.id === hintId);
        if (!hint) throw new Error('Hint not found');
        hint.status = 'SENT';
        hint.hint_text = hintText.trim();
        hint.cost = cost;
        return null;
      }

      case 'reject_hint': {
        const { playerId, hintId } = payload;
        const round = this.hostState.currentRound;
        if (!round || round.questioner_id !== playerId) {
          throw new Error('Only the questioner can reject hints');
        }
        const hint = this.hostState.hints.find((h) => h.id === hintId);
        if (!hint) throw new Error('Hint not found');
        hint.status = 'REJECTED';
        return null;
      }

      case 'end_round': {
        this.hostEndRound();
        return null;
      }

      case 'reveal_answers': {
        this.hostEndRound();
        return null;
      }

      case 'advance_round': {
        return this.hostAdvanceRound();
      }

      case 'get_reveal_state': {
        return this.hostState.revealState;
      }

      case 'set_player_connected': {
        const { playerId, connected } = payload;
        const p = this.hostState.players.find((x) => x.id === playerId);
        if (p) p.connected = connected;
        return null;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private hostSubmitGuess(playerId: string, category: Category, guess: string): GuessResult {
    if (!this.hostState || this.hostState.game.status !== 'ROUND_ACTIVE') {
      throw new Error('Round is not active');
    }
    const round = this.hostState.currentRound;
    if (!round) throw new Error('No active round');

    if (round.questioner_id === playerId) {
      throw new Error('Questioner cannot guess');
    }

    if (!guess || !guess.trim()) {
      throw new Error('Guess cannot be empty');
    }

    // Check timer
    if (round.ends_at && Date.now() >= new Date(round.ends_at).getTime()) {
      this.hostEndRound();
      throw new Error('Round time has expired');
    }

    // Check if player already solved this category
    const alreadySolved = this.hostState.guesses.some(
      (g) => g.round_id === round.id && g.player_id === playerId && g.category === category && g.correct
    );

    if (alreadySolved) {
      this.hostState.guesses.push({
        id: crypto.randomUUID(),
        round_id: round.id,
        player_id: playerId,
        category,
        guess_text: guess.trim(),
        correct: false,
        used_hint: false,
        points_awarded: 0,
        created_at: new Date().toISOString(),
      });
      return { correct: false, points_awarded: 0, already_solved: true };
    }

    // Check if player used a hint
    const usedHint = this.hostState.hints.some(
      (h) =>
        h.round_id === round.id &&
        h.requested_by_player_id === playerId &&
        h.category === category &&
        h.status === 'SENT'
    );

    let answer = '';
    if (category === 'HERO') answer = this.hostState.secretAnswers?.hero || '';
    else if (category === 'HEROINE') answer = this.hostState.secretAnswers?.heroine || '';
    else if (category === 'MOVIE') answer = this.hostState.secretAnswers?.movie || '';

    const isCorrect = normalizeAnswer(guess) === normalizeAnswer(answer);

    if (isCorrect) {
      const points = usedHint ? 0.5 : 1.0;
      const player = this.hostState.players.find((p) => p.id === playerId);
      if (player) {
        player.score = Number((player.score + points).toFixed(1));
      }

      this.hostState.guesses.push({
        id: crypto.randomUUID(),
        round_id: round.id,
        player_id: playerId,
        category,
        guess_text: guess.trim(),
        correct: true,
        used_hint: usedHint,
        points_awarded: points,
        created_at: new Date().toISOString(),
      });

      // Check if all 3 categories have been solved
      const solvedCategories = new Set(
        this.hostState.guesses.filter((g) => g.correct).map((g) => g.category)
      );

      if (
        solvedCategories.has('HERO') &&
        solvedCategories.has('HEROINE') &&
        solvedCategories.has('MOVIE')
      ) {
        this.hostEndRound();
      }

      return { correct: true, points_awarded: points, already_solved: false };
    } else {
      this.hostState.guesses.push({
        id: crypto.randomUUID(),
        round_id: round.id,
        player_id: playerId,
        category,
        guess_text: guess.trim(),
        correct: false,
        used_hint: false,
        points_awarded: 0,
        created_at: new Date().toISOString(),
      });
      return { correct: false, points_awarded: 0, already_solved: false };
    }
  }

  private hostEndRound(): void {
    if (!this.hostState) return;
    if (this.hostState.game.status !== 'ROUND_ACTIVE') return;

    this.hostState.game.status = 'ROUND_REVEAL';
    this.hostState.game.updated_at = new Date().toISOString();

    if (this.hostState.currentRound) {
      this.hostState.currentRound.status = 'ENDED';
    }

    if (this.hostState.secretAnswers && this.hostState.currentRound) {
      this.hostState.revealState = {
        round_number: this.hostState.currentRound.round_number,
        hero_answer: this.hostState.secretAnswers.hero,
        heroine_answer: this.hostState.secretAnswers.heroine,
        movie_answer: this.hostState.secretAnswers.movie,
        hero_initial: this.hostState.currentRound.hero_initial || '',
        heroine_initial: this.hostState.currentRound.heroine_initial || '',
        movie_initial: this.hostState.currentRound.movie_initial || '',
      };
    }
  }

  private hostAdvanceRound(): AdvanceResult {
    if (!this.hostState) throw new Error('No game active');

    if (this.hostState.game.status === 'ROUND_REVEAL') {
      this.hostState.game.status = 'SCOREBOARD';
      this.hostState.game.updated_at = new Date().toISOString();
      return {
        game_status: 'SCOREBOARD',
        next_round: this.hostState.game.current_round,
        next_questioner_id: null,
      };
    }

    if (this.hostState.game.status === 'SCOREBOARD') {
      const nextRound = this.hostState.game.current_round + 1;
      if (nextRound > this.hostState.game.total_rounds) {
        this.hostState.game.status = 'GAME_OVER';
        this.hostState.game.updated_at = new Date().toISOString();
        return {
          game_status: 'GAME_OVER',
          next_round: nextRound,
          next_questioner_id: null,
        };
      }

      const nextIdx =
        (this.hostState.game.current_questioner_index + 1) % this.hostState.players.length;
      const nextQuestioner =
        this.hostState.players.find((p) => p.player_order === nextIdx) || this.hostState.players[0];

      this.hostState.game.status = 'QUESTION_SELECTION';
      this.hostState.game.current_round = nextRound;
      this.hostState.game.current_questioner_index = nextIdx;
      this.hostState.game.updated_at = new Date().toISOString();

      this.hostState.currentRound = {
        id: crypto.randomUUID(),
        game_id: this.hostState.game.id,
        round_number: nextRound,
        questioner_id: nextQuestioner.id,
        hero_initial: null,
        heroine_initial: null,
        movie_initial: null,
        status: 'PENDING',
        started_at: null,
        ends_at: null,
        created_at: new Date().toISOString(),
      };
      this.hostState.secretAnswers = null;
      this.hostState.guesses = [];
      this.hostState.hints = [];
      this.hostState.revealState = null;

      return {
        game_status: 'QUESTION_SELECTION',
        next_round: nextRound,
        next_questioner_id: nextQuestioner.id,
      };
    }

    throw new Error('Cannot advance from current status: ' + this.hostState.game.status);
  }

  // ---- Public Game Store API ----

  async connect(gameId: string) {
    const roomCode = sessionStorage.getItem('hhm_room_code');
    const isHost = sessionStorage.getItem('hhm_is_host') === 'true';

    // If already hosting this exact game, do not disconnect!
    if (this.isHost && this.hostState && this.gameId === gameId) {
      this.updateSnapshotFromHostState();
      return;
    }

    this.gameId = gameId;
    setGameId(gameId);

    if (!roomCode) return;
    this.roomCode = roomCode;

    if (isHost) {
      this.isHost = true;
      const saved = localStorage.getItem(`hhm_host_state_${roomCode}`);
      if (saved) {
        try {
          this.hostState = JSON.parse(saved);
          this.updateSnapshotFromHostState();
        } catch (e) {
          console.error('Failed to parse saved host state', e);
        }
      }
      this.initBroadcastChannel(roomCode);
      this.initHostPeer(roomCode);
      this.startTimerPoll();
    } else {
      this.isHost = false;
      this.initBroadcastChannel(roomCode);
      this.initClientPeer(roomCode);
      this.startTimerPoll();

      // Check local storage first
      const localSync = localStorage.getItem(`hhm_sync_${roomCode}`);
      if (localSync) {
        try {
          const parsed = JSON.parse(localSync);
          if (parsed?.snapshot) {
            this.setSnapshot(parsed.snapshot);
          }
        } catch {
          // ignore
        }
      }

      this.sendToHost({
        type: 'SYNC_REQUEST',
        roomCode,
        sessionId: this.session_id,
        playerId: this.playerId,
      });
    }
  }

  disconnect() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.bc) {
      try {
        this.bc.close();
      } catch {
        // ignore
      }
      this.bc = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    this.hostConnection = null;
    this.peerConnections = [];
  }

  private startTimerPoll() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(async () => {
      const game = this.snapshot.game;
      const round = this.snapshot.currentRound;
      if (!game || !round) return;

      if (game.status === 'ROUND_ACTIVE' && round.ends_at) {
        const endsAt = new Date(round.ends_at).getTime();
        if (Date.now() >= endsAt) {
          await this.endRound();
        }
      }
    }, 500);
  }

  async createGame(displayName: string, totalRounds: number): Promise<CreateGameResult> {
    const name = displayName.trim();
    if (!name) throw new Error('Display name cannot be empty');

    const gameId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const roomCode = generateRoomCode();

    this.isHost = true;
    this.roomCode = roomCode;
    this.gameId = gameId;
    this.playerId = playerId;

    sessionStorage.setItem('hhm_is_host', 'true');
    sessionStorage.setItem('hhm_room_code', roomCode);
    setGameId(gameId);
    setPlayerId(playerId);

    const game: Game = {
      id: gameId,
      room_code: roomCode,
      status: 'LOBBY',
      max_players: 8,
      total_rounds: totalRounds === 5 ? 5 : 10,
      current_round: 0,
      current_questioner_index: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const hostPlayer: Player = {
      id: playerId,
      game_id: gameId,
      display_name: name,
      score: 0,
      player_order: 0,
      session_id: this.session_id,
      connected: true,
      created_at: new Date().toISOString(),
    };

    this.hostState = {
      game,
      players: [hostPlayer],
      currentRound: null,
      secretAnswers: null,
      guesses: [],
      hints: [],
      revealState: null,
    };

    this.initBroadcastChannel(roomCode);
    this.initHostPeer(roomCode);
    this.updateSnapshotFromHostState();
    this.broadcastSnapshot();
    this.startTimerPoll();

    return {
      game_id: gameId,
      room_code: roomCode,
      player_id: playerId,
      display_name: name,
      player_order: 0,
    };
  }

  async joinGame(roomCode: string, displayName: string): Promise<JoinGameResult> {
    const code = roomCode.trim().toUpperCase();
    const name = displayName.trim();
    if (!code) throw new Error('Room code cannot be empty');
    if (!name) throw new Error('Display name cannot be empty');

    this.isHost = false;
    this.roomCode = code;
    sessionStorage.setItem('hhm_is_host', 'false');
    sessionStorage.setItem('hhm_room_code', code);

    this.initBroadcastChannel(code);
    this.initClientPeer(code);

    const requestId = crypto.randomUUID();
    const joinResult = await new Promise<JoinGameResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        this.pendingJoinMessage = null;
        reject(new Error(`Could not connect to room "${code}". Ask the host to keep the lobby open and try again.`));
      }, JOIN_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      const joinMsg: NetworkMessage = {
        type: 'JOIN_REQUEST',
        requestId,
        roomCode: code,
        displayName: name,
        sessionId: this.session_id,
      };
      this.pendingJoinMessage = joinMsg;

      // Send immediately
      this.sendToHost(joinMsg);

      // Retry until the timeout so slow PeerJS connections can still join.
      let retries = 0;
      const retryInterval = setInterval(() => {
        if (!this.pendingRequests.has(requestId)) {
          clearInterval(retryInterval);
          return;
        }
        retries++;
        this.sendToHost(joinMsg);
      }, JOIN_RETRY_MS);
    });

    this.playerId = joinResult.player_id;
    this.gameId = joinResult.game_id;
    setPlayerId(joinResult.player_id);
    setGameId(joinResult.game_id);
    this.startTimerPoll();

    return joinResult;
  }

  async startGame(): Promise<void> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    await this.dispatchAction<void>('start_game', {
      gameId: this.gameId,
      playerId: this.playerId,
    });
  }

  async createRound(hero: string, heroine: string, movie: string): Promise<void> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    await this.dispatchAction<void>('create_round', {
      gameId: this.gameId,
      playerId: this.playerId,
      hero,
      heroine,
      movie,
    });
  }

  async submitGuess(category: Category, guess: string): Promise<GuessResult> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    return this.dispatchAction<GuessResult>('submit_guess', {
      gameId: this.gameId,
      playerId: this.playerId,
      category,
      guess,
    });
  }

  async requestHint(category: Category): Promise<void> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    await this.dispatchAction<void>('request_hint', {
      gameId: this.gameId,
      playerId: this.playerId,
      category,
    });
  }

  async sendHint(hintId: string, hintText: string, cost: number = 0.5): Promise<void> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    await this.dispatchAction<void>('send_hint', {
      gameId: this.gameId,
      playerId: this.playerId,
      hintId,
      hintText,
      cost,
    });
  }

  async rejectHint(hintId: string): Promise<void> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    await this.dispatchAction<void>('reject_hint', {
      gameId: this.gameId,
      playerId: this.playerId,
      hintId,
    });
  }

  async endRound(): Promise<void> {
    if (!this.gameId) return;
    await this.dispatchAction<void>('end_round', {
      gameId: this.gameId,
    });
  }

  async revealAnswers(): Promise<void> {
    if (!this.gameId || !this.playerId) throw new Error('Not in a game');
    await this.dispatchAction<void>('reveal_answers', {
      gameId: this.gameId,
      playerId: this.playerId,
    });
  }

  async advanceRound(): Promise<AdvanceResult> {
    if (!this.gameId) throw new Error('Not in a game');
    return this.dispatchAction<AdvanceResult>('advance_round', {
      gameId: this.gameId,
    });
  }

  async fetchRevealState(): Promise<RevealState | null> {
    if (this.snapshot.revealState) return this.snapshot.revealState;
    if (this.isHost && this.hostState?.revealState) {
      return this.hostState.revealState;
    }
    const state = await this.dispatchAction<RevealState | null>('get_reveal_state', {
      gameId: this.gameId,
    });
    if (state) {
      this.setSnapshot({ revealState: state });
    }
    return state;
  }

  async setConnected(connected: boolean): Promise<void> {
    if (!this.gameId || !this.playerId) return;
    if (this.isHost && this.hostState) {
      const p = this.hostState.players.find((x) => x.id === this.playerId);
      if (p) {
        p.connected = connected;
        this.broadcastSnapshot();
      }
    } else {
      this.sendToHost({
        type: 'SET_CONNECTED',
        gameId: this.gameId,
        playerId: this.playerId,
        connected,
      });
    }
  }

  // ---- Helpers ----

  getMyPlayer(): Player | null {
    return this.snapshot.players.find((p) => p.id === this.playerId) ?? null;
  }

  isQuestioner(): boolean {
    const round = this.snapshot.currentRound;
    return round?.questioner_id === this.playerId;
  }

  getQuestioner(): Player | null {
    const round = this.snapshot.currentRound;
    if (!round) return null;
    return this.snapshot.players.find((p) => p.id === round.questioner_id) ?? null;
  }

  getTimeRemaining(): number {
    const round = this.snapshot.currentRound;
    if (!round?.ends_at) return ROUND_DURATION_MS / 1000;
    const remaining = Math.max(0, Math.ceil((new Date(round.ends_at).getTime() - Date.now()) / 1000));
    return remaining;
  }

  hasSolvedCategory(category: Category): boolean {
    return this.snapshot.guesses.some(
      (g) => g.player_id === this.playerId && g.category === category && g.correct
    );
  }

  hasUsedHintForCategory(category: Category): boolean {
    return this.snapshot.hints.some(
      (h) =>
        h.requested_by_player_id === this.playerId &&
        h.category === category &&
        h.status === 'SENT'
    );
  }

  hasPendingHintForCategory(category: Category): boolean {
    return this.snapshot.hints.some(
      (h) =>
        h.requested_by_player_id === this.playerId &&
        h.category === category &&
        h.status === 'PENDING'
    );
  }

  getPendingHintsForQuestioner(): Hint[] {
    return this.snapshot.hints.filter((h) => h.status === 'PENDING');
  }

  getSentHintsForPlayer(): Hint[] {
    return this.snapshot.hints.filter(
      (h) => h.requested_by_player_id === this.playerId && h.status === 'SENT' && h.hint_text
    );
  }

  getRoundScores(): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const g of this.snapshot.guesses) {
      if (g.correct) {
        scores[g.player_id] = (scores[g.player_id] ?? 0) + g.points_awarded;
      }
    }
    return scores;
  }

  leave() {
    this.disconnect();
    this.gameId = null;
    this.playerId = null;
    this.roomCode = null;
    this.isHost = false;
    this.hostState = null;
    sessionStorage.removeItem('hhm_game_id');
    sessionStorage.removeItem('hhm_player_id');
    sessionStorage.removeItem('hhm_room_code');
    sessionStorage.removeItem('hhm_is_host');
    this.snapshot = {
      game: null,
      players: [],
      currentRound: null,
      guesses: [],
      hints: [],
      revealState: null,
    };
    this.notify();
  }
}

export const gameStore = new GameStore();
export { ROUND_DURATION_MS };
