import { Home, RotateCcw, Trophy } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';

interface GameOverScreenProps {
  onPlayAgain: () => void;
  onHome: () => void;
}

export function GameOverScreen({ onPlayAgain, onHome }: GameOverScreenProps) {
  const snap = useGameStore();

  const game = snap.game;
  const players = snap.players;
  const myPlayer = gameStore.getMyPlayer();

  if (!game) return null;

  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const isWinner = winner?.id === myPlayer?.id;

  const medal = (i: number) => {
    if (i === 0) return '1st';
    if (i === 1) return '2nd';
    if (i === 2) return '3rd';
    return `${i + 1}th`;
  };

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        {/* Winner banner */}
        <div className="text-center mb-8">
          <div className="handwritten text-3xl text-[var(--ink)] opacity-50 mb-2">━━━━━━━━━━━━━━━━━━━━</div>
          <Trophy className="mx-auto mb-2 text-[var(--red-pencil)]" size={48} />
          <h2 className="handwritten text-5xl font-bold text-[var(--red-pencil)] mb-2">GAME OVER</h2>
          <div className="pencil-handwritten text-lg text-[var(--blue-pencil)] mb-1">MOVIE MASTER</div>
          <div className="handwritten text-3xl font-bold text-[var(--ink)]">{winner?.display_name}</div>
          <div className="handwritten text-2xl text-[var(--blue-pencil)]">
            {winner?.score.toFixed(1)} POINTS
          </div>
          {isWinner && (
            <div className="mt-2 doodle-circle text-[var(--red-pencil)] pencil-handwritten">
              That's you!
            </div>
          )}
          <div className="handwritten text-3xl text-[var(--ink)] opacity-50 mt-2">━━━━━━━━━━━━━━━━━━━━</div>
        </div>

        {/* Final scores */}
        <div className="mb-8">
          <div className="clue-label mb-3 text-center">FINAL SCORE</div>
          <div className="space-y-2">
            {sorted.map((p, i) => (
              <div
                key={p.id}
                className={`pencil-border !cursor-default flex items-center gap-3 ${
                  i === 0 ? '!border-[var(--red-pencil)]' : ''
                }`}
                style={{ background: 'rgba(255,252,245,0.5)' }}
              >
                <span className="handwritten text-xl font-bold w-12 text-center text-[var(--blue-pencil)]">
                  {medal(i)}
                </span>
                <span className="pencil-handwritten text-lg flex-1">
                  {p.display_name}
                  {p.id === myPlayer?.id && (
                    <span className="ml-2 text-xs text-[var(--red-pencil)]">YOU</span>
                  )}
                </span>
                <span className="handwritten text-xl font-bold text-[var(--ink)]">
                  {p.score.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={onPlayAgain} className="pencil-border pencil-border-solid w-full justify-center mb-3">
          <RotateCcw size={20} />
          PLAY AGAIN
        </button>
        <button onClick={onHome} className="pencil-border w-full justify-center">
          <Home size={20} />
          HOME
        </button>
      </div>
    </div>
  );
}
