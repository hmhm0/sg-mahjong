import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { connection, SERVER_URL } from '../utils/connection';
import { navigate } from '../utils/navigation';
import { track } from '../utils/analytics';

export function HostGame() {
  const config = useGameStore(s => s.config);
  const AI_BOT_NAMES = ['Sakura', 'Mei Lin', 'Kenji'];
  const [hostName, setHostName] = useState('Player 1');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState<string[]>(['You (Host)', ...AI_BOT_NAMES]);
  const [status, setStatus] = useState('Connecting...');
  const [error, setError] = useState('');
  const [readyState, setReadyState] = useState<boolean[]>([false, false, false, false]);
  const startedRef = useRef(false);
  const attemptedStoredRejoinRef = useRef(false);
  const pendingFreshCreateRef = useRef(false);

  useEffect(() => {
    setStatus('Connecting to server...');
    track('host_room_opened');
    connection.connect(SERVER_URL).then(() => {
      setError('');
      const storedRoom = connection.getStoredRoomInfo();
      if (storedRoom && storedRoom.playerIndex === 0 && !attemptedStoredRejoinRef.current) {
        attemptedStoredRejoinRef.current = true;
        connection.send({
          type: 'rejoin_room',
          code: storedRoom.code,
          playerIndex: 0,
          reconnectToken: storedRoom.reconnectToken,
        });
        setStatus('Rejoining room...');
      } else {
        pendingFreshCreateRef.current = false;
        connection.send({ type: 'create_room' });
        setStatus('Creating room...');
      }
    }).catch(() => {
      setError('Could not connect to game server. Make sure the server is running.');
    });

    const unsubRoom = connection.on('room_created', (msg) => {
      setError('');
      setRoomCode(msg.code);
      connection.setRoomInfo(msg.code, 0, msg.reconnectToken);
      setStatus('Waiting for players...');
      track('host_room_created', { room_code: msg.code });


    });

    const unsubRoomJoined = connection.on('room_joined', (msg) => {
      if (msg.playerIndex !== 0) return;
      setError('');
      setRoomCode(msg.code);
      connection.setRoomInfo(msg.code, 0, msg.reconnectToken);
      setStatus('Room restored. Waiting for players...');
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
        startedRef.current = true;
        setStatus('Game in progress...');
      }
      useGameStore.setState({
        roomPaused: Boolean(msg.paused),
        roomPauseReason: msg.pauseReason || null,
      });
    });

    const unsubJoin = connection.on('player_joined', (msg) => {
      const slotIdx = msg.playerIndex;
      if (slotIdx >= 1 && slotIdx <= 3) {
        setPlayers(prev => {
          const next = [...prev];
          next[slotIdx] = `Player ${slotIdx + 1}`;
          return next;
        });
      }
    });

    const unsubLeft = connection.on('player_left', (msg) => {
      const slotIdx = msg.playerIndex;
      if (slotIdx >= 1 && slotIdx <= 3) {
        setPlayers(prev => {
          const next = [...prev];
          next[slotIdx] = AI_BOT_NAMES[slotIdx - 1];
          return next;
        });
      }
    });

    const unsubError = connection.on('error', (msg) => {
      setError(msg.message);
      useGameStore.setState({ multiplayerStartPending: false });
      if (msg.message === 'Room not found' && attemptedStoredRejoinRef.current && !pendingFreshCreateRef.current) {
        pendingFreshCreateRef.current = true;
        connection.clearRoomInfo();
        setError('');
        setRoomCode('');
        setPlayers(['You (Host)', ...AI_BOT_NAMES]);
        setReadyState([false, false, false, false]);
        setStatus('Creating room...');
        connection.send({ type: 'create_room' });
      }
    });

    const unsubReady = connection.on('player_ready', (msg) => {
      setReadyState(prev => {
        const next = [...prev];
        next[msg.playerIndex] = msg.ready;
        return next;
      });
    });

    const unsubRoomClosed = connection.on('room_closed', (msg) => {
      startedRef.current = true;
      connection.markRoomClosed();
      useGameStore.setState({ multiplayerStartPending: false });
      const reason = msg?.reason === 'empty_timeout'
        ? 'The room closed because it stayed empty for 10 minutes.'
        : 'The room has been closed.';
      setError(reason);
      setStatus('Room closed.');
      setRoomCode('');
    });

    const unsubDiceResults = connection.on('dice_results', (msg: any) => {
      const results = {
        dice: msg.dice as [number, number, number][],
        totals: msg.totals as number[],
        eastPlayerIdx: msg.eastPlayerIdx as number,
        seed: msg.seed as number,
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

    const unsubGameStarted = connection.on('game_started', (msg) => {
      startedRef.current = true;
      setStatus('Starting round...');
      useGameStore.setState({
        multiplayerStartPending: msg?.mode === 'lobby',
      });
    });

    const unsubName = connection.on('player_name', (msg) => {
      if (msg.playerIndex >= 0 && msg.playerIndex < 4) {
        setPlayers(prev => {
          const next = [...prev];
          next[msg.playerIndex] = msg.name;
          return next;
        });
      }
    });

    return () => {
      unsubRoom(); unsubRoomJoined(); unsubJoin(); unsubLeft(); unsubError(); unsubReady(); unsubName(); unsubRoomClosed(); unsubSnapshot(); unsubDiceResults(); unsubGameStarted();
      // Keep subscription & action listener alive after game starts (HostGame unmounts)
      if (!startedRef.current) {
        connection.send({ type: 'leave_room' });
        connection.disconnect();
      }
    };
  }, []);

  const handleSaveName = () => {
    const name = hostName.trim() || 'Player 1';
    setHostName(name);
    setPlayers(prev => {
      const next = [...prev];
      next[0] = name;
      return next;
    });
    if (connection.connected) {
      connection.send({ type: 'player_name', playerIndex: 0, name });
    }
    track('host_name_saved', { name });
  };

  const handleStart = () => {
    if (players.length < 2) {
      setError('Need at least 2 players to start.');
      return;
    }

    startedRef.current = true;
    useGameStore.setState({
      multiplayerStartPending: true,
      diceResults: null,
    });
    track('host_game_start_clicked', { room_code: roomCode });
    const roster = players.map((name, i) => ({
      id: i,
      name: name || `Player ${i + 1}`,
      isHuman: i === 0 ? true : !AI_BOT_NAMES.includes(name),
    }));
    connection.send({ type: 'start_game', mode: 'lobby', config: { ...config }, players: roster });
  };

  const handleCancel = () => {
    attemptedStoredRejoinRef.current = false;
    pendingFreshCreateRef.current = false;
    useGameStore.setState({ multiplayerStartPending: false, diceResults: null });
    connection.send({ type: 'host_quit' });
    connection.disconnect();
    navigate('/');
  };

  return (
    <>
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
            <div className="mb-4">
              <label className="text-green-300 text-xs mb-1 block">Your Name:</label>
              <div className="flex gap-2">
                <input type="text" maxLength={15} value={hostName} onChange={(e) => setHostName(e.target.value)}
                  className="flex-1 bg-green-900/50 border border-green-600 rounded-lg px-3 py-2 text-green-200 text-sm outline-none focus:border-yellow-500" />
                <button onClick={handleSaveName} className="px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-bold shrink-0">Save</button>
              </div>
            </div>
            <p className="text-green-300 text-sm mb-1">Share this room code:</p>
            <div className="text-4xl font-bold tracking-[0.5em] text-yellow-300 bg-green-900/50 rounded-xl py-4 mb-4">
              {roomCode}
            </div>

            <p className="text-green-400 text-sm mb-4">{status}</p>

           <div className="space-y-1 mb-6">
              {players.map((name, i) => {
                const isBot = i > 0 && AI_BOT_NAMES.includes(name);
                const isReady = readyState[i];
                return (
                <div key={i} className={`rounded-lg py-2 px-4 text-sm flex items-center gap-2 ${isBot ? 'bg-gray-700/40 text-gray-400 border border-dashed border-gray-600/40' : 'bg-green-700/40 text-green-200'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isBot ? 'bg-gray-600 text-gray-400' : isReady ? 'bg-green-500 text-white' : 'bg-green-600 text-white'}`}>{i + 1}</span>
                  {name}
                  {i === 0 && <span className="text-yellow-300 text-xs ml-1">(Host)</span>}
                  {isReady && !isBot && <span className="text-green-400 text-xs ml-auto">✓ Ready</span>}
                  {!isReady && !isBot && <span className="text-yellow-400 text-xs ml-auto">Not Ready</span>}
                  {isBot && <span className="text-gray-500 text-xs ml-auto">(Bot)</span>}
                </div>
                );
              })}
            </div>

            <button
              onClick={handleStart}
              disabled={players.some((name, i) => i > 0 && !AI_BOT_NAMES.includes(name) && !readyState[i])}
              className={`w-full py-3 rounded-xl font-bold text-base mb-2 transition-all ${
                players.every((name, i) => i === 0 || AI_BOT_NAMES.includes(name) || readyState[i])
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
          <>
            <p className="text-green-300">{status}</p>
            <button onClick={handleCancel}
              className="w-full mt-6 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors">
              Back / Cancel
            </button>
          </>
        )}
      </div>
    </div>
    </>
  );
}
