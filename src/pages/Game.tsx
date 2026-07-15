import { useState, useEffect, useMemo, useRef } from 'react';
import { GameTable } from '../components/GameTable';
import { Tile as MahjongTile, MeldDisplay } from '../components/Tile';
import { useGameStore } from '../store/gameStore';
import { connection } from '../utils/connection';
import { navigate } from '../utils/navigation';
import { calculateTai } from '../game/rules';
import { formatPayoutAmount, getChipSettlementRuleText, getChipSettlementTransfers, getChipStandings, getPayoutTableLabel, isChipMatchOver } from '../game/chips';
import { isSelfDrawWinMethod } from '../game/winMethods';
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
  'Kan Kan Hu (坎坎胡)',
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
    item.name.startsWith('Kan Kan Hu') ||
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
  const startNewMatch = useGameStore(s => s.startNewMatch);
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
  const roomPaused = useGameStore(s => s.roomPaused);
  const [playAgainReady, setPlayAgainReady] = useState<number[]>([]);
  const [matchReady, setMatchReady] = useState<boolean[]>([false, false, false, false]);
  const [rematchCountdown, setRematchCountdown] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
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

    const selfDraw = isSelfDrawWinMethod(winMethod, winningDiscardPlayer);
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
  const matchOver = phase === 'finished' && winner !== null && isChipMatchOver(players, config);
  const chipStandings = useMemo(() => getChipStandings(players), [players]);
  const topChipAmount = chipStandings[0]?.chips ?? 0;
  const topPlayers = chipStandings.filter(standing => standing.chips === topChipAmount);

  const realPlayerCount = useMemo(() => players.filter(p => p.isHuman).length, [players]);
  const readyCount = playAgainReady.filter(playerId => players.some(p => p.id === playerId && p.isHuman)).length;
  const localReadyPlayerId = isHost ? 0 : (connection.playerIndex >= 0 ? connection.playerIndex : 0);
  const isLocalReady = playAgainReady.includes(localReadyPlayerId);
  const matchReadyCount = matchReady.filter(Boolean).length;
  const isLocalMatchReady = Boolean(matchReady[localReadyPlayerId]);

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
      setMatchReady([false, false, false, false]);
      setRematchCountdown(null);
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

  useEffect(() => {
    if (!matchOver) return;
    if (isMultiplayer) return;
    setMatchReady(players.map(player => !player.isHuman));
    setRematchCountdown(null);
  }, [matchOver, isMultiplayer, players]);

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
    const unsubReady = connection.on('match_ready_state', (msg) => {
      if (Array.isArray(msg.ready) && msg.ready.length === 4) {
        setMatchReady(msg.ready.map(Boolean));
      }
      setRematchCountdown(Number.isInteger(msg.countdown) ? msg.countdown : null);
    });
    const unsubCountdown = connection.on('rematch_countdown', (msg) => {
      setRematchCountdown(Number.isInteger(msg.countdown) ? msg.countdown : null);
    });
    const unsubSnapshot = connection.on('room_snapshot', (msg) => {
      if (Array.isArray(msg.matchReady) && msg.matchReady.length === 4) {
        setMatchReady(msg.matchReady.map(Boolean));
      }
      setRematchCountdown(Number.isInteger(msg.rematchCountdown) ? msg.rematchCountdown : null);
    });
    return () => {
      unsubReady();
      unsubCountdown();
      unsubSnapshot();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'finished' || winner === null || matchOver) return;
    if (!winPopupTimerEnabled || !showWinPopup) return;
    if (winCountdown <= 0) {
      setShowWinPopup(false);
      setWinPopupTimerEnabled(false);
      return;
    }
    const t = setTimeout(() => setWinCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, winner, matchOver, showWinPopup, winCountdown, winPopupTimerEnabled]);

  useEffect(() => {
    const canAutoAdvance = !isMultiplayer || isHost;
    if (!canAutoAdvance || phase !== 'finished' || winner === null || matchOver || hasAutoAdvancedRef.current || roomPaused) return;
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
  }, [playAgainReady, phase, winner, matchOver, isHost, isMultiplayer, config, nextRoundCountdown, roomPaused]);

  useEffect(() => {
    if (!matchOver || isMultiplayer || roomPaused) return;
    if (!matchReady.every(Boolean)) {
      if (rematchCountdown !== null) setRematchCountdown(null);
      return;
    }
    if (rematchCountdown === null) {
      setRematchCountdown(5);
      return;
    }
    if (rematchCountdown > 0) {
      const timer = setTimeout(() => setRematchCountdown(value => value === null ? null : Math.max(0, value - 1)), 1000);
      return () => clearTimeout(timer);
    }
    setMatchReady([false, false, false, false]);
    setRematchCountdown(null);
    startNewMatch(config);
  }, [matchOver, isMultiplayer, roomPaused, matchReady, rematchCountdown, startNewMatch, config]);

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
      connection.send({ type: 'quit_room' });
      connection.disconnect();
    }
    reset();
    navigate('/');
  };

  const handleMatchPlayAgain = () => {
    if (isMultiplayer) {
      connection.send({ type: 'match_ready', ready: !isLocalMatchReady });
      return;
    }
    setMatchReady(current => current.map((ready, playerIndex) =>
      players[playerIndex]?.isHuman ? !isLocalMatchReady : ready
    ));
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
    if (phase !== 'finished' || winner === null || matchOver || roomPaused) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
      return;
    }
    const allReady = players.every((p: any) => !p.isHuman || playAgainReady.includes(p.id));
    if (!allReady || playAgainReady.filter(playerId => players.some(p => p.id === playerId && p.isHuman)).length === 0) {
      if (nextRoundCountdown !== null) useGameStore.setState({ nextRoundCountdown: null });
    }
  }, [phase, winner, matchOver, players, playAgainReady, nextRoundCountdown, roomPaused]);

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
            onClick={() => setShowHistory(true)}
            className="px-2.5 py-1.5 sm:px-3 bg-blue-700 hover:bg-blue-600 text-white rounded-lg font-bold text-xs sm:text-sm transition-colors shadow-lg"
          >
            History
          </button>
        </div>
      </div>
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
      {matchOver ? (
        <div className={`fixed inset-0 z-50 bg-black/75 px-4 flex ${isCompactViewport ? 'items-end' : 'items-center justify-center'}`}>
          <div className={`w-full overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(250,204,21,0.15),_transparent_38%),linear-gradient(180deg,_rgba(20,83,45,0.98),_rgba(5,46,22,0.99))] border border-yellow-400/35 shadow-2xl ${isCompactViewport ? 'max-w-none rounded-t-3xl max-h-[94dvh] p-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]' : 'max-w-lg rounded-2xl p-6 max-h-[88vh]'}`}>
            <div className="text-center mb-4">
              <div className="text-yellow-300 text-[10px] sm:text-xs uppercase tracking-[0.24em] mb-1">Match Over</div>
              <h2 className="text-2xl sm:text-3xl font-black text-white">
                {topPlayers.length === 1 ? `${topPlayers[0].name} leads` : 'Joint chip leaders'}
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-green-200">A player reached $0 or a negative chip balance.</p>
            </div>

            <div className="rounded-xl border border-yellow-300/25 bg-black/20 p-2.5 sm:p-3 mb-4">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-yellow-200">Final Chip Standings</div>
              <div className="space-y-1.5">
                {chipStandings.map((standing) => {
                  const isTop = standing.chips === topChipAmount;
                  const rank = chipStandings.findIndex(entry => entry.chips === standing.chips) + 1;
                  return (
                    <div key={standing.playerId} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 ${isTop ? 'border border-yellow-300/35 bg-yellow-400/10' : 'bg-white/5'}`}>
                      <div className="min-w-0 flex items-center gap-2">
                        <span className={`w-6 text-center text-xs font-black ${isTop ? 'text-yellow-300' : 'text-green-300'}`}>#{rank}</span>
                        <span className={`truncate text-sm ${isTop ? 'font-bold text-yellow-100' : 'text-green-100'}`}>{standing.name}</span>
                      </div>
                      <span className={`shrink-0 text-sm font-black ${standing.chips <= 0 ? 'text-red-300' : isTop ? 'text-yellow-300' : 'text-white'}`}>
                        {formatPayoutAmount(standing.chips)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-green-500/30 bg-green-950/45 p-3 mb-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-green-300">Play Again Status</span>
                <span className="text-xs font-bold text-white">{matchReadyCount}/4 ready</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {players.map((player, playerIndex) => (
                  <div key={player.id} className={`rounded-lg px-2.5 py-2 text-xs ${matchReady[playerIndex] ? 'bg-green-600/35 text-green-100' : 'bg-white/5 text-green-300'}`}>
                    <div className="truncate font-semibold">{player.name}</div>
                    <div className="mt-0.5 text-[10px] opacity-75">
                      {matchReady[playerIndex] ? (player.isHuman ? 'Ready' : 'Bot ready') : 'Waiting'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {rematchCountdown !== null && (
              <div className="mb-4 rounded-xl border border-yellow-400/50 bg-yellow-500/10 px-4 py-3 text-center">
                <div className="text-[10px] uppercase tracking-[0.22em] text-yellow-200">New Match Starting</div>
                <div className="mt-1 text-4xl font-black leading-none text-white">{rematchCountdown}s</div>
                <div className="mt-1 text-xs text-green-200">
                  {isMultiplayer ? 'Creating a new room with the same settings' : 'Resetting chips with the same settings'}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleMatchPlayAgain}
                disabled={rematchCountdown !== null}
                className={`min-h-12 rounded-xl px-3 py-3 text-sm font-bold transition-colors ${isLocalMatchReady ? 'bg-green-600 text-white' : 'bg-yellow-600 text-white hover:bg-yellow-500'} disabled:cursor-not-allowed disabled:opacity-70`}
              >
                {isLocalMatchReady ? 'Ready' : 'Play Again'}
              </button>
              <button
                onClick={handleQuit}
                className="min-h-12 rounded-xl bg-red-700 px-3 py-3 text-sm font-bold text-white hover:bg-red-600"
              >
                Quit
              </button>
            </div>
            <p className="mt-3 text-center text-[10px] text-green-300/75">
              {isMultiplayer
                ? 'All four seats must be ready. Any player pressing Quit closes the room for everyone.'
                : 'The three bots are ready automatically.'}
            </p>
          </div>
        </div>
      ) : phase === 'finished' && winner !== null && winSummary && (
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
                      {getChipSettlementRuleText(chipSettlement)}
                    </div>
                    <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-yellow-300/20 bg-green-950/40 px-2.5 py-2 sm:px-3">
                      <div className="mb-1 text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-yellow-200">Who pays the winner</div>
                      <div className="space-y-1 text-[10px] sm:text-sm text-yellow-50">
                        {getChipSettlementTransfers(chipSettlement)
                          .map(delta => {
                            const player = players[delta.playerIndex];
                            const playerName = player?.name || `P${delta.playerIndex + 1}`;
                            const amount = formatPayoutAmount(Math.abs(delta.delta));
                            return (
                              <div key={delta.playerIndex} className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1.5">
                                <span className={`min-w-0 truncate ${delta.isWinner ? 'font-bold text-yellow-200' : 'text-yellow-50'}`}>
                                  {playerName}
                                </span>
                                <span className={`shrink-0 text-right font-bold ${delta.isWinner ? 'text-yellow-200' : 'text-red-200'}`}>
                                  {delta.isWinner ? `receives ${amount}` : `gives ${amount}`} to {settlementWinnerName}
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
            <div className="text-white font-bold text-lg">Waiting for a player to reconnect.</div>
            <div className="text-red-200 text-sm mt-1">Play resumes automatically when every real-player seat is connected.</div>
            <button
              type="button"
              onClick={handleQuit}
              className="mt-4 w-full rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-600"
            >
              Quit Room
            </button>
          </div>
        </div>
      )}
      <GameTable />
    </div>
  );
}
