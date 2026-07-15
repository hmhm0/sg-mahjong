import { create, type StateCreator } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { GameState, GameConfig, Tile, Meld, Player, Wind } from '../types/mahjong';
import { buildDeck, shuffleDeck, sortHand, isFei, isBonus, tileDisplay } from '../game/tiles';
import { isWinningHand, calculateTai, canChi, canPung, canKong, canSelfKong, canUpgradePungToKong, canWinWithTai, isThirteenWonders, isAutomaticWinResult, isBlockedDiscardWinByFullSuitWait } from '../game/rules';
import { settleRoundChips } from '../game/chips';
import { chooseDiscard } from '../game/ai';
import { track } from '../utils/analytics';

// Helper: turn order follows East -> South -> West -> North.
function getNextPlayer(players: any[], currentIdx: number): number {
  const curWind = players[currentIdx]?.seatWind || 'east';
  const nextWind = WIND_ORDER[(WIND_ORDER.indexOf(curWind) + 1) % WIND_ORDER.length];
  return players.findIndex(p => p.seatWind === nextWind);
}

function findLastMatchingIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i;
  }
  return -1;
}

const WIND_ORDER: Wind[] = ['east', 'south', 'west', 'north'];
const AI_NAMES = ['Sakura', 'Mei Lin', 'Kenji'];
const MAX_MOVE_HISTORY = 300;
// Real-table flow: draw from one wall, with back draws used for replacements.
const DEAD_WALL_SIZE = 15;

function countFlowersAndSeasons(tiles: Tile[] = []): number {
  return tiles.filter(tile =>
    tile.category === 'bonus' &&
    (tile.bonusType === 'flower' || tile.bonusType === 'season')
  ).length;
}

function getNextWind(wind: Wind): Wind {
  return WIND_ORDER[(WIND_ORDER.indexOf(wind) + 1) % WIND_ORDER.length];
}

function getPlayerStartingChips(config: GameConfig): number {
  return typeof config.startingChips === 'number' && Number.isFinite(config.startingChips)
    ? Math.max(0, Math.floor(config.startingChips))
    : 0;
}

function getSpecialHandPayoutTai(result: { totalTai: number; breakdown: { name: string }[] }, config: GameConfig): number | null {
  const isSpecialHand = result.breakdown.some(entry =>
    entry.name.startsWith('Thirteen Wonders') ||
    entry.name.startsWith('Shi Ba Luo Han') ||
    entry.name.startsWith('Tian Hu') ||
    entry.name.startsWith('Di Hu') ||
    entry.name.startsWith('Men Hu') ||
    entry.name.startsWith('Qi Qiang Yi') ||
    entry.name.startsWith('Hua Hu') ||
    entry.name.startsWith('Big Three Dragons') ||
    entry.name.startsWith('Da Xi Si') ||
    entry.name.startsWith('Kan Kan Hu')
  );
  if (!isSpecialHand) return null;
  if (!config.specialTaiCapEnabled) return result.totalTai;
  const specialCap = Math.max(1, Math.min(18, Math.floor(config.specialTaiCap ?? 18)));
  return Math.min(result.totalTai, specialCap);
}

function splitWallForDeadWall(deck: Tile[]): { wall: Tile[]; deadWall: Tile[] } {
  return {
    wall: [...deck],
    deadWall: [],
  };
}

function drawFromFrontOfWall(wall: Tile[]): { tile: Tile | null; wall: Tile[] } {
  const nextWall = [...wall];
  const tile = nextWall.shift() || null;
  return { tile, wall: nextWall };
}

function drawFromBackOfWall(wall: Tile[]): { tile: Tile | null; wall: Tile[] } {
  const nextWall = [...wall];
  const tile = nextWall.pop() || null;
  return { tile, wall: nextWall };
}

function describeNoWinnerRoundEnd(hadKong: boolean): { roundEndReason: 'draw' | 'kong_exhaustion'; message: string; lastAction: string } {
  if (hadKong) {
    const message = 'Kong round ended. Dealer passes to the next player.';
    return {
      roundEndReason: 'kong_exhaustion',
      message,
      lastAction: message,
    };
  }
  const message = 'Draw game! The wall is down to 15 tiles.';
  return {
    roundEndReason: 'draw',
    message,
    lastAction: message,
  };
}

function finishRoundOnWallExhaustion(
  set: GameStoreSetter,
  state: GameStore,
  players: Player[],
  wall: Tile[],
  roundHadKong: boolean,
): boolean {
  if (wall.length > DEAD_WALL_SIZE) return false;
  const dealerIdx = getDealerPlayerIndex(state);
  const roundEnd = describeNoWinnerRoundEnd(roundHadKong);
  set({
    players,
    wall,
    deadWall: [],
    phase: 'finished',
    winner: null,
    winningTiles: [],
    winningDiscardPlayer: null,
    lastDrawnTile: null,
    nextDealerPlayerId: getNextDealerPlayerIdBySeat(state.players, dealerIdx),
    dealerPlayerId: dealerIdx,
    chipSettlement: null,
    roundHadKong,
    roundEndReason: roundEnd.roundEndReason,
    message: roundEnd.message,
    lastAction: roundEnd.lastAction,
    moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
    selfDrawWin: false,
    isHuaShang: false,
    isKangShang: false,
    isMenHu: false,
    isTW: false,
    selfKongData: null,
    waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    nextRoundCountdown: null,
  });
  return true;
}

interface GameStore extends GameState {
  // Actions
  startGame: (config: GameConfig, humanWind?: Wind) => void;
  startNewMatch: (config: GameConfig) => void;
  drawTile: (playerIndex: number, isBonusReplacement?: boolean) => void;
  discardTile: (playerIndex: number, tileIndex: number) => void;
  claimTile: (playerIndex: number, claimType: 'chi' | 'pung' | 'kong' | 'win', chiTiles?: Tile[]) => void;
  passClaim: () => void;
  nextTurn: () => void;
  setWaitingForClaim: (tile: Tile | null, fromPlayer: number) => void;
  reset: () => void;

  // UI state
  waitingForClaim: {
    tile: Tile | null;
    fromPlayer: number;
    eligiblePlayers: { playerIndex: number; actions: string[] }[];
  };
  showConfig: boolean;
  setShowConfig: (show: boolean) => void;
  message: string;
  setMessage: (msg: string) => void;
  selfDrawWin: boolean;
 isHuaShang: boolean;
 isKangShang: boolean;
 isMenHu: boolean;
  isTW: boolean;
 selfDrawWinAction: (playerIndex: number) => void;
  passSelfDrawWin: () => void;
  nextDealerPlayerId: number | null;
  selfKongData: { meldIndex: number; handTileIndex: number; concealedKongTileIndex: number | null } | null;
  selfKongAction: (playerIndex: number, meldIndex: number, handTileIndex: number) => void;
  concealedKongAction: (playerIndex: number, tileIndex: number) => void;
  passSelfKong: () => void;
  dealerCount: number;
  // Multiplayer
  isMultiplayer: boolean;
  isHost: boolean;
  myPlayerIndex: number;
  waitingForRemoteAction: boolean;
  pendingRemoteActionLabel: string | null;
  lastRemoteActionLatencyMs: number | null;
  applyRemoteAction: (playerIndex: number, actionType: string, data: any) => void;
}

type GameStoreSetter = (
  partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>),
  replace?: boolean,
) => void;

function describeTile(tile: Tile | null | undefined): string | null {
  return tile ? tileDisplay(tile) : null;
}

function describePlayer(player?: Player, fallbackIndex?: number): string {
  const name = player?.name || (typeof fallbackIndex === 'number' ? `Player ${fallbackIndex + 1}` : 'Player');
  return name;
}

function appendDebugLog(
  _set: GameStoreSetter,
  _sourceState: unknown,
  _type: string,
  _message: string,
  _details?: Record<string, unknown>,
) {
  // Developer-log snapshots are intentionally disabled.
}

function appendMoveHistory(history: string[], entry: string): string[] {
  return [...history, entry].slice(-MAX_MOVE_HISTORY);
}

function trackGameEvent(event: string, properties: Record<string, unknown>) {
  track(event, properties);
}

function getDealerPlayerIndex(state: { players: Player[]; dealerPlayerId?: number | null }): number {
  if (typeof state.dealerPlayerId === 'number' && state.dealerPlayerId >= 0) {
    return state.dealerPlayerId;
  }
  return state.players.findIndex(p => p.seatWind === 'east');
}

function getNextDealerPlayerIdBySeat(players: Player[], dealerPlayerId: number): number {
  const dealerSeat = players[dealerPlayerId]?.seatWind;
  if (!dealerSeat) return dealerPlayerId;
  const nextSeat = getNextWind(dealerSeat);
  const nextPlayerId = players.findIndex(p => p.seatWind === nextSeat);
  return nextPlayerId >= 0 ? nextPlayerId : dealerPlayerId;
}

function rotateSeatWinds(players: Player[]): Wind[] {
  const nextSeatByCurrent: Record<Wind, Wind> = {
    east: 'north',
    north: 'west',
    west: 'south',
    south: 'east',
  };
  return players.map(player => nextSeatByCurrent[player.seatWind] || player.seatWind);
}

function getHandWinDebugReason(params: {
  winningShape: boolean;
  blockedByFullSuitWait: boolean;
  winAllowedByTai: boolean;
  isAutomaticWin: boolean;
  thresholdTai: number;
  resultTai: number;
}): string {
  if (!params.winningShape) return 'invalid hand shape';
  if (params.blockedByFullSuitWait) return 'blocked by full-suit wait';
  if (params.isAutomaticWin || params.winAllowedByTai) return 'meets win conditions';
  return `below tai threshold (${params.resultTai}/${params.thresholdTai})`;
}

function summarizeClaimEligible(eligible: { playerIndex: number; actions: string[] }[]): string {
  if (!eligible.length) return 'none';
  return eligible
    .map(entry => `P${entry.playerIndex}:${entry.actions.join('/')}`)
    .join(', ');
}

const INITIAL_STATE: GameState = {
  players: [],
  wall: [],
  deadWall: [],
  currentPlayerIndex: 0,
  phase: 'setup',
  multiplayerStartPending: false,
  roundWind: 'east',
  config: { taiThreshold: 4, unlimitedTai: false, feiCount: 4, payoutTable: 'none', startingChips: null, shooterEnabled: false, maxTai: 10, specialTaiCapEnabled: false, specialTaiCap: 18, economyEnabled: false, chipSettlementMode: 'default' },
  lastAction: '',
  winner: null,
  winningTiles: [],
  winningDiscardPlayer: null,
  lastDrawnTile: null,
  winMethod: null,
  discardHistory: [],
  moveHistory: [],
  hostDisconnected: false,
  playerLeft: null,
  roomPaused: false,
  roomPauseReason: null,
  roundHadKong: false,
  roundEndReason: null,
  diceResults: null,
  nextRoundCountdown: null,
  dealerPlayerId: null,
  chipSettlement: null,
  debugLogs: [],
  waitingForRemoteAction: false,
  pendingRemoteActionLabel: null,
  lastRemoteActionLatencyMs: null,
};

const createGameStoreState: StateCreator<GameStore> = (set, get) => ({
  ...INITIAL_STATE,
  showConfig: true,
  selfDrawWin: false,
  selfKongData: null,
  dealerCount: 0,
  isMultiplayer: false,
  isHost: false,
  myPlayerIndex: 0,
  waitingForRemoteAction: false,
  pendingRemoteActionLabel: null,
  lastRemoteActionLatencyMs: null,
isHuaShang: false,
isKangShang: false,
isMenHu: false,
isTW: false,
nextDealerPlayerId: null,
dealerPlayerId: null,
 roundHadKong: false,
 roundEndReason: null,
  waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
  message: 'Configure and start a new game!',
  setMessage: (msg) => set({ message: msg }),
  setShowConfig: (show) => set({ showConfig: show }),
  setWaitingForClaim: (tile, fromPlayer) => set({ waitingForClaim: { tile, fromPlayer, eligiblePlayers: [] } }),

  startGame: (config: GameConfig, humanWind?: Wind) => {
    const deck = shuffleDeck(buildDeck(config));
    const startingChips = getPlayerStartingChips(config);
    const { wall: liveWall } = splitWallForDeadWall(deck);

    const windOrder: Wind[] = ['east', 'south', 'west', 'north'];
    const state = get();
    const existingPlayers = state.players.length === 4 ? state.players : null;

    // Use stored next dealer if set (skip dice roll result)
    let dealerCount = state.dealerCount || 0;
    let roundWind = state.roundWind || 'east';
    if (state.nextDealerPlayerId !== null) {
      // Dealer changed — increment counter
      dealerCount++;
      // After all 4 players have been dealer, rotate round wind
     if (dealerCount >= 4) {
        // End of North round — game is over
        if (roundWind === 'north') {
          set({
            phase: 'finished',
            message: 'Game Over! All rounds completed.',
            nextDealerPlayerId: null,
            roundHadKong: false,
            roundEndReason: null,
            selfKongData: null,
            chipSettlement: null,
          });
          return;
        }
        // Rotate to next round wind
        const windNames: Wind[] = ['east', 'south', 'west', 'north'];
        roundWind = windNames[(windNames.indexOf(roundWind) + 1) % 4] as Wind;
        dealerCount = 0;
      }
    }
    const initialSeatWinds = existingPlayers
      ? (state.nextDealerPlayerId !== null ? rotateSeatWinds(existingPlayers) : existingPlayers.map(p => p.seatWind))
      : (() => {
          const humanWindIdx = humanWind ? windOrder.indexOf(humanWind) : 0;
          return [
            windOrder[(humanWindIdx + 0) % 4],
            windOrder[(humanWindIdx + 1) % 4],
            windOrder[(humanWindIdx + 2) % 4],
            windOrder[(humanWindIdx + 3) % 4],
          ];
        })();

    const basePlayers: Player[] = existingPlayers
      ? existingPlayers.map((p, idx) => ({
          ...p,
          id: p.id ?? idx,
          hand: [],
          melds: [],
          discards: [],
          bonusTiles: [],
          isAlive: true,
          chips: typeof p.chips === 'number' ? p.chips : startingChips,
          seatWind: initialSeatWinds[idx],
        }))
      : [
          { id: 0, name: "You", isHuman: true, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[0], isAlive: true, bonusTiles: [], chips: startingChips },
          { id: 1, name: "Sakura", isHuman: false, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[1], isAlive: true, bonusTiles: [], chips: startingChips },
          { id: 2, name: "Mei Lin", isHuman: false, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[2], isAlive: true, bonusTiles: [], chips: startingChips },
          { id: 3, name: "Kenji", isHuman: false, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[3], isAlive: true, bonusTiles: [], chips: startingChips },
        ];

    const players: Player[] = basePlayers.map(p => ({
      ...p,
      hand: [],
      melds: [],
      discards: [],
      bonusTiles: [],
      isAlive: true,
      chips: typeof p.chips === 'number' ? p.chips : startingChips,
    }));

    let remainingWall = [...liveWall];
    const dealFromWall = () => {
      const drawn = drawFromFrontOfWall(remainingWall);
      remainingWall = drawn.wall;
      return drawn.tile;
    };
    const replaceFromBackOfWall = () => {
      const drawn = drawFromBackOfWall(remainingWall);
      remainingWall = drawn.wall;
      return drawn.tile;
    };

    // Deal: 13 tiles to each player (dealer gets 14)
    for (let round = 0; round < 3; round++) {
      for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 4; i++) {
          const tile = dealFromWall();
          if (tile) players[p].hand.push(tile);
        }
      }
    }
   // 1 more tile to each player
   for (let p = 0; p < 4; p++) {
     const tile = dealFromWall();
     if (tile) players[p].hand.push(tile);
    }
    // East player (the dealer) gets 1 more tile
    const eastPlayerIndex = state.nextDealerPlayerId !== null && players[state.nextDealerPlayerId]
      ? state.nextDealerPlayerId
      : players.findIndex(p => p.seatWind === 'east');
    const eastBonusTile = dealFromWall();
    if (eastBonusTile) players[eastPlayerIndex].hand.push(eastBonusTile);

   // Sort hands
   for (const p of players) {
      p.hand = sortHand(p.hand);
    }

    // Reveal bonus tiles (flowers, seasons, animals) and draw replacements
    // from the back of the wall, starting from East and moving clockwise.
    const eastPlayerIdx = eastPlayerIndex;
    for (let offset = 0; offset < 4; offset++) {
      const p = players[(eastPlayerIdx + offset) % 4];
      while (true) {
        const bonusIdx = p.hand.findIndex(t => isBonus(t));
        if (bonusIdx === -1) break;
        const bonusTile = p.hand.splice(bonusIdx, 1)[0];
        if (!p.bonusTiles) p.bonusTiles = [];
        p.bonusTiles.push(bonusTile);
        const replacement = replaceFromBackOfWall();
        if (!replacement) {
          set({
            nextDealerPlayerId: null,
            dealerPlayerId: eastPlayerIndex,
            selfKongData: null,
            dealerCount: 0,
            roundHadKong: false,
            debugLogs: [],
            isMultiplayer: false,
            isHost: false,
            myPlayerIndex: 0,
            waitingForRemoteAction: false,
            players,
            wall: remainingWall,
            deadWall: [],
            discardHistory: [],
            phase: 'finished',
            winner: null,
            winningTiles: [],
            winningDiscardPlayer: null,
            lastDrawnTile: null,
            winMethod: null,
            nextRoundCountdown: null,
            chipSettlement: null,
            showConfig: false,
            message: 'Draw game! The wall is down to 15 tiles.',
            lastAction: 'Draw game! The wall is down to 15 tiles.',
            roundEndReason: 'draw',
            moveHistory: appendMoveHistory([], 'Draw game! The wall is down to 15 tiles.'),
          });
          return;
        }
        p.hand.push(replacement);
      }
      p.hand = sortHand(p.hand);
    }

    // Check for Tian Hu (天胡): dealer wins with opening hand after replacements
    if (isWinningHand(players[eastPlayerIndex].hand, players[eastPlayerIndex].melds)) {
      const tempState = { players, config, roundWind } as GameState;
      const result = calculateTai(tempState, eastPlayerIndex, false, false, false, false, undefined, true);
      const settlement = settleRoundChips(players.map(player => ({ ...player, hand: [...player.hand], melds: [...player.melds], discards: [...player.discards], bonusTiles: [...player.bonusTiles] })), config, eastPlayerIndex, result.totalTai, null, getSpecialHandPayoutTai(result, config));
          set({
            nextDealerPlayerId: null,
            dealerPlayerId: eastPlayerIndex,
            selfKongData: null,
            dealerCount: 0,
            roundHadKong: false,
            roundEndReason: null,
            debugLogs: [],
            isMultiplayer: false,
            isHost: false,
            myPlayerIndex: 0,
          waitingForRemoteAction: false,
          players: settlement.players,
          wall: remainingWall,
          deadWall: [],
          discardHistory: [],
          phase: 'finished',
          winner: eastPlayerIndex,
          winningTiles: [...players[eastPlayerIndex].hand],
          winningDiscardPlayer: null,
          lastDrawnTile: null,
          winMethod: 'tian_hu',
          nextRoundCountdown: null,
          chipSettlement: settlement.summary,
          showConfig: false,
          message: `Tian Hu! ${describePlayer(players[eastPlayerIndex], eastPlayerIndex)} wins with the opening hand! (${result.totalTai} tai)`,
          lastAction: `Tian Hu! ${describePlayer(players[eastPlayerIndex], eastPlayerIndex)} wins with the opening hand!`,
          moveHistory: appendMoveHistory([], `Tian Hu! ${describePlayer(players[eastPlayerIndex], eastPlayerIndex)} wins with the opening hand!`),
        });
      trackGameEvent('round_finished', {
        win_method: 'tian_hu',
        winner_index: eastPlayerIndex,
        tai: result.totalTai,
        is_multiplayer: state.isMultiplayer,
        is_host: state.isHost,
      });
      appendDebugLog(set, {
        players,
        wall: remainingWall,
        deadWall: [],
        currentPlayerIndex: eastPlayerIndex,
        roundWind: 'east',
        discardHistory: [],
        waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
      }, 'start_game_auto_win', `Tian Hu detected for ${describePlayer(players[eastPlayerIndex], eastPlayerIndex)}`, {
        winner: eastPlayerIndex,
        tai: result.totalTai,
        breakdown: result.breakdown,
      });
      return;
    }

   set({ nextDealerPlayerId: null,
     dealerPlayerId: eastPlayerIndex,
     debugLogs: [],
     players,
     wall: remainingWall,
     deadWall: [],
     discardHistory: [],
     currentPlayerIndex: eastPlayerIndex,
     phase: 'playing',
     roundWind,
     dealerCount,
     config,
     chipSettlement: null,
     roundHadKong: false,
     roundEndReason: null,
     lastDrawnTile: null,
     lastAction: `Game started! ${describePlayer(players[eastPlayerIndex], eastPlayerIndex)} (East) discards first.`,
     moveHistory: appendMoveHistory([], `Game started! ${describePlayer(players[eastPlayerIndex], eastPlayerIndex)} (East) discards first.`),
     winner: null,
     winningTiles: [],
     winningDiscardPlayer: null,
     nextRoundCountdown: null,
     showConfig: false,
     waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
     message: describePlayer(players[eastPlayerIndex], eastPlayerIndex) + ' (East) discards first.',
   });
    trackGameEvent('round_started', {
      dealer_index: eastPlayerIndex,
      round_wind: roundWind,
      player_count: players.length,
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });
    appendDebugLog(set, {
      players,
      wall: remainingWall,
      deadWall: [],
      currentPlayerIndex: eastPlayerIndex,
      roundWind,
      discardHistory: [],
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    }, 'start_game', 'New round started', {
      eastPlayerIndex,
      dealerCount,
      config,
    });

    // If East is a bot, auto-discard after a delay
    if (eastPlayerIndex !== 0) {
      setTimeout(() => {
        const state = get();
        if (state.phase !== 'playing') return;
        const hand = state.players[eastPlayerIndex].hand;
        const melds = state.players[eastPlayerIndex].melds;
        const discardIdx = chooseDiscard(hand, melds);
        if (discardIdx >= 0 && discardIdx < hand.length) {
          get().discardTile(eastPlayerIndex, discardIdx);
        }
      }, 800);
    }
  },

  startNewMatch: (config: GameConfig) => {
    const winds: Wind[] = ['east', 'south', 'west', 'north'];
    const humanWind = winds[Math.floor(Math.random() * winds.length)];
    set({
      ...INITIAL_STATE,
      config,
      showConfig: false,
      nextDealerPlayerId: null,
      dealerPlayerId: null,
      dealerCount: 0,
      roundWind: 'east',
      selfDrawWin: false,
      selfKongData: null,
      isHuaShang: false,
      isKangShang: false,
      isMenHu: false,
      isTW: false,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
      message: 'Starting a new match...',
    });
    get().startGame(config, humanWind);
  },

  drawTile: (playerIndex: number, isBonusReplacement: boolean = false) => {
    const state = get();
    if (state.phase !== 'playing') return;
    if (state.wall.length <= DEAD_WALL_SIZE) {
      const dealerIdx = getDealerPlayerIndex(state);
      const roundEnd = describeNoWinnerRoundEnd(Boolean(state.roundHadKong));
      set({
        phase: 'finished',
        message: roundEnd.message,
        lastAction: roundEnd.lastAction,
        moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
        roundEndReason: roundEnd.roundEndReason,
        nextDealerPlayerId: getNextDealerPlayerIdBySeat(state.players, dealerIdx),
        dealerPlayerId: dealerIdx,
        winningDiscardPlayer: null,
        chipSettlement: null,
      });
      return;
    }

    const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand] }));
    const newWall = [...state.wall];
    const drawnTile = newWall.shift()!;
    let finalDrawnTile = drawnTile;

    newPlayers[playerIndex].hand.push(drawnTile);
    newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);
    appendDebugLog(set, {
      ...state,
      players: newPlayers,
      wall: newWall,
      deadWall: [],
    }, 'draw_tile', `${describePlayer(state.players[playerIndex], playerIndex)} drew ${tileDisplay(drawnTile)}`, {
      playerIndex,
      tile: tileDisplay(drawnTile),
      isBonusReplacement,
    });

    // If a bonus tile is drawn, draw a replacement
    // If a bonus tile is drawn, reveal it and draw a replacement
    if (isBonus(drawnTile)) {
      // Qi Qiang Yi (七搶一): another player takes the eighth flower/season.
      let qqyWinner: number | null = null;
      if (
        drawnTile.category === 'bonus' &&
        (drawnTile.bonusType === 'flower' || drawnTile.bonusType === 'season')
      ) {
        for (let p = 0; p < newPlayers.length; p++) {
          if (p === playerIndex) continue;
          if (countFlowersAndSeasons(newPlayers[p].bonusTiles) >= 7) {
            qqyWinner = p;
            break;
          }
        }
      }

      if (qqyWinner !== null) {
        const bonusIdx = findLastMatchingIndex(newPlayers[playerIndex].hand, t => t === drawnTile);
        if (bonusIdx >= 0) {
          const bonusTile = newPlayers[playerIndex].hand.splice(bonusIdx, 1)[0];
          if (!newPlayers[qqyWinner].bonusTiles) newPlayers[qqyWinner].bonusTiles = [];
          newPlayers[qqyWinner].bonusTiles.push(bonusTile);
        }
        const qqyResult = calculateTai({ ...state, players: newPlayers } as GameState, qqyWinner, false, false, false, false, undefined, false, false, false, false, true, false);
        const settlement = settleRoundChips(newPlayers, state.config, qqyWinner, qqyResult.totalTai, null, getSpecialHandPayoutTai(qqyResult, state.config));
      set({
        players: settlement.players,
        wall: newWall,
        deadWall: [],
        phase: 'finished',
        winner: qqyWinner,
        winningTiles: [],
        winningDiscardPlayer: null,
        lastDrawnTile: null,
        winMethod: 'qi_qiang_yi',
        nextRoundCountdown: null,
        chipSettlement: settlement.summary,
          showConfig: false,
          lastAction: `Qi Qiang Yi! ${describePlayer(state.players[qqyWinner], qqyWinner)} wins with all 8 flowers/seasons!`,
          moveHistory: appendMoveHistory(state.moveHistory, `Qi Qiang Yi! ${describePlayer(state.players[qqyWinner], qqyWinner)} wins with all 8 flowers/seasons!`),
          message: `Qi Qiang Yi! ${describePlayer(state.players[qqyWinner], qqyWinner)} wins with all 8 flowers/seasons! (${qqyResult.totalTai} tai)`,
        });
        trackGameEvent('round_finished', {
          win_method: 'qi_qiang_yi',
          winner_index: qqyWinner,
          tile: tileDisplay(drawnTile),
          is_multiplayer: state.isMultiplayer,
          is_host: state.isHost,
        });
        return;
      }

      // Remove bonus tile from hand and add to bonusTiles display
      const bonusIdx = findLastMatchingIndex(newPlayers[playerIndex].hand, t => t === drawnTile);
      if (bonusIdx >= 0) {
       const bonusTile = newPlayers[playerIndex].hand.splice(bonusIdx, 1)[0];
       if (!newPlayers[playerIndex].bonusTiles) newPlayers[playerIndex].bonusTiles = [];
       newPlayers[playerIndex].bonusTiles.push(bonusTile);

        // Hua Hu (花胡): player has self-drawn all 8 flowers/seasons
        if (countFlowersAndSeasons(newPlayers[playerIndex].bonusTiles) >= 8) {
          const hhResult = calculateTai({ ...state, players: newPlayers } as GameState, playerIndex, false, false, false, false, undefined, false, false, false, false, false, true);
          const settlement = settleRoundChips(newPlayers, state.config, playerIndex, hhResult.totalTai, null, getSpecialHandPayoutTai(hhResult, state.config));
      set({
            players: settlement.players,
            wall: newWall,
            deadWall: [],
            phase: 'finished',
            winner: playerIndex,
            winningTiles: [],
            winningDiscardPlayer: null,
            lastDrawnTile: null,
            winMethod: 'hua_hu',
            nextRoundCountdown: null,
            chipSettlement: settlement.summary,
            showConfig: false,
            lastAction: `Hua Hu! ${describePlayer(state.players[playerIndex], playerIndex)} wins with all 8 flowers/seasons!`,
            moveHistory: appendMoveHistory(state.moveHistory, `Hua Hu! ${describePlayer(state.players[playerIndex], playerIndex)} wins with all 8 flowers/seasons!`),
            message: `Hua Hu! ${describePlayer(state.players[playerIndex], playerIndex)} wins with all 8 flowers/seasons! (${hhResult.totalTai} tai)`,
          });
          trackGameEvent('round_finished', {
            win_method: 'hua_hu',
            winner_index: playerIndex,
            tile: tileDisplay(drawnTile),
            is_multiplayer: state.isMultiplayer,
            is_host: state.isHost,
          });
          return;
        }
      }

      // Draw replacement tiles from the back of the wall.
      while (true) {
        if (newWall.length === 0) {
          const dealerIdx = getDealerPlayerIndex(state);
          const roundEnd = describeNoWinnerRoundEnd(true);
          set({
            players: newPlayers,
            wall: newWall,
            deadWall: [],
            phase: 'finished',
            winner: null,
            winningTiles: [],
            winningDiscardPlayer: null,
            lastDrawnTile: null,
            nextDealerPlayerId: getNextDealerPlayerIdBySeat(state.players, dealerIdx),
            dealerPlayerId: dealerIdx,
            chipSettlement: null,
            roundHadKong: false,
            roundEndReason: roundEnd.roundEndReason,
            message: roundEnd.message,
            lastAction: roundEnd.lastAction,
            moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
        });
          return;
        }

        const replacement = drawFromBackOfWall(newWall);
        newWall.splice(0, newWall.length, ...replacement.wall);
        if (!replacement.tile) {
          const dealerIdx = getDealerPlayerIndex(state);
          const roundEnd = describeNoWinnerRoundEnd(true);
          set({
            players: newPlayers,
            wall: newWall,
            deadWall: [],
            phase: 'finished',
            winner: null,
            winningTiles: [],
            winningDiscardPlayer: null,
            lastDrawnTile: null,
            nextDealerPlayerId: getNextDealerPlayerIdBySeat(state.players, dealerIdx),
            dealerPlayerId: dealerIdx,
            chipSettlement: null,
            roundHadKong: false,
            roundEndReason: roundEnd.roundEndReason,
            message: roundEnd.message,
            lastAction: roundEnd.lastAction,
            moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
          });
          return;
        }
        if (isBonus(replacement.tile)) {
          newPlayers[playerIndex].bonusTiles = [...(newPlayers[playerIndex].bonusTiles || []), replacement.tile];
          isBonusReplacement = true;
          continue;
        }

        newPlayers[playerIndex].hand.push(replacement.tile);
        newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);
        finalDrawnTile = replacement.tile;
        isBonusReplacement = true;
        break;
      }
    }

    // Check if player can self-kong
    const kongIdx = canSelfKong(newPlayers[playerIndex].hand);

    // Check for self-draw win (Zi Mo)
    const canWinSelf = isWinningHand(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds);
    const canWinTW = isThirteenWonders(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds);

    // Check for Men Hu (门胡): non-dealer wins on first drawn tile
    const dealerPlayerIdx = getDealerPlayerIndex(state);
    const isMenHu = playerIndex !== dealerPlayerIdx && state.discardHistory.length <= 1 && state.players[playerIndex].melds.length === 0;

    // For human: show Win/Pass buttons if self-draw possible
    const localPlayerIdx = get().myPlayerIndex || 0;
    if (playerIndex === localPlayerIdx && (canWinSelf || canWinTW)) {
      const tempState = { ...state, players: newPlayers, wall: newWall, deadWall: [], config: state.config, waitingForClaim: state.waitingForClaim };
      const result = calculateTai(tempState, playerIndex, true, false, isBonusReplacement, false, undefined, false, false, isMenHu, canWinTW);
      const isAutomaticWin = isAutomaticWinResult(result, { menHu: isMenHu, thirteenWonders: canWinTW });
      const winReason = getHandWinDebugReason({
        winningShape: canWinSelf || canWinTW,
        blockedByFullSuitWait: false,
        winAllowedByTai: isAutomaticWin || result.totalTai >= state.config.taiThreshold,
        isAutomaticWin,
        thresholdTai: state.config.taiThreshold,
        resultTai: result.totalTai,
      });
      appendDebugLog(set, tempState, 'self_draw_eval', `${describePlayer(state.players[playerIndex], playerIndex)} self-draw evaluation`, {
        playerIndex,
        canWinSelf,
        canWinTW,
        isMenHu,
        isAutomaticWin,
        reason: winReason,
        tai: result.totalTai,
        breakdown: result.breakdown,
      });
      if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
          result.totalTai >= state.config.taiThreshold) {
        set({
          players: newPlayers,
          wall: newWall,
          deadWall: [],
          lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} drew a tile. (${describePlayer(state.players[playerIndex], playerIndex)}'s turn)`,
          moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} drew a tile. (${describePlayer(state.players[playerIndex], playerIndex)}'s turn)`),
          selfDrawWin: true,
          isHuaShang: isBonusReplacement,
          isMenHu: isMenHu,
          isTW: canWinTW,
          lastDrawnTile: finalDrawnTile,
          message: (isBonusReplacement ? `You can win! (Hua Shang) - ${result.totalTai} tai` : `You can win! (Zi Mo) - ${result.totalTai} tai`),
        });
        return;
      }
    }

    // Check for self-kong (upgrade pung to kong or concealed kong)
    let selfKongData: { meldIndex: number; handTileIndex: number; concealedKongTileIndex: number | null } | null = null;
    if (playerIndex === localPlayerIdx) {
      const pungUpgrade = canUpgradePungToKong(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds);
      const concealedKongIdx = canSelfKong(newPlayers[playerIndex].hand);
      if (pungUpgrade) {
        selfKongData = { meldIndex: pungUpgrade.meldIndex, handTileIndex: pungUpgrade.handTileIndex, concealedKongTileIndex: null };
      } else if (concealedKongIdx !== null) {
        selfKongData = { meldIndex: -1, handTileIndex: concealedKongIdx, concealedKongTileIndex: concealedKongIdx };
      }
    }

    set({
      players: newPlayers,
      wall: newWall,
      deadWall: [],
      selfKongData,
     selfDrawWin: false,
     isHuaShang: isBonusReplacement,
     isKangShang: false,
     isMenHu: isMenHu,
      isTW: canWinTW,
     lastDrawnTile: finalDrawnTile,
     lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} drew a tile. (${describePlayer(state.players[playerIndex], playerIndex)}'s turn)`,
      moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} drew a tile. (${describePlayer(state.players[playerIndex], playerIndex)}'s turn)`),
      message: playerIndex === (get().myPlayerIndex || 0) ? 'Your turn to discard.' : `${describePlayer(state.players[playerIndex], playerIndex)} is thinking...`,
    });
    trackGameEvent('tile_drawn', {
      player_index: playerIndex,
      tile: tileDisplay(finalDrawnTile),
      is_bonus_replacement: isBonusReplacement,
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });

    if (!get().selfDrawWin && !get().selfKongData && finishRoundOnWallExhaustion(set, state, newPlayers, newWall, Boolean(state.roundHadKong))) {
      return;
    }

   // If AI drew, check self-draw win or auto-discard
    if (playerIndex !== 0) {
     if (canWinSelf || canWinTW) {
        const tempState = { ...state, players: newPlayers, wall: newWall, deadWall: [], config: state.config, waitingForClaim: state.waitingForClaim };
        const result = calculateTai(tempState, playerIndex, true, false, isBonusReplacement, false, undefined, false, false, isMenHu, canWinTW);
        const isAutomaticWin = isAutomaticWinResult(result, { menHu: isMenHu, thirteenWonders: canWinTW });
        const winReason = getHandWinDebugReason({
          winningShape: canWinSelf || canWinTW,
          blockedByFullSuitWait: false,
          winAllowedByTai: isAutomaticWin || result.totalTai >= state.config.taiThreshold,
          isAutomaticWin,
          thresholdTai: state.config.taiThreshold,
          resultTai: result.totalTai,
        });
        appendDebugLog(set, tempState, 'ai_self_draw_eval', `${describePlayer(state.players[playerIndex], playerIndex)} AI self-draw evaluation`, {
          playerIndex,
          canWinSelf,
          canWinTW,
          isMenHu,
          isAutomaticWin,
          reason: winReason,
          tai: result.totalTai,
          breakdown: result.breakdown,
        });
        if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
            result.totalTai >= state.config.taiThreshold) {
          setTimeout(() => {
            get().selfDrawWinAction(playerIndex);
          }, 300);
          return;
        }
      }
      // Only auto-discard for pure AI players (isHuman === false)
      // In multiplayer, remote humans send their own discards
      if (state.players[playerIndex] && !state.players[playerIndex].isHuman) {
      setTimeout(() => {
        const current = get();
        const hand = current.players[playerIndex].hand;
        const melds = current.players[playerIndex].melds;
        const discardIdx = chooseDiscard(hand, melds);
        if (discardIdx >= 0 && discardIdx < hand.length) {
          get().discardTile(playerIndex, discardIdx);
        }
      }, 500);
      }
    }
  },

  discardTile: (playerIndex: number, tileIndex: number) => {
    const state = get();
    if (state.phase !== 'playing') return;

    const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand], discards: [...p.discards] }));
    const hand = newPlayers[playerIndex].hand;

    if (tileIndex < 0 || tileIndex >= hand.length) return;
    const discardedTile = hand[tileIndex];

    // Can't discard fei
    if (isFei(discardedTile)) return;

    hand.splice(tileIndex, 1);
    newPlayers[playerIndex].hand = hand;
    newPlayers[playerIndex].discards.push(discardedTile);

    set({
      players: newPlayers,
      discardHistory: [...state.discardHistory, discardedTile],
      lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} discarded ${discardedTile.category === 'suit' ? discardedTile.suit + ' ' + discardedTile.value : discardedTile.category === 'honor' ? discardedTile.type : '?'}`,
      moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} discarded ${discardedTile.category === 'suit' ? discardedTile.suit + ' ' + discardedTile.value : discardedTile.category === 'honor' ? discardedTile.type : '?'}`),
      message: `Player ${playerIndex === (get().myPlayerIndex || 0) ? 'You' : describePlayer(state.players[playerIndex], playerIndex)} discarded a tile.`,
    });
    trackGameEvent('tile_discarded', {
      player_index: playerIndex,
      tile: tileDisplay(discardedTile),
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });
    appendDebugLog(set, {
      ...state,
      players: newPlayers,
      discardHistory: [...state.discardHistory, discardedTile],
    }, 'discard', `${describePlayer(state.players[playerIndex], playerIndex)} discarded ${tileDisplay(discardedTile)}`, {
      playerIndex,
      tileIndex,
      discard: tileDisplay(discardedTile),
    });

    // Check if other players can claim this tile
    const eligible: { playerIndex: number; actions: string[] }[] = [];
    const eastPlayerIdx = getDealerPlayerIndex(state);

    // Thirteen Wonders has absolute priority — check before all other claims
    let twWinner: number | null = null;
    for (let p = 0; p < newPlayers.length; p++) {
      if (p === playerIndex) continue;
      if (isThirteenWonders([...newPlayers[p].hand, discardedTile], newPlayers[p].melds)) {
        twWinner = p;
        break;
      }
    }
    if (twWinner !== null) {
      set({
        waitingForClaim: { tile: discardedTile, fromPlayer: playerIndex, eligiblePlayers: [{ playerIndex: twWinner, actions: ['win'] }] },
        message: `Thirteen Wonders! ${describePlayer(state.players[twWinner], twWinner)} wins from ${describePlayer(state.players[playerIndex], playerIndex)}'s discard!`,
      });
      get().claimTile(twWinner, 'win');
      return;
    }

    for (let p = 0; p < newPlayers.length; p++) {
      if (p === playerIndex) continue;
      const playerHand = newPlayers[p].hand;
      const playerMelds = newPlayers[p].melds;
      const actions: string[] = [];
      const blockedDiscardWin = isBlockedDiscardWinByFullSuitWait(playerHand, playerMelds, discardedTile);

      // Check win
      const isTWClaim = isThirteenWonders([...playerHand, discardedTile], playerMelds);
      const winningShape = isTWClaim || isWinningHand([...playerHand, discardedTile], playerMelds);
      const canDiscardWin = isTWClaim || (!blockedDiscardWin && winningShape);
      if (canDiscardWin) {
        const isDiHu = state.discardHistory.length === 0 && playerIndex === eastPlayerIdx && p !== eastPlayerIdx;
        const result = calculateTai(state, p, false, false, false, false, discardedTile, false, isDiHu, false, false, isTWClaim);
        const isAutomaticWin = isAutomaticWinResult(result, { diHu: isDiHu, thirteenWonders: isTWClaim });
        const meetsThreshold = canWinWithTai(result, state.config.taiThreshold, false, isAutomaticWin);
        const winReason = getHandWinDebugReason({
          winningShape,
          blockedByFullSuitWait: blockedDiscardWin,
          winAllowedByTai: meetsThreshold,
          isAutomaticWin,
          thresholdTai: state.config.taiThreshold + 1,
          resultTai: result.totalTai,
        });
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: [...state.discardHistory, discardedTile],
        }, 'discard_win_eval', `${describePlayer(state.players[p], p)} evaluated win on ${tileDisplay(discardedTile)}`, {
          discardedBy: playerIndex,
          playerIndex: p,
          discard: tileDisplay(discardedTile),
          canWin: canDiscardWin,
          isDiHu,
          isThirteenWonders: isTWClaim,
          isAutomaticWin,
          meetsThreshold,
          reason: winReason,
          tai: result.totalTai,
          breakdown: result.breakdown,
        });
        if (meetsThreshold) {
          actions.push('win');
        }
      } else {
        const winReason = getHandWinDebugReason({
          winningShape: isTWClaim || isWinningHand([...playerHand, discardedTile], playerMelds),
          blockedByFullSuitWait: blockedDiscardWin,
          winAllowedByTai: false,
          isAutomaticWin: false,
          thresholdTai: state.config.taiThreshold + 1,
          resultTai: 0,
        });
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: [...state.discardHistory, discardedTile],
        }, 'discard_win_eval', `${describePlayer(state.players[p], p)} cannot win on ${tileDisplay(discardedTile)}`, {
          discardedBy: playerIndex,
          playerIndex: p,
          discard: tileDisplay(discardedTile),
          canWin: false,
          blockedDiscardWin,
          reason: winReason,
        });
      }
      // Kong overrides others
      if (canKong(playerHand, discardedTile)) {
        actions.push('kong');
      }
      if (canPung(playerHand, discardedTile)) {
        actions.push('pung');
      }
      // Only the next player in turn can chi
      const chiPlayer = getNextPlayer(newPlayers, playerIndex);
      if (p === chiPlayer && canChi(playerHand, discardedTile)) {
        actions.push('chi');
      }

      if (actions.length > 0) {
        eligible.push({ playerIndex: p, actions });
      }
    }

    if (eligible.length > 0) {
      set({
        discardHistory: [...get().discardHistory],
        waitingForClaim: { tile: discardedTile, fromPlayer: playerIndex, eligiblePlayers: eligible },
        lastAction: `Claim window opened on ${tileDisplay(discardedTile)}`,
        moveHistory: appendMoveHistory(state.moveHistory, `Claim window opened on ${tileDisplay(discardedTile)}`),
        message: `A tile can be claimed! Checking claims...`,
      });
      appendDebugLog(set, {
        ...get(),
        players: newPlayers,
        discardHistory: [...get().discardHistory],
        waitingForClaim: { tile: discardedTile, fromPlayer: playerIndex, eligiblePlayers: eligible },
      }, 'claim_window', `Claim window opened for ${tileDisplay(discardedTile)}`, {
        fromPlayer: playerIndex,
        discard: tileDisplay(discardedTile),
        eligible,
      });

      // Auto-handle AI claims
      handleAIClaims(get, set, eligible, discardedTile, playerIndex);
    } else {
      // No one can claim, next player's turn
      const nextPlayer = getNextPlayer(newPlayers, playerIndex);
      const nextName = describePlayer(state.players[nextPlayer], nextPlayer);
      set({ currentPlayerIndex: nextPlayer });
      appendDebugLog(set, {
        ...get(),
        players: newPlayers,
        currentPlayerIndex: nextPlayer,
      }, 'no_claim', `No claim on ${tileDisplay(discardedTile)}; next turn ${nextName}`, {
        fromPlayer: playerIndex,
        discard: tileDisplay(discardedTile),
        nextPlayer,
      });
      get().drawTile(nextPlayer);
    }
  },

  claimTile: (playerIndex: number, claimType: 'chi' | 'pung' | 'kong' | 'win', chiTiles?: Tile[]) => {
    const state = get();
    const { tile, fromPlayer } = state.waitingForClaim;
    if (!tile) return;

    // Remove claimed tile from discardHistory before updating state
    const newDiscardHistory = [...state.discardHistory];
    const histIdx = findLastMatchingIndex(state.discardHistory, t =>
      tile.category === 'suit' && t.category === 'suit' && t.suit === tile.suit && t.value === tile.value ||
      tile.category === 'honor' && t.category === 'honor' && t.type === tile.type
    );
    if (histIdx >= 0) {
      newDiscardHistory.splice(histIdx, 1);
    }

    const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand], melds: [...p.melds], discards: [...p.discards] }));

    // If winning, check tai threshold
      if (claimType === 'win') {
      const eastPlayerIdx = getDealerPlayerIndex(state);
      const isDiHu = state.discardHistory.length === 1 && tile && fromPlayer === eastPlayerIdx && playerIndex !== eastPlayerIdx;
      const isTWClaim = isThirteenWonders([...newPlayers[playerIndex].hand, tile], newPlayers[playerIndex].melds);
      const blockedDiscardWin = isBlockedDiscardWinByFullSuitWait(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds, tile);
      if (blockedDiscardWin && !isTWClaim) {
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: newDiscardHistory,
          waitingForClaim: { tile, fromPlayer, eligiblePlayers: state.waitingForClaim.eligiblePlayers },
        }, 'claim_win_rejected', `${describePlayer(state.players[playerIndex], playerIndex)} cannot win on ${tileDisplay(tile)}`, {
          playerIndex,
          fromPlayer,
          tile: tileDisplay(tile),
          reason: 'blocked by full-suit wait',
          isThirteenWonders: isTWClaim,
          blockedDiscardWin,
        });
        return;
      }
      const result = calculateTai(state, playerIndex, false, false, false, false, tile, false, isDiHu, false, false, isTWClaim);
      const isAutomaticWin = isAutomaticWinResult(result, { diHu: isDiHu, thirteenWonders: isTWClaim });
      const meetsThreshold = canWinWithTai(result, state.config.taiThreshold, false, isAutomaticWin);
      if (meetsThreshold) {
        const dealerIdx = getDealerPlayerIndex(state);
        const nextDealer = playerIndex !== dealerIdx ? getNextDealerPlayerIdBySeat(state.players, dealerIdx) : dealerIdx;
        const winningTiles = [...newPlayers[playerIndex].hand, tile];
        const settlement = settleRoundChips(newPlayers, state.config, playerIndex, result.totalTai, fromPlayer, getSpecialHandPayoutTai(result, state.config));
        set({
          phase: 'finished',
          winner: playerIndex,
          winningTiles,
          winningDiscardPlayer: fromPlayer,
          winMethod: isTWClaim ? 'thirteen_wonders' : 'discard',
          players: settlement.players,
          discardHistory: newDiscardHistory,
          nextDealerPlayerId: playerIndex !== dealerIdx ? nextDealer : null,
          dealerPlayerId: dealerIdx,
          chipSettlement: settlement.summary,
          lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} wins on ${tileDisplay(tile)}!`,
          moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} wins on ${tileDisplay(tile)}!`),
          message: `${describePlayer(state.players[playerIndex], playerIndex)} wins! (${result.totalTai} tai)`,
        });
        trackGameEvent('round_finished', {
          win_method: isTWClaim ? 'thirteen_wonders' : 'discard',
          winner_index: playerIndex,
          from_player: fromPlayer,
          tile: tileDisplay(tile),
          tai: result.totalTai,
          is_multiplayer: state.isMultiplayer,
          is_host: state.isHost,
        });
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: newDiscardHistory,
          waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
        }, 'claim_win', `${describePlayer(state.players[playerIndex], playerIndex)} won on ${tileDisplay(tile)}`, {
          playerIndex,
          fromPlayer,
          tile: tileDisplay(tile),
          isDiHu,
          isThirteenWonders: isTWClaim,
          isAutomaticWin,
          tai: result.totalTai,
          breakdown: result.breakdown,
          winningTiles: winningTiles.map(tileDisplay),
        });
        return;
      } else {
        const winReason = getHandWinDebugReason({
          winningShape: true,
          blockedByFullSuitWait: false,
          winAllowedByTai: meetsThreshold,
          isAutomaticWin,
          thresholdTai: state.config.taiThreshold,
          resultTai: result.totalTai,
        });
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: newDiscardHistory,
          waitingForClaim: { tile, fromPlayer, eligiblePlayers: state.waitingForClaim.eligiblePlayers },
        }, 'claim_win_rejected', `${describePlayer(state.players[playerIndex], playerIndex)} cannot win on ${tileDisplay(tile)}`, {
          playerIndex,
          fromPlayer,
          tile: tileDisplay(tile),
          isDiHu,
          isThirteenWonders: isTWClaim,
          isAutomaticWin,
          meetsThreshold,
          reason: winReason,
          tai: result.totalTai,
          breakdown: result.breakdown,
        });
      }
    }

    // For non-win claims, remove the discard from the discard pile and add to melds
    const discardPile = newPlayers[fromPlayer].discards;
    const discardIdx = findLastMatchingIndex(discardPile, t =>
      tile.category === 'suit' && t.category === 'suit' && t.suit === tile.suit && t.value === tile.value ||
      tile.category === 'honor' && t.category === 'honor' && t.type === tile.type
    );
    if (discardIdx >= 0) {
      discardPile.splice(discardIdx, 1);
    }

    // Add to melds
    const playerHand = newPlayers[playerIndex].hand;

    // Qiang Kang (Snatch Kang): Thirteen Wonders snatches a tile from a Kong declaration
    if (claimType === 'kong' && tile) {
      for (let p = 0; p < newPlayers.length; p++) {
        if (p === playerIndex) continue;
        if (isThirteenWonders([...newPlayers[p].hand, tile], newPlayers[p].melds)) {
          const qkResult = calculateTai(state, p, false, false, false, false, tile, false, false, false, true);
          const dealerIdx = getDealerPlayerIndex(state);
          const settlement = settleRoundChips(state.players.map(pl => ({ ...pl, hand: [...pl.hand], melds: [...pl.melds] })), state.config, p, qkResult.totalTai, fromPlayer, getSpecialHandPayoutTai(qkResult, state.config));
          set({
          phase: 'finished',
          winner: p,
          winningTiles: [...state.players[p].hand, tile],
          winningDiscardPlayer: fromPlayer,
          winMethod: 'thirteen_wonders',
            players: settlement.players,
            discardHistory: newDiscardHistory,
            nextDealerPlayerId: p !== dealerIdx ? getNextDealerPlayerIdBySeat(state.players, dealerIdx) : null,
            dealerPlayerId: dealerIdx,
            chipSettlement: settlement.summary,
            waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
            lastAction: `Qiang Kang! ${describePlayer(state.players[p], p)} wins on ${tileDisplay(tile)}.`,
            moveHistory: appendMoveHistory(state.moveHistory, `Qiang Kang! ${describePlayer(state.players[p], p)} wins on ${tileDisplay(tile)}.`),
            message: `Qiang Kang! ${describePlayer(state.players[p], p)} wins by Thirteen Wonders! (${qkResult.totalTai} tai)`,
          });
          trackGameEvent('round_finished', {
            win_method: 'thirteen_wonders',
            winner_index: p,
            from_player: fromPlayer,
            tile: tileDisplay(tile),
            tai: qkResult.totalTai,
            is_multiplayer: state.isMultiplayer,
            is_host: state.isHost,
          });
          return;
        }
      }
    }

    if (claimType === 'pung' || claimType === 'kong') {
      // Find 2 (or 3 for kong) matching tiles in hand
      const matching: number[] = [];
      for (let i = 0; i < playerHand.length && matching.length < (claimType === 'kong' ? 3 : 2); i++) {
        const t = playerHand[i];
        if (tile.category === 'suit' && t.category === 'suit' && t.suit === tile.suit && t.value === tile.value) {
          matching.push(i);
        } else if (tile.category === 'honor' && t.category === 'honor' && t.type === tile.type) {
          matching.push(i);
        }
      }
      const meldTiles = [tile, ...matching.map(i => playerHand[i])];
      // Remove from hand (reverse order)
      for (let i = matching.length - 1; i >= 0; i--) {
        playerHand.splice(matching[i], 1);
      }
      newPlayers[playerIndex].melds.push({ type: claimType === 'kong' ? 'kong' : 'pung', tiles: meldTiles, fromPlayer });
    } else if (claimType === 'chi') {
      if (chiTiles && chiTiles.length > 0) {
        // Remove chi tiles from hand and create meld
        const chiHandTiles: Tile[] = [];
        for (const ct of chiTiles) {
          const idx = playerHand.findIndex(t => 
            t.category === ct.category && 
            (ct.category === 'suit' ? (t as any).suit === (ct as any).suit && (t as any).value === (ct as any).value :
             ct.category === 'honor' ? (t as any).type === (ct as any).type : false)
          );
          if (idx >= 0) {
            chiHandTiles.push(playerHand.splice(idx, 1)[0]);
          }
        }
        const meldTiles = [tile, ...chiHandTiles].sort((a: any, b: any) => (a.value || 0) - (b.value || 0));
        newPlayers[playerIndex].melds.push({ type: 'chi', tiles: meldTiles, fromPlayer });
      }
    }
    newPlayers[playerIndex].hand = sortHand(playerHand);
    const roundHadKong = state.roundHadKong || claimType === 'kong';

    // After kong, draw a replacement tile from the back of the wall.
    let kongWall = [...state.wall];
    let kongDraw: Tile | null = null;
    if (claimType === 'kong') {
      if (kongWall.length === 0) {
        const dealerIdx = getDealerPlayerIndex(state);
        const roundEnd = describeNoWinnerRoundEnd(true);
        set({
          players: newPlayers,
          currentPlayerIndex: playerIndex,
          winningDiscardPlayer: null,
          waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
          wall: kongWall,
          deadWall: [],
          phase: 'finished',
          discardHistory: newDiscardHistory,
          roundHadKong,
          nextDealerPlayerId: getNextDealerPlayerIdBySeat(state.players, dealerIdx),
          dealerPlayerId: dealerIdx,
          roundEndReason: roundEnd.roundEndReason,
          message: roundEnd.message,
          lastAction: roundEnd.lastAction,
          moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
          chipSettlement: null,
        });
        return;
      }

      while (kongWall.length > 0) {
        const replacement = drawFromBackOfWall(kongWall);
        kongWall = replacement.wall;
        kongDraw = replacement.tile;
        if (!kongDraw) {
          break;
        }
        if (isBonus(kongDraw)) {
          if (!newPlayers[playerIndex].bonusTiles) newPlayers[playerIndex].bonusTiles = [];
          newPlayers[playerIndex].bonusTiles.push(kongDraw);
          kongDraw = null;
          continue;
        }
        break;
      }

      if (!kongDraw) {
        const dealerIdx = getDealerPlayerIndex(state);
        const roundEnd = describeNoWinnerRoundEnd(true);
        set({
          players: newPlayers,
          currentPlayerIndex: playerIndex,
          winningDiscardPlayer: null,
          waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
          wall: kongWall,
          deadWall: [],
          phase: 'finished',
          discardHistory: newDiscardHistory,
          roundHadKong,
          nextDealerPlayerId: getNextDealerPlayerIdBySeat(state.players, dealerIdx),
          dealerPlayerId: dealerIdx,
          roundEndReason: roundEnd.roundEndReason,
          message: roundEnd.message,
          lastAction: roundEnd.lastAction,
          moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
          chipSettlement: null,
        });
        return;
      }

      newPlayers[playerIndex].hand.push(kongDraw);
      newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);
    }

    // Kang Shang: win on kong replacement tile
    if (claimType === 'kong' && isWinningHand(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds)) {
      const tempState = { ...state, players: newPlayers, wall: kongWall, deadWall: [], config: state.config };
      const result = calculateTai(tempState, playerIndex, true, false, false, true);
      const isAutomaticWin = isAutomaticWinResult(result);
        if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
            result.totalTai >= state.config.taiThreshold) {
          if (playerIndex === 0) {
            set({
              players: newPlayers,
              currentPlayerIndex: playerIndex,
              waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
              wall: kongWall,
              deadWall: [],
              discardHistory: newDiscardHistory,
              selfDrawWin: true,
              isKangShang: true,
              lastDrawnTile: kongDraw,
              lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} drew a kong replacement tile. (${describePlayer(state.players[playerIndex], playerIndex)}'s turn)`,
              moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} drew a kong replacement tile. (${describePlayer(state.players[playerIndex], playerIndex)}'s turn)`),
              message: `You can win! (Kang Shang) - ${result.totalTai} tai`,
              chipSettlement: null,
            });
            return;
          }
          const dealerIdx = getDealerPlayerIndex(state);
          const settlement = settleRoundChips(newPlayers, state.config, playerIndex, result.totalTai, null, getSpecialHandPayoutTai(result, state.config));
        set({
          phase: 'finished',
          winner: playerIndex,
          winningTiles: [...newPlayers[playerIndex].hand],
          winningDiscardPlayer: null,
          winMethod: 'kang_shang',
          players: settlement.players,
          currentPlayerIndex: playerIndex,
          waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
          wall: kongWall,
          deadWall: [],
          discardHistory: newDiscardHistory,
          selfDrawWin: false,
          roundHadKong,
          nextDealerPlayerId: playerIndex !== dealerIdx ? getNextDealerPlayerIdBySeat(state.players, dealerIdx) : null,
          dealerPlayerId: dealerIdx,
          isKangShang: true,
          chipSettlement: settlement.summary,
          lastDrawnTile: kongDraw,
          lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} wins by Kang Shang!`,
          moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} wins by Kang Shang!`),
          message: `${describePlayer(state.players[playerIndex], playerIndex)} wins by Kang Shang! (${result.totalTai} tai)`,
        });
        return;
      }
    }

    set({
      players: newPlayers,
      currentPlayerIndex: playerIndex,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
      wall: claimType === 'kong' ? kongWall : state.wall,
      deadWall: [],
      discardHistory: newDiscardHistory,
      roundHadKong,
      lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} claimed with ${claimType}!`,
      moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} claimed with ${claimType}!`),
      message: playerIndex === (get().myPlayerIndex || 0) ? 'Your turn to discard.' : `${describePlayer(state.players[playerIndex], playerIndex)} made a ${claimType}!`,
    });
    trackGameEvent('tile_claimed', {
      player_index: playerIndex,
      claim_type: claimType,
      from_player: fromPlayer,
      tile: tileDisplay(tile),
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });

    if (claimType === 'kong' && finishRoundOnWallExhaustion(set, state, newPlayers, kongWall, roundHadKong)) {
      return;
    }
    appendDebugLog(set, {
      ...state,
      players: newPlayers,
      wall: claimType === 'kong' ? kongWall : state.wall,
      deadWall: [],
      currentPlayerIndex: playerIndex,
      discardHistory: newDiscardHistory,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    }, 'claim_resolved', `${describePlayer(state.players[playerIndex], playerIndex)} claimed ${claimType}`, {
      playerIndex,
      fromPlayer,
      tile: tileDisplay(tile),
      claimType,
      chiTiles: chiTiles?.map(tileDisplay),
      resultingMelds: newPlayers[playerIndex].melds.map(meld => ({
        type: meld.type,
        tiles: meld.tiles.map(tileDisplay),
        fromPlayer: meld.fromPlayer,
      })),
    });

   // If AI claimed, auto-discard
    // Only auto-discard for pure AI players (isHuman === false)
    if (state.players[playerIndex] && !state.players[playerIndex].isHuman) {
     setTimeout(() => {
       const current = get();
       const hand = current.players[playerIndex].hand;
        const melds = current.players[playerIndex].melds;
        const discardIdx = chooseDiscard(hand, melds);
        if (discardIdx >= 0 && discardIdx < hand.length) {
          get().discardTile(playerIndex, discardIdx);
        }
      }, 500);
    }
  },

  passClaim: () => {
    const state = get();
    const { tile, fromPlayer } = state.waitingForClaim;

    set({
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    });
    trackGameEvent('claim_passed', {
      from_player: fromPlayer,
      tile: describeTile(tile),
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });

    const nextPlayer = getNextPlayer(state.players, fromPlayer);
    set({ currentPlayerIndex: nextPlayer });
    appendDebugLog(set, {
      ...state,
      currentPlayerIndex: nextPlayer,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    }, 'claim_pass', `${describePlayer(state.players[nextPlayer], nextPlayer)} turn after pass on ${describeTile(tile) || 'tile'}`, {
      fromPlayer,
      tile: describeTile(tile),
      nextPlayer,
      eligiblePlayers: state.waitingForClaim.eligiblePlayers,
    });
    get().drawTile(nextPlayer);
  },

  nextTurn: () => {
    const state = get();
    const nextPlayer = getNextPlayer(state.players, state.currentPlayerIndex);
    set({ currentPlayerIndex: nextPlayer });
    get().drawTile(nextPlayer);
  },

  selfKongAction: (playerIndex: number, meldIndex: number, handTileIndex: number) => {
    const state = get();
    if (state.phase !== 'playing') return;
    const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand], melds: p.melds.map(m => ({ ...m, tiles: [...m.tiles] })) }));
    const roundHadKong = true;

    // If meldIndex >= 0, upgrade an exposed pung to kong
    if (meldIndex >= 0 && meldIndex < newPlayers[playerIndex].melds.length) {
      const tile = newPlayers[playerIndex].hand.splice(handTileIndex, 1)[0];
      newPlayers[playerIndex].melds[meldIndex].tiles.push(tile);
      newPlayers[playerIndex].melds[meldIndex].type = 'kong';
    } else {
      const kongTile = newPlayers[playerIndex].hand[handTileIndex];
      if (!kongTile) return;
      const kongTiles: Tile[] = [];
      const matchingIndexes: number[] = [];
      for (let i = 0; i < newPlayers[playerIndex].hand.length; i++) {
        const t = newPlayers[playerIndex].hand[i];
        const matches =
          kongTile.category === 'suit' && t.category === 'suit' && t.suit === kongTile.suit && t.value === kongTile.value ||
          kongTile.category === 'honor' && t.category === 'honor' && t.type === kongTile.type;
        if (matches) {
          matchingIndexes.push(i);
          kongTiles.push(t);
        }
      }
      if (kongTiles.length !== 4) return;
      for (let i = matchingIndexes.length - 1; i >= 0; i--) {
        newPlayers[playerIndex].hand.splice(matchingIndexes[i], 1);
      }
      newPlayers[playerIndex].melds.push({ type: 'concealed-kong', tiles: kongTiles, fromPlayer: null });
    }

    let newWall = [...state.wall];
    let kongDraw: Tile | null = null;
    if (newWall.length === 0) {
      const roundEnd = describeNoWinnerRoundEnd(true);
      set({
        players: newPlayers,
        wall: newWall,
        deadWall: [],
        selfKongData: null,
        winningDiscardPlayer: null,
        currentPlayerIndex: playerIndex,
        lastAction: roundEnd.lastAction,
        moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
        message: roundEnd.message,
        phase: 'finished',
        roundHadKong,
        roundEndReason: roundEnd.roundEndReason,
        chipSettlement: null,
      });
      return;
    }

    while (newWall.length > 0) {
      const replacement = drawFromBackOfWall(newWall);
      newWall = replacement.wall;
      kongDraw = replacement.tile;
      if (!kongDraw) {
        break;
      }
      if (isBonus(kongDraw)) {
        if (!newPlayers[playerIndex].bonusTiles) newPlayers[playerIndex].bonusTiles = [];
        newPlayers[playerIndex].bonusTiles.push(kongDraw);
        kongDraw = null;
        continue;
      }
      break;
    }

    if (!kongDraw) {
      const roundEnd = describeNoWinnerRoundEnd(true);
      set({
        players: newPlayers,
        wall: newWall,
        deadWall: [],
        selfKongData: null,
        winningDiscardPlayer: null,
        currentPlayerIndex: playerIndex,
        lastAction: roundEnd.lastAction,
        moveHistory: appendMoveHistory(state.moveHistory, roundEnd.lastAction),
        message: roundEnd.message,
        phase: 'finished',
        roundHadKong,
        roundEndReason: roundEnd.roundEndReason,
        chipSettlement: null,
      });
      return;
    }

    newPlayers[playerIndex].hand.push(kongDraw);
    newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);

    // Kang Shang: check if replacement tile gives a win
    if (isWinningHand(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds)) {
      const tempState = { ...state, players: newPlayers, wall: newWall, deadWall: [] };
      const result = calculateTai(tempState, playerIndex, true, false, false, true);
      const isAutomaticWin = isAutomaticWinResult(result);
      if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
          result.totalTai >= state.config.taiThreshold) {
        const dealerIdx = getDealerPlayerIndex(state);
        const settlement = settleRoundChips(newPlayers, state.config, playerIndex, result.totalTai, null, getSpecialHandPayoutTai(result, state.config));
        set({
          phase: 'finished', winner: playerIndex, winningTiles: [...newPlayers[playerIndex].hand], winningDiscardPlayer: null, lastDrawnTile: kongDraw,
          players: settlement.players, wall: newWall, deadWall: [], selfKongData: null, winMethod: 'kang_shang',
          roundHadKong,
          nextRoundCountdown: null,
          dealerPlayerId: dealerIdx,
          chipSettlement: settlement.summary,
          lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} wins by Kang Shang!`,
          moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} wins by Kang Shang!`),
          message: `${describePlayer(state.players[playerIndex], playerIndex)} wins by Kang Shang! (${result.totalTai} tai)`,
        });
        return;
      }
    }

    set({
      players: newPlayers,
      wall: newWall,
      deadWall: [],
      selfKongData: null,
      winningDiscardPlayer: null,
      currentPlayerIndex: playerIndex,
      lastDrawnTile: kongDraw,
      lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} declared a kong!`,
      moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} declared a kong!`),
      message: playerIndex === (get().myPlayerIndex || 0) ? 'Your turn to discard.' : `${describePlayer(state.players[playerIndex], playerIndex)} made a kong!`,
      roundHadKong,
    });

    if (finishRoundOnWallExhaustion(set, state, newPlayers, newWall, roundHadKong)) {
      return;
    }
  },

  concealedKongAction: (playerIndex: number, tileIndex: number) => {
    get().selfKongAction(playerIndex, -1, tileIndex);
  },

  passSelfKong: () => {
    const state = get();
    if (finishRoundOnWallExhaustion(set, state, state.players, state.wall, Boolean(state.roundHadKong))) {
      return;
    }
    set({ selfKongData: null });
  },

  selfDrawWinAction: (playerIndex: number) => {
    const state = get();
    if (state.phase !== 'playing') return;

      const result = calculateTai(state, playerIndex, true, false, state.isHuaShang, state.isKangShang, undefined, false, false, state.isMenHu, state.isTW);
    const isAutomaticWin = isAutomaticWinResult(result, { menHu: state.isMenHu, thirteenWonders: state.isTW });
    if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
        result.totalTai >= state.config.taiThreshold) {
      const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand], melds: [...p.melds] }));
      const dealerIdx = getDealerPlayerIndex(state);
      const settlement = settleRoundChips(newPlayers, state.config, playerIndex, result.totalTai, null, getSpecialHandPayoutTai(result, state.config));
      set({
        phase: 'finished',
        winner: playerIndex,
        winningTiles: [...newPlayers[playerIndex].hand],
        winningDiscardPlayer: null,
        lastDrawnTile: state.lastDrawnTile,
        winMethod: state.isTW ? 'thirteen_wonders' : state.isMenHu ? 'men_hu' : state.isHuaShang ? 'hua_shang' : state.isKangShang ? 'kang_shang' : 'self_draw',
        players: settlement.players,
        selfDrawWin: false,
        isHuaShang: false,
        isKangShang: false,
       isMenHu: false,
       isTW: false,
        nextDealerPlayerId: playerIndex !== dealerIdx ? getNextDealerPlayerIdBySeat(state.players, dealerIdx) : null,
        dealerPlayerId: dealerIdx,
        nextRoundCountdown: null,
        chipSettlement: settlement.summary,
        lastAction: `${describePlayer(state.players[playerIndex], playerIndex)} wins by ${state.isTW ? 'Thirteen Wonders' : state.isMenHu ? 'Men Hu' : state.isHuaShang ? 'Hua Shang' : state.isKangShang ? 'Kang Shang' : 'self-draw'}!`,
        moveHistory: appendMoveHistory(state.moveHistory, `${describePlayer(state.players[playerIndex], playerIndex)} wins by ${state.isTW ? 'Thirteen Wonders' : state.isMenHu ? 'Men Hu' : state.isHuaShang ? 'Hua Shang' : state.isKangShang ? 'Kang Shang' : 'self-draw'}!`),
        message: `${describePlayer(state.players[playerIndex], playerIndex)} wins by ${state.isTW ? 'Thirteen Wonders' : state.isMenHu ? 'Men Hu' : state.isHuaShang ? 'Hua Shang' : state.isKangShang ? 'Kang Shang' : 'self-draw'}! (${result.totalTai} tai)`,
        });
          trackGameEvent('round_finished', {
            win_method: state.isTW ? 'thirteen_wonders' : state.isMenHu ? 'men_hu' : state.isHuaShang ? 'hua_shang' : state.isKangShang ? 'kang_shang' : 'self_draw',
            winner_index: playerIndex,
            tai: result.totalTai,
            is_multiplayer: state.isMultiplayer,
            is_host: state.isHost,
          });
    appendDebugLog(set, {
      ...state,
      players: newPlayers,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    }, 'self_draw_win', `${describePlayer(state.players[playerIndex], playerIndex)} committed self-draw win`, {
      playerIndex,
      tai: result.totalTai,
      breakdown: result.breakdown,
      winMethod: state.isTW ? 'thirteen_wonders' : state.isMenHu ? 'men_hu' : state.isHuaShang ? 'hua_shang' : state.isKangShang ? 'kang_shang' : 'self_draw',
      isAutomaticWin,
    });
    } else {
      appendDebugLog(set, state, 'self_draw_win_rejected', `${describePlayer(state.players[playerIndex], playerIndex)} cannot self-draw win`, {
        playerIndex,
        tai: result.totalTai,
        breakdown: result.breakdown,
        winMethod: state.isTW ? 'thirteen_wonders' : state.isMenHu ? 'men_hu' : state.isHuaShang ? 'hua_shang' : state.isKangShang ? 'kang_shang' : 'self_draw',
        isAutomaticWin,
        reason: getHandWinDebugReason({
          winningShape: isWinningHand(state.players[playerIndex].hand, state.players[playerIndex].melds),
          blockedByFullSuitWait: false,
          winAllowedByTai: false,
          isAutomaticWin,
          thresholdTai: state.config.taiThreshold,
          resultTai: result.totalTai,
        }),
      });
    }
    trackGameEvent('self_draw_win_declined', {
      player_index: playerIndex,
      tai: result.totalTai,
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });
  },

  passSelfDrawWin: () => {
    const state = get();
    appendDebugLog(set, state, 'self_draw_pass', `${describePlayer(state.players[state.currentPlayerIndex], state.currentPlayerIndex)} passed self-draw win`, {
      playerIndex: state.currentPlayerIndex,
    });
    if (finishRoundOnWallExhaustion(set, state, state.players, state.wall, Boolean(state.roundHadKong))) {
      return;
    }
    set({ selfDrawWin: false, message: 'Your turn to discard.' });
  },

  applyRemoteAction: (playerIndex: number, actionType: string, data: any) => {
    const state = get();
    if (state.phase !== 'playing' || !state.isMultiplayer) return;
    set({ waitingForRemoteAction: false });
    switch (actionType) {
      case 'discard': {
        const tileIndex = data.tileIndex;
        if (tileIndex >= 0 && tileIndex < (state.players[playerIndex]?.hand || []).length) {
          get().discardTile(playerIndex, tileIndex);
        }
        break;
      }
      case 'self_draw_win': {
        get().selfDrawWinAction(playerIndex);
        break;
      }
     case 'pass_self_draw': {
       get().passSelfDrawWin();
       break;
     }
      case 'win':
      case 'kong':
      case 'pung':
      case 'chi': {
        get().claimTile(playerIndex, actionType, data?.chiTiles);
        break;
      }
      case 'pass_claim': {
        get().passClaim();
        break;
      }
      case 'self_kong': {
        get().selfKongAction(playerIndex, data.meldIndex, data.handTileIndex);
        break;
      }
      case 'concealed_kong': {
        get().concealedKongAction(playerIndex, data.tileIndex);
        break;
      }
      case 'pass_self_kong': {
        get().passSelfKong();
        break;
      }
    }
  },

 reset: () => {
   const nextId = get().nextDealerPlayerId;
    const prevDealerCount = get().dealerCount || 0;
    const prevRoundWind = get().roundWind || 'east';
  set({ ...INITIAL_STATE, showConfig: true, selfDrawWin: false, isHuaShang: false, isKangShang: false, isMenHu: false, isTW: false, nextDealerPlayerId: nextId, dealerCount: prevDealerCount, roundWind: prevRoundWind, selfKongData: null, waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] }, message: 'Configure and start a new game!' });
  },
});

export const createGameStore = () => createStore<GameStore>(createGameStoreState);
export const useGameStore = create<GameStore>(createGameStoreState);

function handleAIClaims(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
  eligible: { playerIndex: number; actions: string[] }[],
  tile: Tile,
  fromPlayer: number,
) {
  // Priority: Win > Kong > Pung > Chi
  // Within same priority, closest clockwise from discarder has priority
  // Process all AI claims in one batch with correct ordering
  setTimeout(() => {
    const state = get();
    if (state.waitingForClaim.tile !== tile) return;

    const playerCount = state.players.length;
    // Build clockwise order starting from the player AFTER the discarder
    const orderedPlayers: number[] = [];
    for (let offset = 1; offset < playerCount; offset++) {
      orderedPlayers.push((fromPlayer + offset) % playerCount);
    }

    // Check each priority level: Win > Kong > Pung
    for (const actionType of ['win', 'kong', 'pung']) {
      for (const pIdx of orderedPlayers) {
        const found = eligible.find(e => e.playerIndex === pIdx && e.actions.includes(actionType));
        if (found && state.players[found.playerIndex]) {
          if (state.players[found.playerIndex].isHuman) return; // Human decides — stop AI processing
          get().claimTile(found.playerIndex, actionType as any);
          return;
        }
      }
    }

    // Chi: only the next player clockwise from discarder
    const nextPlayer = getNextPlayer(state.players, fromPlayer);
    const chiFound = eligible.find(e => e.playerIndex === nextPlayer && e.actions.includes('chi'));
    if (chiFound && state.players[chiFound.playerIndex]) {
      if (state.players[chiFound.playerIndex].isHuman) return; // Human decides
      const t = state.waitingForClaim.tile;
      if (t && t.category === 'suit') {
        const suit = t.suit;
        const val = t.value;
        const handSuit = state.players[chiFound.playerIndex].hand.filter((ht: any) => ht.category === 'suit' && ht.suit === suit);
        for (let v1 = Math.max(1, val - 2); v1 <= Math.min(val, 7); v1++) {
          const needed = [v1, v1 + 1, v1 + 2].filter(v => v !== val);
          const chiTiles: any[] = [];
          for (const nv of needed) {
            const found = handSuit.find((ht: any) => ht.value === nv);
            if (found) chiTiles.push(found);
          }
          if (chiTiles.length === needed.length) {
            get().claimTile(chiFound.playerIndex, 'chi', chiTiles);
            return;
          }
        }
      }
    }
  }, 200);

}
