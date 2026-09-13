/*
# Fix: start_game must set current_round = 1

When the game starts, `current_round` must be set to 1 (since round 1 is
being created). Without this, `advance_round` computes `next_round = 0 + 1 = 1`
which collides with the existing round 1 record (unique constraint violation).

## Changes
- Recreates start_game to also set games.current_round = 1.
*/

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

  -- Set current_round = 1 when starting, so advance_round computes round 2 correctly
  UPDATE games
  SET status = 'QUESTION_SELECTION',
      current_round = 1,
      updated_at = now()
  WHERE games.id = p_game_id;

  INSERT INTO rounds (game_id, round_number, questioner_id, status)
  VALUES (p_game_id, 1, v_questioner_id, 'PENDING');
END;
$$;
