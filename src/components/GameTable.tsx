import { useState, useMemo, useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { Tile, MeldDisplay, EmptyTile } from './Tile';
import { isBonus, isFei } from '../game/tiles';
import { calculateTai } from '../game/rules';
import { connection } from '../utils/connection';

const WIND_CHARS: Record<string, string> = { east: '(East) \u6771', south: '(South) \u5357', west: '(West) \u897F', north: '(North) \u5317' };
const AI_BOT_NAMES = ['Sakura', 'Mei Lin', 'Kenji'];
const ROUND_CHARS: Record<string, string> = { east: '\u6771', south: '\u5357', west: '\u897F', north: '\u5317' };

export function GameTable() {
  const viewportScale = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    const vh = window.innerHeight;
    const contentHeight = 920;
    return Math.min(1, vh / contentHeight);
  }, []);

  const { players, wall, phase, currentPlayerIndex, message, roundWind, config, waitingForClaim, drawTile, discardTile, claimTile, passClaim, winner, discardHistory, selfDrawWin, selfDrawWinAction, passSelfDrawWin, isMultiplayer, isHost, myPlayerIndex, diceResults, lastAction, selfKongData, selfKongAction, passSelfKong, dealerCount, dealerPlayerId } = useGameStore();
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [chiSelection, setChiSelection] = useState<{ display: any[]; handTiles: any[] }[] | null>(null);
  const [inactiveWarning, setInactiveWarning] = useState<string | null>(null);
  const [kongAnim, setKongAnim] = useState(false);
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

  const humanIdx = (myPlayerIndex !== undefined && myPlayerIndex !== null) ? myPlayerIndex : 0;
  const pc = players.length || 4;
  const rightIdx = (humanIdx + 1) % pc;
  const topIdx = (humanIdx + 2) % pc;
  const leftIdx = (humanIdx + 3) % pc;
  const human = players[humanIdx];
  if (!human) return null;

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
    if (selectedTile === null || !isHumanTurn) return;
    const st = useGameStore.getState();
    const hIdx = (st.myPlayerIndex ?? 0);
    const isRemoteClient = st.isMultiplayer && !st.isHost;
    if (isRemoteClient) {
      connection.send({ type: 'action', actionType: 'discard', data: { tileIndex: selectedTile, playerIdx: hIdx } });
    } else {
      st.discardTile(hIdx, selectedTile);
    }
    setSelectedTile(null);
  };

  const handleTileClick = (index: number) => {
    if (!isHumanTurn) return;
    setSelectedTile(prev => (prev === index ? null : index));
  };

  const handleChiOpen = () => {
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
    if (st.isMultiplayer && !st.isHost && connection.connected) {
      const hIdx = (st.myPlayerIndex ?? 0);
      connection.send({ type: 'action', actionType, data: { playerIdx: hIdx, ...data } });
    }
  };

  const handleClaim = (action: string, chiTiles?: any[]) => {
    const st = useGameStore.getState();
    if (st.isMultiplayer && !st.isHost) {
      sendAction(action, { chiTiles });
    } else {
      const hIdx = (st.myPlayerIndex ?? 0);
      st.claimTile(hIdx, action as any, chiTiles);
    }
  };

  const handlePassClaim = () => {
    const st = useGameStore.getState();
    if (st.isMultiplayer && !st.isHost) {
      sendAction('pass_claim');
    } else {
      st.passClaim();
    }
  };

  return (
    <div className="w-full min-h-screen bg-green-900 p-1 flex flex-col">
      <div className="flex flex-col items-center gap-1 p-1">
        {players[topIdx] && (
          <>
            <span className="text-green-300 text-xs" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[players[topIdx].seatWind] || ""}</span>
              {players[topIdx].name}{!AI_BOT_NAMES.includes(players[topIdx].name) && ` (P${topIdx})`}
              {players[topIdx].id === dealerPlayerId && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
              <span className="text-yellow-300 text-xs">- {playerTai[players[topIdx].id]?.totalTai ?? 0} tai</span>
            </span>
            <div className="flex gap-0.5">
              {players[topIdx].hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                <Tile key={i} tile={t} faceDown={true} size="sm" />
              ))}
            </div>
            {/* Melds + Bonus tiles in one row */}
            <div className="flex items-center justify-center gap-2">
              {players[topIdx].melds.length > 0 && (
                <div className="flex gap-1">
                  {players[topIdx].melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
              {players[topIdx].bonusTiles && players[topIdx].bonusTiles.length > 0 && (
                <div className="flex gap-0.5">
                  {players[topIdx].bonusTiles.map((t: any, i: number) => (
                    <Tile key={"bonus-" + i} tile={t} size="md" />
                  ))}
                </div>
              )}
            </div>
            {currentPlayerIndex === players[topIdx].id && phase === 'playing' && <div className="flex justify-center text-yellow-400 text-lg animate-bounce mt-0.5">▲</div>}
          </>
        )}
      </div>

      <div className="flex-1 flex">
        <div className="flex flex-col items-center gap-1 px-1">
          {players[leftIdx] && (
            <>
              <span className="text-green-300 text-xs font-medium">{players[leftIdx].name}</span>
              {!AI_BOT_NAMES.includes(players[leftIdx].name) && <span className="text-green-400 text-xs font-medium"> (P{leftIdx})</span>}
              {players[leftIdx].id === dealerPlayerId && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[players[leftIdx].seatWind] || ""}</span>
              <span className="text-yellow-300 text-xs">- {playerTai[players[leftIdx].id]?.totalTai ?? 0} tai</span>
              <div className="flex items-start gap-3">
                <div className="flex flex-col space-y-[-10px]">
                  {players[leftIdx].hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                    <Tile key={i} tile={t} faceDown={true} size="sm" rotate={90} />
                  ))}
                </div>
                {currentPlayerIndex === players[leftIdx].id && phase === 'playing' && <div className="self-center text-yellow-400 text-lg animate-pulse">◄</div>}
                {players[leftIdx].bonusTiles && players[leftIdx].bonusTiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 items-center">
                    {players[leftIdx].bonusTiles.map((t: any, i: number) => (
                      <Tile key={"bonus-" + i} tile={t} size="md" />
                    ))}
                  </div>
                )}
              </div>
              {players[leftIdx].melds.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {players[leftIdx].melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-2">
          {discardHistory.length > 0 ? (
            <div className="p-2 bg-green-800/30 rounded-lg w-full max-w-[380px]">
              <div ref={discardRef} className="flex gap-1 flex-wrap overflow-y-auto" style={{ maxWidth: "374px", maxHeight: "120px" }}>
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
              <span className="text-yellow-300 font-bold text-lg bg-yellow-700/50 px-4 py-1.5 rounded-lg inline-block animate-bounce border border-yellow-500/50">
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
            <div className="text-green-300 text-sm text-center mt-1">{lastAction}</div>
          ) : (message && !isMultiplayer) ? (
            <div className="text-yellow-300 text-base font-bold text-center mt-2">{message}</div>
          ) : null}
          <div className="text-green-300/70 text-sm text-center mt-1">
            Wall: {wall.length} | {roundWind.charAt(0).toUpperCase() + roundWind.slice(1)} ({ROUND_CHARS[roundWind] || '?'}) round | {config.taiThreshold === 0 ? '0 tai' : config.taiThreshold + ' tai'}
            {config.feiCount > 0 && ' | Fei: ' + config.feiCount}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 px-1">
          {players[rightIdx] && (
            <>
              <span className="text-green-300 text-xs font-medium">{players[rightIdx].name}</span>
              {!AI_BOT_NAMES.includes(players[rightIdx].name) && <span className="text-green-400 text-xs font-medium"> (P{rightIdx})</span>}
              {players[rightIdx].id === dealerPlayerId && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[players[rightIdx].seatWind] || ""}</span>
              <span className="text-yellow-300 text-xs">- {playerTai[players[rightIdx].id]?.totalTai ?? 0} tai</span>
              <div className="flex items-start gap-3">
                {players[rightIdx].bonusTiles && players[rightIdx].bonusTiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 items-center">
                    {players[rightIdx].bonusTiles.map((t: any, i: number) => (
                      <Tile key={"bonus-" + i} tile={t} size="md" />
                    ))}
                  </div>
                )}
                {currentPlayerIndex === players[rightIdx].id && phase === 'playing' && <div className="self-center text-yellow-400 text-lg animate-pulse">►</div>}
                <div className="flex flex-col space-y-[-10px]">
                  {players[rightIdx].hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                    <Tile key={i} tile={t} faceDown={true} size="sm" rotate={-90} />
                  ))}
                </div>
              </div>
              {players[rightIdx].melds.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {players[rightIdx].melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="bg-green-800/40 rounded-lg p-2">
        {currentPlayerIndex === humanIdx && phase === 'playing' && <div className="flex justify-center text-yellow-400 text-lg animate-bounce mb-1">▼</div>}
        {chiSelection && (
          <div className="flex flex-col items-center gap-1 mb-2">
            <div className="text-yellow-300 text-xs font-bold">Choose Chi tiles:</div>
            <div className="flex gap-2">
              {chiSelection.map((option, i) => (
                <button key={i} onClick={() => handleChiSelect(option)} className="flex gap-0.5 p-1 bg-green-700 rounded hover:bg-green-600 border border-green-500">
                  {option.display.map((t: any, j: number) => (
                    <Tile key={j} tile={t} size="sm" />
                  ))}
                </button>
              ))}
              <button onClick={() => setChiSelection(null)} className="px-2 py-1 bg-gray-700 rounded text-gray-300 text-xs hover:bg-gray-600">Cancel</button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-center gap-2 mb-2">
          {human.melds.length > 0 && (
            <div className="flex gap-1">
              {human.melds.map((meld: any, i: number) => (
                <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
              ))}
            </div>
          )}
          {human.bonusTiles && human.bonusTiles.length > 0 && (
            <div className="flex gap-1">
              {human.bonusTiles.map((t: any, i: number) => (
                <Tile key={"bonus-" + i} tile={t} size="md" />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-1 mb-1">
          <span className="text-green-300 text-xs">You (P{humanIdx})</span>
          {human.id === dealerPlayerId && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
          <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[human.seatWind]}</span>
          <span className="text-yellow-300 text-xs">- {playerTai[humanIdx]?.totalTai ?? 0} tai</span>
        </div>
        <div className="flex gap-1 flex-wrap justify-center">
          {human.hand.filter((t: any) => !isBonus(t)).map((tile: any, idx: number) => {
            const actualIdx = human.hand.indexOf(tile);
            return (
              <Tile key={'tile-' + idx} tile={tile} selected={selectedTile === actualIdx} onClick={() => handleTileClick(actualIdx)} size="md" />
            );
          })}
          {human.hand.length === 0 && (
            <span className="text-green-400/50 text-sm">No tiles</span>
          )}
        </div>

        <div className="flex gap-2 justify-center mt-2 flex-wrap">
          {phase === 'playing' && !hasClaimOptions && (
            <>
              {selfDrawWin && (
                <>
                  <button onClick={() => {
                    if (useGameStore.getState().isMultiplayer && !useGameStore.getState().isHost) {
                      connection.send({ type: 'action', actionType: 'self_draw_win', data: { playerIdx: (useGameStore.getState().myPlayerIndex ?? 0) } });
                    } else {
                      useGameStore.getState().selfDrawWinAction(useGameStore.getState().myPlayerIndex ?? 0);
                    }
                  }} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm animate-pulse">Win!</button>
                  <button onClick={() => {
                    if (useGameStore.getState().isMultiplayer && !useGameStore.getState().isHost) {
                      connection.send({ type: 'action', actionType: 'pass_self_draw', data: { playerIdx: (useGameStore.getState().myPlayerIndex ?? 0) } });
                    } else {
                      useGameStore.getState().passSelfDrawWin();
                    }
                  }} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm">Pass</button>
                </>
              )}
              {!selfDrawWin && isHumanTurn && selectedTile !== null && !isFei(human.hand[selectedTile]) && (
                <button onClick={handleDiscard} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm transition-colors">Discard</button>
              )}
              {!selfDrawWin && selfKongData && isHumanTurn && (
                <>
                  <button onClick={() => {
                    setKongAnim(true);
                    setTimeout(() => setKongAnim(false), 600);
                    const st = useGameStore.getState();
                    if (selfKongData.meldIndex >= 0) {
                      if (st.isMultiplayer && !st.isHost) {
                        connection.send({ type: 'action', actionType: 'self_kong', data: { playerIdx: (st.myPlayerIndex ?? 0), meldIndex: selfKongData.meldIndex, handTileIndex: selfKongData.handTileIndex } });
                      } else {
                        st.selfKongAction(st.myPlayerIndex ?? 0, selfKongData.meldIndex, selfKongData.handTileIndex);
                      }
                    } else {
                      if (st.isMultiplayer && !st.isHost) {
                        connection.send({ type: 'action', actionType: 'concealed_kong', data: { playerIdx: (st.myPlayerIndex ?? 0), tileIndex: selfKongData.handTileIndex } });
                      } else {
                        st.selfKongAction(st.myPlayerIndex ?? 0, -1, selfKongData.handTileIndex);
                      }
                    }
                    st.passSelfKong();
                  }} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Kong</button>
                  <button onClick={() => {
                    const st = useGameStore.getState();
                    if (st.isMultiplayer && !st.isHost) {
                      connection.send({ type: 'action', actionType: 'pass_self_kong', data: { playerIdx: (st.myPlayerIndex ?? 0) } });
                    } else {
                      st.passSelfKong();
                    }
                  }} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm">Pass</button>
                </>
              )}
            </>
          )}
          {hasClaimOptions && (
            <>
              {eligibleActions.includes('win') && <button onClick={() => handleClaim('win')} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Win!</button>}
              {eligibleActions.includes('kong') && <button onClick={() => handleClaim('kong')} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Kong</button>}
              {eligibleActions.includes('pung') && <button onClick={() => handleClaim('pung')} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Pung</button>}
              {eligibleActions.includes('chi') && chiSelection === null && <button onClick={handleChiOpen} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Chi</button>}
              <button onClick={handlePassClaim} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm transition-colors">Pass</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
