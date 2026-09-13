/*
# Fix: Ambiguous column references in game functions

The PL/pgSQL rowtype variables (e.g. v_game) shadow table column names,
causing "column reference is ambiguous" errors. This migration recreates
all SECURITY DEFINER functions with fully table-qualified column references
(e.g. games.room_code instead of room_code).

## Changes
- Replaces create_game, join_game, start_game, create_round, submit_guess,
  request_hint, send_hint, reject_hint, end_round, reveal_answers,
  advance_round, get_reveal_state, get_game_state, set_player_connected
  with versions that qualify all column references with table names.
*/

-- ============================================================
-- CREATE GAME (fixed)
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
  IF p_display_name IS NULL OR length(btrim(p_display_name)) < 1 THEN
    RAISE EXCEPTION 'Display name cannot be empty';
  END IF;

  IF p_total_rounds NOT IN (5, 10) THEN
    p_total_rounds := 10;
  END IF;

  v_room_code := generate_room_code();

  INSERT INTO games (id, room_code, status, total_rounds, current_questioner_index)
  VALUES (gen_random_uuid(), v_room_code, 'LOBBY', p_total_rounds, 0)
  RETURNING games.id INTO v_game_id;

  INSERT INTO players (game_id, display_name, player_order, session_id)
  VALUES (v_game_id, btrim(p_display_name), 0, p_session_id)
  RETURNING players.id INTO v_player_id;

  RETURN QUERY SELECT v_game_id, v_room_code, v_player_id, btrim(p_display_name), 0;
END;
$$;

-- ============================================================
-- JOIN GAME (fixed)
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
  v_game_id uuid;
  v_room_code text;
  v_game_status game_status;
  v_max_players int;
  v_player_count int;
  v_next_order int;
  v_player_id uuid;
  v_existing_player_id uuid;
  v_existing_name text;
  v_existing_order int;
BEGIN
  IF p_display_name IS NULL OR length(btrim(p_display_name)) < 1 THEN
    RAISE EXCEPTION 'Display name cannot be empty';
  END IF;

  -- Find game by room code (use table-qualified names to avoid ambiguity)
  SELECT games.id, games.room_code, games.status, games.max_players
  INTO v_game_id, v_room_code, v_game_status, v_max_players
  FROM games WHERE games.room_code = upper(btrim(p_room_code));

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_game_status != 'LOBBY' THEN
    RAISE EXCEPTION 'Game has already started';
  END IF;

  SELECT count(*) INTO v_player_count FROM players WHERE players.game_id = v_game_id;
  IF v_player_count >= v_max_players THEN
    RAISE EXCEPTION 'Room is full';
  END IF;

  -- Check for duplicate session (reconnection)
  SELECT players.id, players.display_name, players.player_order
  INTO v_existing_player_id, v_existing_name, v_existing_order
  FROM players WHERE players.game_id = v_game_id AND players.session_id = p_session_id;

  IF v_existing_player_id IS NOT NULL THEN
    UPDATE players SET connected = true WHERE players.id = v_existing_player_id;
    RETURN QUERY SELECT v_game_id, v_room_code, v_existing_player_id, v_existing_name, v_existing_order;
    RETURN;
  END IF;

  SELECT count(*) INTO v_next_order FROM players WHERE players.game_id = v_game_id;

  INSERT INTO players (game_id, display_name, player_order, session_id)
  VALUES (v_game_id, btrim(p_display_name), v_next_order, p_session_id)
  RETURNING players.id INTO v_player_id;

  RETURN QUERY SELECT v_game_id, v_room_code, v_player_id, btrim(p_display_name), v_next_order;
END;
$$;

-- ============================================================
-- START GAME (fixed)
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
  v_game_id uuid;
  v_game_status game_status;
  v_questioner_index int;
  v_player_count int;
  v_questioner_id uuid;
BEGIN
  SELECT games.id, games.status, games.current_questioner_index
  INTO v_game_id, v_game_status, v_questioner_index
  FROM games WHERE games.id = p_game_id;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM players WHERE players.id = p_player_id AND players.game_id = p_game_id) THEN
    RAISE EXCEPTION 'Not a player in this game';
  END IF;

  IF v_game_status != 'LOBBY' THEN
    RAISE EXCEPTION 'Game has already started';
  END IF;

  SELECT count(*) INTO v_player_count FROM players WHERE players.game_id = p_game_id;
  IF v_player_count < 3 THEN
    RAISE EXCEPTION 'Need at least 3 players to start';
  END IF;

  SELECT players.id INTO v_questioner_id FROM players
  WHERE players.game_id = p_game_id
  ORDER BY players.player_order
  LIMIT 1 OFFSET v_questioner_index;

  UPDATE games SET status = 'QUESTION_SELECTION', updated_at = now() WHERE games.id = p_game_id;

  INSERT INTO rounds (game_id, round_number, questioner_id, status)
  VALUES (p_game_id, 1, v_questioner_id, 'PENDING');
END;
$$;

-- ============================================================
-- CREATE ROUND (fixed)
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
  v_game_status game_status;
  v_round_id uuid;
  v_round_number int;
  v_round_questioner_id uuid;
  v_hero_init text;
  v_heroine_init text;
  v_movie_init text;
  v_ends_at timestamptz;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status != 'QUESTION_SELECTION' THEN
    RAISE EXCEPTION 'Not in question selection phase';
  END IF;

  SELECT rounds.id, rounds.round_number, rounds.questioner_id
  INTO v_round_id, v_round_number, v_round_questioner_id
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'PENDING'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'No pending round found';
  END IF;

  IF v_round_questioner_id != p_player_id THEN
    RAISE EXCEPTION 'You are not the questioner';
  END IF;

  IF p_hero IS NULL OR length(btrim(p_hero)) < 2 THEN
    RAISE EXCEPTION 'Hero cannot be empty';
  END IF;
  IF p_heroine IS NULL OR length(btrim(p_heroine)) < 2 THEN
    RAISE EXCEPTION 'Heroine cannot be empty';
  END IF;
  IF p_movie IS NULL OR length(btrim(p_movie)) < 2 THEN
    RAISE EXCEPTION 'Movie cannot be empty';
  END IF;

  v_hero_init := get_initial(p_hero);
  v_heroine_init := get_initial(p_heroine);
  v_movie_init := get_initial(p_movie);
  v_ends_at := now() + interval '90 seconds';

  UPDATE rounds
  SET hero_answer = btrim(p_hero),
      heroine_answer = btrim(p_heroine),
      movie_answer = btrim(p_movie),
      hero_initial = v_hero_init,
      heroine_initial = v_heroine_init,
      movie_initial = v_movie_init,
      status = 'ACTIVE',
      started_at = now(),
      ends_at = v_ends_at
  WHERE rounds.id = v_round_id;

  UPDATE games SET status = 'ROUND_ACTIVE', updated_at = now() WHERE games.id = p_game_id;

  RETURN QUERY SELECT v_round_id, v_round_number, v_hero_init, v_heroine_init, v_movie_init, v_ends_at;
END;
$$;

-- ============================================================
-- SUBMIT GUESS (fixed)
-- ============================================================
CREATE OR REPLACE FUNCTION submit_guess(
  p_game_id uuid,
  p_player_id uuid,
  p_category text,
  p_guess text
)
RETURNS TABLE(
  correct boolean,
  points_awarded numeric,
  already_solved boolean
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game_status game_status;
  v_round_id uuid;
  v_round_questioner_id uuid;
  v_round_ends_at timestamptz;
  v_round_hero_answer text;
  v_round_heroine_answer text;
  v_round_movie_answer text;
  v_normalized_guess text;
  v_normalized_answer text;
  v_is_correct boolean;
  v_used_hint boolean := false;
  v_points numeric := 0;
  v_existing_correct int;
  v_all_solved boolean;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT rounds.id, rounds.questioner_id, rounds.ends_at,
         rounds.hero_answer, rounds.heroine_answer, rounds.movie_answer
  INTO v_round_id, v_round_questioner_id, v_round_ends_at,
       v_round_hero_answer, v_round_heroine_answer, v_round_movie_answer
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'ACTIVE'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  IF v_round_questioner_id = p_player_id THEN
    RAISE EXCEPTION 'Questioner cannot guess';
  END IF;

  IF now() >= v_round_ends_at THEN
    UPDATE rounds SET status = 'ENDED' WHERE rounds.id = v_round_id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE games.id = p_game_id;
    RAISE EXCEPTION 'Round time has expired';
  END IF;

  IF p_guess IS NULL OR length(btrim(p_guess)) < 1 THEN
    RAISE EXCEPTION 'Guess cannot be empty';
  END IF;

  SELECT count(*) INTO v_existing_correct FROM guesses
  WHERE guesses.round_id = v_round_id
    AND guesses.player_id = p_player_id
    AND guesses.category = p_category::guess_category
    AND guesses.correct = true;

  IF v_existing_correct > 0 THEN
    INSERT INTO guesses (round_id, player_id, category, guess_text, correct, used_hint, points_awarded)
    VALUES (v_round_id, p_player_id, p_category::guess_category, btrim(p_guess), false, false, 0);
    RETURN QUERY SELECT false, 0::numeric, true;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM hints
    WHERE hints.round_id = v_round_id
      AND hints.requested_by_player_id = p_player_id
      AND hints.category = p_category::guess_category
      AND hints.status = 'SENT'
  ) INTO v_used_hint;

  v_normalized_guess := normalize_answer(p_guess);

  IF p_category = 'HERO' THEN
    v_normalized_answer := normalize_answer(v_round_hero_answer);
  ELSIF p_category = 'HEROINE' THEN
    v_normalized_answer := normalize_answer(v_round_heroine_answer);
  ELSIF p_category = 'MOVIE' THEN
    v_normalized_answer := normalize_answer(v_round_movie_answer);
  ELSE
    RAISE EXCEPTION 'Invalid category';
  END IF;

  v_is_correct := (v_normalized_guess = v_normalized_answer);

  IF v_is_correct THEN
    IF v_used_hint THEN
      v_points := 0.5;
    ELSE
      v_points := 1.0;
    END IF;
    UPDATE players SET score = players.score + v_points WHERE players.id = p_player_id;
  ELSE
    v_points := 0;
  END IF;

  INSERT INTO guesses (round_id, player_id, category, guess_text, correct, used_hint, points_awarded)
  VALUES (v_round_id, p_player_id, p_category::guess_category, btrim(p_guess), v_is_correct, v_used_hint, v_points);

  SELECT (
    EXISTS(SELECT 1 FROM guesses WHERE guesses.round_id = v_round_id AND guesses.category = 'HERO' AND guesses.correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE guesses.round_id = v_round_id AND guesses.category = 'HEROINE' AND guesses.correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE guesses.round_id = v_round_id AND guesses.category = 'MOVIE' AND guesses.correct = true)
  ) INTO v_all_solved;

  IF v_all_solved THEN
    UPDATE rounds SET status = 'ENDED' WHERE rounds.id = v_round_id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE games.id = p_game_id;
  END IF;

  RETURN QUERY SELECT v_is_correct, v_points, false;
END;
$$;

-- ============================================================
-- REQUEST HINT (fixed)
-- ============================================================
CREATE OR REPLACE FUNCTION request_hint(
  p_game_id uuid,
  p_player_id uuid,
  p_category text
)
RETURNS TABLE(hint_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game_status game_status;
  v_round_id uuid;
  v_round_questioner_id uuid;
  v_round_ends_at timestamptz;
  v_already_solved boolean;
  v_hint_id uuid;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT rounds.id, rounds.questioner_id, rounds.ends_at
  INTO v_round_id, v_round_questioner_id, v_round_ends_at
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'ACTIVE'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  IF v_round_questioner_id = p_player_id THEN
    RAISE EXCEPTION 'Questioner cannot request hints';
  END IF;

  IF now() >= v_round_ends_at THEN
    UPDATE rounds SET status = 'ENDED' WHERE rounds.id = v_round_id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE games.id = p_game_id;
    RAISE EXCEPTION 'Round time has expired';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM guesses
    WHERE guesses.round_id = v_round_id AND guesses.player_id = p_player_id
      AND guesses.category = p_category::guess_category AND guesses.correct = true
  ) INTO v_already_solved;

  IF v_already_solved THEN
    RAISE EXCEPTION 'You already solved this category';
  END IF;

  IF EXISTS (
    SELECT 1 FROM hints
    WHERE hints.round_id = v_round_id
      AND hints.requested_by_player_id = p_player_id
      AND hints.category = p_category::guess_category
      AND hints.status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'You already have a pending hint request for this category';
  END IF;

  INSERT INTO hints (round_id, requested_by_player_id, category, cost, status)
  VALUES (v_round_id, p_player_id, p_category::guess_category, 0.3, 'PENDING')
  RETURNING hints.id INTO v_hint_id;

  RETURN QUERY SELECT v_hint_id;
END;
$$;

-- ============================================================
-- SEND HINT (fixed)
-- ============================================================
CREATE OR REPLACE FUNCTION send_hint(
  p_game_id uuid,
  p_player_id uuid,
  p_hint_id uuid,
  p_hint_text text,
  p_cost numeric DEFAULT 0.3
)
RETURNS TABLE(
  hint_id uuid,
  category text,
  hint_text text,
  requested_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game_status game_status;
  v_round_id uuid;
  v_round_questioner_id uuid;
  v_hint_id uuid;
  v_hint_category guess_category;
  v_hint_status hint_status;
  v_hint_requested_by uuid;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT rounds.id, rounds.questioner_id
  INTO v_round_id, v_round_questioner_id
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'ACTIVE'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  IF v_round_questioner_id != p_player_id THEN
    RAISE EXCEPTION 'Only the questioner can send hints';
  END IF;

  SELECT hints.id, hints.category, hints.status, hints.requested_by_player_id
  INTO v_hint_id, v_hint_category, v_hint_status, v_hint_requested_by
  FROM hints WHERE hints.id = p_hint_id AND hints.round_id = v_round_id;

  IF v_hint_id IS NULL THEN
    RAISE EXCEPTION 'Hint not found';
  END IF;

  IF v_hint_status != 'PENDING' THEN
    RAISE EXCEPTION 'Hint already processed';
  END IF;

  IF p_hint_text IS NULL OR length(btrim(p_hint_text)) < 1 THEN
    RAISE EXCEPTION 'Hint text cannot be empty';
  END IF;

  UPDATE hints
  SET hint_text = btrim(p_hint_text),
      status = 'SENT',
      cost = p_cost
  WHERE hints.id = p_hint_id;

  RETURN QUERY SELECT p_hint_id, v_hint_category::text, btrim(p_hint_text), v_hint_requested_by;
END;
$$;

-- ============================================================
-- REJECT HINT (fixed)
-- ============================================================
CREATE OR REPLACE FUNCTION reject_hint(
  p_game_id uuid,
  p_player_id uuid,
  p_hint_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_round_id uuid;
  v_round_questioner_id uuid;
  v_hint_id uuid;
BEGIN
  SELECT rounds.id, rounds.questioner_id
  INTO v_round_id, v_round_questioner_id
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'ACTIVE'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  IF v_round_questioner_id != p_player_id THEN
    RAISE EXCEPTION 'Only the questioner can reject hints';
  END IF;

  SELECT hints.id INTO v_hint_id FROM hints
  WHERE hints.id = p_hint_id AND hints.round_id = v_round_id AND hints.status = 'PENDING';

  IF v_hint_id IS NULL THEN
    RAISE EXCEPTION 'Hint not found';
  END IF;

  UPDATE hints SET status = 'REJECTED' WHERE hints.id = p_hint_id;
END;
$$;

-- ============================================================
-- END ROUND (fixed)
-- ============================================================
CREATE OR REPLACE FUNCTION end_round(
  p_game_id uuid
)
RETURNS TABLE(ended boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game_status game_status;
  v_round_id uuid;
  v_round_ends_at timestamptz;
  v_all_solved boolean;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status != 'ROUND_ACTIVE' THEN
    RETURN QUERY SELECT false, 'not active'::text;
    RETURN;
  END IF;

  SELECT rounds.id, rounds.ends_at
  INTO v_round_id, v_round_ends_at
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'ACTIVE'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RETURN QUERY SELECT false, 'no active round'::text;
    RETURN;
  END IF;

  IF now() >= v_round_ends_at THEN
    UPDATE rounds SET status = 'ENDED' WHERE rounds.id = v_round_id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE games.id = p_game_id;
    RETURN QUERY SELECT true, 'timer'::text;
    RETURN;
  END IF;

  SELECT (
    EXISTS(SELECT 1 FROM guesses WHERE guesses.round_id = v_round_id AND guesses.category = 'HERO' AND guesses.correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE guesses.round_id = v_round_id AND guesses.category = 'HEROINE' AND guesses.correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE guesses.round_id = v_round_id AND guesses.category = 'MOVIE' AND guesses.correct = true)
  ) INTO v_all_solved;

  IF v_all_solved THEN
    UPDATE rounds SET status = 'ENDED' WHERE rounds.id = v_round_id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE games.id = p_game_id;
    RETURN QUERY SELECT true, 'all solved'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'not ended'::text;
END;
$$;

-- ============================================================
-- REVEAL ANSWERS (fixed)
-- ============================================================
CREATE OR REPLACE FUNCTION reveal_answers(
  p_game_id uuid,
  p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game_status game_status;
  v_round_id uuid;
  v_round_questioner_id uuid;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT rounds.id, rounds.questioner_id
  INTO v_round_id, v_round_questioner_id
  FROM rounds
  WHERE rounds.game_id = p_game_id AND rounds.status = 'ACTIVE'
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_id IS NULL THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  IF v_round_questioner_id != p_player_id THEN
    RAISE EXCEPTION 'Only the questioner can reveal answers';
  END IF;

  UPDATE rounds SET status = 'ENDED' WHERE rounds.id = v_round_id;
  UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE games.id = p_game_id;
END;
$$;

-- ============================================================
-- ADVANCE ROUND (fixed)
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
  v_game_status game_status;
  v_total_rounds int;
  v_current_round int;
  v_current_questioner_index int;
  v_next_round int;
  v_next_questioner_index int;
  v_player_count int;
  v_next_questioner_id uuid;
BEGIN
  SELECT games.status, games.total_rounds, games.current_round, games.current_questioner_index
  INTO v_game_status, v_total_rounds, v_current_round, v_current_questioner_index
  FROM games WHERE games.id = p_game_id;

  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status NOT IN ('ROUND_REVEAL', 'SCOREBOARD') THEN
    RAISE EXCEPTION 'Cannot advance from current state';
  END IF;

  v_next_round := v_current_round + 1;

  IF v_next_round > v_total_rounds THEN
    UPDATE games SET status = 'GAME_OVER', updated_at = now() WHERE games.id = p_game_id;
    RETURN QUERY SELECT 'GAME_OVER'::text, v_next_round, NULL::uuid;
    RETURN;
  END IF;

  SELECT count(*) INTO v_player_count FROM players WHERE players.game_id = p_game_id;
  v_next_questioner_index := mod(v_current_questioner_index + 1, v_player_count);

  SELECT players.id INTO v_next_questioner_id FROM players
  WHERE players.game_id = p_game_id
  ORDER BY players.player_order
  LIMIT 1 OFFSET v_next_questioner_index;

  UPDATE games
  SET status = 'QUESTION_SELECTION',
      current_round = v_next_round,
      current_questioner_index = v_next_questioner_index,
      updated_at = now()
  WHERE games.id = p_game_id;

  INSERT INTO rounds (game_id, round_number, questioner_id, status)
  VALUES (p_game_id, v_next_round, v_next_questioner_id, 'PENDING');

  RETURN QUERY SELECT 'QUESTION_SELECTION'::text, v_next_round, v_next_questioner_id;
END;
$$;

-- ============================================================
-- GET REVEAL STATE (fixed)
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
  v_game_status game_status;
  v_round_number int;
  v_hero_answer text;
  v_heroine_answer text;
  v_movie_answer text;
  v_hero_initial text;
  v_heroine_initial text;
  v_movie_initial text;
BEGIN
  SELECT games.status INTO v_game_status FROM games WHERE games.id = p_game_id;
  IF v_game_status IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game_status NOT IN ('ROUND_REVEAL', 'SCOREBOARD', 'GAME_OVER') THEN
    RAISE EXCEPTION 'Answers are not revealed yet';
  END IF;

  SELECT rounds.round_number, rounds.hero_answer, rounds.heroine_answer, rounds.movie_answer,
         rounds.hero_initial, rounds.heroine_initial, rounds.movie_initial
  INTO v_round_number, v_hero_answer, v_heroine_answer, v_movie_answer,
       v_hero_initial, v_heroine_initial, v_movie_initial
  FROM rounds
  WHERE rounds.game_id = p_game_id
  ORDER BY rounds.round_number DESC LIMIT 1;

  IF v_round_number IS NULL THEN
    RAISE EXCEPTION 'No round found';
  END IF;

  RETURN QUERY SELECT v_round_number, v_hero_answer, v_heroine_answer, v_movie_answer,
    v_hero_initial, v_heroine_initial, v_movie_initial;
END;
$$;

-- ============================================================
-- SET PLAYER CONNECTED (fixed)
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
  UPDATE players SET connected = p_connected WHERE players.id = p_player_id AND players.game_id = p_game_id;
END;
$$;

-- ============================================================
-- GET GAME STATE (fixed)
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
  v_game_id uuid;
  v_room_code text;
  v_game_status game_status;
  v_total_rounds int;
  v_current_round int;
  v_current_questioner_index int;
  v_count int;
BEGIN
  SELECT games.id, games.room_code, games.status, games.total_rounds,
         games.current_round, games.current_questioner_index
  INTO v_game_id, v_room_code, v_game_status, v_total_rounds,
       v_current_round, v_current_questioner_index
  FROM games WHERE games.id = p_game_id;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  SELECT count(*) INTO v_count FROM players WHERE players.game_id = p_game_id;

  RETURN QUERY SELECT v_game_id, v_room_code, v_game_status::text,
    v_total_rounds, v_current_round, v_current_questioner_index, v_count;
END;
$$;
