import { useState } from 'react';
import { Copy, Check, Play, Users } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';

interface LobbyScreenProps {
  onLeave: () => void;
}

export function LobbyScreen({ onLeave }: LobbyScreenProps) {
  const snap = useGameStore();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const game = snap.game;
  const players = snap.players;
  const myPlayer = gameStore.getMyPlayer();
  const isCreator = myPlayer?.player_order === 0;
  const playerCount = players.length;
  const canStart = playerCount >= 2;

  const handleCopy = async () => {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.room_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleStart = async () => {
    setError('');
    setStarting(true);
    try {
      await gameStore.startGame();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the game.');
    } finally {
      setStarting(false);
    }
  };

  if (!game) return null;

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="handwritten text-4xl font-bold text-[var(--ink)] mb-2">
            HERO, HEROINE &amp; MOVIE
          </h1>
          <div className="pencil-handwritten text-sm text-[var(--ink)] opacity-60">
            Share this code with your friends
          </div>
        </div>

        {/* Room code card */}
        <div className="clue-card mb-8 relative">
          <div className="tape" />
          <div className="clue-label mb-2">ROOM CODE</div>
          <button
            onClick={handleCopy}
            className="handwritten text-5xl font-bold tracking-[0.2em] text-[var(--red-pencil)] hover:opacity-70 transition-opacity flex items-center gap-3 mx-auto"
          >
            {game.room_code}
            {copied ? <Check size={24} /> : <Copy size={24} />}
          </button>
        </div>

        {/* Players list */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <Users size={18} className="text-[var(--blue-pencil)]" />
            <span className="clue-label !mb-0">PLAYERS</span>
            <span className="ml-auto pencil-handwritten text-sm text-[var(--ink)] opacity-60">
              {playerCount} / {game.max_players}
            </span>
          </div>
          <div className="space-y-2">
            {players.map((p, i) => (
              <div
                key={p.id}
                className="pencil-border flex items-center gap-3 !cursor-default !shadow-none"
                style={{ background: 'rgba(255,252,245,0.5)' }}
              >
                <span className="handwritten text-2xl text-[var(--blue-pencil)] w-8 text-center">
                  {i + 1}
                </span>
                <span className="pencil-handwritten text-lg">{p.display_name}</span>
                {p.id === myPlayer?.id && (
                  <span className="ml-auto text-xs pencil-handwritten text-[var(--red-pencil)]">
                    YOU
                  </span>
                )}
                {i === 0 && (
                  <span className="text-xs pencil-handwritten text-[var(--green-pencil)]">
                    HOST
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Start button */}
        {isCreator ? (
          <>
            <button
              onClick={handleStart}
              disabled={!canStart || starting}
              className="pencil-border pencil-border-solid w-full justify-center"
            >
              <Play size={20} />
              {starting ? 'STARTING...' : canStart ? 'START GAME' : `NEED ${2 - playerCount} MORE PLAYER`}
            </button>
            {!canStart && (
              <div className="mt-3 text-center pencil-handwritten text-sm text-[var(--ink)] opacity-60">
                At least 2 players are needed to start.
              </div>
            )}
          </>
        ) : (
          <div className="clue-card">
            <div className="pencil-handwritten text-[var(--blue-pencil)]">
              Waiting for the host to start the game...
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 pencil-handwritten text-[var(--red-pencil)] text-sm text-center">
            {error}
          </div>
        )}

        <button onClick={onLeave} className="mt-6 pencil-border w-full justify-center text-sm">
          LEAVE GAME
        </button>
      </div>
    </div>
  );
}
