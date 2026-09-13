import { useState } from 'react';
import { Film, Plus, LogIn } from 'lucide-react';
import { gameStore } from '@/lib/gameStore';

interface HomeScreenProps {
  onCreate: () => void;
  onJoin: () => void;
}

export function HomeScreen({ onCreate, onJoin }: HomeScreenProps) {
  const [error, setError] = useState('');

  const handleQuickRejoin = async () => {
    const gameId = sessionStorage.getItem('hhm_game_id');
    if (!gameId) {
      setError('No game to rejoin.');
      return;
    }
    try {
      await gameStore.connect(gameId);
    } catch {
      setError('Could not rejoin that game.');
    }
  };

  const hasGame = !!sessionStorage.getItem('hhm_game_id');

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center justify-center px-6 py-12">
      <div className="text-center mb-12">
        <div className="mb-2 text-sm tracking-[0.3em] text-[var(--blue-pencil)] pencil-handwritten">
          THE NOTEBOOK GAME
        </div>
        <h1 className="handwritten text-7xl md:text-8xl font-bold leading-none mb-3">
          <span className="text-[var(--ink)]">HERO</span>
          <span className="text-[var(--red-pencil)]">,</span>{' '}
          <span className="text-[var(--ink)]">HEROINE</span>
        </h1>
        <h1 className="handwritten text-5xl md:text-6xl font-bold text-[var(--blue-pencil)]">
          &amp; MOVIE
        </h1>
        <div className="mt-6 pencil-handwritten text-lg text-[var(--ink)] opacity-70">
          Remember that game we played on a notebook?
        </div>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button onClick={onCreate} className="pencil-border pencil-border-solid w-full justify-center">
          <Plus size={20} />
          CREATE GAME
        </button>
        <button onClick={onJoin} className="pencil-border pencil-border-red w-full justify-center">
          <LogIn size={20} />
          JOIN GAME
        </button>
        {hasGame && (
          <button onClick={handleQuickRejoin} className="pencil-border pencil-border-blue w-full justify-center text-sm">
            <Film size={18} />
            REJOIN LAST GAME
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 pencil-handwritten text-[var(--red-pencil)] text-sm">{error}</div>
      )}

      <div className="mt-16 text-center pencil-handwritten text-sm text-[var(--ink)] opacity-50 max-w-sm">
        One player picks a Hero, a Heroine, and a Movie. Everyone else sees only
        the first letters and races to guess. No accounts, no apps — just a room
        code and your friends.
      </div>
    </div>
  );
}
