import { useState, useEffect } from 'react';
import { Hand, Lightbulb, Eye, X, Check, AlertCircle, Clock } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';
import type { Category, Hint } from '@/lib/supabase';

interface ChaserScreenProps {
  onLeave: () => void;
}

export function ChaserScreen({ onLeave }: ChaserScreenProps) {
  const snap = useGameStore();
  const [showGuess, setShowGuess] = useState(false);
  const [showHintRequest, setShowHintRequest] = useState(false);
  const [guessCategory, setGuessCategory] = useState<Category>('HERO');
  const [guessText, setGuessText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [guessResult, setGuessResult] = useState<{ correct: boolean; points: number; already: boolean } | null>(null);
  const [hintCategory, setHintCategory] = useState<Category>('HERO');
  const [hintLoading, setHintLoading] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(90);

  const game = snap.game;
  const round = snap.currentRound;
  const myPlayer = gameStore.getMyPlayer();
  const questioner = gameStore.getQuestioner();

  // Timer countdown
  useEffect(() => {
    if (!round?.ends_at) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((new Date(round.ends_at!).getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 500);
    return () => clearInterval(interval);
  }, [round?.ends_at]);

  if (!game || !round || !myPlayer) return null;

  const solvedHero = gameStore.hasSolvedCategory('HERO');
  const solvedHeroine = gameStore.hasSolvedCategory('HEROINE');
  const solvedMovie = gameStore.hasSolvedCategory('MOVIE');

  const sentHints = gameStore.getSentHintsForPlayer();
  const pendingHints = snap.hints.filter((h) => h.status === 'PENDING');
  const isQuestioner = gameStore.isQuestioner();

  const handleSubmitGuess = async () => {
    setError('');
    if (!guessText.trim()) {
      setError('Guess cannot be empty.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await gameStore.submitGuess(guessCategory, guessText.trim());
      setGuessResult({ correct: result.correct, points: result.points_awarded, already: result.already_solved });
      setGuessText('');
      setTimeout(() => setGuessResult(null), 3000);
      setShowGuess(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestHint = async () => {
    setError('');
    setHintLoading(true);
    try {
      await gameStore.requestHint(hintCategory);
      setShowHintRequest(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setHintLoading(false);
    }
  };

  const handleReveal = async () => {
    setError('');
    try {
      await gameStore.revealAnswers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center px-6 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="pencil-handwritten text-sm text-[var(--ink)] opacity-60">
              ROUND {round.round_number} / {game.total_rounds}
            </div>
            <div className="pencil-handwritten text-sm text-[var(--blue-pencil)]">
              Questioner: {questioner?.display_name ?? '—'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={20} className={timeLeft <= 10 ? 'text-[var(--red-pencil)] animate-pulse' : 'text-[var(--ink)]'} />
            <span className={`handwritten text-3xl font-bold ${timeLeft <= 10 ? 'text-[var(--red-pencil)]' : 'text-[var(--ink)]'}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
        </div>

        {/* Clue grid */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {(['HERO', 'HEROINE', 'MOVIE'] as Category[]).map((cat) => {
            const initial = cat === 'HERO' ? round.hero_initial : cat === 'HEROINE' ? round.heroine_initial : round.movie_initial;
            const solved = cat === 'HERO' ? solvedHero : cat === 'HEROINE' ? solvedHeroine : solvedMovie;
            return (
              <div key={cat} className={`clue-card ${solved ? '!border-[var(--green-pencil)]' : ''}`}>
                {solved && (
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-[var(--green-pencil)] rounded-full flex items-center justify-center">
                    <Check size={14} className="text-white" />
                  </div>
                )}
                <div className="clue-label">{cat}</div>
                <div className={`clue-letter ${solved ? '!text-[var(--green-pencil)]' : ''}`}>
                  {initial || '?'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Score */}
        <div className="text-center mb-6">
          <span className="pencil-handwritten text-sm text-[var(--ink)] opacity-60">YOUR SCORE: </span>
          <span className="handwritten text-2xl font-bold text-[var(--blue-pencil)]">
            {myPlayer.score.toFixed(1)}
          </span>
        </div>

        {/* Hints received */}
        {sentHints.length > 0 && (
          <div className="mb-4">
            <div className="clue-label mb-2">HINTS YOU RECEIVED</div>
            {sentHints.map((h: Hint) => (
              <div key={h.id} className="clue-card !p-3 mb-2 text-left">
                <div className="clue-label !mb-1">{h.category}</div>
                <div className="pencil-handwritten text-base">{h.hint_text}</div>
              </div>
            ))}
          </div>
        )}

        {/* Questioner controls */}
        {isQuestioner ? (
          <div className="space-y-3">
            <div className="clue-card">
              <div className="pencil-handwritten text-[var(--blue-pencil)] text-center">
                You are the Questioner this round.
              </div>
            </div>
            <button onClick={handleReveal} className="pencil-border pencil-border-red w-full justify-center">
              <Eye size={20} />
              REVEAL ANSWERS
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => { setShowGuess(true); setError(''); }} className="pencil-border pencil-border-solid w-full justify-center">
              <Hand size={20} />
              GUESS
            </button>
            <button onClick={() => { setShowHintRequest(true); setError(''); }} className="pencil-border pencil-border-blue w-full justify-center">
              <Lightbulb size={20} />
              REQUEST HINT
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center justify-center gap-2 pencil-handwritten text-[var(--red-pencil)] text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <button onClick={onLeave} className="mt-6 pencil-border w-full justify-center text-sm">
          LEAVE GAME
        </button>
      </div>

      {/* Guess modal */}
      {showGuess && (
        <Modal onClose={() => setShowGuess(false)} title="What are you guessing?">
          <div className="flex gap-2 mb-4">
            {(['HERO', 'HEROINE', 'MOVIE'] as Category[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setGuessCategory(cat)}
                disabled={cat === 'HERO' ? solvedHero : cat === 'HEROINE' ? solvedHeroine : solvedMovie}
                className={`pencil-border flex-1 justify-center text-sm ${
                  guessCategory === cat ? 'pencil-border-red' : ''
                }`}
                style={{ opacity: (cat === 'HERO' ? solvedHero : cat === 'HEROINE' ? solvedHeroine : solvedMovie) ? 0.4 : 1 }}
              >
                {cat}
              </button>
            ))}
          </div>
          <label className="clue-label block mb-1">ANSWER</label>
          <input
            type="text"
            value={guessText}
            onChange={(e) => setGuessText(e.target.value)}
            placeholder="Type your guess..."
            maxLength={80}
            className="pencil-input mb-4"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSubmitGuess()}
          />
          <button
            onClick={handleSubmitGuess}
            disabled={submitting}
            className="pencil-border pencil-border-solid w-full justify-center"
          >
            {submitting ? 'SUBMITTING...' : 'SUBMIT'}
          </button>
        </Modal>
      )}

      {/* Hint request modal */}
      {showHintRequest && (
        <Modal onClose={() => setShowHintRequest(false)} title="Request a Hint">
          <div className="mb-4 pencil-handwritten text-sm text-[var(--ink)] opacity-70">
            Choose a category. Using a hint means a correct answer for that category
            is worth 0.5 points instead of 1.0.
          </div>
          <div className="flex gap-2 mb-4">
            {(['HERO', 'HEROINE', 'MOVIE'] as Category[]).map((cat) => {
              const solved = cat === 'HERO' ? solvedHero : cat === 'HEROINE' ? solvedHeroine : solvedMovie;
              const hasPending = gameStore.hasPendingHintForCategory(cat);
              return (
                <button
                  key={cat}
                  onClick={() => setHintCategory(cat)}
                  disabled={solved || hasPending}
                  className={`pencil-border flex-1 justify-center text-sm ${
                    hintCategory === cat ? 'pencil-border-blue' : ''
                  }`}
                  style={{ opacity: solved || hasPending ? 0.4 : 1 }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <button
            onClick={handleRequestHint}
            disabled={hintLoading}
            className="pencil-border pencil-border-blue w-full justify-center"
          >
            {hintLoading ? 'REQUESTING...' : 'REQUEST HINT'}
          </button>
        </Modal>
      )}

      {/* Guess result toast */}
      {guessResult && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 page-enter">
          <div className={`clue-card !px-6 ${guessResult.correct ? '!border-[var(--green-pencil)]' : '!border-[var(--red-pencil)]'}`}>
            {guessResult.already ? (
              <div className="pencil-handwritten text-[var(--ink)] opacity-70">Already solved!</div>
            ) : guessResult.correct ? (
              <div className="flex items-center gap-2">
                <Check className="text-[var(--green-pencil)]" size={24} />
                <span className="handwritten text-2xl font-bold text-[var(--green-pencil)]">
                  +{guessResult.points.toFixed(1)}!
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <X className="text-[var(--red-pencil)]" size={24} />
                <span className="handwritten text-2xl font-bold text-[var(--red-pencil)]">
                  Wrong!
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-6" onClick={onClose}>
      <div className="page-enter clue-card !p-6 w-full max-w-sm relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 opacity-50 hover:opacity-100">
          <X size={20} />
        </button>
        <h3 className="handwritten text-2xl font-bold text-center mb-4 text-[var(--ink)]">{title}</h3>
        {children}
      </div>
    </div>
  );
}
