import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { buildDeck, seededShuffle, sortHand } from '../game/tiles';
import { connection, SERVER_URL } from '../utils/connection';

export function HostGame() {
  const config = useGameStore(s => s.config);
  const startGame = useGameStore(s => s.startGame);
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState<string[]>(['You (Host)']);
  const [status, setStatus] = useState('Connecting...');
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    setStatus('Connecting to server...');
    connection.connect(SERVER_URL).then(() => {
      connection.send({ type: 'create_room' });
      setStatus('Creating room...');
    }).catch(() => {
      setError('Could not connect to game server. Make sure the server is running.');
    });

    const unsubRoom = connection.on('room_created', (msg) => {
      setRoomCode(msg.code);
      connection.setRoomInfo(msg.code, 0);
      setStatus('Waiting for players...');
    });

    const unsubJoin = connection.on('player_joined', (msg) => {
      setPlayers(prev => [...prev, `Player ${msg.playerIndex + 1}`]);
    });

    const unsubLeft = connection.on('player_left', (msg) => {
      if (msg.playerIndex === 0) return;
      setPlayers(prev => prev.filter((_, i) => {
        if (i === msg.playerIndex) return false;
        return true;
      }));
    });

    const unsubError = connection.on('error', (msg) => {
      setError(msg.message);
    });

    return () => {
      unsubRoom(); unsubJoin(); unsubLeft(); unsubError();
      if (!startedRef.current) {
        connection.send({ type: 'leave_room' });
        connection.disconnect();
      }
    };
  }, []);

  const handleStart = () => {
    if (players.length < 2) {
      setError('Need at least 2 players to start.');
      return;
    }

    startedRef.current = true;

    // Send config to server, server generates seed
    connection.send({ type: 'start_game', config: { ...config } });

    const unsubGame = connection.on('game_started', (msg) => {
      // Generate deterministic game from seed
      const deck = buildDeck(msg.config);
      const shuffled = seededShuffle(deck, msg.seed);

      const playerCount = msg.playerCount;
      const playerData: any[] = [];

      for (let p = 0; p < playerCount; p++) {
        playerData.push({
          id: p,
          name: p === 0 ? 'You' : `Player ${p + 1}`,
          isHuman: p === 0,
          hand: [] as any[],
          melds: [],
          discards: [],
          seatWind: (['east', 'south', 'west', 'north'] as const)[p],
          isAlive: true,
        });
      }

      // Deal: same logic as startGame in store
      let wallIdx = 0;
      for (let round = 0; round < 3; round++) {
        for (let p = 0; p < playerCount; p++) {
          for (let i = 0; i < 4; i++) {
            playerData[p].hand.push(shuffled[wallIdx++]);
          }
        }
      }
      for (let p = 0; p < playerCount; p++) {
        playerData[p].hand.push(shuffled[wallIdx++]);
      }
      playerData[0].hand.push(shuffled[wallIdx++]);

      const remainingWall = shuffled.slice(wallIdx);

      // Send initial state via connection
      connection.send({ type: 'action', playerIndex: 0, actionType: 'init_game', data: {
        players: playerData,
        wall: remainingWall,
        config: msg.config,
        playerIndex: 0,
      }});

      // Set local state
      useGameStore.setState({
        players: playerData,
        wall: remainingWall,
        deadWall: [],
        currentPlayerIndex: 0,
        phase: 'playing',
        roundWind: 'east',
        config: msg.config,
        lastAction: 'Game started! You are East.',
        winner: null,
        winningTiles: [],
        showConfig: false,
        message: 'Your turn!',
      });
      unsubGame();
      window.location.hash = '#/';
    });
  };

  const handleCancel = () => {
    connection.send({ type: 'leave_room' });
    connection.disconnect();
    window.location.hash = '#/';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-950 flex flex-col items-center justify-center p-4">
      <div className="bg-green-800/60 backdrop-blur rounded-2xl p-8 w-full max-w-md border border-green-700/50 text-center">
        <h1 className="text-2xl font-bold text-yellow-300 mb-2">Host Game</h1>

        {error && (
          <div className="bg-red-800/60 text-red-200 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {roomCode ? (
          <>
            <p className="text-green-300 text-sm mb-1">Share this room code:</p>
            <div className="text-4xl font-bold tracking-[0.5em] text-yellow-300 bg-green-900/50 rounded-xl py-4 mb-4">
              {roomCode}
            </div>

            <p className="text-green-400 text-sm mb-4">{status}</p>

            <div className="space-y-1 mb-6">
              {players.map((name, i) => (
                <div key={i} className="bg-green-700/40 rounded-lg py-2 px-4 text-green-200 text-sm flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  {name}
                </div>
              ))}
              {Array.from({ length: 4 - players.length }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-green-700/20 rounded-lg py-2 px-4 text-green-500/50 text-sm border border-dashed border-green-700/30">
                  Waiting for player {players.length + i + 1}...
                </div>
              ))}
            </div>

            <button
              onClick={handleStart}
              disabled={players.length < 2}
              className={`w-full py-3 rounded-xl font-bold text-base mb-2 transition-all ${
                players.length >= 2
                  ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Start Game
            </button>

            <button onClick={handleCancel}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
              Cancel
            </button>
          </>
        ) : (
          <p className="text-green-300">{status}</p>
        )}
      </div>
    </div>
  );
}
