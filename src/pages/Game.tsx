import { useState, useEffect, useRef } from 'react';
import { GameTable } from '../components/GameTable';
import { useGameStore } from '../store/gameStore';
import { connection } from '../utils/connection';
import { buildDeck, seededShuffle, sortHand, isBonus } from '../game/tiles';
import { generateDiceResults } from '../components/MultiplayerDiceOverlay';

export function Game() {
  const reset = useGameStore(s => s.reset);
  const isMultiplayer = useGameStore(s => s.isMultiplayer);
  const isHost = useGameStore(s => s.isHost);
  const phase = useGameStore(s => s.phase);
  const config = useGameStore(s => s.config);
  const lastAction = useGameStore(s => s.lastAction);
  const moveHistory = useGameStore(s => s.moveHistory);
  const [playAgainReady, setPlayAgainReady] = useState<number[]>([]);
  // moveHistory is now in the store (useGameStore)
  const [showHistory, setShowHistory] = useState(false);
  const readyRef = useRef<number[]>([]);
  const lastActionRef = useRef('');

  // Track lastAction changes for move history (host only — join client receives via state_update)
  useEffect(() => {
    if (!isHost) return;
    if (lastAction && lastAction !== lastActionRef.current) {
      lastActionRef.current = lastAction;
      useGameStore.setState({ moveHistory: [...useGameStore.getState().moveHistory, lastAction] });
    }
  }, [lastAction, isHost]);

  // Reset history on new round
  useEffect(() => {
    if (phase === 'playing') {
      useGameStore.setState({ moveHistory: [] });
      lastActionRef.current = '';
    }
  }, [phase]);

  // Listen for player_ready updates (post-game)
  useEffect(() => {
    const unsub = connection.on('player_ready', (msg) => {
      setPlayAgainReady(prev => {
        const next = prev.filter(i => i !== msg.playerIndex);
        if (msg.ready) next.push(msg.playerIndex);
        readyRef.current = next;
        return next;
      });
    });
    return () => {
      unsub();
    };
  }, []);

  const handleQuit = () => {
    if (isMultiplayer) {
      if (isHost) {
        connection.send({ type: 'leave_room' });
      }
      connection.disconnect();
    }
    reset();
  };

  const handlePlayAgain = () => {
    if (isHost) {
      connection.send({ type: 'player_ready', playerIndex: 0, ready: true });
      setPlayAgainReady(prev => {
        const next = [...prev.filter(i => i !== 0), 0];
        readyRef.current = next;
        return next;
      });
    } else {
      const pi = connection.playerIndex >= 0 ? connection.playerIndex : 0;
      const isNowReady = !playAgainReady.includes(pi);
      connection.send({ type: 'player_ready', playerIndex: pi, ready: isNowReady });
      setPlayAgainReady(prev => {
        const next = isNowReady ? [...prev.filter(i => i !== pi), pi] : prev.filter(i => i !== pi);
        readyRef.current = next;
        return next;
      });
    }
  };

  // Host: when all real players ready, start new game
  useEffect(() => {
    if (!isHost || phase !== 'playing') return;
    const s = useGameStore.getState();
    // Check if all non-bot players are ready
    const allReady = s.players.every((p: any) => {
      if (p.isHuman) return readyRef.current.includes(p.id);
      return true; // bots auto-ready
    });
    if (allReady && readyRef.current.length > 0) {
      // Generate new game
      const seed = Math.floor(Math.random() * 2147483647);
      const deck = buildDeck(config || s.config);
      const shuffled = seededShuffle(deck, seed);
      const results = generateDiceResults(seed, 4);
      const windOrder = ['east', 'south', 'west', 'north'] as const;
      const eastIdx = results.eastPlayerIdx;

      const playerData: any[] = [];
      for (let p = 0; p < 4; p++) {
        const origPlayer = s.players[p];
        playerData.push({
          id: p,
          name: origPlayer?.name || (p === 0 ? 'Player 1' : `Player ${p + 1}`),
          isHuman: origPlayer ? origPlayer.isHuman : (p === 0),
          hand: [] as any[],
          melds: [],
          discards: [],
          seatWind: windOrder[(p - eastIdx + 4) % 4],
          isAlive: true,
          bonusTiles: origPlayer?.bonusTiles || [],
        });
      }

      let wallIdx = 0;
      for (let round = 0; round < 3; round++) {
        for (let p = 0; p < 4; p++) {
          for (let i = 0; i < 4; i++) playerData[p].hand.push(shuffled[wallIdx++]);
        }
      }
      for (let p = 0; p < 4; p++) playerData[p].hand.push(shuffled[wallIdx++]);
      playerData[eastIdx].hand.push(shuffled[wallIdx++]);

      // Bonus tile replacement
      for (let offset = 0; offset < 4; offset++) {
        const p = (eastIdx + offset) % 4;
        while (true) {
          const bonusIdx = playerData[p].hand.findIndex((t: any) => isBonus(t));
          if (bonusIdx === -1) break;
          const bonusTile = playerData[p].hand.splice(bonusIdx, 1)[0];
          if (!playerData[p].bonusTiles) playerData[p].bonusTiles = [];
          playerData[p].bonusTiles.push(bonusTile);
          if (wallIdx < shuffled.length) playerData[p].hand.push(shuffled[wallIdx++]);
        }
        playerData[p].hand = sortHand(playerData[p].hand);
      }

      const remainingWall = shuffled.slice(wallIdx);

      useGameStore.setState({
        isMultiplayer: true, isHost: true, myPlayerIndex: 0,
        players: playerData, wall: remainingWall, deadWall: [],
        currentPlayerIndex: eastIdx, phase: 'playing', roundWind: s.roundWind || 'east',
        config: config || s.config,
        lastAction: `Game started! P${eastIdx} (East) discards first.`,
        winner: null, winningTiles: [], showConfig: false,
        message: s.players[0]?.name ? (s.players[0].name + ' (East) discards first.') : 'Game started!',
        diceResults: { dice: results.dice, totals: results.totals, eastPlayerIdx: results.eastPlayerIdx },
        selfKongData: null, selfDrawWin: false, isHuaShang: false, isKangShang: false, isMenHu: false, isTW: false,
        nextDealerPlayerId: null,
      });

      // Broadcast to join clients
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

      readyRef.current = [];
      setPlayAgainReady([]);
    }
  }, [playAgainReady, phase]);

  return (
    <div className="relative">
      <div className="absolute top-3 left-3 z-10 flex gap-2">
        <button
          onClick={handleQuit}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
        >
          Quit Game
        </button>
        {phase === 'finished' && isMultiplayer && (
          <button
            onClick={handlePlayAgain}
            className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold text-sm transition-colors shadow-lg animate-pulse"
          >
            {playAgainReady.includes(isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0))
              ? '✓ Ready' : 'Play Again'}
          </button>
        )}
      </div>
      <div className="absolute top-3 right-3 z-10">
        <button
          onClick={() => setShowHistory(true)}
          className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
        >
          History
        </button>
      </div>
      {showHistory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowHistory(false)}>
          <div className="bg-green-800 rounded-xl p-6 max-w-lg w-full mx-4 border border-green-600/50 max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-yellow-300">Move History</h2>
              <span className="text-green-400 text-xs">{moveHistory.length} moves</span>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
              {moveHistory.map((entry, i) => (
                <div key={i} className="text-green-200 text-sm py-1 border-b border-green-700/30 last:border-0">
                  <span className="text-green-500 text-xs mr-2">#{i + 1}</span>
                  {entry}
                </div>
              ))}
              {moveHistory.length === 0 && (
                <div className="text-green-400/50 text-sm italic py-8 text-center">No moves recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
      <GameTable />
    </div>
  );
}
