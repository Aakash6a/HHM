/*
# Game Logic Functions — Part 2: Guess, Hint, End Round

## Functions

### submit_guess(p_game_id uuid, p_player_id uuid, p_category text, p_guess text)
Validates: game is ROUND_ACTIVE, caller is NOT the questioner, round timer
not expired, category not already solved by this player. Normalizes the guess
and compares against the questioner's stored answer. Awards +1.0 without hint
or +0.5 if the player has used a hint for that category. Returns correctness
and points awarded. Also checks if all three categories are solved by at least
one chaser — if so, triggers round end.

### request_hint(p_game_id uuid, p_player_id uuid, p_category text)
Validates: game is ROUND_ACTIVE, caller is not questioner, category not already
solved by this player, no existing pending hint for this player+category.
Creates a PENDING hint record. Returns hint_id.

### send_hint(p_game_id uuid, p_player_id uuid, p_hint_id uuid, p_hint_text text, p_cost numeric)
Validates: game is ROUND_ACTIVE, caller is the questioner, hint is PENDING.
Stores the hint text, marks hint as SENT. Marks the requesting player as having
used a hint for that category (so their future correct guess is worth +0.5).
Returns the hint info.

### reject_hint(p_game_id uuid, p_player_id uuid, p_hint_id uuid)
Questioner rejects a hint request.

### end_round(p_game_id uuid)
Server-authoritative round end. Checks timer expiry or all-solved condition.
Transitions round to ENDED, game to ROUND_REVEAL. Stops accepting guesses.
Can be called by any client to trigger the check — the function itself decides
whether the round should end.
*/

-- ============================================================
-- SUBMIT GUESS
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
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
  v_normalized_guess text;
  v_normalized_answer text;
  v_is_correct boolean;
  v_used_hint boolean := false;
  v_points numeric := 0;
  v_already_solved boolean := false;
  v_existing_correct int;
  v_all_solved boolean;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  -- Check game is in ROUND_ACTIVE
  IF v_game.status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  -- Get the active round
  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'ACTIVE'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  -- Verify caller is NOT the questioner
  IF v_round.questioner_id = p_player_id THEN
    RAISE EXCEPTION 'Questioner cannot guess';
  END IF;

  -- Check timer not expired
  IF now() >= v_round.ends_at THEN
    -- Auto-end the round
    UPDATE rounds SET status = 'ENDED' WHERE id = v_round.id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE id = p_game_id;
    RAISE EXCEPTION 'Round time has expired';
  END IF;

  -- Validate guess text
  IF p_guess IS NULL OR length(btrim(p_guess)) < 1 THEN
    RAISE EXCEPTION 'Guess cannot be empty';
  END IF;

  -- Check if this player already solved this category
  SELECT count(*) INTO v_existing_correct FROM guesses
  WHERE round_id = v_round.id
    AND player_id = p_player_id
    AND category = p_category::guess_category
    AND correct = true;

  IF v_existing_correct > 0 THEN
    -- Already solved — record the guess but award 0 points
    INSERT INTO guesses (round_id, player_id, category, guess_text, correct, used_hint, points_awarded)
    VALUES (v_round.id, p_player_id, p_category::guess_category, btrim(p_guess), false, false, 0);

    RETURN QUERY SELECT false, 0::numeric, true;
    RETURN;
  END IF;

  -- Check if player used a hint for this category
  SELECT EXISTS(
    SELECT 1 FROM hints
    WHERE round_id = v_round.id
      AND requested_by_player_id = p_player_id
      AND category = p_category::guess_category
      AND status = 'SENT'
  ) INTO v_used_hint;

  -- Normalize and compare
  v_normalized_guess := normalize_answer(p_guess);

  IF p_category = 'HERO' THEN
    v_normalized_answer := normalize_answer(v_round.hero_answer);
  ELSIF p_category = 'HEROINE' THEN
    v_normalized_answer := normalize_answer(v_round.heroine_answer);
  ELSIF p_category = 'MOVIE' THEN
    v_normalized_answer := normalize_answer(v_round.movie_answer);
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

    -- Award points to player
    UPDATE players SET score = score + v_points WHERE id = p_player_id;
  ELSE
    v_points := 0;
  END IF;

  -- Record the guess
  INSERT INTO guesses (round_id, player_id, category, guess_text, correct, used_hint, points_awarded)
  VALUES (v_round.id, p_player_id, p_category::guess_category, btrim(p_guess), v_is_correct, v_used_hint, v_points);

  -- Check if all three categories are solved by at least one chaser
  SELECT (
    EXISTS(SELECT 1 FROM guesses WHERE round_id = v_round.id AND category = 'HERO' AND correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE round_id = v_round.id AND category = 'HEROINE' AND correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE round_id = v_round.id AND category = 'MOVIE' AND correct = true)
  ) INTO v_all_solved;

  IF v_all_solved THEN
    -- End the round immediately
    UPDATE rounds SET status = 'ENDED' WHERE id = v_round.id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE id = p_game_id;
  END IF;

  RETURN QUERY SELECT v_is_correct, v_points, false;
END;
$$;

-- ============================================================
-- REQUEST HINT
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
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
  v_hint_id uuid;
  v_already_solved boolean;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game.status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'ACTIVE'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  -- Caller must not be the questioner
  IF v_round.questioner_id = p_player_id THEN
    RAISE EXCEPTION 'Questioner cannot request hints';
  END IF;

  -- Check timer
  IF now() >= v_round.ends_at THEN
    UPDATE rounds SET status = 'ENDED' WHERE id = v_round.id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE id = p_game_id;
    RAISE EXCEPTION 'Round time has expired';
  END IF;

  -- Check category not already solved by this player
  SELECT EXISTS(
    SELECT 1 FROM guesses
    WHERE round_id = v_round.id AND player_id = p_player_id
      AND category = p_category::guess_category AND correct = true
  ) INTO v_already_solved;
  IF v_already_solved THEN
    RAISE EXCEPTION 'You already solved this category';
  END IF;

  -- Check no existing pending hint for this player+category
  IF EXISTS (
    SELECT 1 FROM hints
    WHERE round_id = v_round.id
      AND requested_by_player_id = p_player_id
      AND category = p_category::guess_category
      AND status = 'PENDING'
  ) THEN
    RAISE EXCEPTION 'You already have a pending hint request for this category';
  END IF;

  -- Create hint request
  INSERT INTO hints (round_id, requested_by_player_id, category, cost, status)
  VALUES (v_round.id, p_player_id, p_category::guess_category, 0.3, 'PENDING')
  RETURNING id INTO v_hint_id;

  RETURN QUERY SELECT v_hint_id;
END;
$$;

-- ============================================================
-- SEND HINT
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
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
  v_hint hints%ROWTYPE;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game.status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'ACTIVE'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  -- Caller must be the questioner
  IF v_round.questioner_id != p_player_id THEN
    RAISE EXCEPTION 'Only the questioner can send hints';
  END IF;

  -- Get the hint
  SELECT * INTO v_hint FROM hints WHERE id = p_hint_id AND round_id = v_round.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hint not found';
  END IF;

  IF v_hint.status != 'PENDING' THEN
    RAISE EXCEPTION 'Hint already processed';
  END IF;

  IF p_hint_text IS NULL OR length(btrim(p_hint_text)) < 1 THEN
    RAISE EXCEPTION 'Hint text cannot be empty';
  END IF;

  -- Update hint
  UPDATE hints
  SET hint_text = btrim(p_hint_text),
      status = 'SENT',
      cost = p_cost
  WHERE id = p_hint_id;

  RETURN QUERY SELECT p_hint_id, v_hint.category::text, btrim(p_hint_text), v_hint.requested_by_player_id;
END;
$$;

-- ============================================================
-- REJECT HINT
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
  v_round rounds%ROWTYPE;
  v_hint hints%ROWTYPE;
BEGIN
  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'ACTIVE'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  IF v_round.questioner_id != p_player_id THEN
    RAISE EXCEPTION 'Only the questioner can reject hints';
  END IF;

  SELECT * INTO v_hint FROM hints WHERE id = p_hint_id AND round_id = v_round.id AND status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hint not found';
  END IF;

  UPDATE hints SET status = 'REJECTED' WHERE id = p_hint_id;
END;
$$;

-- ============================================================
-- END ROUND (server-authoritative — checks timer or all-solved)
-- ============================================================
CREATE OR REPLACE FUNCTION end_round(
  p_game_id uuid
)
RETURNS TABLE(ended boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
  v_all_solved boolean;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  -- Only end if currently in ROUND_ACTIVE
  IF v_game.status != 'ROUND_ACTIVE' THEN
    RETURN QUERY SELECT false, 'not active'::text;
    RETURN;
  END IF;

  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'ACTIVE'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no active round'::text;
    RETURN;
  END IF;

  -- Check timer expiry
  IF now() >= v_round.ends_at THEN
    UPDATE rounds SET status = 'ENDED' WHERE id = v_round.id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE id = p_game_id;
    RETURN QUERY SELECT true, 'timer'::text;
    RETURN;
  END IF;

  -- Check all solved
  SELECT (
    EXISTS(SELECT 1 FROM guesses WHERE round_id = v_round.id AND category = 'HERO' AND correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE round_id = v_round.id AND category = 'HEROINE' AND correct = true)
    AND EXISTS(SELECT 1 FROM guesses WHERE round_id = v_round.id AND category = 'MOVIE' AND correct = true)
  ) INTO v_all_solved;

  IF v_all_solved THEN
    UPDATE rounds SET status = 'ENDED' WHERE id = v_round.id;
    UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE id = p_game_id;
    RETURN QUERY SELECT true, 'all solved'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'not ended'::text;
END;
$$;

-- ============================================================
-- REVEAL ANSWERS (Questioner presses "Reveal Answers")
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
  v_game games%ROWTYPE;
  v_round rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found';
  END IF;

  IF v_game.status != 'ROUND_ACTIVE' THEN
    RAISE EXCEPTION 'Round is not active';
  END IF;

  SELECT * INTO v_round FROM rounds
  WHERE game_id = p_game_id AND status = 'ACTIVE'
  ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active round found';
  END IF;

  -- Only the questioner can reveal
  IF v_round.questioner_id != p_player_id THEN
    RAISE EXCEPTION 'Only the questioner can reveal answers';
  END IF;

  UPDATE rounds SET status = 'ENDED' WHERE id = v_round.id;
  UPDATE games SET status = 'ROUND_REVEAL', updated_at = now() WHERE id = p_game_id;
END;
$$;
