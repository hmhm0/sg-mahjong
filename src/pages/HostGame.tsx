import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { buildDeck, seededShuffle, sortHand, isBonus } from '../game/tiles';
import { connection, SERVER_URL } from '../utils/connection';
import { generateDiceResults, MultiplayerDiceOverlay } from '../components/MultiplayerDiceOverlay';
import { chooseDiscard } from '../game/ai';

// Module-level variables to prevent subscription accumulation
let _multiSubUnsub: (() => void) | null = null;
let _multiActionUnsub: (() => void) | null = null;

export function HostGame() {
  const config = useGameStore(s => s.config);
  const startGame = useGameStore(s => s.startGame);
  const AI_BOT_NAMES = ['Sakura', 'Mei Lin', 'Kenji'];
  const [hostName, setHostName] = useState('Player 1');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState<string[]>(['You (Host)', ...AI_BOT_NAMES]);
  const [status, setStatus] = useState('Connecting...');
  const [error, setError] = useState('');
  const [readyState, setReadyState] = useState<boolean[]>([false, false, false, false]);
  const [diceData, setDiceData] = useState<{
    dice: [number, number, number][];
    totals: number[];
    eastPlayerIdx: number;
    seed: number;
    playerCount: number;
  } | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    setStatus('Connecting to server...');
    connection.connect(SERVER_URL).then(() => {
      setError('');
      connection.send({ type: 'create_room' });
      setStatus('Creating room...');
    }).catch(() => {
      setError('Could not connect to game server. Make sure the server is running.');
    });

    const unsubRoom = connection.on('room_created', (msg) => {
      setError('');
      setRoomCode(msg.code);
      connection.setRoomInfo(msg.code, 0);
      setStatus('Waiting for players...');


    });

    const unsubJoin = connection.on('player_joined', (msg) => {
      const slotIdx = msg.playerIndex;
      if (slotIdx >= 1 && slotIdx <= 3) {
        setPlayers(prev => {
          const next = [...prev];
          next[slotIdx] = `Player ${slotIdx + 1}`;
          // Re-broadcast all known real-player names so the new joiner sees them
          setTimeout(() => {
            for (let i = 0; i < next.length; i++) {
              if (i === slotIdx) continue; // Skip the joining player (they'll send their own name)
              const n = next[i];
              if (n && !AI_BOT_NAMES.includes(n)) {
                connection.send({ type: 'player_name', playerIndex: i, name: n });
              }
            }
          }, 200);
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
    });

    const unsubReady = connection.on('player_ready', (msg) => {
      setReadyState(prev => {
        const next = [...prev];
        next[msg.playerIndex] = msg.ready;
        return next;
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
      unsubRoom(); unsubJoin(); unsubLeft(); unsubError(); unsubReady(); unsubName();
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
  };

  const handleStart = () => {
    if (players.length < 2) {
      setError('Need at least 2 players to start.');
      return;
    }

    startedRef.current = true;

    // Send config to server, server generates seed
    connection.send({ type: 'start_game', config: { ...config } });

    const unsubGame = connection.on('game_started', (msg) => {
      const playerCount = 4;
      const seed = msg.seed;

      // Generate deterministic dice results from seed
      const results = generateDiceResults(seed, playerCount);

      // Set dice data to show the overlay
      setDiceData({
        dice: results.dice,
        totals: results.totals,
        eastPlayerIdx: results.eastPlayerIdx,
        seed,
        playerCount,
      });

      // Broadcast dice results to join client
      connection.send({ type: 'dice_results', dice: results.dice, totals: results.totals, eastPlayerIdx: results.eastPlayerIdx, playerCount, myPlayerIndex: 0 });

      unsubGame();
    });
  };

  const handleDiceComplete = () => {
    if (!diceData) return;
    const msg = { playerCount: diceData.playerCount, seed: diceData.seed, config: { ...config } };

      // Generate deterministic game from seed
      const deck = buildDeck(msg.config);
      const shuffled = seededShuffle(deck, msg.seed);
      const windOrder = ['east', 'south', 'west', 'north'] as const;
      const eastIdx = diceData.eastPlayerIdx;

      const seatRankByTotal = [...Array(4).keys()].sort((a, b) => diceData.totals[b] - diceData.totals[a]);
      const playerData: any[] = [];
      for (let p = 0; p < 4; p++) {
        playerData.push({
          id: p,
          name: p === 0 ? (players[p] || 'Player 1') : (AI_BOT_NAMES.includes(players[p]) ? AI_BOT_NAMES[p - 1] : (players[p] || `Player ${p + 1}`)),
          isHuman: p === 0 || !AI_BOT_NAMES.includes(players[p]),
          hand: [] as any[],
          melds: [],
          discards: [],
          seatWind: windOrder[seatRankByTotal.indexOf(p)],
          isAlive: true,
        });
      }

      // Deal: same logic as startGame in store
      let wallIdx = 0;
      for (let round = 0; round < 3; round++) {
        for (let p = 0; p < 4; p++) {
          for (let i = 0; i < 4; i++) {
            playerData[p].hand.push(shuffled[wallIdx++]);
          }
        }
      }
      for (let p = 0; p < 4; p++) {
        playerData[p].hand.push(shuffled[wallIdx++]);
      }
      // East player (highest dice roller) gets the extra tile
      playerData[eastIdx].hand.push(shuffled[wallIdx++]);

      // Reveal bonus tiles (flowers, seasons, animals) and draw replacements
      // Clockwise order starting from East
      for (let offset = 0; offset < 4; offset++) {
        const p = (eastIdx + offset) % 4;
        while (true) {
          const bonusIdx = playerData[p].hand.findIndex((t: any) => isBonus(t));
          if (bonusIdx === -1) break;
          const bonusTile = playerData[p].hand.splice(bonusIdx, 1)[0];
          if (!playerData[p].bonusTiles) playerData[p].bonusTiles = [];
          playerData[p].bonusTiles.push(bonusTile);
          // Draw replacement from wall (clockwise from East)
          if (wallIdx < shuffled.length) {
            playerData[p].hand.push(shuffled[wallIdx++]);
          }
        }
        playerData[p].hand = sortHand(playerData[p].hand);
      }

      const remainingWall = shuffled.slice(wallIdx);

      // Set local state
      useGameStore.setState({
        isMultiplayer: true,
        isHost: true,
        myPlayerIndex: 0,
        players: playerData,
        wall: remainingWall,
        deadWall: [],
        currentPlayerIndex: eastIdx,
        phase: 'playing',
        roundWind: 'east',
        config: msg.config,
        lastAction: `Game started! P${eastIdx} (East) discards first.`,
        winner: null,
        winningTiles: [],
        showConfig: false,
       message: players.length > 0 ? 'Your turn!' : 'Starting...',
        diceResults: { dice: diceData.dice, totals: diceData.totals, eastPlayerIdx: diceData.eastPlayerIdx },
      });

     window.location.hash = '#/';

      // Broadcast initial game state to remote clients
      const stateData: any = {};
      const fullState = useGameStore.getState();
      for (const key in fullState) {
        if (typeof (fullState as any)[key] !== 'function' && key !== 'myPlayerIndex') {
          stateData[key] = (fullState as any)[key];
        }
      }
      stateData.isMultiplayer = true;
      stateData.isHost = true;
      connection.send({ type: 'state_update', state: stateData });

      // If East is a bot, auto-discard after a delay
      if (!playerData[eastIdx].isHuman) {
        setTimeout(() => {
          const st = useGameStore.getState();
          if (st.phase !== 'playing') return;
          const hand = st.players[eastIdx].hand;
          const melds = st.players[eastIdx].melds;
          const discardIdx = chooseDiscard(hand, melds);
          if (discardIdx >= 0 && discardIdx < hand.length) {
            st.discardTile(eastIdx, discardIdx);
          }
        }, 800);
      }

      // Set up store subscription to broadcast state to remote clients
      if (_multiSubUnsub) _multiSubUnsub();
      _multiSubUnsub = useGameStore.subscribe(() => {
        const s = useGameStore.getState();
        if (!s.isMultiplayer || s.phase === 'setup') return;
        const data: any = {};
        for (const key in s) {
          if (typeof (s as any)[key] !== 'function' && key !== 'myPlayerIndex') {
            data[key] = (s as any)[key];
          }
        }
        data.isMultiplayer = true;
        data.isHost = true;
        connection.send({ type: 'state_update', state: data });
      });

      // Listen for remote player actions
      if (_multiActionUnsub) _multiActionUnsub();
      _multiActionUnsub = connection.on('player_action', (msg: any) => {
        useGameStore.getState().applyRemoteAction(msg.playerIndex, msg.actionType, msg.data);
      });
    };

  const handleCancel = () => {
    connection.send({ type: 'leave_room' });
    connection.disconnect();
    window.location.hash = '#/';
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
          <p className="text-green-300">{status}</p>
        )}
      </div>
    </div>
    {diceData && (
      <MultiplayerDiceOverlay
        playerNames={players}
        dice={diceData.dice}
        totals={diceData.totals}
        eastPlayerIdx={diceData.eastPlayerIdx}
        myPlayerIndex={0}
        playerCount={diceData.playerCount}
        onComplete={handleDiceComplete}
      />
    )}
    </>
  );
}
