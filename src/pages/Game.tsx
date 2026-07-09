import { useState, useEffect, useMemo, useRef } from 'react';
import { GameTable } from '../components/GameTable';
import { Tile as MahjongTile, MeldDisplay } from '../components/Tile';
import { useGameStore } from '../store/gameStore';
import { connection } from '../utils/connection';
import { buildDeck, seededShuffle, sortHand, isBonus } from '../game/tiles';
import { generateDiceResults } from '../components/MultiplayerDiceOverlay';
import { calculateTai } from '../game/rules';
import type { Tile } from '../types/mahjong';

const WIN_HEADLINE_PRIORITY = [
  'Tian Hu (天胡)',
  'Di Hu (地胡)',
  'Men Hu (门胡)',
  'Thirteen Wonders (十三幺)',
  'Qi Qiang Yi (七搶一)',
  'Hua Hu (花胡)',
  'Shi Ba Luo Han (十八罗汉)',
  'Da Xi Si (大四喜)',
  'Big Three Dragons',
  'Xiao Xi Si (小四喜)',
  'Pure Honours (字一色)',
  'Little Three Dragons',
  'Kang Kang Hu (杠杠胡)',
  'Full Flush Sequence Hand (清一色平胡)',
  'Full Flush Triplets Hand (清一色碰碰胡)',
  'Full Flush',
  'Half Flush',
  'Pong Pong Hu (碰碰胡)',
  'Ping Hu (平胡)',
  'Chou Ping Hu (臭平胡)',
] as const;

function getWinHeadline(
  breakdown: { name: string; tai: number }[],
  fallbackName: string,
): string {
  for (const target of WIN_HEADLINE_PRIORITY) {
    const match = breakdown.find(item => item.name === target);
    if (match) return match.name;
  }
  return `${fallbackName} wins`;
}

function tileKey(tile: Tile): string {
  if (tile.category === 'suit') return `suit:${tile.suit}:${tile.value}`;
  if (tile.category === 'honor') return `honor:${tile.type}`;
  if (tile.category === 'bonus') return `bonus:${tile.bonusType}:${tile.id}`;
  return 'fei';
}

export function Game() {
  const reset = useGameStore(s => s.reset);
  const clearDebugLogs = useGameStore(s => s.clearDebugLogs);
  const isMultiplayer = useGameStore(s => s.isMultiplayer);
  const isHost = useGameStore(s => s.isHost);
  const phase = useGameStore(s => s.phase);
  const config = useGameStore(s => s.config);
  const lastAction = useGameStore(s => s.lastAction);
  const moveHistory = useGameStore(s => s.moveHistory);
  const winner = useGameStore(s => s.winner);
  const winningTiles = useGameStore(s => s.winningTiles);
  const lastDrawnTile = useGameStore(s => s.lastDrawnTile);
  const winMethod = useGameStore(s => s.winMethod);
  const players = useGameStore(s => s.players);
  const wall = useGameStore(s => s.wall);
  const deadWall = useGameStore(s => s.deadWall);
  const currentPlayerIndex = useGameStore(s => s.currentPlayerIndex);
  const roundWind = useGameStore(s => s.roundWind);
  const discardHistory = useGameStore(s => s.discardHistory);
  const diceResults = useGameStore(s => s.diceResults);
  const nextRoundCountdown = useGameStore(s => s.nextRoundCountdown);
  const debugLogs = useGameStore(s => s.debugLogs);
  const [playAgainReady, setPlayAgainReady] = useState<number[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [showWinPopup, setShowWinPopup] = useState(true);
  const [winCountdown, setWinCountdown] = useState(30);
  const [winPopupTimerEnabled, setWinPopupTimerEnabled] = useState(true);
  const readyRef = useRef<number[]>([]);
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
    const baseHand = winnerPlayer.hand || [];
    const remainingCounts = new Map<string, number>();
    for (const tile of baseHand) {
      const key = tileKey(tile);
      remainingCounts.set(key, (remainingCounts.get(key) || 0) + 1);
    }
    let winningDiscardTile: Tile | null = null;
    if (winMethod === 'discard' || winMethod === 'qiang_kang' || winMethod === 'di_hu') {
      for (const tile of winningTiles) {
        const key = tileKey(tile);
        const count = remainingCounts.get(key) || 0;
        if (count > 0) {
          remainingCounts.set(key, count - 1);
        } else {
          winningDiscardTile = tile;
          break;
        }
      }
    }
    const result = calculateTai(
      summaryState,
      winner,
      selfDraw,
      false,
      winMethod === 'hua_shang',
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
      headline: getWinHeadline(result.breakdown, winnerPlayer.name),
      reason: lastAction || 'Winning hand',
      totalTai: result.totalTai,
      breakdown: result.breakdown,
      handTiles: winningTiles,
      bonusTiles: winnerPlayer.bonusTiles || [],
      winningDiscardTile,
      winningTile: selfDraw ? lastDrawnTile : winningDiscardTile,
      selfDraw,
    };
  }, [phase, winner, winningTiles, lastDrawnTile, players, wall, deadWall, currentPlayerIndex, roundWind, config, lastAction, discardHistory, moveHistory, diceResults, winMethod]);

  const realPlayerCount = useMemo(() => players.filter(p => p.isHuman).length, [players]);
  const readyCount = playAgainReady.filter(playerId => players.some(p => p.id === playerId && p.isHuman)).length;
  const localReadyPlayerId = isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0);
  const isLocalReady = playAgainReady.includes(localReadyPlayerId);

  // Reset history on new round
  useEffect(() => {
    if (phase === 'playing') {
      setShowWinPopup(true);
      setWinCountdown(30);
      setWinPopupTimerEnabled(true);
      useGameStore.setState({ nextRoundCountdown: null });
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
    if (!winPopupTimerEnabled || !showWinPopup) return;
    if (winCountdown <= 0) {
      setShowWinPopup(false);
      setWinPopupTimerEnabled(false);
      return;
    }
    const t = setTimeout(() => setWinCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, winner, showWinPopup, winCountdown, winPopupTimerEnabled]);

  useEffect(() => {
    const canAutoAdvance = !isMultiplayer || isHost;
    if (!canAutoAdvance || phase !== 'finished' || winner === null || hasAutoAdvancedRef.current) return;
    const state = useGameStore.getState();
    const allReady = state.players.every((p: any) => !p.isHuman || readyRef.current.includes(p.id));
    if (!allReady || readyRef.current.length === 0) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
      return;
    }

    if (nextRoundCountdown === null) {
      useGameStore.setState({ nextRoundCountdown: 5 });
      return;
    }

    if (nextRoundCountdown > 0) {
      const t = setTimeout(() => {
        useGameStore.setState(s => ({
          nextRoundCountdown: s.nextRoundCountdown === null ? null : Math.max(0, s.nextRoundCountdown - 1),
        }));
      }, 1000);
      return () => clearTimeout(t);
    }

    hasAutoAdvancedRef.current = true;
    useGameStore.setState({ nextRoundCountdown: null });
    useGameStore.getState().startGame(config);
    readyRef.current = [];
    setPlayAgainReady([]);
    setShowWinPopup(true);
    setWinCountdown(30);
    setWinPopupTimerEnabled(true);
    hasAutoAdvancedRef.current = false;
  }, [playAgainReady, phase, winner, isHost, isMultiplayer, config, nextRoundCountdown]);

  const closeWinPopup = () => {
    setShowWinPopup(false);
    setWinPopupTimerEnabled(false);
  };

  const reopenWinPopup = () => {
    setShowWinPopup(true);
    setWinPopupTimerEnabled(false);
  };

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

  useEffect(() => {
    if (phase !== 'finished' || winner === null) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
      return;
    }
    const allReady = players.every((p: any) => !p.isHuman || playAgainReady.includes(p.id));
    if (!allReady || playAgainReady.filter(playerId => players.some(p => p.id === playerId && p.isHuman)).length === 0) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
    }
  }, [phase, winner, players, playAgainReady, nextRoundCountdown]);

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
        debugLogs: [],
        players: playerData, wall: remainingWall, deadWall: [],
        currentPlayerIndex: eastIdx, phase: 'playing', roundWind: s.roundWind || 'east',
        config: config || s.config,
        lastAction: `Game started! P${eastIdx} (East) discards first.`,
        moveHistory: [`Game started! P${eastIdx} (East) discards first.`],
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowDebugLogs(true)}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
          >
            Dev Logs
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
          >
            History
          </button>
        </div>
      </div>
      {showDebugLogs && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowDebugLogs(false)}>
          <div className="bg-slate-900 rounded-xl p-6 max-w-5xl w-full mx-4 border border-slate-700 max-h-[85vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 gap-3">
              <div>
                <h2 className="text-xl font-bold text-white">Developer Logs</h2>
                <p className="text-slate-400 text-xs mt-1">{debugLogs.length} entries, newest first</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={clearDebugLogs}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-sm"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowDebugLogs(false)}
                  className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-sm"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2 pr-1">
              {[...debugLogs].reverse().map((entry) => (
                <details key={entry.id} className="rounded-lg border border-slate-700 bg-slate-800/80 p-2">
                  {(() => {
                    const reason = (entry.details as { reason?: string } | undefined)?.reason;
                    return (
                      <>
                  <summary className="list-none cursor-pointer">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-slate-100 font-semibold text-xs leading-5">{entry.message}</div>
                        <div className="text-slate-400 text-[10px]">{entry.type} | {entry.ts}</div>
                      </div>
                      <div className="text-slate-300 text-[10px] text-right shrink-0">
                        <div>Wall: {entry.wallCount}</div>
                        <div>Turn: P{entry.currentPlayerIndex}</div>
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-300">
                    <div>Players: {entry.snapshot.players.length}</div>
                    <div>Discards: {entry.snapshot.discardHistory.length}</div>
                    {reason && <div className="col-span-2">Reason: {reason}</div>}
                    {entry.snapshot.waitingForClaim?.tile && <div>Claim Tile: {entry.snapshot.waitingForClaim.tile}</div>}
                    {entry.snapshot.waitingForClaim && <div>Eligible: {entry.snapshot.waitingForClaim.eligiblePlayers.map(p => `P${p.playerIndex}:${p.actions.join('/')}`).join(', ') || 'none'}</div>}
                  </div>
                  <pre className="mt-2 text-[10px] leading-4 text-slate-200 whitespace-pre-wrap overflow-x-auto">
{JSON.stringify(entry, null, 2)}
                  </pre>
                      </>
                    );
                  })()}
                </details>
              ))}
              {debugLogs.length === 0 && (
                <div className="text-slate-400 text-sm italic py-8 text-center">No developer logs yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
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
            <div className="fixed inset-0 bg-black/65 flex items-center justify-center z-50 px-4" onClick={closeWinPopup}>
              <div className="w-full max-w-xl bg-green-800/95 border border-green-600/60 rounded-2xl shadow-2xl p-6 max-h-[82vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                  <div className="text-yellow-300 text-xs uppercase tracking-[0.2em] mb-1">Round End</div>
                  <h2 className="text-2xl font-bold text-white">{winSummary.headline}</h2>
                </div>
                  <button
                    onClick={closeWinPopup}
                    className="text-green-200 hover:text-white text-sm px-3 py-1 rounded-md bg-green-700/60"
                  >
                    Close
                  </button>
                </div>
                <p className="text-green-100 text-sm mb-4">{winSummary.reason}</p>
                <div className="space-y-3 mb-4">
                  <div>
                    <div className="text-yellow-300 text-xs font-bold mb-1">Winning Hand</div>
                    <div className="flex flex-wrap gap-1 rounded-lg bg-green-700/35 p-2">
                      {winSummary.handTiles.map((tile, i) => (
                        <MahjongTile key={`hand-${i}`} tile={tile} size="md" />
                      ))}
                    </div>
                  </div>
                  {players[winner]?.melds?.length > 0 && (
                    <div>
                      <div className="text-yellow-300 text-xs font-bold mb-1">Melds</div>
                      <div className="flex flex-wrap gap-2 rounded-lg bg-green-700/35 p-2">
                        {players[winner].melds.map((meld, i) => (
                          <MeldDisplay key={`meld-${i}`} tiles={meld.tiles} type={meld.type} size="sm" />
                        ))}
                      </div>
                    </div>
                  )}
                  {winSummary.bonusTiles.length > 0 && (
                    <div>
                      <div className="text-yellow-300 text-xs font-bold mb-1">Bonus Tiles</div>
                      <div className="flex flex-wrap gap-1 rounded-lg bg-green-700/35 p-2">
                        {winSummary.bonusTiles.map((tile, i) => (
                          <MahjongTile key={`bonus-${i}`} tile={tile} size="md" />
                        ))}
                      </div>
                    </div>
                  )}
                  {winSummary.winningDiscardTile && (
                    <div>
                      <div className="text-yellow-300 text-xs font-bold mb-1">Winning Discard</div>
                      <div className="flex flex-wrap gap-1 rounded-lg bg-green-700/35 p-2">
                        <MahjongTile tile={winSummary.winningDiscardTile} size="md" highlight />
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-center mb-4">
                  <div className="text-5xl font-bold text-yellow-300">{winSummary.totalTai}</div>
                  <div className="text-green-200 text-sm mt-1">tai total</div>
                </div>
                {winSummary.winningTile && (
                  <div className="mb-4">
                    <div className="text-yellow-300 text-xs font-bold mb-1">{winSummary.selfDraw ? 'Winning Draw' : 'Winning Tile'}</div>
                    <div className="flex flex-wrap justify-center gap-1 rounded-lg bg-green-700/35 p-2">
                      <MahjongTile tile={winSummary.winningTile} size="md" highlight />
                    </div>
                  </div>
                )}
                <div className="space-y-1 mb-4">
                  {winSummary.breakdown.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-green-700/40 rounded-lg px-3 py-2">
                      <span className="text-green-100">{item.name}</span>
                      <span className="text-yellow-300 font-bold">+{item.tai}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-green-200/80">
                  <span>
                    {nextRoundCountdown !== null
                      ? `Next round starts in ${nextRoundCountdown}s`
                      : winPopupTimerEnabled
                        ? `Auto closes in ${winCountdown}s`
                        : 'Result popup reopened'}
                  </span>
                  <span>{readyCount}/{realPlayerCount} ready</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center">
              <div className="pointer-events-auto flex flex-col items-center gap-3">
                <div className="bg-green-800/90 border border-green-600/60 rounded-2xl shadow-2xl p-4 flex items-center gap-3">
                  <button
                    onClick={reopenWinPopup}
                    className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-sm"
                  >
                    Show Result
                  </button>
                  <button
                    onClick={toggleReady}
                    className={`px-4 py-2 rounded-lg font-bold text-sm ${isLocalReady ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                  >
                    {isLocalReady ? `✓ Ready (${readyCount}/${realPlayerCount})` : `Ready (${readyCount}/${realPlayerCount})`}
                  </button>
                </div>
                {nextRoundCountdown !== null && (
                  <div className="rounded-2xl border-2 border-yellow-400 bg-green-950/95 px-6 py-3 shadow-2xl animate-pulse text-center min-w-[220px]">
                    <div className="text-yellow-300 text-xs uppercase tracking-[0.25em] mb-1">Next Round Starting</div>
                    <div className="text-white font-black text-4xl leading-none">{nextRoundCountdown}s</div>
                    <div className="text-green-200 text-xs mt-1">everyone ready</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <GameTable />
    </div>
  );
}
