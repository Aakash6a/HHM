import { useEffect, useState } from 'react';
import { ArrowRight, Film } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';
import type { RevealState } from '@/lib/supabase';

interface RevealScreenProps {
  onContinue: () => void;
  onLeave: () => void;
}

export function RevealScreen({ onContinue, onLeave }: RevealScreenProps) {
  const snap = useGameStore();
  const [reveal, setReveal] = useState<RevealState | null>(null);

  useEffect(() => {
    gameStore.fetchRevealState().then(setReveal);
  }, []);

  const game = snap.game;
  const players = snap.players;
  const roundScores = gameStore.getRoundScores();

  if (!game) return null;

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Film className="mx-auto mb-2 text-[var(--red-pencil)]" size={32} />
          <h2 className="handwritten text-4xl font-bold text-[var(--ink)]">ANSWER</h2>
        </div>

        {/* Answers */}
        <div className="clue-card mb-6 relative">
          <div className="tape" />
          <div className="space-y-4 text-left">
            <div>
              <div className="clue-label">HERO</div>
              <div className="handwritten text-2xl text-[var(--ink)]">
                {reveal?.hero_answer ?? '...'}
              </div>
            </div>
            <div className="border-t border-dashed border-[var(--ink)] opacity-20" />
            <div>
              <div className="clue-label">HEROINE</div>
              <div className="handwritten text-2xl text-[var(--ink)]">
                {reveal?.heroine_answer ?? '...'}
              </div>
            </div>
            <div className="border-t border-dashed border-[var(--ink)] opacity-20" />
            <div>
              <div className="clue-label">MOVIE</div>
              <div className="handwritten text-2xl text-[var(--ink)]">
                {reveal?.movie_answer ?? '...'}
              </div>
            </div>
          </div>
        </div>

        {/* Round scores */}
        <div className="mb-8">
          <div className="clue-label mb-3">ROUND SCORES</div>
          <div className="space-y-2">
            {players.map((p) => (
              <div
                key={p.id}
                className="pencil-border !cursor-default !shadow-none flex items-center justify-between"
                style={{ background: 'rgba(255,252,245,0.5)' }}
              >
                <span className="pencil-handwritten text-lg">{p.display_name}</span>
                <span className={`handwritten text-xl font-bold ${(roundScores[p.id] ?? 0) > 0 ? 'text-[var(--green-pencil)]' : 'text-[var(--ink)] opacity-50'}`}>
                  +{(roundScores[p.id] ?? 0).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={onContinue} className="pencil-border pencil-border-solid w-full justify-center">
          CONTINUE
          <ArrowRight size={20} />
        </button>

        <button onClick={onLeave} className="mt-3 pencil-border w-full justify-center text-sm">
          LEAVE GAME
        </button>
      </div>
    </div>
  );
}
