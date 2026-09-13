import { ArrowRight, Crown } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';

interface ScoreboardScreenProps {
  onContinue: () => void;
  onLeave: () => void;
}

export function ScoreboardScreen({ onContinue, onLeave }: ScoreboardScreenProps) {
  const snap = useGameStore();

  const game = snap.game;
  const players = snap.players;
  const myPlayer = gameStore.getMyPlayer();

  if (!game) return null;

  const sorted = [...players].sort((a, b) => b.score - a.score);
  const nextQuestionerIndex = (game.current_questioner_index + 1) % players.length;
  const nextQuestioner = players.find((p) => p.player_order === nextQuestionerIndex);

  const medal = (i: number) => {
    if (i === 0) return '1st';
    if (i === 1) return '2nd';
    if (i === 2) return '3rd';
    return `${i + 1}th`;
  };

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center px-6 py-12">
      <div className="w-full max-w-md">
        <h2 className="handwritten text-4xl font-bold text-center mb-8 text-[var(--ink)]">
          SCOREBOARD
        </h2>

        <div className="space-y-2 mb-8">
          {sorted.map((p, i) => (
            <div
              key={p.id}
              className={`pencil-border !cursor-default flex items-center gap-3 ${
                i === 0 ? '!border-[var(--red-pencil)]' : ''
              }`}
              style={{ background: 'rgba(255,252,245,0.5)' }}
            >
              <span className="handwritten text-2xl font-bold w-12 text-center text-[var(--blue-pencil)]">
                {medal(i)}
              </span>
              <span className="pencil-handwritten text-lg flex-1">
                {p.display_name}
                {p.id === myPlayer?.id && (
                  <span className="ml-2 text-xs text-[var(--red-pencil)]">YOU</span>
                )}
              </span>
              <span className="handwritten text-2xl font-bold text-[var(--ink)]">
                {p.score.toFixed(1)}
              </span>
              {i === 0 && <Crown size={20} className="text-[var(--red-pencil)]" />}
            </div>
          ))}
        </div>

        {nextQuestioner && (
          <div className="clue-card mb-6">
            <div className="clue-label mb-1">NEXT QUESTIONER</div>
            <div className="handwritten text-2xl font-bold text-[var(--blue-pencil)]">
              {nextQuestioner.display_name}
            </div>
          </div>
        )}

        <button onClick={onContinue} className="pencil-border pencil-border-solid w-full justify-center">
          NEXT ROUND
          <ArrowRight size={20} />
        </button>

        <button onClick={onLeave} className="mt-3 pencil-border w-full justify-center text-sm">
          LEAVE GAME
        </button>
      </div>
    </div>
  );
}
