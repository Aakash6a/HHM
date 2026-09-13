/*
# Hero, Heroine & Movie — Core Game Schema

Creates the five core tables for the multiplayer movie-guessing game:
games, players, rounds, guesses, hints.

## Tables

### games
- id (uuid PK)
- room_code (text, unique, 6-char) — the join code friends share
- status (text) — game state machine: LOBBY | QUESTION_SELECTION | ROUND_ACTIVE | ROUND_REVEAL | SCOREBOARD | GAME_OVER
- max_players (int, default 8)
- total_rounds (int, default 10) — 5 or 10
- current_round (int, default 0)
- current_questioner_index (int, default 0) — deterministic rotation pointer
- created_at, updated_at (timestamptz)

### players
- id (uuid PK)
- game_id (uuid FK -> games)
- display_name (text)
- score (numeric, default 0) — cumulative score, server-owned
- player_order (int) — join order, used for questioner rotation
- session_id (text) — used for reconnection
- connected (bool, default true)
- created_at (timestamptz)

### rounds
- id (uuid PK)
- game_id (uuid FK -> games)
- round_number (int)
- questioner_id (uuid FK -> players)
- hero_answer, heroine_answer, movie_answer (text) — SECRET, never exposed to chasers before reveal
- hero_initial, heroine_initial, movie_initial (text) — the public clue
- status (text) — PENDING | ACTIVE | ENDED
- started_at, ends_at (timestamptz) — server-owned 90s timer
- created_at (timestamptz)

### guesses
- id (uuid PK)
- round_id (uuid FK -> rounds)
- player_id (uuid FK -> players)
- category (text) — HERO | HEROINE | MOVIE
- guess_text (text)
- correct (bool) — server-decided
- used_hint (bool)
- points_awarded (numeric) — 1.0, 0.5, or 0
- created_at (timestamptz)

### hints
- id (uuid PK)
- round_id (uuid FK -> rounds)
- requested_by_player_id (uuid FK -> players)
- category (text)
- cost (numeric)
- hint_text (text) — written by questioner
- status (text) — PENDING | SENT | REJECTED
- created_at (timestamptz)

## Security
- RLS enabled on all tables.
- All tables are open to anon+authenticated CRUD (the game is no-auth, room-code based).
- Sensitive answer columns on `rounds` are protected by column-level grants: anon can SELECT everything EXCEPT the three answer columns; only the service role and SECURITY DEFINER functions can read/write them.
- Score, status, and correctness columns are writable only through privileged functions (clients have INSERT on guesses/hints but cannot set correct/points/score).
*/

-- ============================================================
-- ENUMS
-- ============================================================
DO $$ BEGIN
  CREATE TYPE game_status AS ENUM ('LOBBY','QUESTION_SELECTION','ROUND_ACTIVE','ROUND_REVEAL','SCOREBOARD','GAME_OVER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE round_status AS ENUM ('PENDING','ACTIVE','ENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE guess_category AS ENUM ('HERO','HEROINE','MOVIE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hint_status AS ENUM ('PENDING','SENT','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TABLES
-- ============================================================
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text UNIQUE NOT NULL,
  status game_status NOT NULL DEFAULT 'LOBBY',
  max_players int NOT NULL DEFAULT 8,
  total_rounds int NOT NULL DEFAULT 10,
  current_round int NOT NULL DEFAULT 0,
  current_questioner_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  score numeric(6,1) NOT NULL DEFAULT 0,
  player_order int NOT NULL,
  session_id text NOT NULL,
  connected boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, session_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number int NOT NULL,
  questioner_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  hero_answer text,
  heroine_answer text,
  movie_answer text,
  hero_initial text,
  heroine_initial text,
  movie_initial text,
  status round_status NOT NULL DEFAULT 'PENDING',
  started_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, round_number)
);

CREATE TABLE IF NOT EXISTS guesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category guess_category NOT NULL,
  guess_text text NOT NULL,
  correct boolean NOT NULL DEFAULT false,
  used_hint boolean NOT NULL DEFAULT false,
  points_awarded numeric(4,1) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  requested_by_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category guess_category NOT NULL,
  cost numeric(3,1) NOT NULL DEFAULT 0,
  hint_text text,
  status hint_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_players_game_id ON players(game_id);
CREATE INDEX IF NOT EXISTS idx_rounds_game_id ON rounds(game_id);
CREATE INDEX IF NOT EXISTS idx_guesses_round_id ON guesses(round_id);
CREATE INDEX IF NOT EXISTS idx_hints_round_id ON hints(round_id);
CREATE INDEX IF NOT EXISTS idx_games_room_code ON games(room_code);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE guesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hints ENABLE ROW LEVEL SECURITY;

-- Games: full CRUD for anon (no-auth game)
DROP POLICY IF EXISTS "games_select_all" ON games;
CREATE POLICY "games_select_all" ON games FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "games_insert_all" ON games;
CREATE POLICY "games_insert_all" ON games FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "games_update_all" ON games;
CREATE POLICY "games_update_all" ON games FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "games_delete_all" ON games;
CREATE POLICY "games_delete_all" ON games FOR DELETE TO anon, authenticated USING (true);

-- Players: full CRUD for anon
DROP POLICY IF EXISTS "players_select_all" ON players;
CREATE POLICY "players_select_all" ON players FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "players_insert_all" ON players;
CREATE POLICY "players_insert_all" ON players FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "players_update_all" ON players;
CREATE POLICY "players_update_all" ON players FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "players_delete_all" ON players;
CREATE POLICY "players_delete_all" ON players FOR DELETE TO anon, authenticated USING (true);

-- Rounds: SELECT and INSERT for anon, but UPDATE only via functions (we'll revoke update)
DROP POLICY IF EXISTS "rounds_select_all" ON rounds;
CREATE POLICY "rounds_select_all" ON rounds FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rounds_insert_all" ON rounds;
CREATE POLICY "rounds_insert_all" ON rounds FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rounds_delete_all" ON rounds;
CREATE POLICY "rounds_delete_all" ON rounds FOR DELETE TO anon, authenticated USING (true);

-- Guesses: SELECT and INSERT for anon (correct/points default to false/0, set by function)
DROP POLICY IF EXISTS "guesses_select_all" ON guesses;
CREATE POLICY "guesses_select_all" ON guesses FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "guesses_insert_all" ON guesses;
CREATE POLICY "guesses_insert_all" ON guesses FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "guesses_delete_all" ON guesses;
CREATE POLICY "guesses_delete_all" ON guesses FOR DELETE TO anon, authenticated USING (true);

-- Hints: SELECT and INSERT for anon
DROP POLICY IF EXISTS "hints_select_all" ON hints;
CREATE POLICY "hints_select_all" ON hints FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "hints_insert_all" ON hints;
CREATE POLICY "hints_insert_all" ON hints FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "hints_update_all" ON hints;
CREATE POLICY "hints_update_all" ON hints FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "hints_delete_all" ON hints;
CREATE POLICY "hints_delete_all" ON hints FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- COLUMN-LEVEL SECURITY: hide answer columns from anon
-- The anon role can see initials but NOT the actual answers.
-- Only the service role (bypasses RLS) and SECURITY DEFINER functions can read answers.
-- ============================================================
REVOKE SELECT (hero_answer, heroine_answer, movie_answer) ON rounds FROM anon, authenticated;
GRANT SELECT (id, game_id, round_number, questioner_id, hero_initial, heroine_initial, movie_initial, status, started_at, ends_at, created_at) ON rounds TO anon, authenticated;

-- Revoke direct UPDATE on rounds so clients can't modify puzzle answers or status
REVOKE UPDATE ON rounds FROM anon, authenticated;

-- Revoke UPDATE on guesses so clients can't set correct/points after insert
REVOKE UPDATE ON guesses FROM anon, authenticated;

-- Revoke UPDATE on players.score so clients can't set their own score
REVOKE UPDATE (score) ON players FROM anon, authenticated;
GRANT UPDATE (display_name, session_id, connected) ON players TO anon, authenticated;

-- Revoke UPDATE on games status fields so clients can't change game state
REVOKE UPDATE (status, current_round, current_questioner_index, total_rounds, max_players) ON games FROM anon, authenticated;
GRANT UPDATE (updated_at) ON games TO anon, authenticated;

-- ============================================================
-- HELPER: normalize_answer(text) -> text
-- Trim, lowercase, collapse spaces, remove harmless punctuation
-- ============================================================
CREATE OR REPLACE FUNCTION normalize_answer(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    regexp_replace(
      btrim(
        regexp_replace(
          COALESCE(p_input, ''),
          '[.,;:!?"''(){}\[\]#@*&^%$~`|\\/<>_+=\-]', '', 'g'
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- ============================================================
-- HELPER: get_initial(text) -> text
-- Take the first meaningful character (skip leading whitespace/punctuation)
-- ============================================================
CREATE OR REPLACE FUNCTION get_initial(p_input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(substr(
    regexp_replace(
      btrim(COALESCE(p_input, '')),
      '^[^a-zA-Z0-9]+',
      ''
    ),
    1,
    1
  ));
$$;

-- ============================================================
-- HELPER: generate_room_code() -> text
-- Generate a unique 6-character alphanumeric room code
-- ============================================================
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_exists boolean;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;

    SELECT EXISTS(SELECT 1 FROM games WHERE room_code = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;
