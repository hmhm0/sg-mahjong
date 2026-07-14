import { useState, useEffect, useMemo, useRef } from 'react';
import { GameTable } from '../components/GameTable';
import { Tile as MahjongTile, MeldDisplay } from '../components/Tile';
import { useGameStore } from '../store/gameStore';
import { connection } from '../utils/connection';
import { calculateTai } from '../game/rules';
import { formatPayoutAmount, getPayoutTableLabel } from '../game/chips';
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

function getSpecialPayoutLabel(
  breakdown: { name: string; tai: number }[],
  specialTaiCapEnabled: boolean,
  specialTaiCap?: number,
): string | null {
  const isSpecialHand = breakdown.some(item =>
    item.name.startsWith('Tian Hu') ||
    item.name.startsWith('Di Hu') ||
    item.name.startsWith('Men Hu') ||
    item.name.startsWith('Thirteen Wonders') ||
    item.name.startsWith('Qi Qiang Yi') ||
    item.name.startsWith('Hua Hu') ||
    item.name.startsWith('Big Three Dragons') ||
    item.name.startsWith('Da Xi Si') ||
    item.name.startsWith('Shi Ba Luo Han'),
  );
  if (!isSpecialHand) return null;
  if (!specialTaiCapEnabled) {
    return 'Special hands are uncapped.';
  }
  const cap = Math.max(1, Math.min(18, Math.floor(specialTaiCap ?? 18)));
  return `Special hands are capped at ${cap} tai.`;
}

function tileKey(tile: Tile): string {
  if (tile.category === 'suit') return `suit:${tile.suit}:${tile.value}`;
  if (tile.category === 'honor') return `honor:${tile.type}`;
  if (tile.category === 'bonus') return `bonus:${tile.bonusType}:${tile.id}`;
  return 'fei';
}

function describeTile(tile: Tile): string {
  if (tile.category === 'suit') {
    const suitName = tile.suit === 'bamboo' ? 'Bamboo' : tile.suit === 'characters' ? 'Characters' : 'Dots';
    return `${suitName} ${tile.value}`;
  }
  if (tile.category === 'honor') {
    const names: Record<string, string> = {
      east: 'East Wind',
      south: 'South Wind',
      west: 'West Wind',
      north: 'North Wind',
      hong: 'Red Dragon',
      fa: 'Green Dragon',
      baak: 'White Dragon',
    };
    return names[tile.type] || tile.type;
  }
  if (tile.category === 'bonus') {
    return `${tile.bonusType} ${tile.id}`;
  }
  return 'Fei';
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
  const winningDiscardPlayer = useGameStore(s => s.winningDiscardPlayer);
  const chipSettlement = useGameStore(s => s.chipSettlement);
  const players = useGameStore(s => s.players);
  const wall = useGameStore(s => s.wall);
  const deadWall = useGameStore(s => s.deadWall);
  const currentPlayerIndex = useGameStore(s => s.currentPlayerIndex);
  const roundWind = useGameStore(s => s.roundWind);
  const diceResults = useGameStore(s => s.diceResults);
  const nextRoundCountdown = useGameStore(s => s.nextRoundCountdown);
  const debugLogs = useGameStore(s => s.debugLogs);
  const roomPaused = useGameStore(s => s.roomPaused);
  const [playAgainReady, setPlayAgainReady] = useState<number[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showDebugLogs, setShowDebugLogs] = useState(false);
  const [showWinPopup, setShowWinPopup] = useState(true);
  const [winCountdown, setWinCountdown] = useState(30);
  const [winPopupTimerEnabled, setWinPopupTimerEnabled] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const readyRef = useRef<number[]>([]);
  const hasAutoAdvancedRef = useRef(false);
  const lastPhaseRef = useRef(phase);

  useEffect(() => {
    const updateCompact = () => {
      if (typeof window === 'undefined') return;
      setIsCompactViewport(window.matchMedia('(max-width: 640px)').matches);
    };
    updateCompact();
    window.addEventListener('resize', updateCompact);
    window.addEventListener('orientationchange', updateCompact);
    return () => {
      window.removeEventListener('resize', updateCompact);
      window.removeEventListener('orientationchange', updateCompact);
    };
  }, []);

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
    const fallbackDiscardText =
      !selfDraw && typeof winningDiscardPlayer === 'number' && players[winningDiscardPlayer]
        ? `${players[winningDiscardPlayer].name} discarded the winning tile to ${winnerPlayer.name}.`
        : null;

    return {
      name: winnerPlayer.name,
      headline: getWinHeadline(result.breakdown, winnerPlayer.name),
      reason: lastAction || 'Winning hand',
      totalTai: result.totalTai,
      breakdown: result.breakdown,
      handTiles: winningTiles,
      bonusTiles: winnerPlayer.bonusTiles || [],
      winningDiscardTile,
      winningDiscardText: winningDiscardTile && typeof winningDiscardPlayer === 'number' && players[winningDiscardPlayer]
        ? `${players[winningDiscardPlayer].name} discarded ${describeTile(winningDiscardTile)} to ${winnerPlayer.name}.`
        : fallbackDiscardText,
      winningTile: selfDraw ? lastDrawnTile : winningDiscardTile,
      selfDraw,
    };
  }, [phase, winner, winningTiles, lastDrawnTile, players, wall, deadWall, currentPlayerIndex, roundWind, config, lastAction, moveHistory, diceResults, winMethod, winningDiscardPlayer]);
  const settlementWinnerName = chipSettlement
    ? (players[chipSettlement.winnerIndex]?.name || `P${chipSettlement.winnerIndex + 1}`)
    : '';
  const specialPayoutLabel = winSummary ? getSpecialPayoutLabel(winSummary.breakdown, Boolean(config.specialTaiCapEnabled), config.specialTaiCap) : null;

  const realPlayerCount = useMemo(() => players.filter(p => p.isHuman).length, [players]);
  const readyCount = playAgainReady.filter(playerId => players.some(p => p.id === playerId && p.isHuman)).length;
  const localReadyPlayerId = isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0);
  const isLocalReady = playAgainReady.includes(localReadyPlayerId);

  // Reset history on new round
  useEffect(() => {
    if (phase === 'playing' && !roomPaused) {
      setShowWinPopup(true);
      setWinCountdown(30);
      setWinPopupTimerEnabled(true);
      useGameStore.setState({ nextRoundCountdown: null });
      setPlayAgainReady([]);
      readyRef.current = [];
      hasAutoAdvancedRef.current = false;
    }
  }, [phase, roomPaused]);

  // Clear stale ready state as soon as a round ends so the result screen stays visible
  // and the next hand only starts after fresh ready input for the current finish.
  useEffect(() => {
    const justFinished = lastPhaseRef.current !== 'finished' && phase === 'finished';
    if (justFinished && winner !== null && !roomPaused) {
      setPlayAgainReady([]);
      readyRef.current = [];
      hasAutoAdvancedRef.current = false;
      if (nextRoundCountdown !== null) {
        useGameStore.setState({ nextRoundCountdown: null });
      }
    }
    lastPhaseRef.current = phase;
  }, [phase, winner, roomPaused, nextRoundCountdown]);

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

  // Keep remote clients synced to the host's authoritative game state.
  useEffect(() => {
    const unsub = connection.on('state_update', (msg) => {
      const state = msg.state;
      if (!state) return;
      state.isMultiplayer = true;
      state.isHost = connection.playerIndex === 0;
      state.myPlayerIndex = connection.playerIndex >= 0 ? connection.playerIndex : 0;
      useGameStore.setState(state);
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
    if (!canAutoAdvance || phase !== 'finished' || winner === null || hasAutoAdvancedRef.current || roomPaused) return;
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
    if (isMultiplayer) {
      const roster = useGameStore.getState().players.map((p: any) => ({
        id: p.id,
        name: p.name,
        isHuman: p.isHuman,
      }));
      connection.send({ type: 'start_game', mode: 'round', config: config, players: roster });
    } else {
      useGameStore.getState().startGame(config);
    }
    readyRef.current = [];
    setPlayAgainReady([]);
    setShowWinPopup(true);
    setWinCountdown(30);
    setWinPopupTimerEnabled(true);
    hasAutoAdvancedRef.current = false;
  }, [playAgainReady, phase, winner, isHost, isMultiplayer, config, nextRoundCountdown, roomPaused]);

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
      connection.send({ type: isHost ? 'host_quit' : 'leave_room' });
      setTimeout(() => {
        connection.disconnect();
      }, 150);
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
    if (phase !== 'finished' || winner === null || roomPaused) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
      return;
    }
    const allReady = players.every((p: any) => !p.isHuman || playAgainReady.includes(p.id));
    if (!allReady || playAgainReady.filter(playerId => players.some(p => p.id === playerId && p.isHuman)).length === 0) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
    }
  }, [phase, winner, players, playAgainReady, nextRoundCountdown, roomPaused]);

  return (
      <div className="relative">
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          onClick={handleQuit}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
        >
          Quit Game
        </button>
        {isMultiplayer && isHost && connection.roomCode && (
          <div className="px-3 py-1.5 rounded-lg bg-green-950/85 border border-yellow-400/40 text-yellow-100 text-sm font-bold shadow-lg">
            Room {connection.roomCode}
          </div>
        )}
      </div>
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10">
        <div className="flex gap-1.5 sm:gap-2">
          <button
            onClick={() => setShowDebugLogs(true)}
            className="px-2.5 py-1.5 sm:px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-xs sm:text-sm transition-colors shadow-lg"
          >
            Dev Logs
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="px-2.5 py-1.5 sm:px-3 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold text-xs sm:text-sm transition-colors shadow-lg"
          >
            History
          </button>
        </div>
      </div>
      {showDebugLogs && (
        <div className={`fixed inset-0 bg-black/70 z-50 flex ${isCompactViewport ? 'items-end' : 'items-center justify-center'}`} onClick={() => setShowDebugLogs(false)}>
          <div
            className={`bg-slate-900 border border-slate-700 shadow-2xl flex flex-col w-full ${isCompactViewport ? 'max-w-none rounded-t-3xl h-[84dvh] px-3.5 pt-3.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]' : 'rounded-xl p-6 max-w-5xl mx-4 max-h-[85vh]'} `}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between gap-2 ${isCompactViewport ? 'mb-2.5' : 'mb-3'}`}>
              <div>
                <h2 className={`${isCompactViewport ? 'text-base' : 'text-lg'} sm:text-xl font-bold text-white`}>Developer Logs</h2>
                <p className="text-slate-400 text-[10px] sm:text-xs mt-0.5">{debugLogs.length} entries, newest first</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={clearDebugLogs}
                  className="px-2.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-[10px] sm:text-sm min-h-10 sm:min-h-11"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowDebugLogs(false)}
                  className="px-2.5 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-bold text-[10px] sm:text-sm min-h-10 sm:min-h-11"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1.5 pr-1 overscroll-contain">
              {[...debugLogs].reverse().map((entry) => (
                <details key={entry.id} className="rounded-md border border-slate-700 bg-slate-800/80 p-1.5 sm:p-1.5">
                  {(() => {
                    const reason = (entry.details as { reason?: string } | undefined)?.reason;
                    return (
                      <>
                        <summary className="list-none cursor-pointer">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-slate-100 font-semibold text-[10px] sm:text-[11px] leading-4 sm:leading-5 truncate">{entry.message}</div>
                              <div className="text-slate-400 text-[8px] sm:text-[9px]">{entry.type} | {entry.ts}</div>
                            </div>
                            <div className="text-slate-300 text-[8px] sm:text-[9px] text-right shrink-0 leading-4">
                              <div>W {entry.wallCount}</div>
                              <div>T P{entry.currentPlayerIndex}</div>
                            </div>
                          </div>
                        </summary>
                        <div className="mt-1 grid grid-cols-2 gap-1 text-[8px] sm:text-[9px] text-slate-300 leading-4">
                          <div>Players: {entry.snapshot.players.length}</div>
                          <div>Discards: {entry.snapshot.discardHistory.length}</div>
                          <div className="col-span-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] sm:text-[9px] text-slate-300">
                      {entry.snapshot.players.map(p => (
                        <span key={p.playerIndex}>
                          P{p.playerIndex + 1}: {p.name}
                        </span>
                      ))}
                    </div>
                    {reason && <div className="col-span-2">Reason: {reason}</div>}
                    {entry.snapshot.waitingForClaim?.tile && <div>Claim Tile: {entry.snapshot.waitingForClaim.tile}</div>}
                    {entry.snapshot.waitingForClaim && <div>Eligible: {entry.snapshot.waitingForClaim.eligiblePlayers.map(p => `P${p.playerIndex}:${p.actions.join('/')}`).join(', ') || 'none'}</div>}
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer list-none text-[8px] sm:text-[9px] text-slate-400 hover:text-slate-200">Raw JSON</summary>
                          <pre className="mt-1 text-[8px] sm:text-[9px] leading-4 text-slate-200 whitespace-pre-wrap overflow-x-auto max-h-32">
{JSON.stringify(entry, null, 2)}
                          </pre>
                        </details>
                      </>
                    );
                  })()}
                </details>
              ))}
              {debugLogs.length === 0 && (
                <div className="text-slate-400 text-xs sm:text-sm italic py-6 sm:py-8 text-center">No developer logs yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
      {showHistory && (
        <div className={`fixed inset-0 bg-black/60 z-50 flex ${isCompactViewport ? 'items-end' : 'items-center justify-center'}`} onClick={() => setShowHistory(false)}>
          <div
            className={`bg-green-800 border border-green-600/50 shadow-2xl flex flex-col w-full ${isCompactViewport ? 'max-w-none rounded-t-3xl h-[78dvh] px-3.5 pt-3.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]' : 'rounded-xl p-6 max-w-lg mx-4 max-h-[80vh]'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between ${isCompactViewport ? 'mb-2' : 'mb-3'}`}>
              <h2 className={`${isCompactViewport ? 'text-base' : 'text-lg'} sm:text-xl font-bold text-yellow-300`}>Move History</h2>
              <span className="text-green-400 text-[10px] sm:text-xs">{moveHistory.length} moves</span>
            </div>
            <div className="overflow-y-auto flex-1 space-y-0.5 pr-1 overscroll-contain">
              {moveHistory.map((entry, i) => (
                <div key={i} className="text-green-200 text-[10px] sm:text-xs py-0.75 border-b border-green-700/30 last:border-0 leading-4">
                  <span className="text-green-500 text-[10px] sm:text-xs mr-1.5">#{i + 1}</span>
                  {entry}
                </div>
              ))}
              {moveHistory.length === 0 && (
                <div className="text-green-400/50 text-xs sm:text-sm italic py-6 sm:py-8 text-center">No moves recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
      {phase === 'finished' && winner !== null && winSummary && (
        <>
      {showWinPopup ? (
            <div className={`fixed inset-0 bg-black/65 z-50 px-4 flex ${isCompactViewport ? 'items-end' : 'items-center justify-center'}`} onClick={closeWinPopup}>
              <div
                className={`w-full bg-green-800/95 border border-green-600/60 shadow-2xl overflow-y-auto overscroll-contain ${isCompactViewport ? 'max-w-none rounded-t-3xl h-[92dvh] p-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]' : 'max-w-xl rounded-2xl p-6 max-h-[82vh]'}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 mb-3 sm:mb-4">
                  <div>
                    <div className="text-yellow-300 text-[10px] sm:text-xs uppercase tracking-[0.2em] mb-1">Round End</div>
                    <h2 className={`${isCompactViewport ? 'text-lg' : 'text-xl'} sm:text-2xl font-bold text-white leading-tight`}>{winSummary.headline}</h2>
                  </div>
                  <button
                    onClick={closeWinPopup}
                    className="text-green-200 hover:text-white text-xs sm:text-sm px-3 py-2 rounded-md bg-green-700/60 min-h-10 sm:min-h-11"
                  >
                    Close
                  </button>
                </div>
                <p className="text-green-100 text-xs sm:text-sm mb-3">{winSummary.reason}</p>
                <div className="space-y-2 mb-3 sm:mb-4">
                  <div>
                    <div className="text-yellow-300 text-[10px] sm:text-xs font-bold mb-1">Winning Hand</div>
                    <div className={`flex flex-wrap gap-1 rounded-lg bg-green-700/35 ${isCompactViewport ? 'p-1.5' : 'p-2'}`}>
                      {winSummary.handTiles.map((tile, i) => (
                        <MahjongTile key={`hand-${i}`} tile={tile} size="md" />
                      ))}
                    </div>
                  </div>
                  {players[winner]?.melds?.length > 0 && (
                    <div>
                      <div className="text-yellow-300 text-[10px] sm:text-xs font-bold mb-1">Melds</div>
                      <div className={`flex flex-wrap gap-1.5 rounded-lg bg-green-700/35 ${isCompactViewport ? 'p-1.5' : 'p-2'}`}>
                        {players[winner].melds.map((meld, i) => (
                          <MeldDisplay key={`meld-${i}`} tiles={meld.tiles} type={meld.type} size="sm" />
                        ))}
                      </div>
                    </div>
                  )}
                  {winSummary.bonusTiles.length > 0 && (
                    <div>
                      <div className="text-yellow-300 text-[10px] sm:text-xs font-bold mb-1">Bonus Tiles</div>
                      <div className={`flex flex-wrap gap-1 rounded-lg bg-green-700/35 ${isCompactViewport ? 'p-1.5' : 'p-2'}`}>
                        {winSummary.bonusTiles.map((tile, i) => (
                          <MahjongTile key={`bonus-${i}`} tile={tile} size="md" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-center mb-3 sm:mb-4">
                  <div className={`${isCompactViewport ? 'text-4xl' : 'text-5xl'} font-bold text-yellow-300 leading-none`}>{winSummary.totalTai}</div>
                  <div className="text-green-200 text-xs sm:text-sm mt-1">tai total</div>
                </div>
                {winSummary.winningTile && (
                  <div className="mb-3 sm:mb-4">
                    <div className="text-yellow-300 text-[10px] sm:text-xs font-bold mb-1">{winSummary.selfDraw ? 'Winning Draw' : 'Winning Tile'}</div>
                    <div className={`flex flex-wrap justify-center gap-1 rounded-lg bg-green-700/35 ${isCompactViewport ? 'p-1.5' : 'p-2'}`}>
                      <MahjongTile tile={winSummary.winningTile} size="md" highlight />
                    </div>
                  </div>
                )}
                  <div className="space-y-1 mb-3 sm:mb-4">
                  {winSummary.breakdown.map((item, i) => (
                    <div key={i} className={`flex items-center justify-between ${isCompactViewport ? 'text-xs' : 'text-sm'} bg-green-700/40 rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2`}>
                      <span className="text-green-100 pr-2">{item.name}</span>
                      <span className="text-yellow-300 font-bold shrink-0">+{item.tai}</span>
                    </div>
                  ))}
                </div>
                {winSummary.winningDiscardText && (
                  <div className="mb-3 sm:mb-4 rounded-lg bg-green-700/30 px-3 py-2 text-xs sm:text-sm text-green-100">
                    {winSummary.winningDiscardText}
                  </div>
                )}
                {chipSettlement && config.payoutTable !== 'none' && (
                  <div className="mb-3 sm:mb-4 rounded-lg border border-yellow-400/30 bg-yellow-500/10 px-3 py-3 text-xs sm:text-sm text-yellow-50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-yellow-200">Payout Table</span>
                      <span className="text-yellow-100 text-xs">{getPayoutTableLabel(chipSettlement.payoutTable)}</span>
                    </div>
                    <div className="mt-1 text-yellow-100/90 text-xs sm:text-sm">
                      {specialPayoutLabel && (
                        <span className="block mb-1">
                          {specialPayoutLabel}
                        </span>
                      )}
                      {chipSettlement.rawTai > chipSettlement.tai && (
                        <span className="block mb-1">
                          Payout capped at {chipSettlement.tai} tai from a {chipSettlement.rawTai}-tai win.
                        </span>
                      )}
                      {chipSettlement.mode === 'discard'
                        ? chipSettlement.settlementStyle === 'shooter'
                          ? `Shooter pay: only the shooter pays ${formatPayoutAmount(chipSettlement.shooterPerTai)} for ${chipSettlement.tai} tai.`
                          : `Non-shooter pay: each non-discarder pays ${formatPayoutAmount(chipSettlement.nonShooterPerTai)} and the discarder pays ${formatPayoutAmount(chipSettlement.selfDrawPerTai)} for ${chipSettlement.tai} tai.`
                        : `Self-draw pay: each opponent pays ${formatPayoutAmount(chipSettlement.selfDrawPerTai)} for ${chipSettlement.tai} tai.`}
                    </div>
                    <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-yellow-300/20 bg-green-950/40 px-2.5 py-2 sm:px-3">
                      <div className="mb-1 text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-yellow-200">Who pays the winner</div>
                      <div className="space-y-1 text-[10px] sm:text-sm text-yellow-50">
                        {chipSettlement.playerDeltas
                          .filter(delta => delta.delta !== 0)
                          .map(delta => {
                            const player = players[delta.playerIndex];
                            const playerName = player?.name || `P${delta.playerIndex + 1}`;
                            const amount = formatPayoutAmount(Math.abs(delta.delta));
                            const isWinner = delta.playerIndex === chipSettlement.winnerIndex;
                            return (
                              <div key={delta.playerIndex} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1.5">
                                <span className={`min-w-0 truncate ${isWinner ? 'font-bold text-yellow-200' : 'text-yellow-50'}`}>
                                  {playerName}
                                </span>
                                <span className={`shrink-0 text-right font-bold ${isWinner ? 'text-yellow-200' : 'text-red-200'}`}>
                                  {isWinner ? `receives ${amount}` : `gives ${amount}`} to {settlementWinnerName}
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 text-[10px] sm:text-xs text-green-200/80 flex-wrap">
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
              <div className="pointer-events-auto flex flex-col items-center gap-3 px-4">
                <div className="bg-green-800/90 border border-green-600/60 rounded-2xl shadow-2xl p-3 sm:p-4 flex items-center gap-3 flex-wrap justify-center">
                  <button
                    onClick={reopenWinPopup}
                    className="px-4 py-2 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-sm min-h-11 w-full sm:w-auto"
                  >
                    Show Result
                  </button>
                  <button
                    onClick={toggleReady}
                    className={`px-4 py-2 rounded-lg font-bold text-sm min-h-11 w-full sm:w-auto ${isLocalReady ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                  >
                    {isLocalReady ? `✓ Ready (${readyCount}/${realPlayerCount})` : `Ready (${readyCount}/${realPlayerCount})`}
                  </button>
                </div>
                {nextRoundCountdown !== null && (
                  <div className="rounded-2xl border-2 border-yellow-400 bg-green-950/95 px-5 py-3 shadow-2xl animate-pulse text-center min-w-[220px] max-w-[90vw]">
                    <div className="text-yellow-300 text-[11px] uppercase tracking-[0.25em] mb-1">Next Round Starting</div>
                    <div className="text-white font-black text-4xl leading-none">{nextRoundCountdown}s</div>
                    <div className="text-green-200 text-xs mt-1">everyone ready</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {roomPaused && (
        <div className="fixed inset-0 z-40 bg-black/45 pointer-events-none flex items-center justify-center">
          <div className="pointer-events-auto bg-red-900/95 border border-red-500/70 rounded-2xl px-6 py-4 shadow-2xl text-center max-w-sm mx-4">
            <div className="text-red-200 text-xs uppercase tracking-[0.2em] mb-1">Room Paused</div>
            <div className="text-white font-bold text-lg">A player left the game.</div>
            <div className="text-red-200 text-sm mt-1">Only quitting is allowed until the room closes.</div>
          </div>
        </div>
      )}
      <GameTable />
    </div>
  );
}
