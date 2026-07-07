import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { buildDeck, seededShuffle, sortHand } from '../game/tiles';
import { connection, SERVER_URL } from '../utils/connection';

export function JoinGame() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('Enter a room code to join');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!startedRef.current) {
        connection.send({ type: 'leave_room' });
        connection.disconnect();
      }
    };
  }, []);

  const handleConnect = async () => {
    if (code.length < 4) {
      setError('Please enter a valid room code.');
      return;
    }

    setError('');
    setStatus('Connecting to server...');

    try {
      await connection.connect(SERVER_URL);
      setConnected(true);

      const upperCode = code.toUpperCase();
      connection.send({ type: 'join_room', code: upperCode });

      connection.on('room_joined', (msg) => {
        connection.setRoomInfo(msg.code, msg.playerIndex);
        setStatus('Joined! Waiting for the host to start the game...');
        setJoined(true);
      });

      connection.on('error', (msg) => {
        setError(msg.message);
        setStatus('Failed to join room.');
        connection.disconnect();
      });

      connection.on('player_joined', () => {
        // Ignore other players joining, we already joined
      });

      connection.on('game_started', (msg) => {
        startedRef.current = true;

        // Generate deterministic game from seed
        const deck = buildDeck(msg.config);
        const shuffled = seededShuffle(deck, msg.seed);

        const playerCount = msg.playerCount;
        const myIndex = connection.playerIndex;
        const playerData: any[] = [];

        for (let p = 0; p < playerCount; p++) {
          playerData.push({
            id: p,
            name: p === myIndex ? 'You' : `Player ${p + 1}`,
            isHuman: p === myIndex,
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
        playerData[myIndex].hand.push(shuffled[wallIdx++]);

        const remainingWall = shuffled.slice(wallIdx);

        useGameStore.setState({
          players: playerData,
          wall: remainingWall,
          deadWall: [],
          currentPlayerIndex: 0,
          phase: 'playing',
          roundWind: 'east',
          config: msg.config,
          lastAction: 'Game started!',
          winner: null,
          winningTiles: [],
          showConfig: false,
          message: myIndex === 0 ? 'Your turn!' : 'Waiting...',
        });

        window.location.hash = '#/';
      });

    } catch (e) {
      setError('Could not connect to game server. Make sure the server is running.');
      setStatus('Connection failed.');
    }
  };

  const handleCancel = () => {
    connection.send({ type: 'leave_room' });
    connection.disconnect();
    window.location.hash = '#/';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-950 flex flex-col items-center justify-center p-4">
      <div className="bg-green-800/60 backdrop-blur rounded-2xl p-8 w-full max-w-md border border-green-700/50 text-center">
        <h1 className="text-2xl font-bold text-yellow-300 mb-6">Join Game</h1>

        {error && (
          <div className="bg-red-800/60 text-red-200 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {!joined ? (
          <>
            <p className="text-green-300 text-sm mb-3">Enter the 4-character room code:</p>
            <input
              type="text"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX"
              className="w-full text-center text-3xl font-bold tracking-[0.5em] py-4 bg-green-900/50 border-2 border-green-600 rounded-xl text-yellow-300 outline-none focus:border-yellow-500 mb-4 uppercase"
            />
            <p className="text-green-400/50 text-xs mb-4">Codes are letters and numbers (no 0, 1, I, O)</p>

            <button onClick={handleConnect}
              disabled={code.length < 4}
              className={`w-full py-3 rounded-xl font-bold text-base mb-2 transition-all ${
                code.length >= 4
                  ? 'bg-green-600 hover:bg-green-500 text-white'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}>
              Join
            </button>

            <button onClick={handleCancel}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
              Back
            </button>
          </>
        ) : (
          <>
            <p className="text-green-300 text-lg mb-2">Joined!</p>
            <p className="text-green-400 text-sm mb-4">{status}</p>
            <div className="flex justify-center">
              <div className="animate-spin w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
