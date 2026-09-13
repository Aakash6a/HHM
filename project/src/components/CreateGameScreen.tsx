import { useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { gameStore } from '@/lib/gameStore';

interface CreateGameScreenProps {
  onBack: () => void;
  onCreated: (gameId: string, roomCode: string) => void;
}

export function CreateGameScreen({ onBack, onCreated }: CreateGameScreenProps) {
  const [name, setName] = useState('');
  const [rounds, setRounds] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setLoading(true);
    try {
      const result = await gameStore.createGame(name.trim(), rounds);
      await gameStore.connect(result.game_id);
      onCreated(result.game_id, result.room_code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-enter min-h-screen notebook-bg-ruled flex flex-col items-center justify-center px-6 py-12">
      <button onClick={onBack} className="absolute top-6 left-6 pencil-border text-sm">
        <ArrowLeft size={18} />
        BACK
      </button>

      <div className="w-full max-w-sm">
        <h2 className="handwritten text-5xl font-bold text-center mb-8 text-[var(--ink)]">
          Create Game
        </h2>

        <div className="mb-6">
          <label className="clue-label block mb-2">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rahul"
            maxLength={20}
            className="pencil-input"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>

        <div className="mb-8">
          <label className="clue-label block mb-3">Number of Rounds</label>
          <div className="flex gap-3">
            <button
              onClick={() => setRounds(5)}
              className={`pencil-border flex-1 justify-center ${rounds === 5 ? 'pencil-border-red' : ''}`}
            >
              5 Rounds
            </button>
            <button
              onClick={() => setRounds(10)}
              className={`pencil-border flex-1 justify-center ${rounds === 10 ? 'pencil-border-red' : ''}`}
            >
              10 Rounds
            </button>
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={loading}
          className="pencil-border pencil-border-solid w-full justify-center"
        >
          <Plus size={20} />
          {loading ? 'CREATING...' : 'CREATE GAME'}
        </button>

        {error && (
          <div className="mt-4 pencil-handwritten text-[var(--red-pencil)] text-sm text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
