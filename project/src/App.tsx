import { useState, useEffect } from 'react';
import { gameStore } from '@/lib/gameStore';
import { useGameStore } from '@/lib/useGameStore';
import { HomeScreen } from '@/components/HomeScreen';
import { CreateGameScreen } from '@/components/CreateGameScreen';
import { JoinGameScreen } from '@/components/JoinGameScreen';
import { LobbyScreen } from '@/components/LobbyScreen';
import { QuestionerScreen } from '@/components/QuestionerScreen';
import { ChaserScreen } from '@/components/ChaserScreen';
import { WaitingScreen } from '@/components/WaitingScreen';
import { RevealScreen } from '@/components/RevealScreen';
import { ScoreboardScreen } from '@/components/ScoreboardScreen';
import { GameOverScreen } from '@/components/GameOverScreen';
import { QuestionerHintHandler } from '@/components/QuestionerHintHandler';

type Screen = 'home' | 'create' | 'join' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const snap = useGameStore();

  // Handle connection state on mount
  useEffect(() => {
    const gameId = sessionStorage.getItem('hhm_game_id');
    if (gameId) {
      gameStore.connect(gameId).catch(() => {
        sessionStorage.removeItem('hhm_game_id');
        sessionStorage.removeItem('hhm_player_id');
      });
    }

    // Handle disconnect on unmount / page close
    const handleBeforeUnload = () => {
      gameStore.setConnected(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const handleLeave = () => {
    gameStore.leave();
    setScreen('home');
  };

  const handlePlayAgain = () => {
    gameStore.leave();
    setScreen('create');
  };

  const handleHome = () => {
    gameStore.leave();
    setScreen('home');
  };

  // ---- Non-game screens ----
  if (screen === 'home') {
    return <HomeScreen onCreate={() => setScreen('create')} onJoin={() => setScreen('join')} />;
  }
  if (screen === 'create') {
    return (
      <CreateGameScreen
        onBack={() => setScreen('home')}
        onCreated={() => setScreen('game')}
      />
    );
  }
  if (screen === 'join') {
    return (
      <JoinGameScreen
        onBack={() => setScreen('home')}
        onJoined={() => setScreen('game')}
      />
    );
  }

  // ---- Game screens (driven by server state) ----
  const game = snap.game;
  if (!game) {
    return <HomeScreen onCreate={() => setScreen('create')} onJoin={() => setScreen('join')} />;
  }

  const isQuestioner = gameStore.isQuestioner();

  switch (game.status) {
    case 'LOBBY':
      return <LobbyScreen onLeave={handleLeave} />;

    case 'QUESTION_SELECTION':
      return isQuestioner ? (
        <QuestionerScreen onLeave={handleLeave} />
      ) : (
        <WaitingScreen onLeave={handleLeave} />
      );

    case 'ROUND_ACTIVE':
      return (
        <div className="min-h-screen notebook-bg-ruled">
          {isQuestioner && <QuestionerHintHandler />}
          <ChaserScreen onLeave={handleLeave} />
        </div>
      );

    case 'ROUND_REVEAL':
      return (
        <RevealScreen
          onContinue={async () => {
            await gameStore.advanceRound();
          }}
          onLeave={handleLeave}
        />
      );

    case 'SCOREBOARD':
      return (
        <ScoreboardScreen
          onContinue={async () => {
            await gameStore.advanceRound();
          }}
          onLeave={handleLeave}
        />
      );

    case 'GAME_OVER':
      return <GameOverScreen onPlayAgain={handlePlayAgain} onHome={handleHome} />;

    default:
      return <HomeScreen onCreate={() => setScreen('create')} onJoin={() => setScreen('join')} />;
  }
}

export default App;
