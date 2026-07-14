import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { connection, SERVER_URL } from '../utils/connection';
import { navigate } from '../utils/navigation';
import { track } from '../utils/analytics';
const AI_BOT_NAMES = ['Sakura', 'Mei Lin', 'Kenji'];

export function JoinGame() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState('Enter a room code to join');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [players, setPlayers] = useState<string[]>(['', 'Sakura', 'Mei Lin', 'Kenji']);
  const [readyState, setReadyState] = useState<boolean[]>([false, false, false, false]);
  const [isReady, setIsReady] = useState(false);
  const startedRef = useRef(false);
  const listenerCleanupRef = useRef<(() => void)[]>([]);

  const cleanupConnectionListeners = () => {
    listenerCleanupRef.current.forEach((unsub) => unsub());
    listenerCleanupRef.current = [];
  };

  useEffect(() => {
    return () => {
      cleanupConnectionListeners();
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
    track('join_room_opened');

    try {
      await connection.connect(SERVER_URL);
      setConnected(true);

      const upperCode = code.toUpperCase();
      const storedRoom = connection.getStoredRoomInfo();
      if (storedRoom && storedRoom.code === upperCode && storedRoom.playerIndex > 0) {
        connection.send({ type: 'rejoin_room', code: upperCode, playerIndex: storedRoom.playerIndex });
      } else {
        connection.send({ type: 'join_room', code: upperCode });
      }

      cleanupConnectionListeners();
      const unsubRoomJoined = connection.on('room_joined', (msg) => {
        connection.setRoomInfo(msg.code, msg.playerIndex);
        const defaultName = `Player ${msg.playerIndex + 1}`;
        const finalName = playerName.trim() || defaultName;
        connection.send({ type: 'player_name', playerIndex: msg.playerIndex, name: finalName });
        track('room_joined', { room_code: msg.code, player_index: msg.playerIndex, name: finalName });
        setPlayerName(finalName);
        setStatus('Set your name below, toggle Ready, and wait.');
        setJoined(true);
      });

      const unsubSnapshot = connection.on('room_snapshot', (msg) => {
        if (Array.isArray(msg.names)) {
          setPlayers(prev => {
            const next = [...prev];
            for (let i = 0; i < 4; i++) {
              const incoming = msg.names[i];
              if (typeof incoming === 'string' && incoming.trim()) {
                next[i] = incoming;
              } else if (i > 0 && !next[i]) {
                next[i] = AI_BOT_NAMES[i - 1];
              }
            }
            return next;
          });
        }
        if (Array.isArray(msg.ready)) {
          setReadyState(prev => {
            const next = [...prev];
            for (let i = 0; i < 4; i++) {
              next[i] = Boolean(msg.ready[i]);
            }
            return next;
          });
        }
        if (msg.started) {
          setStatus('Game in progress...');
        }
        useGameStore.setState({
          roomPaused: Boolean(msg.paused),
          roomPauseReason: msg.pauseReason || null,
        });
      });

      const unsubError = connection.on('error', (msg) => {
        setError(msg.message);
        setStatus('Failed to join room.');
        if (!connection.roomCode) {
          connection.disconnect();
        }
      });

      const unsubRoomClosed = connection.on('room_closed', () => {
        startedRef.current = true;
        connection.markRoomClosed();
        useGameStore.setState({ multiplayerStartPending: false });
        setStatus('Room closed.');
        setError('The room has been closed.');
        useGameStore.setState({ hostDisconnected: true, roomPaused: false, roomPauseReason: null });
      });

      const unsubPlayerJoined = connection.on('player_joined', (msg) => {
        const slotIdx = msg.playerIndex;
        if (slotIdx >= 1 && slotIdx <= 3) {
          setPlayers(prev => {
            const next = [...prev];
            if (!next[slotIdx]) next[slotIdx] = `Player ${slotIdx + 1}`;
            return next;
          });
        }
      });

      const unsubPlayerLeft = connection.on('player_left', (msg) => {
        const slotIdx = msg.playerIndex;
        if (slotIdx >= 0 && slotIdx <= 3) {
          setPlayers(prev => {
            const next = [...prev];
            next[slotIdx] = slotIdx > 0 ? AI_BOT_NAMES[slotIdx - 1] : '';
            return next;
          });
        }
      });

      const unsubPlayerName = connection.on('player_name', (msg) => {
        const slotIdx = msg.playerIndex;
        if (slotIdx >= 0 && slotIdx <= 3) {
          setPlayers(prev => {
            const next = [...prev];
            next[slotIdx] = msg.name;
            return next;
          });
        }
      });

      const unsubGameStarted = connection.on('game_started', (msg) => {
        startedRef.current = true;
        useGameStore.setState({
          multiplayerStartPending: msg?.mode === 'lobby',
        });
      });

      const unsubReady = connection.on('player_ready', (msg) => {
        if (msg.playerIndex >= 0 && msg.playerIndex < 4) {
          setReadyState(prev => {
            const next = [...prev];
            next[msg.playerIndex] = msg.ready;
            return next;
          });
        }
      });

      const unsubStateUpdate = connection.on('state_update', (msg) => {
        startedRef.current = true;
        track('multiplayer_state_received', { room_code: connection.roomCode, player_index: connection.playerIndex });
        const state = msg.state;
        state.isMultiplayer = true;
        state.isHost = false;
        state.myPlayerIndex = connection.playerIndex >= 0 ? connection.playerIndex : 0;
        const pending = useGameStore.getState().multiplayerStartPending;
        useGameStore.setState({
          ...state,
          multiplayerStartPending: pending,
        });
      });

      const unsubDiceResults = connection.on('dice_results', (msg: any) => {
        const results = {
          dice: msg.dice as [number, number, number][],
          totals: msg.totals as number[],
          eastPlayerIdx: msg.eastPlayerIdx as number,
          playerCount: msg.playerCount as number,
        };
        useGameStore.setState({
          diceResults: {
            dice: results.dice,
            totals: results.totals,
            eastPlayerIdx: results.eastPlayerIdx,
          },
          multiplayerStartPending: true,
        });
      });

      const unsubDisconnected = connection.on('disconnected', () => {
        useGameStore.setState({ multiplayerStartPending: false });
        if (connection.roomCode && !startedRef.current) {
          setStatus('Connection lost. Reconnecting...');
          setError('Connection dropped. Reconnecting to the room...');
        }
      });

      const unsubReconnecting = connection.on('reconnecting', (msg) => {
        if (connection.roomCode && !startedRef.current) {
          setStatus(`Reconnecting... (${msg.attempt}/${msg.maxAttempts})`);
        }
      });

      listenerCleanupRef.current = [
        unsubRoomJoined,
        unsubSnapshot,
        unsubError,
        unsubRoomClosed,
        unsubPlayerJoined,
        unsubPlayerLeft,
        unsubPlayerName,
        unsubGameStarted,
        unsubReady,
        unsubStateUpdate,
        unsubDiceResults,
        unsubDisconnected,
        unsubReconnecting,
      ];

     } catch (e) {
      setError('Could not connect to game server. Make sure the server is running.');
      setStatus('Connection failed.');
    }
  };

  const handleCancel = () => {
    cleanupConnectionListeners();
    useGameStore.setState({ multiplayerStartPending: false, diceResults: null });
    connection.send({ type: 'leave_room' });
    connection.disconnect();
    navigate('/');
  };

  return (
    <>
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
            <div className="mb-4">
              <label className="text-green-300 text-xs mb-1 block">Your Name:</label>
              <input type="text" maxLength={15} value={playerName} onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your name" autoComplete="off"
                className="w-full bg-green-900/50 border border-green-600 rounded-lg px-3 py-2 text-green-200 text-sm outline-none focus:border-yellow-500" />
            </div>
            <p className="text-green-300 text-sm mb-3">Room Code:</p>
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
            <p className="text-green-300 text-sm mb-3">Players in room:</p>
            <div className="space-y-1 mb-4">
              {players.map((name, i) => {
                const isMe = i === (connection.playerIndex >= 0 ? connection.playerIndex : 0);
                const isHost = i === 0;
                const isBot = i > 0 && AI_BOT_NAMES.includes(name);
                const isEmpty = !name && !isBot;
                const rdy = readyState[i];
                return (
                  <div key={i} className={`rounded-lg py-2 px-4 text-sm flex items-center gap-2 ${isEmpty ? 'bg-gray-700/30 text-gray-500 border border-dashed border-gray-600/30' : isBot ? 'bg-gray-700/40 text-gray-400 border border-dashed border-gray-600/40' : isMe ? 'bg-green-700/40 text-green-200' : 'bg-green-700/30 text-green-300'}`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isEmpty || isBot ? 'bg-gray-600 text-gray-400' : rdy ? 'bg-green-500 text-white' : 'bg-green-600 text-white'}`}>{i + 1}</span>
                    {isEmpty ? 'Waiting...' : name}
                    {isMe && <span className="text-yellow-300 text-xs ml-1">(You)</span>}
                    {isHost && !isMe && <span className="text-yellow-300 text-xs ml-1">(Host)</span>}
                    {rdy && !isBot && <span className="text-green-400 text-xs ml-auto">✓ Ready</span>}
                    {!rdy && !isBot && !isEmpty && <span className="text-yellow-400 text-xs ml-auto">Not Ready</span>}
                    {isBot && <span className="text-gray-500 text-xs ml-auto">(Bot)</span>}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => {
                const newReady = !isReady;
                setIsReady(newReady);
                connection.send({ type: 'player_ready', playerIndex: connection.playerIndex, ready: newReady });
              }}
              className={`w-full py-2 rounded-lg font-bold text-sm mb-2 transition-all ${
                isReady ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
            >
              {isReady ? '✓ Ready' : 'Not Ready'}
            </button>
            <button onClick={handleCancel}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
    </>
  );
}
