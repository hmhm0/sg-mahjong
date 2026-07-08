import { useState, useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { connection } from './utils/connection';
import { Home } from './pages/Home';
import { Game } from './pages/Game';
import { Tutorial } from './pages/Tutorial';
import { Rules } from './pages/Rules';
import { HostGame } from './pages/HostGame';
import { JoinGame } from './pages/JoinGame';

function Router({ hash }: { hash: string }) {
  switch (hash) {
    case '/tutorial':
      return <Tutorial />;
    case '/rules':
      return <Rules />;
    case '/host':
      return <HostGame />;
    case '/join':
      return <JoinGame />;
    default:
      return <Home />;
  }
}

export default function App() {
  const phase = useGameStore(s => s.phase);
  const hostDisconnected = useGameStore(s => s.hostDisconnected);
  const playerLeft = useGameStore(s => s.playerLeft);
  const [hostDismissed, setHostDismissed] = useState(false);
  const [playerLeftCountdown, setPlayerLeftCountdown] = useState(5);
  const [playerLeftDismissed, setPlayerLeftDismissed] = useState(false);
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/');

  useEffect(() => {
    const handler = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Listen for player_left globally
  useEffect(() => {
    const unsub = connection.on('player_left', (msg) => {
      const s = useGameStore.getState();
      const name = s.players[msg.playerIndex]?.name || 'Player ' + (msg.playerIndex + 1);
      useGameStore.setState({ playerLeft: { playerIndex: msg.playerIndex, playerName: name } });
      setPlayerLeftCountdown(5);
      setPlayerLeftDismissed(false);
    });
    return () => {
      unsub();
    };
  }, []);

  // Countdown for player left popup
  useEffect(() => {
    if (!playerLeft || playerLeftDismissed) return;
    if (playerLeftCountdown <= 0) {
      setPlayerLeftDismissed(true);
      useGameStore.getState().reset();
      useGameStore.setState({ playerLeft: null, hostDisconnected: false });
      window.location.hash = '#/';
      return;
    }
    const t = setTimeout(() => setPlayerLeftCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [playerLeft, playerLeftCountdown, playerLeftDismissed]);

  // Auto-dismiss host disconnected popup after 5s
  useEffect(() => {
    if (hostDisconnected) {
      const t = setTimeout(() => {
        setHostDismissed(true);
        useGameStore.getState().reset();
        useGameStore.setState({ hostDisconnected: false });
        window.location.hash = '#/';
      }, 5000);
      return () => {
        clearTimeout(t);
      };
    }
  }, [hostDisconnected]);

  const dismissHostClosed = () => {
    setHostDismissed(true);
    useGameStore.getState().reset();
    useGameStore.setState({ hostDisconnected: false });
    window.location.hash = '#/';
  };

  const dismissPlayerLeft = () => {
    setPlayerLeftDismissed(true);
    useGameStore.getState().reset();
    useGameStore.setState({ playerLeft: null, hostDisconnected: false });
    window.location.hash = '#/';
  };

  return (
    <>
      {hostDisconnected && !hostDismissed && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={dismissHostClosed}>
          <div className="bg-green-800 rounded-xl p-6 text-center max-w-sm mx-4 border border-green-600/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-yellow-300 mb-2">Game Closed</h2>
            <p className="text-green-200 text-sm">The host has closed the game.</p>
            <p className="text-green-400/60 text-xs mt-4">Auto-closes in 5s...</p>
          </div>
        </div>
      )}
      {playerLeft && !playerLeftDismissed && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={dismissPlayerLeft}>
          <div className="bg-green-800 rounded-xl p-6 text-center max-w-sm mx-4 border border-green-600/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-yellow-300 mb-2">Player Left</h2>
            <p className="text-green-200 text-sm">{playerLeft.playerName} has left the game.</p>
            <p className="text-green-400/60 text-xs mt-4">Auto-closes in {playerLeftCountdown}s...</p>
          </div>
        </div>
      )}
      {phase === 'playing' || phase === 'finished' ? <Game /> : <Router hash={hash} />}
    </>
  );
}
