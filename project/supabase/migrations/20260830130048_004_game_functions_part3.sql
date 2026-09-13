/*
# Game Logic Functions — Part 3: Advance Round, End Game, Reveal View, Disconnect

## Functions

### advance_round(p_game_id uuid)
Transitions from ROUND_REVEAL to SCOREBOARD, then to QUESTION_SELECTION for
the next round. Rotates the questioner index deterministically. Creates the
next round record (PENDING). If all rounds are done, transitions to GAME_OVER.

### get_reveal_state(p_game_id uuid)
Returns the full answers for the current round (only callable when game is
in ROUND_REVEAL). This is the ONLY function that exposes the secret answers
to the client, and only after the round has ended.

### set_player_connected(p_game_id uuid, p_player_id uuid, p_connected boolean)
Updates a player's connection status. Used for disconnect/reconnect handling.

### get_game_state(p_game_id uuid)
Returns a comprehensive snapshot of the game state for a client joining or
reconnecting — game status, current round info (public fields only), players,
and scores.
*/

-- ============================================================
-- ADVANCE ROUND (Reveal -> Scoreboard -> Next Round)
-- ============================================================
CREATE OR REPLACE FUNCTION advance_round(
  p_game_id uuid
)
RETURNS TABLE(
  game_status text,
  next_round int,
  next_questioner_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_next_round int;
  v_next_questioner_index int;
  v_next_questioner_id uuid;
  v_player_count int;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  -- Must be in ROUND_REVEAL or SCOREBOARD to advance
  IF v_game.status NOT IN ('ROUND_REVEAL', 'SCOREBOARD') THEN
    RAISE EXCEPTION 'Cannot advance from current state';
  END IF;

  v_next_round := v_game.current_round + 1;

  -- Check if all rounds are done
  IF v_next_round > v_game.total_rounds THEN
    UPDATE games SET status = 'GAME_OVER', updated_at = now() WHERE id = p_game_id;
    RETURN QUERY SELECT 'GAME_OVER'::text, v_next_round, NULL::uuid;
    RETURN;
  END IF;

  -- Rotate questioner index
  SELECT count(*) INTO v_player_count FROM players WHERE game_id = p_game_id;
  v_next_questioner_index := mod(v_game.current_questioner_index + 1, v_player_count);

  -- Get next questioner
  SELECT id INTO v_next_questioner_id FROM players
  WHERE game_id = p_game_id
  ORDER BY player_order
  LIMIT 1 OFFSET v_next_questioner_index;

  -- Update game: advance round, rotate questioner, go to QUESTION_SELECTION
  UPDATE games
  SET status = 'QUESTION_SELECTION',
      current_round = v_next_round,
      current_questioner_index = v_next_questioner_index,
      updated_at = now()
  WHERE id = p_game_id;

  -- Create next round record
  INSERT INTO rounds (game_id, round_number, questioner_id, status)
  VALUES (p_game_id, v_next_round, v_next_questioner_id, 'PENDING');

  RETURN QUERY SELECT 'QUESTION_SELECTION'::text, v_next_round, v_next_questioner_id;
END;
$$;

-- ============================================================
-- GET REVEAL STATE (returns secret answers — only after round ends)
-- ============================================================
CREATE OR REPLACE FUNCTION get_reveal_state(
  p_game_id uuid
)
RETURNS TABLE(
  round_number int,
  hero_answer text,
  heroine_answer text,
  movie_answer text,
  hero_initial text,
  heroine_initial text,
  movie_initial text
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  -- Only reveal when in ROUND_REVEAL, SCOREBOARD, or GAME_OVER
  IF v_game.status NOT IN ('ROUND_REVEAL', 'SCOREBOARD', 'GAME_OVER') THEN
    RAISE EXCEPTION 'Answers are not revealed yet';
  END IF;

  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No round found';
  END IF;

  RETURN QUERY SELECT v_round.round_number, v_round.hero_answer, v_round.heroine_answer,
    v_round.movie_answer, v_round.hero_initial, v_round.heroine_initial, v_round.movie_initial;
END;
$$;

-- ============================================================
-- SET PLAYER CONNECTED
-- ============================================================
CREATE OR REPLACE FUNCTION set_player_connected(
  p_game_id uuid,
  p_player_id uuid,
  p_connected boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE players SET connected = p_connected WHERE id = p_player_id AND game_id = p_game_id;
END;
$$;

-- ============================================================
-- GET GAME STATE (full snapshot for joining/reconnecting)
-- ============================================================
CREATE OR REPLACE FUNCTION get_game_state(
  p_game_id uuid
)
RETURNS TABLE(
  game_id uuid,
  room_code text,
  status text,
  total_rounds int,
  current_round int,
  current_questioner_index int,
  player_count int
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_count int;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  SELECT count(*) INTO v_count FROM players WHERE game_id = p_game_id;

  RETURN QUERY SELECT v_game.id, v_game.room_code, v_game.status::text,
    v_game.total_rounds, v_game.current_round, v_game.current_questioner_index, v_count;
END;
$$;

-- ============================================================
-- VIEW: rounds_public (hides answer columns)
-- A view that exposes only the public round fields.
-- Because anon lacks SELECT on the answer columns, this view
-- (which runs as invoker) naturally hides them.
-- ============================================================
CREATE OR REPLACE VIEW rounds_public AS
SELECT
  id,
  game_id,
  round_number,
  questioner_id,
  hero_initial,
  heroine_initial,
  movie_initial,
  status,
  started_at,
  ends_at,
  created_at
FROM rounds;

GRANT SELECT ON rounds_public TO anon, authenticated;
