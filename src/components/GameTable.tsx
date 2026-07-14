import { useState, useMemo, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { Tile, MeldDisplay, EmptyTile } from './Tile';
import { isBonus, isFei } from '../game/tiles';
import { calculateTai } from '../game/rules';
import { connection } from '../utils/connection';

const WIND_CHARS: Record<string, string> = { east: '(East) \u6771', south: '(South) \u5357', west: '(West) \u897F', north: '(North) \u5317' };
const ROUND_CHARS: Record<string, string> = { east: '\u6771', south: '\u5357', west: '\u897F', north: '\u5317' };
const WIND_ORDER: Array<'east' | 'south' | 'west' | 'north'> = ['east', 'south', 'west', 'north'];

function formatChipBalance(chips: number): string {
  return Number.isInteger(chips) ? chips.toLocaleString('en-US') : chips.toFixed(2).replace(/\.00$/, '');
}

export function GameTable() {
  const { players, wall, phase, currentPlayerIndex, message, roundWind, config, waitingForClaim, drawTile, discardTile, claimTile, passClaim, winner, discardHistory, selfDrawWin, selfDrawWinAction, passSelfDrawWin, isMultiplayer, isHost, myPlayerIndex, diceResults, lastAction, selfKongData, selfKongAction, passSelfKong, dealerCount, dealerPlayerId, roomPaused } = useGameStore();
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [chiSelection, setChiSelection] = useState<{ display: any[]; handTiles: any[] }[] | null>(null);
  const [inactiveWarning, setInactiveWarning] = useState<string | null>(null);
  const [kongAnim, setKongAnim] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const lastActionKeyRef = useRef<string>('');
  const lastMoveRef = useRef<number>(Date.now());
  const discardRef = useRef<HTMLDivElement>(null);

  // Poll for inactivity (AFK warning after 5 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      const s = useGameStore.getState();
      if (s.phase !== 'playing') {
        setInactiveWarning(null);
        return;
      }
      const stateKey = String(s.currentPlayerIndex);
      if (stateKey !== lastActionKeyRef.current) {
        lastActionKeyRef.current = stateKey;
        lastMoveRef.current = Date.now();
        setInactiveWarning(null);
      } else if (Date.now() - lastMoveRef.current > 300000) {
        const pName = s.players[s.currentPlayerIndex]?.name || 'Unknown';
        setInactiveWarning(pName);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll discard pile when new tiles are added
  useEffect(() => {
    if (discardRef.current) {
      discardRef.current.scrollTop = discardRef.current.scrollHeight;
    }
  }, [discardHistory]);

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

  const humanIdx = (myPlayerIndex !== undefined && myPlayerIndex !== null) ? myPlayerIndex : 0;
  const human = players[humanIdx];
  if (!human) return null;
  const humanSeatWind = (human.seatWind || 'east') as typeof WIND_ORDER[number];
  const humanSeatIndex = WIND_ORDER.indexOf(humanSeatWind);
  const seatAtOffset = (offset: number) => WIND_ORDER[(humanSeatIndex + offset + WIND_ORDER.length) % WIND_ORDER.length];
  const bottomSeat = humanSeatWind;
  const rightSeat = seatAtOffset(1);
  const topSeat = seatAtOffset(2);
  const leftSeat = seatAtOffset(3);
  const rightPlayer = players.find(p => p.seatWind === rightSeat);
  const topPlayer = players.find(p => p.seatWind === topSeat);
  const leftPlayer = players.find(p => p.seatWind === leftSeat);
  const roundNumber = Math.min(4, Math.max(1, (dealerCount || 0) + 1));
  const getPlayerChips = (player: any) => {
    if (typeof player?.chips === 'number' && Number.isFinite(player.chips)) return Math.max(0, Math.round(player.chips * 100) / 100);
    return typeof config.startingChips === 'number' && Number.isFinite(config.startingChips)
      ? Math.max(0, Math.round(config.startingChips * 100) / 100)
      : 0;
  };

  const isHumanTurn = phase === 'playing' && currentPlayerIndex === humanIdx;
  const humanClaim = waitingForClaim.eligiblePlayers.find(e => e.playerIndex === humanIdx);
  const hasClaimOptions = humanClaim !== undefined;
  const eligibleActions = humanClaim?.actions || [];

  const playerTai = useMemo(() => {
    const result: Record<number, any> = {};
    for (let i = 0; i < players.length; i++) {
      try {
        result[i] = calculateTai(
          { players, wall, deadWall: [], currentPlayerIndex, phase, roundWind: roundWind || "east", config, lastAction: "", winner, winningTiles: [] } as any,
          i,
          false,
          true,
        );
      } catch (e) {
        result[i] = { totalTai: 0, tai: 0, breakdown: [], feiPenalty: 0 };
      }
    }
    return result;
  }, [players, wall, phase, currentPlayerIndex, roundWind, config, winner]);

  const handleDiscard = () => {
    if (roomPaused || selectedTile === null || !isHumanTurn) return;
    const st = useGameStore.getState();
    const hIdx = (st.myPlayerIndex ?? 0);
    if (st.isMultiplayer) {
      connection.send({ type: 'action', actionType: 'discard', data: { tileIndex: selectedTile, playerIdx: hIdx } });
    } else {
      st.discardTile(hIdx, selectedTile);
    }
    setSelectedTile(null);
  };

  const handleTileClick = (index: number) => {
    if (roomPaused || !isHumanTurn) return;
    setSelectedTile(prev => (prev === index ? null : index));
  };

  const handleChiOpen = () => {
    if (roomPaused) return;
    const tile = waitingForClaim.tile;
    if (!tile || tile.category !== 'suit') return;
    const suit = tile.suit;
    const val = tile.value;
    const handSuit = human.hand.filter((t: any) => t.category === 'suit' && t.suit === suit);
    const options: { display: any[]; handTiles: any[] }[] = [];
    for (let v1 = val - 2; v1 <= val; v1++) {
      if (v1 < 1 || v1 + 2 > 9) continue;
      const needed = [v1, v1 + 1, v1 + 2].filter(v => v !== val);
      const handTiles = needed.map(nv => handSuit.find((t: any) => t.value === nv)).filter(Boolean);
      if (handTiles.length === needed.length) {
        options.push({ display: [...handTiles, tile].sort((a: any, b: any) => a.value - b.value), handTiles });
      }
    }
    setChiSelection(options);
  };

  const handleChiSelect = (option: { display: any[]; handTiles: any[] }) => {
    handleClaim('chi', option.handTiles);
    setChiSelection(null);
  };

  const sendAction = (actionType: string, data?: any) => {
    const st = useGameStore.getState();
    if (st.roomPaused) return;
    if (st.isMultiplayer && connection.connected) {
      const hIdx = (st.myPlayerIndex ?? 0);
      connection.send({ type: 'action', actionType, data: { playerIdx: hIdx, ...data } });
    }
  };

  const handleClaim = (action: string, chiTiles?: any[]) => {
    const st = useGameStore.getState();
    if (st.roomPaused) return;
    if (st.isMultiplayer) {
      sendAction(action, { chiTiles });
    } else {
      const hIdx = (st.myPlayerIndex ?? 0);
      st.claimTile(hIdx, action as any, chiTiles);
    }
  };

  const handlePassClaim = () => {
    const st = useGameStore.getState();
    if (st.roomPaused) return;
    if (st.isMultiplayer) {
      sendAction('pass_claim');
    } else {
      st.passClaim();
    }
  };

  return (
    <div className="w-full min-h-[100dvh] bg-green-900 p-0.5 sm:p-1 flex flex-col overflow-hidden pb-[calc(env(safe-area-inset-bottom)+0.25rem)]">
      <div className="flex flex-col items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1">
        {topPlayer && (
          <>
            <span className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-[9px] sm:text-xs text-green-300 text-center leading-4">
              <span className="text-white text-[10px] sm:text-xs font-bold font-serif">{WIND_CHARS[topPlayer.seatWind] || ""}</span>
              {topPlayer.name}
              {topPlayer.id === dealerPlayerId && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-yellow-400 text-black text-[8px] font-bold leading-none" title="Dealer">庄</span>}
              <span className="text-yellow-300 text-[9px] sm:text-xs">
                - {playerTai[topPlayer.id]?.totalTai ?? 0} tai - {formatChipBalance(getPlayerChips(topPlayer))} chips
              </span>
            </span>
            <div className="flex gap-0.5 flex-wrap justify-center">
              {topPlayer.hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                <Tile key={i} tile={t} faceDown={true} size="sm" />
              ))}
            </div>
            {/* Melds + Bonus tiles in one row */}
            <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
              {topPlayer.melds.length > 0 && (
                <div className="flex gap-0.5 sm:gap-1 flex-wrap justify-center">
                  {topPlayer.melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
              {topPlayer.bonusTiles && topPlayer.bonusTiles.length > 0 && (
                <div className="flex gap-0.5 flex-wrap justify-center">
                  {topPlayer.bonusTiles.map((t: any, i: number) => (
                    <Tile key={"bonus-" + i} tile={t} size="md" />
                  ))}
                </div>
              )}
            </div>
            {currentPlayerIndex === topPlayer.id && phase === 'playing' && <div className="flex justify-center text-yellow-400 text-lg animate-bounce mt-0.5">▲</div>}
          </>
        )}
      </div>

      <div className="flex-1 flex">
        <div className="flex flex-col items-center gap-0.5 sm:gap-1 px-0.5 sm:px-1 shrink-0">
          {leftPlayer && (
            <>
              <span className="text-green-300 text-[9px] sm:text-xs font-medium text-center leading-4">{leftPlayer.name}</span>
              <div className="flex items-center gap-1 leading-4">
                {leftPlayer.id === dealerPlayerId && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-yellow-400 text-black text-[8px] font-bold leading-none" title="Dealer">庄</span>}
                <span className="text-white text-[10px] sm:text-xs font-bold font-serif">{WIND_CHARS[leftPlayer.seatWind] || ""}</span>
              </div>
              <span className="text-yellow-300 text-[9px] sm:text-xs leading-4">- {playerTai[leftPlayer.id]?.totalTai ?? 0} tai - {formatChipBalance(getPlayerChips(leftPlayer))} chips</span>
              <div className="flex items-start gap-2 sm:gap-3">
                <div className="flex flex-col -space-y-2.5">
                  {leftPlayer.hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                    <Tile key={i} tile={t} faceDown={true} size="sm" rotate={90} />
                  ))}
                </div>
                {currentPlayerIndex === leftPlayer.id && phase === 'playing' && <div className="self-center text-yellow-400 text-base sm:text-lg animate-pulse">◄</div>}
                {leftPlayer.bonusTiles && leftPlayer.bonusTiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 items-center">
                    {leftPlayer.bonusTiles.map((t: any, i: number) => (
                      <Tile key={"bonus-" + i} tile={t} size="md" />
                    ))}
                  </div>
                )}
              </div>
              {leftPlayer.melds.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {leftPlayer.melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-1 sm:p-2 min-w-0">
          {discardHistory.length > 0 ? (
            <div className="p-1.5 sm:p-2 bg-green-800/30 rounded-lg w-full max-w-[420px]">
              <div
                ref={discardRef}
                className="flex gap-1 flex-wrap overflow-y-auto"
                style={{ maxWidth: "100%", maxHeight: isCompactViewport ? "88px" : "120px" }}
              >
                {discardHistory.map((t: any, i: number) => (
                  <Tile key={i} tile={t} size="sm" highlight={i === discardHistory.length - 1} />
                ))}
              </div>
            </div>
          ) : (
            <div className="w-48 h-32 bg-green-800/30 border-2 border-dashed border-green-700/50 rounded-lg flex items-center justify-center">
              <span className="text-green-600/50 text-sm">Discard Pile</span>
            </div>
          )}

          {kongAnim && (
            <div className="text-center my-1">
              <span className="text-yellow-300 font-bold text-base sm:text-lg bg-yellow-700/50 px-3 sm:px-4 py-1.5 rounded-lg inline-block animate-bounce border border-yellow-500/50">
                🀄 Kong!
              </span>
            </div>
          )}
          {inactiveWarning && (
            <div className="text-center my-1 animate-pulse">
              <span className="text-red-400 font-bold text-base bg-red-900/60 px-3 py-1.5 rounded-lg inline-block border border-red-500/50">
                ⚠ {inactiveWarning} is inactive!
              </span>
            </div>
          )}
          {(lastAction && isMultiplayer) ? (
            <div className="text-green-300 text-xs sm:text-sm text-center mt-1 px-1">{lastAction}</div>
          ) : (message && !isMultiplayer) ? (
            <div className="text-yellow-300 text-sm sm:text-base font-bold text-center mt-2 px-1">{message}</div>
          ) : null}
            <div className="text-green-300/70 text-[10px] sm:text-sm text-center mt-1 px-1">
            Wall: {wall.length} | Round {roundNumber}/4 | {roundWind.charAt(0).toUpperCase() + roundWind.slice(1)} ({ROUND_CHARS[roundWind] || '?'}) round | {config.taiThreshold === 0 ? '0 tai' : config.taiThreshold + ' tai'}
            {config.feiCount > 0 && ' | Fei: ' + config.feiCount}
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5 sm:gap-1 px-0.5 sm:px-1 shrink-0">
          {rightPlayer && (
            <>
              <span className="text-green-300 text-[9px] sm:text-xs font-medium text-center leading-4">{rightPlayer.name}</span>
              <div className="flex items-center gap-1 leading-4">
                {rightPlayer.id === dealerPlayerId && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-yellow-400 text-black text-[8px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
                <span className="text-white text-[10px] sm:text-xs font-bold font-serif">{WIND_CHARS[rightPlayer.seatWind] || ""}</span>
              </div>
              <span className="text-yellow-300 text-[9px] sm:text-xs leading-4">- {playerTai[rightPlayer.id]?.totalTai ?? 0} tai - {formatChipBalance(getPlayerChips(rightPlayer))} chips</span>
              <div className="flex items-start gap-2 sm:gap-3">
                {rightPlayer.bonusTiles && rightPlayer.bonusTiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 items-center">
                    {rightPlayer.bonusTiles.map((t: any, i: number) => (
                      <Tile key={"bonus-" + i} tile={t} size="md" />
                    ))}
                  </div>
                )}
                {currentPlayerIndex === rightPlayer.id && phase === 'playing' && <div className="self-center text-yellow-400 text-base sm:text-lg animate-pulse">►</div>}
                <div className="flex flex-col -space-y-2.5">
                  {rightPlayer.hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                    <Tile key={i} tile={t} faceDown={true} size="sm" rotate={-90} />
                  ))}
                </div>
              </div>
              {rightPlayer.melds.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {rightPlayer.melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="bg-green-800/40 rounded-lg p-1.5 sm:p-2">
        {currentPlayerIndex === humanIdx && phase === 'playing' && !roomPaused && <div className="flex justify-center text-yellow-400 text-lg animate-bounce mb-1">▼</div>}
          {!roomPaused && chiSelection && (
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className="text-yellow-300 text-xs font-bold">Choose Chi tiles:</div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {chiSelection.map((option, i) => (
                <button key={i} onClick={() => handleChiSelect(option)} className="flex gap-0.5 p-1.5 bg-green-700 rounded-lg hover:bg-green-600 border border-green-500">
                  {option.display.map((t: any, j: number) => (
                    <Tile key={j} tile={t} size="sm" />
                  ))}
                </button>
              ))}
              <button onClick={() => setChiSelection(null)} className="px-3 py-2 bg-gray-700 rounded-lg text-gray-300 text-xs hover:bg-gray-600 min-h-11">Cancel</button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-center gap-1.5 mb-2 flex-wrap">
          {human.melds.length > 0 && (
            <div className="flex gap-0.5 sm:gap-1 flex-wrap justify-center">
              {human.melds.map((meld: any, i: number) => (
                <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
              ))}
            </div>
          )}
          {human.bonusTiles && human.bonusTiles.length > 0 && (
            <div className="flex gap-0.5 sm:gap-1 flex-wrap justify-center">
              {human.bonusTiles.map((t: any, i: number) => (
                <Tile key={"bonus-" + i} tile={t} size={isCompactViewport ? "sm" : "md"} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-1 mb-1 flex-wrap text-center leading-4">
          <span className="text-green-300 text-[9px] sm:text-xs">You (P{humanIdx})</span>
          {human.id === dealerPlayerId && <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-yellow-400 text-black text-[8px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
          <span className="text-white text-[10px] sm:text-xs font-bold font-serif">{WIND_CHARS[bottomSeat]}</span>
          <span className="text-yellow-300 text-[9px] sm:text-xs">- {playerTai[humanIdx]?.totalTai ?? 0} tai - {formatChipBalance(getPlayerChips(human))} chips</span>
        </div>
        <div className="flex gap-1 flex-nowrap overflow-x-auto justify-start sm:justify-center px-1 pb-1 w-full max-w-full [scrollbar-width:none] [-ms-overflow-style:none]">
          {human.hand.filter((t: any) => !isBonus(t)).map((tile: any, idx: number) => {
            const actualIdx = human.hand.indexOf(tile);
            return (
              <Tile key={'tile-' + idx} tile={tile} selected={selectedTile === actualIdx} onClick={() => handleTileClick(actualIdx)} size={isCompactViewport ? 'sm' : 'md'} />
            );
          })}
          {human.hand.length === 0 && (
            <span className="text-green-400/50 text-sm whitespace-nowrap">No tiles</span>
          )}
        </div>

        {roomPaused && (
          <div className="mb-2 text-center">
            <span className="inline-flex items-center rounded-full border border-red-400/60 bg-red-900/70 px-3 py-1 text-red-100 text-xs font-bold">
              Room paused because a player left
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 justify-center mt-2 sm:flex sm:flex-wrap">
          {phase === 'playing' && !hasClaimOptions && !roomPaused && (
            <>
              {selfDrawWin && (
                <>
                  <button onClick={() => {
                    if (useGameStore.getState().isMultiplayer) {
                      connection.send({ type: 'action', actionType: 'self_draw_win', data: { playerIdx: (useGameStore.getState().myPlayerIndex ?? 0) } });
                    } else {
                      useGameStore.getState().selfDrawWinAction(useGameStore.getState().myPlayerIndex ?? 0);
                    }
                  }} className="min-h-11 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm animate-pulse w-full sm:w-auto">Win!</button>
                  <button onClick={() => {
                    if (useGameStore.getState().isMultiplayer) {
                      connection.send({ type: 'action', actionType: 'pass_self_draw', data: { playerIdx: (useGameStore.getState().myPlayerIndex ?? 0) } });
                    } else {
                      useGameStore.getState().passSelfDrawWin();
                    }
                  }} className="min-h-11 px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm w-full sm:w-auto">Pass</button>
                </>
              )}
              {!selfDrawWin && isHumanTurn && selectedTile !== null && !isFei(human.hand[selectedTile]) && (
                <button onClick={handleDiscard} className="min-h-11 px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm transition-colors w-full sm:w-auto">Discard</button>
              )}
              {!selfDrawWin && selfKongData && isHumanTurn && (
                <>
                  <button onClick={() => {
                    setKongAnim(true);
                    setTimeout(() => setKongAnim(false), 600);
                    const st = useGameStore.getState();
                    if (selfKongData.meldIndex >= 0) {
                      if (st.isMultiplayer) {
                        connection.send({ type: 'action', actionType: 'self_kong', data: { playerIdx: (st.myPlayerIndex ?? 0), meldIndex: selfKongData.meldIndex, handTileIndex: selfKongData.handTileIndex } });
                      } else {
                        st.selfKongAction(st.myPlayerIndex ?? 0, selfKongData.meldIndex, selfKongData.handTileIndex);
                      }
                    } else {
                      if (st.isMultiplayer) {
                        connection.send({ type: 'action', actionType: 'concealed_kong', data: { playerIdx: (st.myPlayerIndex ?? 0), tileIndex: selfKongData.handTileIndex } });
                      } else {
                        st.selfKongAction(st.myPlayerIndex ?? 0, -1, selfKongData.handTileIndex);
                      }
                    }
                    st.passSelfKong();
                  }} className="min-h-11 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse w-full sm:w-auto">Kong</button>
                  <button onClick={() => {
                    const st = useGameStore.getState();
                    if (st.isMultiplayer) {
                      connection.send({ type: 'action', actionType: 'pass_self_kong', data: { playerIdx: (st.myPlayerIndex ?? 0) } });
                    } else {
                      st.passSelfKong();
                    }
                  }} className="min-h-11 px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm w-full sm:w-auto">Pass</button>
                </>
              )}
            </>
          )}
          {hasClaimOptions && !roomPaused && (
            <>
              {eligibleActions.includes('win') && <button onClick={() => handleClaim('win')} className="min-h-11 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse w-full sm:w-auto">Win!</button>}
              {eligibleActions.includes('kong') && <button onClick={() => handleClaim('kong')} className="min-h-11 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse w-full sm:w-auto">Kong</button>}
              {eligibleActions.includes('pung') && <button onClick={() => handleClaim('pung')} className="min-h-11 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse w-full sm:w-auto">Pung</button>}
              {eligibleActions.includes('chi') && chiSelection === null && <button onClick={handleChiOpen} className="min-h-11 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse w-full sm:w-auto">Chi</button>}
              <button onClick={handlePassClaim} className="min-h-11 px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm transition-colors w-full sm:w-auto">Pass</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
