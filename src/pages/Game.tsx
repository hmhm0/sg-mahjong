import { useState, useEffect, useMemo, useRef } from 'react';
import { GameTable } from '../components/GameTable';
import { useGameStore } from '../store/gameStore';
import { connection } from '../utils/connection';
import { buildDeck, seededShuffle, sortHand, isBonus } from '../game/tiles';
import { generateDiceResults } from '../components/MultiplayerDiceOverlay';
import { calculateTai } from '../game/rules';

export function Game() {
  const reset = useGameStore(s => s.reset);
  const isMultiplayer = useGameStore(s => s.isMultiplayer);
  const isHost = useGameStore(s => s.isHost);
  const phase = useGameStore(s => s.phase);
  const config = useGameStore(s => s.config);
  const lastAction = useGameStore(s => s.lastAction);
  const moveHistory = useGameStore(s => s.moveHistory);
  const winner = useGameStore(s => s.winner);
  const winningTiles = useGameStore(s => s.winningTiles);
  const winMethod = useGameStore(s => s.winMethod);
  const players = useGameStore(s => s.players);
  const wall = useGameStore(s => s.wall);
  const deadWall = useGameStore(s => s.deadWall);
  const currentPlayerIndex = useGameStore(s => s.currentPlayerIndex);
  const roundWind = useGameStore(s => s.roundWind);
  const discardHistory = useGameStore(s => s.discardHistory);
  const diceResults = useGameStore(s => s.diceResults);
  const [playAgainReady, setPlayAgainReady] = useState<number[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showWinPopup, setShowWinPopup] = useState(true);
  const [winCountdown, setWinCountdown] = useState(30);
  const readyRef = useRef<number[]>([]);
  const lastActionRef = useRef('');
  const hasAutoAdvancedRef = useRef(false);

  const winSummary = useMemo(() => {
    if (phase !== 'finished' || winner === null) return null;
    const winnerPlayer = players[winner];
    if (!winnerPlayer) return null;

    const summaryPlayers = players.map((p, i) => (i === winner ? { ...p, hand: [...winningTiles] } : p));
    const summaryState = {
      players: summaryPlayers,
      wall,
      deadWall,
      currentPlayerIndex,
      phase,
      roundWind,
      config,
      lastAction,
      winner,
      winningTiles,
      discardHistory,
      moveHistory,
      hostDisconnected: false,
      playerLeft: null,
      diceResults,
      winMethod,
    } as any;

    const selfDraw = winMethod === 'self_draw' || winMethod === 'kang_shang' || winMethod === 'men_hu';
    const result = calculateTai(
      summaryState,
      winner,
      selfDraw,
      false,
      false,
      winMethod === 'kang_shang',
      undefined,
      winMethod === 'tian_hu',
      winMethod === 'di_hu',
      winMethod === 'men_hu',
      winMethod === 'thirteen_wonders',
      winMethod === 'qi_qiang_yi',
      winMethod === 'hua_hu',
    );

    return {
      name: winnerPlayer.name,
      reason: lastAction || 'Winning hand',
      totalTai: result.totalTai,
      breakdown: result.breakdown,
    };
  }, [phase, winner, winningTiles, players, wall, deadWall, currentPlayerIndex, roundWind, config, lastAction, discardHistory, moveHistory, diceResults, winMethod]);

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
      setShowWinPopup(true);
      setWinCountdown(30);
      setPlayAgainReady([]);
      readyRef.current = [];
      hasAutoAdvancedRef.current = false;
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

  useEffect(() => {
    if (phase !== 'finished' || winner === null) return;
    if (!showWinPopup && winCountdown <= 0) return;
    if (winCountdown <= 0) {
      setShowWinPopup(false);
      return;
    }
    const t = setTimeout(() => setWinCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, winner, showWinPopup, winCountdown]);

  useEffect(() => {
    if (!isHost || phase !== 'finished' || winner === null || hasAutoAdvancedRef.current) return;
    const state = useGameStore.getState();
    const allReady = state.players.every((p: any) => !p.isHuman || readyRef.current.includes(p.id));
    if (!allReady || readyRef.current.length === 0) return;

    hasAutoAdvancedRef.current = true;
    const t = setTimeout(() => {
      useGameStore.getState().startGame(config);
      readyRef.current = [];
      setPlayAgainReady([]);
      setShowWinPopup(true);
      setWinCountdown(30);
      hasAutoAdvancedRef.current = false;
    }, 500);
    return () => clearTimeout(t);
  }, [playAgainReady, phase, winner, isHost, config]);

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

  const toggleReady = () => {
    const pi = isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0);
    const isNowReady = !playAgainReady.includes(pi);
    connection.send({ type: 'player_ready', playerIndex: pi, ready: isNowReady });
    setPlayAgainReady(prev => {
      const next = isNowReady ? [...prev.filter(i => i !== pi), pi] : prev.filter(i => i !== pi);
      readyRef.current = next;
      return next;
    });
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
      {phase === 'finished' && winner !== null && winSummary && (
        <>
          {showWinPopup ? (
            <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 px-4" onClick={() => setShowWinPopup(false)}>
              <div className="w-full max-w-xl bg-green-800/95 border border-green-600/60 rounded-2xl shadow-2xl p-6 max-h-[82vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="text-yellow-300 text-xs uppercase tracking-[0.2em] mb-1">Round End</div>
                    <h2 className="text-2xl font-bold text-white">{winSummary.name} wins</h2>
                  </div>
                  <button
                    onClick={() => setShowWinPopup(false)}
                    className="text-green-200 hover:text-white text-sm px-3 py-1 rounded-md bg-green-700/60"
                  >
                    Close
                  </button>
                </div>
                <p className="text-green-100 text-sm mb-4">{winSummary.reason}</p>
                <div className="text-center mb-4">
                  <div className="text-5xl font-bold text-yellow-300">{winSummary.totalTai}</div>
                  <div className="text-green-200 text-sm mt-1">tai total</div>
                </div>
                <div className="space-y-1 mb-4">
                  {winSummary.breakdown.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-green-700/40 rounded-lg px-3 py-2">
                      <span className="text-green-100">{item.name}</span>
                      <span className="text-yellow-300 font-bold">+{item.tai}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-green-200/80">
                  <span>Auto closes in {winCountdown}s</span>
                  <span>{playAgainReady.length} ready</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
              <div className="pointer-events-auto bg-green-800/90 border border-green-600/60 rounded-2xl shadow-2xl p-4 flex items-center gap-3">
                <button
                  onClick={() => setShowWinPopup(true)}
                  className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-sm"
                >
                  Show Result
                </button>
                <button
                  onClick={toggleReady}
                  className={`px-4 py-2 rounded-lg font-bold text-sm ${playAgainReady.includes(isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0)) ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                >
                  {playAgainReady.includes(isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0)) ? '✓ Ready' : 'Ready'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <GameTable />
    </div>
  );
}
