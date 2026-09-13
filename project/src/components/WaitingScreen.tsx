import { PenLine, Clock } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';

interface WaitingScreenProps {
  onLeave: () => void;
}

export function WaitingScreen({ onLeave }: WaitingScreenProps) {
  const snap = useGameStore();
  const questioner = gameStore.getQuestioner();
  const game = snap.game;

  if (!game) return null;

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <PenLine className="mx-auto mb-4 text-[var(--blue-pencil)] animate-pulse" size={48} />
        <h2 className="handwritten text-3xl font-bold text-[var(--ink)] mb-3">
          {questioner?.display_name} is thinking...
        </h2>
        <div className="clue-card mb-6">
          <div className="pencil-handwritten text-[var(--blue-pencil)]">
            The Questioner is writing down a Hero, a Heroine, and a Movie.
            Get ready to guess from the first letters!
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mb-8 pencil-handwritten text-sm text-[var(--ink)] opacity-60">
          <Clock size={16} />
          Round {game.current_round || 1} of {game.total_rounds}
        </div>
        <button onClick={onLeave} className="pencil-border w-full justify-center text-sm">
          LEAVE GAME
        </button>
      </div>
    </div>
  );
}
