import { useState } from 'react';
import { ArrowLeft, LogIn } from 'lucide-react';
import { gameStore } from '@/lib/gameStore';

interface JoinGameScreenProps {
  onBack: () => void;
  onJoined: (gameId: string, roomCode: string) => void;
}

export function JoinGameScreen({ onBack, onJoined }: JoinGameScreenProps) {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    setError('');
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!roomCode.trim()) {
      setError('Please enter a room code.');
      return;
    }
    setLoading(true);
    try {
      const result = await gameStore.joinGame(roomCode.trim().toUpperCase(), name.trim());
      await gameStore.connect(result.game_id);
      onJoined(result.game_id, result.room_code);
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
          Join Game
        </h2>

        <div className="mb-6">
          <label className="clue-label block mb-2">Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priya"
            maxLength={20}
            className="pencil-input"
          />
        </div>

        <div className="mb-8">
          <label className="clue-label block mb-2">Room Code</label>
          <input
            type="text"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="H7K2PQ"
            maxLength={6}
            className="pencil-input text-center text-2xl tracking-[0.3em] handwritten"
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          />
        </div>

        <button
          onClick={handleJoin}
          disabled={loading}
          className="pencil-border pencil-border-solid w-full justify-center"
        >
          <LogIn size={20} />
          {loading ? 'JOINING...' : 'JOIN GAME'}
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
