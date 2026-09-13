import { useState, useEffect } from 'react';
import { Send, X, Lightbulb, Clock } from 'lucide-react';
import { useGameStore, gameStore } from '@/lib/useGameStore';
import type { Hint } from '@/lib/supabase';

export function QuestionerHintHandler() {
  const snap = useGameStore();
  const [hintTexts, setHintTexts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const pendingHints = snap.hints.filter((h) => h.status === 'PENDING');

  const getPlayerName = (playerId: string) =>
    snap.players.find((p) => p.id === playerId)?.display_name ?? 'Someone';

  const handleSend = async (hint: Hint) => {
    setError('');
    const text = hintTexts[hint.id];
    if (!text?.trim()) {
      setError('Hint cannot be empty.');
      return;
    }
    setSending(true);
    try {
      await gameStore.sendHint(hint.id, text.trim());
      setHintTexts((prev) => ({ ...prev, [hint.id]: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  const handleReject = async (hint: Hint) => {
    setError('');
    try {
      await gameStore.rejectHint(hint.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  if (pendingHints.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb size={18} className="text-[var(--blue-pencil)]" />
        <span className="clue-label !mb-0">HINT REQUESTS</span>
      </div>
      {pendingHints.map((hint) => (
        <div key={hint.id} className="clue-card !p-4 mb-3 text-left">
          <div className="flex items-center gap-2 mb-2">
            <span className="handwritten text-lg text-[var(--red-pencil)]">
              {getPlayerName(hint.requested_by_player_id)}
            </span>
            <span className="pencil-handwritten text-sm text-[var(--ink)] opacity-60">
              requested a hint for
            </span>
            <span className="doodle-circle text-[var(--blue-pencil)] pencil-handwritten text-sm">
              {hint.category}
            </span>
          </div>
          <input
            type="text"
            value={hintTexts[hint.id] ?? ''}
            onChange={(e) => setHintTexts((prev) => ({ ...prev, [hint.id]: e.target.value }))}
            placeholder="Write a hint..."
            maxLength={120}
            className="pencil-input mb-3"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleSend(hint)}
              disabled={sending}
              className="pencil-border pencil-border-solid flex-1 justify-center text-sm"
            >
              <Send size={16} />
              SEND
            </button>
            <button
              onClick={() => handleReject(hint)}
              className="pencil-border flex-1 justify-center text-sm"
            >
              <X size={16} />
              REJECT
            </button>
          </div>
        </div>
      ))}
      {error && (
        <div className="pencil-handwritten text-[var(--red-pencil)] text-sm text-center">{error}</div>
      )}
    </div>
  );
}
