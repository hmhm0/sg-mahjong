import { useState, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { Tile, MeldDisplay, EmptyTile } from './Tile';
import { isBonus, isFei } from '../game/tiles';
import { calculateTai } from '../game/rules';

const WIND_CHARS: Record<string, string> = { east: '(East) \u6771', south: '(South) \u5357', west: '(West) \u897F', north: '(North) \u5317' };
const WIND_COLORS: Record<string, string> = { east: 'white', south: 'white', west: 'white', north: 'white' };

export function GameTable() {
  const viewportScale = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    const vh = window.innerHeight;
    const contentHeight = 920;
    return Math.min(1, vh / contentHeight);
  }, []);

  const { players, wall, phase, currentPlayerIndex, message, roundWind, config, waitingForClaim, drawTile, discardTile, claimTile, passClaim, winner, discardHistory, selfDrawWin, selfDrawWinAction, passSelfDrawWin } = useGameStore();
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [chiSelection, setChiSelection] = useState<{ display: any[]; handTiles: any[] }[] | null>(null);
  const human = players[0];
  if (!human) return null;

  const isHumanTurn = phase === 'playing' && currentPlayerIndex === 0;
  const humanClaim = waitingForClaim.eligiblePlayers.find(e => e.playerIndex === 0);
  const hasClaimOptions = humanClaim !== undefined;
  const eligibleActions = humanClaim?.actions || [];

  const playerTai = useMemo(() => {
    const result: Record<number, any> = {};
    for (let i = 0; i < players.length; i++) {
      try {
        result[i] = calculateTai({ players, wall, deadWall: [], currentPlayerIndex, phase, roundWind: roundWind || "east", config, lastAction: "", winner, winningTiles: [] } as any, i, false, i !== 0);
      } catch (e) {
        result[i] = { totalTai: 0, tai: 0, breakdown: [], feiPenalty: 0 };
      }
    }
    return result;
  }, [players, wall, phase, currentPlayerIndex, roundWind, config, winner]);

  const handleDiscard = () => {
    if (selectedTile === null || !isHumanTurn) return;
    discardTile(0, selectedTile);
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
    claimTile(0, 'chi', option.handTiles);
    setChiSelection(null);
  };

  return (
    <div className="w-full min-h-screen bg-green-900 p-1 flex flex-col">
      <div className="flex flex-col items-center gap-1 p-1">
        {players[2] && (
          <>
            <span className="text-green-300 text-xs" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[players[2].seatWind] || ""}</span>
              {players[2].name}
              {players[2].seatWind === 'east' && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
              <span className="text-yellow-300 text-xs">- {playerTai[players[2].id]?.totalTai ?? 0} tai</span>
            </span>
            <div className="flex gap-0.5">
              {players[2].hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                <Tile key={i} tile={t} faceDown={true} size="sm" />
              ))}
            </div>

        <div className="flex gap-2 justify-center mt-2 flex-wrap">
          {phase === 'playing' && !hasClaimOptions && (
            <>
              {isHumanTurn && selectedTile !== null && !isFei(human.hand[selectedTile]) && (
                <button onClick={handleDiscard} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm transition-colors">Discard</button>
              )}
            </>
          )}
          {hasClaimOptions && (
            <>
              {eligibleActions.includes('win') && <button onClick={() => claimTile(0, 'win')} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Win!</button>}
              {eligibleActions.includes('kong') && <button onClick={() => claimTile(0, 'kong')} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Kong</button>}
              {eligibleActions.includes('pung') && <button onClick={() => claimTile(0, 'pung')} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Pung</button>}
              {eligibleActions.includes('chi') && chiSelection === null && <button onClick={handleChiOpen} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Chi</button>}
              <button onClick={() => passClaim()} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm transition-colors">Pass</button>
            </>
          )}
        </div>
            {/* Melds + Bonus tiles in one row (like user) */}
            <div className="flex items-center justify-center gap-2">
              {players[2].melds.length > 0 && (
                <div className="flex gap-1">
                  {players[2].melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
              {players[2].bonusTiles && players[2].bonusTiles.length > 0 && (
                <div className="flex gap-0.5">
                  {players[2].bonusTiles.map((t: any, i: number) => (
                    <Tile key={"bonus-" + i} tile={t} size="md" />
                  ))}
                </div>
              )}
            </div>
            {currentPlayerIndex === players[2].id && phase === 'playing' && <div className="flex justify-center text-yellow-400 text-lg animate-bounce mt-0.5">▲</div>}
          </>
        )}
      </div>

      <div className="flex-1 flex">
        <div className="flex flex-col items-center gap-1 px-1">
          {players[3] && (
            <>
              <span className="text-green-300 text-xs font-medium">{players[3].name}</span>
              {players[3].seatWind === 'east' && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[players[3].seatWind] || ""}</span>
              <span className="text-yellow-300 text-xs">- {playerTai[players[3].id]?.totalTai ?? 0} tai</span>
              <div className="flex items-start gap-3">
                <div className="flex flex-col space-y-[-10px]">
                  {players[3].hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                    <Tile key={i} tile={t} faceDown={true} size="sm" rotate={90} />
                  ))}
                </div>
                {currentPlayerIndex === players[3].id && phase === 'playing' && <div className="self-center text-yellow-400 text-lg animate-pulse">◄</div>}
                {players[3].bonusTiles && players[3].bonusTiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 items-center">
                    {players[3].bonusTiles.map((t: any, i: number) => (
                      <Tile key={"bonus-" + i} tile={t} size="md" />
                    ))}
                  </div>
                )}
              </div>
              {players[3].melds.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {players[3].melds.map((meld: any, i: number) => (
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
              <div className="flex gap-1 flex-wrap" style={{ maxWidth: "374px" }}>
                {discardHistory.slice(-40).map((t: any, i: number) => (
                  <Tile key={i} tile={t} size="sm" highlight={i === discardHistory.slice(-40).length - 1} />
                ))}
              </div>
            </div>
          ) : (
            <div className="w-48 h-32 bg-green-800/30 border-2 border-dashed border-green-700/50 rounded-lg flex items-center justify-center">
              <span className="text-green-600/50 text-sm">Discard Pile</span>
            </div>
          )}
          {message && <div className="text-yellow-300 text-base font-bold text-center mt-2">{message}</div>}
          <div className="text-green-300/70 text-sm text-center mt-1">
            Wall: {wall.length} | {config.taiThreshold === 0 ? '0 tai' : config.taiThreshold + ' tai'}
            {config.feiCount > 0 && ' | Fei: ' + config.feiCount}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 px-1">
          {players[1] && (
            <>
              <span className="text-green-300 text-xs font-medium">{players[1].name}</span>
              {players[1].seatWind === 'east' && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
              <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[players[1].seatWind] || ""}</span>
              <span className="text-yellow-300 text-xs">- {playerTai[players[1].id]?.totalTai ?? 0} tai</span>
              <div className="flex items-start gap-3">
                {players[1].bonusTiles && players[1].bonusTiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 items-center">
                    {players[1].bonusTiles.map((t: any, i: number) => (
                      <Tile key={"bonus-" + i} tile={t} size="md" />
                    ))}
                  </div>
                )}
                {currentPlayerIndex === players[1].id && phase === 'playing' && <div className="self-center text-yellow-400 text-lg animate-pulse">►</div>}
                <div className="flex flex-col space-y-[-10px]">
                  {players[1].hand.filter((t: any) => !isBonus(t)).map((t: any, i: number) => (
                    <Tile key={i} tile={t} faceDown={true} size="sm" rotate={-90} />
                  ))}
                </div>
              </div>
              {players[1].melds.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {players[1].melds.map((meld: any, i: number) => (
                    <MeldDisplay key={i} tiles={meld.tiles} type={meld.type} size="sm" />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

      </div>
      <div className="bg-green-800/40 rounded-lg p-2">
        {currentPlayerIndex === 0 && phase === 'playing' && <div className="flex justify-center text-yellow-400 text-lg animate-bounce mb-1">▼</div>}
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
          <span className="text-green-300 text-xs">You</span>
          {human.seatWind === 'east' && <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-yellow-400 text-black text-[9px] font-bold ml-0.5 leading-none" title="Dealer">庄</span>}
          <span style={{ color: "#fff", fontSize: "12px", fontWeight: "bold", fontFamily: "serif" }}>{WIND_CHARS[human.seatWind]}</span>
          <span className="text-yellow-300 text-xs">- {playerTai[0]?.totalTai ?? 0} tai</span>
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
              {isHumanTurn && selectedTile !== null && !isFei(human.hand[selectedTile]) && (
                <button onClick={handleDiscard} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm transition-colors">Discard</button>
              )}
            </>
          )}
          {hasClaimOptions && (
            <>
              {eligibleActions.includes('win') && <button onClick={() => claimTile(0, 'win')} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Win!</button>}
              {eligibleActions.includes('kong') && <button onClick={() => claimTile(0, 'kong')} className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Kong</button>}
              {eligibleActions.includes('pung') && <button onClick={() => claimTile(0, 'pung')} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Pung</button>}
              {eligibleActions.includes('chi') && chiSelection === null && <button onClick={handleChiOpen} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm transition-colors animate-pulse">Chi</button>}
              <button onClick={() => passClaim()} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-bold text-sm transition-colors">Pass</button>
            </>
          )}
        </div>
      </div>

      {phase === 'finished' && winner !== null && <div>Game Over! Winner: {players[winner]?.name}</div>}
   </div>
  );

}
