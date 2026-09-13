/*
# Fix: Enable realtime on game tables

No tables were published for realtime, so postgres_changes subscriptions
never fired — players joining a lobby didn't appear on other players' screens.

Add games, players, rounds, guesses, and hints to the supabase_realtime
publication so the client-side subscriptions work.
*/

ALTER PUBLICATION supabase_realtime ADD TABLE public.games;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE public.guesses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.hints;
