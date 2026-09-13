import { useState } from 'react';
import { Eye, Play, AlertCircle } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';

interface QuestionerScreenProps {
  onLeave: () => void;
}

export function QuestionerScreen({ onLeave }: QuestionerScreenProps) {
  const snap = useGameStore();
  const [hero, setHero] = useState('');
  const [heroine, setHeroine] = useState('');
  const [movie, setMovie] = useState('');
  const [step, setStep] = useState<'input' | 'confirm'>('input');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const game = snap.game;
  const round = snap.currentRound;
  const players = snap.players;
  const myPlayer = gameStore.getMyPlayer();
  const questioner = gameStore.getQuestioner();

  if (!game || !round) return null;

  const heroInit = hero.trim() ? hero.trim().charAt(0).toUpperCase() : '?';
  const heroineInit = heroine.trim() ? heroine.trim().charAt(0).toUpperCase() : '?';
  const movieInit = movie.trim() ? movie.trim().charAt(0).toUpperCase() : '?';

  const handleCreateClue = () => {
    setError('');
    if (hero.trim().length < 2) {
      setError('Hero cannot be empty.');
      return;
    }
    if (heroine.trim().length < 2) {
      setError('Heroine cannot be empty.');
      return;
    }
    if (movie.trim().length < 2) {
      setError('Movie cannot be empty.');
      return;
    }
    setStep('confirm');
  };

  const handleStartRound = async () => {
    setError('');
    setLoading(true);
    try {
      await gameStore.createRound(hero.trim(), heroine.trim(), movie.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="doodle-circle text-[var(--red-pencil)] handwritten text-2xl font-bold mb-2">
            YOUR TURN
          </div>
          <div className="pencil-handwritten text-sm text-[var(--ink)] opacity-60">
            Round {game.current_round || 1} of {game.total_rounds}
          </div>
        </div>

        {step === 'input' ? (
          <>
            <h2 className="handwritten text-3xl font-bold text-center mb-6 text-[var(--ink)]">
              Create Your Puzzle
            </h2>

            <div className="space-y-5 mb-8">
              <div>
                <label className="clue-label block mb-1">HERO</label>
                <input
                  type="text"
                  value={hero}
                  onChange={(e) => setHero(e.target.value)}
                  placeholder="e.g. Shah Rukh Khan"
                  maxLength={60}
                  className="pencil-input"
                />
              </div>
              <div>
                <label className="clue-label block mb-1">HEROINE</label>
                <input
                  type="text"
                  value={heroine}
                  onChange={(e) => setHeroine(e.target.value)}
                  placeholder="e.g. Kajol"
                  maxLength={60}
                  className="pencil-input"
                />
              </div>
              <div>
                <label className="clue-label block mb-1">MOVIE</label>
                <input
                  type="text"
                  value={movie}
                  onChange={(e) => setMovie(e.target.value)}
                  placeholder="e.g. Dilwale Dulhania Le Jayenge"
                  maxLength={80}
                  className="pencil-input"
                />
              </div>
            </div>

            <button
              onClick={handleCreateClue}
              className="pencil-border pencil-border-solid w-full justify-center"
            >
              <Eye size={20} />
              CREATE CLUE
            </button>
          </>
        ) : (
          <>
            <h2 className="handwritten text-3xl font-bold text-center mb-6 text-[var(--ink)]">
              Your Puzzle
            </h2>

            <div className="clue-card mb-6 relative">
              <div className="tape" />
              <div className="space-y-3 text-left">
                <div>
                  <span className="clue-label !mb-0">HERO: </span>
                  <span className="pencil-handwritten text-lg">{hero}</span>
                </div>
                <div>
                  <span className="clue-label !mb-0">HEROINE: </span>
                  <span className="pencil-handwritten text-lg">{heroine}</span>
                </div>
                <div>
                  <span className="clue-label !mb-0">MOVIE: </span>
                  <span className="pencil-handwritten text-lg">{movie}</span>
                </div>
              </div>
            </div>

            <div className="clue-card mb-8">
              <div className="clue-label mb-3">CLUE</div>
              <div className="flex items-center justify-center gap-4">
                <span className="clue-letter">{heroInit}</span>
                <span className="handwritten text-4xl text-[var(--ink)] opacity-30">|</span>
                <span className="clue-letter">{heroineInit}</span>
                <span className="handwritten text-4xl text-[var(--ink)] opacity-30">|</span>
                <span className="clue-letter">{movieInit}</span>
              </div>
            </div>

            <button
              onClick={handleStartRound}
              disabled={loading}
              className="pencil-border pencil-border-solid w-full justify-center"
            >
              <Play size={20} />
              {loading ? 'STARTING...' : 'START ROUND'}
            </button>

            <button
              onClick={() => setStep('input')}
              className="mt-3 pencil-border w-full justify-center text-sm"
            >
              EDIT PUZZLE
            </button>
          </>
        )}

        {error && (
          <div className="mt-4 flex items-center justify-center gap-2 pencil-handwritten text-[var(--red-pencil)] text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <div className="mt-8 text-center pencil-handwritten text-sm text-[var(--ink)] opacity-50">
          {players.length} players in this game. {questioner?.display_name} is the Questioner.
        </div>

        <button onClick={onLeave} className="mt-4 pencil-border w-full justify-center text-sm">
          LEAVE GAME
        </button>
      </div>
    </div>
  );
}
