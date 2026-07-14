import { useState, useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { connection } from './utils/connection';
import { Home } from './pages/Home';
import { Game } from './pages/Game';
import { Tutorial } from './pages/Tutorial';
import { Rules } from './pages/Rules';
import { HostGame } from './pages/HostGame';
import { JoinGame } from './pages/JoinGame';
import { navigate } from './utils/navigation';
import { initAnalytics, trackPageView } from './utils/analytics';
import { MultiplayerDiceOverlay } from './components/MultiplayerDiceOverlay';

const SITE_NAME = 'Singapore Mahjong';
const SITE_URL = 'https://sgmahjong.app';
const SITE_DESCRIPTION = 'Play Singapore Mahjong online with Fei jokers, tai scoring, single-player bots, and multiplayer rooms.';
const GOOGLE_SITE_VERIFICATION = import.meta.env.VITE_GOOGLE_SITE_VERIFICATION as string | undefined;
const SITE_KEYWORDS = [
  'Singapore Mahjong',
  'SG Mahjong',
  'mahjong singapore',
  'Singapore mahjong online',
  'tai scoring',
  'Fei joker',
  'multiplayer mahjong',
  'single player mahjong',
  'mahjong rules',
  'mahjong tutorial',
].join(', ');

const ROUTE_META: Record<string, { title: string; description: string; keywords: string }> = {
  '/': {
    title: 'Singapore Mahjong',
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS,
  },
  '/tutorial': {
    title: 'How to Play - Singapore Mahjong',
    description: 'Learn how to play Singapore Mahjong online with Fei jokers, tai scoring, winds, melds, and winning hands.',
    keywords: `${SITE_KEYWORDS}, how to play singapore mahjong, mahjong tutorial`,
  },
  '/rules': {
    title: 'Rules Reference - Singapore Mahjong',
    description: 'Reference the Singapore Mahjong rules, special hands, call priority, Fei rules, and tai scoring patterns.',
    keywords: `${SITE_KEYWORDS}, singapore mahjong rules, special hands, call priority`,
  },
  '/host': {
    title: 'Host Multiplayer Room - Singapore Mahjong',
    description: 'Host a Singapore Mahjong multiplayer room, share the room code, and start a match with friends.',
    keywords: `${SITE_KEYWORDS}, host mahjong room, multiplayer mahjong room`,
  },
  '/join': {
    title: 'Join Multiplayer Room - Singapore Mahjong',
    description: 'Join an existing Singapore Mahjong multiplayer room using the room code and custom player name.',
    keywords: `${SITE_KEYWORDS}, join mahjong room, singapore mahjong multiplayer`,
  },
};

function getRoute() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  if (ROUTE_META[pathname]) return pathname;
  const hashRoute = window.location.hash.replace(/^#/, '');
  const normalizedHash = hashRoute.replace(/\/+$/, '') || '/';
  return ROUTE_META[normalizedHash] ? normalizedHash : '/';
}

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
  const multiplayerStartPending = useGameStore(s => s.multiplayerStartPending);
  const diceResults = useGameStore(s => s.diceResults);
  const players = useGameStore(s => s.players);
  const myPlayerIndex = useGameStore(s => s.myPlayerIndex);
  const clearDiceResults = () => useGameStore.setState({ diceResults: null });
  const hostDisconnected = useGameStore(s => s.hostDisconnected);
  const playerLeft = useGameStore(s => s.playerLeft);
  const roomPaused = useGameStore(s => s.roomPaused);
  const [hostDismissed, setHostDismissed] = useState(false);
  const [playerLeftCountdown, setPlayerLeftCountdown] = useState(5);
  const [playerLeftDismissed, setPlayerLeftDismissed] = useState(false);
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    initAnalytics();
    const meta = ROUTE_META[route] || ROUTE_META['/'];
    const gameTitle = phase === 'playing'
      ? `Live Game - ${SITE_NAME}`
      : phase === 'finished'
        ? `Round Complete - ${SITE_NAME}`
        : meta.title;
    const gameDescription = phase === 'playing'
      ? 'Live Singapore Mahjong game in progress with local rules, Fei, and tai scoring.'
      : phase === 'finished'
        ? 'A Singapore Mahjong round has ended. Review the result popup, hand details, and score breakdown.'
        : meta.description;
    const keywords = meta.keywords;
    const currentUrl = `${SITE_URL}${route === '/' ? '/' : `${route}/`}`;
    const canonical = currentUrl;
    const shouldIndex = phase !== 'playing' && phase !== 'finished' && route !== '/host' && route !== '/join';
    const robotsContent = shouldIndex
      ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
      : 'noindex,nofollow,noarchive';

    document.title = gameTitle;

    const upsertMeta = (selector: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        document.head.appendChild(el);
      }
      Object.entries(attrs).forEach(([key, value]) => el!.setAttribute(key, value));
    };

    const upsertLink = (selector: string, attrs: Record<string, string>) => {
      let el = document.head.querySelector(selector) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement('link');
        document.head.appendChild(el);
      }
      Object.entries(attrs).forEach(([key, value]) => el!.setAttribute(key, value));
    };

    upsertMeta('meta[name="description"]', { name: 'description', content: gameDescription });
    upsertMeta('meta[name="keywords"]', { name: 'keywords', content: keywords });
    upsertMeta('meta[name="author"]', { name: 'author', content: SITE_NAME });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: robotsContent });
    upsertMeta('meta[name="googlebot"]', { name: 'googlebot', content: robotsContent });
    if (GOOGLE_SITE_VERIFICATION) {
      upsertMeta('meta[name="google-site-verification"]', {
        name: 'google-site-verification',
        content: GOOGLE_SITE_VERIFICATION,
      });
    }
    upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: '#0f3d2e' });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: gameTitle });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: gameDescription });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SITE_NAME });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: currentUrl });
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: `${SITE_URL}/og-image.svg` });
    upsertMeta('meta[property="og:image:alt"]', { property: 'og:image:alt', content: 'Singapore Mahjong game table and title card' });
    upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: 'en_SG' });
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: gameTitle });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: gameDescription });
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: `${SITE_URL}/og-image.svg` });
    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: canonical });

    const existingScripts = Array.from(document.head.querySelectorAll('script[data-seo-jsonld="true"]'));
    existingScripts.forEach((script) => script.remove());

    const schema = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebSite',
          name: SITE_NAME,
          url: SITE_URL,
          description: SITE_DESCRIPTION,
          inLanguage: 'en-SG',
        },
        {
          '@type': 'VideoGame',
          name: SITE_NAME,
          url: currentUrl,
          description: gameDescription,
          applicationCategory: 'Game',
          genre: ['Mahjong', 'Strategy', 'Board Game'],
          operatingSystem: 'Web browser',
          playMode: ['SinglePlayer', 'MultiPlayer'],
          image: `${SITE_URL}/og-image.svg`,
        },
      ],
    };

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-seo-jsonld', 'true');
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);

    trackPageView(route, gameTitle);
  }, [route, phase]);

  useEffect(() => {
    const handler = () => setRoute(getRoute());
    window.addEventListener('hashchange', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('hashchange', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  // Listen for player_left globally
  useEffect(() => {
    const unsub = connection.on('player_left', (msg) => {
      const s = useGameStore.getState();
      const name = s.players[msg.playerIndex]?.name || 'Player ' + (msg.playerIndex + 1);
      useGameStore.setState({
        playerLeft: { playerIndex: msg.playerIndex, playerName: name },
        roomPaused: true,
        roomPauseReason: { type: 'player_left', playerIndex: msg.playerIndex },
      });
      setPlayerLeftCountdown(5);
      setPlayerLeftDismissed(false);
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = connection.on('room_closed', (msg) => {
      connection.markRoomClosed();
      const s = useGameStore.getState();
      if (s.phase === 'playing' || s.phase === 'finished' || s.isMultiplayer) {
        useGameStore.setState({ hostDisconnected: true, playerLeft: null, roomPaused: false, roomPauseReason: null });
      }
      if (msg?.reason === 'host_disconnect') {
        setHostDismissed(false);
      }
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = connection.on('room_paused', (msg) => {
      const s = useGameStore.getState();
      const pauseReason = msg?.reason || null;
      useGameStore.setState({
        roomPaused: true,
        roomPauseReason: pauseReason,
        playerLeft: pauseReason?.type === 'player_left'
          ? { playerIndex: pauseReason.playerIndex, playerName: s.players[pauseReason.playerIndex]?.name || `Player ${pauseReason.playerIndex + 1}` }
          : s.playerLeft,
      });
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = connection.on('room_resumed', () => {
      useGameStore.setState({ roomPaused: false, roomPauseReason: null });
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsub = connection.on('state_update', (msg) => {
      const state = msg?.state;
      if (!state) return;
      state.isMultiplayer = true;
      state.isHost = connection.playerIndex === 0;
      state.myPlayerIndex = connection.playerIndex >= 0 ? connection.playerIndex : 0;
      const pending = useGameStore.getState().multiplayerStartPending;
      useGameStore.setState({
        ...state,
        multiplayerStartPending: pending,
      });
    });
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsubGameStarted = connection.on('game_started', (msg) => {
      useGameStore.setState({
        multiplayerStartPending: msg?.mode === 'lobby',
      });
    });
    const unsubDiceResults = connection.on('dice_results', (msg: any) => {
      useGameStore.setState({
        diceResults: {
          dice: msg.dice,
          totals: msg.totals,
          eastPlayerIdx: msg.eastPlayerIdx,
        },
        multiplayerStartPending: true,
      });
    });
    return () => {
      unsubGameStarted();
      unsubDiceResults();
    };
  }, []);

  // Countdown for player left popup
  useEffect(() => {
    if (!playerLeft || playerLeftDismissed) return;
    if (playerLeftCountdown <= 0) {
      setPlayerLeftDismissed(true);
      useGameStore.getState().reset();
      useGameStore.setState({ playerLeft: null, hostDisconnected: false });
      connection.disconnect();
      navigate('/');
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
        connection.disconnect();
        navigate('/');
      }, 5000);
      return () => {
        clearTimeout(t);
      };
    }
  }, [hostDisconnected]);

  const dismissHostClosed = () => {
    setHostDismissed(true);
    useGameStore.getState().reset();
    useGameStore.setState({ hostDisconnected: false, roomPaused: false, roomPauseReason: null });
    connection.disconnect();
    navigate('/');
  };

  const dismissPlayerLeft = () => {
    setPlayerLeftDismissed(true);
    useGameStore.getState().reset();
    useGameStore.setState({ playerLeft: null, hostDisconnected: false, roomPaused: false, roomPauseReason: null });
    connection.disconnect();
    navigate('/');
  };

  return (
    <>
      {hostDisconnected && !hostDismissed && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={dismissHostClosed}>
          <div className="bg-green-800 rounded-xl p-6 text-center max-w-sm mx-4 border border-green-600/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-yellow-300 mb-2">Host Disconnected</h2>
            <p className="text-green-200 text-sm">The host has disconnected from the room.</p>
            <p className="text-green-400/60 text-sm mt-4">Returning to the main menu in 5s...</p>
          </div>
        </div>
      )}
      {playerLeft && !playerLeftDismissed && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={dismissPlayerLeft}>
          <div className="bg-green-800 rounded-xl p-6 text-center max-w-sm mx-4 border border-green-600/50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-yellow-300 mb-2">Room Paused</h2>
            <p className="text-green-200 text-sm">{playerLeft.playerName} has left the game.</p>
            <p className="text-green-400/60 text-xs mt-2">The room is paused until the host quits or the room closes.</p>
            <p className="text-green-400/60 text-xs mt-4">Auto-closes in {playerLeftCountdown}s...</p>
          </div>
        </div>
      )}
      {((phase === 'playing' || phase === 'finished') && !multiplayerStartPending) ? <Game /> : <Router hash={route} />}
      {multiplayerStartPending && diceResults && (
        <MultiplayerDiceOverlay
          dice={diceResults.dice}
          totals={diceResults.totals}
          eastPlayerIdx={diceResults.eastPlayerIdx}
          myPlayerIndex={myPlayerIndex}
          playerCount={players.length || 4}
          playerNames={players.map(p => p.name)}
          onComplete={() => {
            clearDiceResults();
            useGameStore.setState({ multiplayerStartPending: false });
          }}
        />
      )}
    </>
  );
}
