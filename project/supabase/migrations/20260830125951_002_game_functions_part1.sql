/*
# Game Logic Functions — Part 1: Create, Join, Start, Create Round

Server-authoritative SECURITY DEFINER functions that act as the "GameService".
All game state, scoring, timer, and rotation logic lives here — the browser
only calls these RPCs and can never set scores, correctness, or state directly.

## Functions

### create_game(p_display_name text, p_total_rounds int, p_session_id text)
Creates a game with a unique room code, adds the creator as the first player
(player_order 0), and returns the game + player info.
The creator becomes the first Questioner (current_questioner_index = 0).

### join_game(p_room_code text, p_display_name text, p_session_id text)
Validates: room exists, game not started, room not full, name not empty.
Adds the player to the lobby with the next player_order.
Returns game + player info.

### start_game(p_game_id uuid, p_player_id uuid)
Validates: caller is a player in the game, game is in LOBBY, players >= 3.
Transitions game to QUESTION_SELECTION. Creates the first round record
(status PENDING) with the questioner determined by current_questioner_index.

### create_round(p_game_id uuid, p_player_id uuid, p_hero text, p_heroine text, p_movie text)
Validates: game is in QUESTION_SELECTION, caller is the current questioner,
answers are non-empty (min 2 chars). Stores the secret answers, generates
initials, and transitions game to ROUND_ACTIVE. Sets the 90-second timer.
Returns the public round state (initials only — never the answers).
*/

-- ============================================================
-- CREATE GAME
-- ============================================================
CREATE OR REPLACE FUNCTION create_game(
  p_display_name text,
  p_total_rounds int DEFAULT 10,
  p_session_id text DEFAULT gen_random_uuid()::text
)
RETURNS TABLE(
  game_id uuid,
  room_code text,
  player_id uuid,
  display_name text,
  player_order int
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game_id uuid;
  v_room_code text;
  v_player_id uuid;
BEGIN
  -- Validate display name
  IF p_display_name IS NULL OR length(btrim(p_display_name)) < 1 THEN
    RAISE EXCEPTION 'Display name cannot be empty';
  END IF;

  -- Validate total rounds
  IF p_total_rounds NOT IN (5, 10) THEN
    p_total_rounds := 10;
  END IF;

  -- Generate unique room code
  v_room_code := generate_room_code();

  -- Create game
  INSERT INTO games (id, room_code, status, total_rounds, current_questioner_index)
  VALUES (gen_random_uuid(), v_room_code, 'LOBBY', p_total_rounds, 0)
  RETURNING id INTO v_game_id;

  -- Add creator as first player
  INSERT INTO players (game_id, display_name, player_order, session_id)
  VALUES (v_game_id, btrim(p_display_name), 0, p_session_id)
  RETURNING id INTO v_player_id;

  RETURN QUERY SELECT v_game_id, v_room_code, v_player_id, btrim(p_display_name), 0;
END;
$$;

-- ============================================================
-- JOIN GAME
-- ============================================================
CREATE OR REPLACE FUNCTION join_game(
  p_room_code text,
  p_display_name text,
  p_session_id text DEFAULT gen_random_uuid()::text
)
RETURNS TABLE(
  game_id uuid,
  room_code text,
  player_id uuid,
  display_name text,
  player_order int
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_player_count int;
  v_next_order int;
  v_player_id uuid;
BEGIN
  -- Validate display name
  IF p_display_name IS NULL OR length(btrim(p_display_name)) < 1 THEN
    RAISE EXCEPTION 'Display name cannot be empty';
  END IF;

  -- Find game by room code
  SELECT * INTO v_game FROM games WHERE room_code = upper(btrim(p_room_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  -- Check game hasn't started
  IF v_game.status != 'LOBBY' THEN
    RAISE EXCEPTION 'Game has already started';
  END IF;

  -- Check room isn't full
  SELECT count(*) INTO v_player_count FROM players WHERE game_id = v_game.id;
  IF v_player_count >= v_game.max_players THEN
    RAISE EXCEPTION 'Room is full';
  END IF;

  -- Check for duplicate session (reconnection)
  SELECT id INTO v_player_id FROM players WHERE game_id = v_game.id AND session_id = p_session_id;
  IF FOUND THEN
    -- Reconnecting: update connected status and return existing
    UPDATE players SET connected = true WHERE id = v_player_id;
    RETURN QUERY SELECT v_game.id, v_game.room_code, v_player_id,
      (SELECT display_name FROM players WHERE id = v_player_id),
      (SELECT player_order FROM players WHERE id = v_player_id);
    RETURN;
  END IF;

  -- Assign next player_order
  SELECT count(*) INTO v_next_order FROM players WHERE game_id = v_game.id;

  -- Add player
  INSERT INTO players (game_id, display_name, player_order, session_id)
  VALUES (v_game.id, btrim(p_display_name), v_next_order, p_session_id)
  RETURNING id INTO v_player_id;

  RETURN QUERY SELECT v_game.id, v_game.room_code, v_player_id, btrim(p_display_name), v_next_order;
END;
$$;

-- ============================================================
-- START GAME
-- ============================================================
CREATE OR REPLACE FUNCTION start_game(
  p_game_id uuid,
  p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_player_count int;
  v_questioner_id uuid;
  v_questioner_index int;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  -- Verify caller is a player
  IF NOT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND game_id = p_game_id) THEN
    RAISE EXCEPTION 'Not a player in this game';
  END IF;

  -- Check game is in LOBBY
  IF v_game.status != 'LOBBY' THEN
    RAISE EXCEPTION 'Game has already started';
  END IF;

  -- Check minimum players
  SELECT count(*) INTO v_player_count FROM players WHERE game_id = p_game_id;
  IF v_player_count < 3 THEN
    RAISE EXCEPTION 'Need at least 3 players to start';
  END IF;

  -- Get questioner for round 1
  v_questioner_index := v_game.current_questioner_index;

  SELECT id INTO v_questioner_id FROM players
  WHERE game_id = p_game_id
  ORDER BY player_order
  LIMIT 1 OFFSET v_questioner_index;

  -- Transition to QUESTION_SELECTION
  UPDATE games SET status = 'QUESTION_SELECTION', updated_at = now() WHERE id = p_game_id;

  -- Create round 1 record (PENDING)
  INSERT INTO rounds (game_id, round_number, questioner_id, status)
  VALUES (p_game_id, 1, v_questioner_id, 'PENDING');
END;
$$;

-- ============================================================
-- CREATE ROUND (Questioner submits puzzle)
-- ============================================================
CREATE OR REPLACE FUNCTION create_round(
  p_game_id uuid,
  p_player_id uuid,
  p_hero text,
  p_heroine text,
  p_movie text
)
RETURNS TABLE(
  round_id uuid,
  round_number int,
  hero_initial text,
  heroine_initial text,
  movie_initial text,
  ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
  v_questioner_id uuid;
  v_hero_init text;
  v_heroine_init text;
  v_movie_init text;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  -- Check game is in QUESTION_SELECTION
  IF v_game.status != 'QUESTION_SELECTION' THEN
    RAISE EXCEPTION 'Not in question selection phase';
  END IF;

  -- Get the current pending round
  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'PENDING'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No pending round found';
  END IF;

  -- Verify caller is the questioner
  IF v_round.questioner_id != p_player_id THEN
    RAISE EXCEPTION 'You are not the questioner';
  END IF;

  -- Validate answers (non-empty, min 2 chars)
  IF p_hero IS NULL OR length(btrim(p_hero)) < 2 THEN
    RAISE EXCEPTION 'Hero cannot be empty';
  END IF;
  IF p_heroine IS NULL OR length(btrim(p_heroine)) < 2 THEN
    RAISE EXCEPTION 'Heroine cannot be empty';
  END IF;
  IF p_movie IS NULL OR length(btrim(p_movie)) < 2 THEN
    RAISE EXCEPTION 'Movie cannot be empty';
  END IF;

  -- Generate initials
  v_hero_init := get_initial(p_hero);
  v_heroine_init := get_initial(p_heroine);
  v_movie_init := get_initial(p_movie);

  -- Store answers and initials, start the round
  UPDATE rounds
  SET hero_answer = btrim(p_hero),
      heroine_answer = btrim(p_heroine),
      movie_answer = btrim(p_movie),
      hero_initial = v_hero_init,
      heroine_initial = v_heroine_init,
      movie_initial = v_movie_init,
      status = 'ACTIVE',
      started_at = now(),
      ends_at = now() + interval '90 seconds'
  WHERE id = v_round.id;

  -- Transition game to ROUND_ACTIVE
  UPDATE games SET status = 'ROUND_ACTIVE', updated_at = now() WHERE id = p_game_id;

  RETURN QUERY SELECT v_round.id, v_round.round_number, v_hero_init, v_heroine_init, v_movie_init,
    now() + interval '90 seconds';
END;
$$;
