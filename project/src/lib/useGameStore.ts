import { useSyncExternalStore } from 'react';
import { gameStore, type GameSnapshot } from './gameStore';

export function useGameStore(): GameSnapshot {
  return useSyncExternalStore(
    (callback) => gameStore.subscribe(callback),
    () => gameStore.getSnapshot(),
    () => gameStore.getSnapshot()
  );
}

export { gameStore };
