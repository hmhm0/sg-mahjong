import { useState, useEffect } from 'react';
import { useGameStore } from './store/gameStore';
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
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/');

  useEffect(() => {
    const handler = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  if (phase === 'playing' || phase === 'finished') {
    return <Game />;
  }

  return <Router hash={hash} />;
}
