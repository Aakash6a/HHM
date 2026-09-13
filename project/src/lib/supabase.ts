// ---- Game Types & Model Definitions ----

export type GameStatus =
  | 'LOBBY'
  | 'QUESTION_SELECTION'
  | 'ROUND_ACTIVE'
  | 'ROUND_REVEAL'
  | 'SCOREBOARD'
  | 'GAME_OVER';

export type RoundStatus = 'PENDING' | 'ACTIVE' | 'ENDED';
export type Category = 'HERO' | 'HEROINE' | 'MOVIE';

export interface Game {
  id: string;
  room_code: string;
  status: GameStatus;
  max_players: number;
  total_rounds: number;
  current_round: number;
  current_questioner_index: number;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  game_id: string;
  display_name: string;
  score: number;
  player_order: number;
  session_id: string;
  connected: boolean;
  created_at: string;
}

export interface RoundPublic {
  id: string;
  game_id: string;
  round_number: number;
  questioner_id: string;
  hero_initial: string | null;
  heroine_initial: string | null;
  movie_initial: string | null;
  status: RoundStatus;
  started_at: string | null;
  ends_at: string | null;
  created_at: string;
}

export interface Guess {
  id: string;
  round_id: string;
  player_id: string;
  category: Category;
  guess_text: string;
  correct: boolean;
  used_hint: boolean;
  points_awarded: number;
  created_at: string;
}

export interface Hint {
  id: string;
  round_id: string;
  requested_by_player_id: string;
  category: Category;
  cost: number;
  hint_text: string | null;
  status: 'PENDING' | 'SENT' | 'REJECTED';
  created_at: string;
}

export interface RevealState {
  round_number: number;
  hero_answer: string;
  heroine_answer: string;
  movie_answer: string;
  hero_initial: string;
  heroine_initial: string;
  movie_initial: string;
}

export interface CreateGameResult {
  game_id: string;
  room_code: string;
  player_id: string;
  display_name: string;
  player_order: number;
}

export interface JoinGameResult {
  game_id: string;
  room_code: string;
  player_id: string;
  display_name: string;
  player_order: number;
}

export interface GuessResult {
  correct: boolean;
  points_awarded: number;
  already_solved: boolean;
}

export interface AdvanceResult {
  game_status: string;
  next_round: number;
  next_questioner_id: string | null;
}
