import { create } from 'zustand';
import type { GameState, GameConfig, Tile, Meld, Player, Wind, DebugLogEntry } from '../types/mahjong';
import { buildDeck, shuffleDeck, sortHand, isFei, isBonus, tileDisplay } from '../game/tiles';
import { checkWin, calculateTai, canChi, canPung, canKong, canSelfKong, canUpgradePungToKong, hasValidTai, isThirteenWonders, isAutomaticWinResult, isBlockedDiscardWinByFullSuitWait } from '../game/rules';
import { chooseDiscard } from '../game/ai';
import { track } from '../utils/analytics';

// Helper: find next player clockwise by seat wind (not by index)
function getNextPlayer(players: any[], currentIdx: number): number {
  const order = ['east', 'south', 'west', 'north'];
  const curWind = players[currentIdx]?.seatWind || 'east';
  const nextWind = order[(order.indexOf(curWind) + 1) % 4];
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
const MAX_DEBUG_LOGS = 200;
const MAX_MOVE_HISTORY = 300;

interface GameStore extends GameState {
  // Actions
  startGame: (config: GameConfig, humanWind?: Wind) => void;
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
  applyRemoteAction: (playerIndex: number, actionType: string, data: any) => void;
  clearDebugLogs: () => void;
}

interface DebugStateSource {
  players: Player[];
  wall: Tile[];
  currentPlayerIndex: number;
  roundWind: Wind;
  discardHistory: Tile[];
  waitingForClaim?: GameStore['waitingForClaim'];
}

type GameStoreSetter = (
  partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>),
  replace?: boolean,
) => void;

function describeTile(tile: Tile | null | undefined): string | null {
  return tile ? tileDisplay(tile) : null;
}

function snapshotPlayers(players: Player[]) {
  return players.map((player, playerIndex) => ({
    playerIndex,
    name: player.name,
    seatWind: player.seatWind,
    hand: player.hand.map(tileDisplay),
    bonusTiles: (player.bonusTiles || []).map(tileDisplay),
    melds: player.melds.map(meld => ({
      type: meld.type,
      tiles: meld.tiles.map(tileDisplay),
      fromPlayer: meld.fromPlayer,
    })),
    discards: player.discards.map(tileDisplay),
  }));
}

function buildDebugEntry(
  state: DebugStateSource,
  type: string,
  message: string,
  details?: Record<string, unknown>,
): DebugLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    type,
    message,
    currentPlayerIndex: state.currentPlayerIndex,
    roundWind: state.roundWind,
    wallCount: state.wall.length,
    snapshot: {
      players: snapshotPlayers(state.players),
      discardHistory: state.discardHistory.map(tileDisplay),
      waitingForClaim: state.waitingForClaim
        ? {
            tile: describeTile(state.waitingForClaim.tile),
            fromPlayer: state.waitingForClaim.fromPlayer,
            eligiblePlayers: state.waitingForClaim.eligiblePlayers.map(entry => ({
              playerIndex: entry.playerIndex,
              actions: [...entry.actions],
            })),
          }
        : undefined,
    },
    details,
  };
}

function appendDebugLog(
  set: GameStoreSetter,
  sourceState: DebugStateSource,
  type: string,
  message: string,
  details?: Record<string, unknown>,
) {
  set(state => ({
    debugLogs: [...state.debugLogs, buildDebugEntry(sourceState, type, message, details)].slice(-MAX_DEBUG_LOGS),
  }));
}

function appendMoveHistory(history: string[], entry: string): string[] {
  return [...history, entry].slice(-MAX_MOVE_HISTORY);
}

function trackGameEvent(event: string, properties: Record<string, unknown>) {
  track(event, properties);
}

function getWinEvalReason(
  canWin: boolean,
  isAutomaticWin: boolean,
  meetsThreshold: boolean,
  resultTai: number,
  threshold: number,
): string {
  if (!canWin) return 'No valid winning hand shape';
  if (isAutomaticWin || meetsThreshold) return 'Meets win conditions';
  return `Below tai threshold (${resultTai}/${threshold})`;
}

function meetsDiscardWinThreshold(resultTai: number, threshold: number): boolean {
  return resultTai >= threshold + 1;
}

function getDealerPlayerIndex(state: { players: Player[]; dealerPlayerId?: number | null }): number {
  if (typeof state.dealerPlayerId === 'number' && state.dealerPlayerId >= 0) {
    return state.dealerPlayerId;
  }
  return state.players.findIndex(p => p.seatWind === 'east');
}

const INITIAL_STATE: GameState = {
  players: [],
  wall: [],
  deadWall: [],
  currentPlayerIndex: 0,
  phase: 'setup',
  roundWind: 'east',
  config: { taiThreshold: 4, unlimitedTai: false, feiCount: 4, startingChips: null, shooterEnabled: false, economyEnabled: false, chipSettlementMode: 'default' },
  lastAction: '',
  winner: null,
  winningTiles: [],
  lastDrawnTile: null,
  winMethod: null,
  discardHistory: [],
  moveHistory: [],
  hostDisconnected: false,
  playerLeft: null,
  diceResults: null,
  nextRoundCountdown: null,
  dealerPlayerId: null,
  debugLogs: [],
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...INITIAL_STATE,
  showConfig: true,
  selfDrawWin: false,
  selfKongData: null,
  dealerCount: 0,
  isMultiplayer: false,
  isHost: false,
  myPlayerIndex: 0,
  waitingForRemoteAction: false,
  clearDebugLogs: () => set({ debugLogs: [] }),
 isHuaShang: false,
 isKangShang: false,
 isMenHu: false,
 isTW: false,
 nextDealerPlayerId: null,
 dealerPlayerId: null,
  waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
  message: 'Configure and start a new game!',
  setMessage: (msg) => set({ message: msg }),
  setShowConfig: (show) => set({ showConfig: show }),
  setWaitingForClaim: (tile, fromPlayer) => set({ waitingForClaim: { tile, fromPlayer, eligiblePlayers: [] } }),

  startGame: (config: GameConfig, humanWind?: Wind) => {
    const deck = shuffleDeck(buildDeck(config));

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
            selfKongData: null,
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
      ? existingPlayers.map(p => p.seatWind)
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
          seatWind: initialSeatWinds[idx],
        }))
      : [
          { id: 0, name: "You", isHuman: true, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[0], isAlive: true, bonusTiles: [] },
          { id: 1, name: "Sakura", isHuman: false, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[1], isAlive: true, bonusTiles: [] },
          { id: 2, name: "Mei Lin", isHuman: false, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[2], isAlive: true, bonusTiles: [] },
          { id: 3, name: "Kenji", isHuman: false, hand: [], melds: [], discards: [], seatWind: initialSeatWinds[3], isAlive: true, bonusTiles: [] },
        ];

    const players: Player[] = basePlayers.map(p => ({
      ...p,
      hand: [],
      melds: [],
      discards: [],
      bonusTiles: [],
      isAlive: true,
    }));

    // Deal: 13 tiles to each player (dealer gets 14)
    let wallIdx = 0;
    for (let round = 0; round < 3; round++) {
      for (let p = 0; p < 4; p++) {
        for (let i = 0; i < 4; i++) {
          players[p].hand.push(deck[wallIdx++]);
        }
      }
    }
   // 1 more tile to each player
   for (let p = 0; p < 4; p++) {
     players[p].hand.push(deck[wallIdx++]);
   }
    // East player (the dealer) gets 1 more tile
    const eastPlayerIndex = state.nextDealerPlayerId !== null && players[state.nextDealerPlayerId]
      ? state.nextDealerPlayerId
      : players.findIndex(p => p.seatWind === 'east');
    players[eastPlayerIndex].hand.push(deck[wallIdx++]);

   // Sort hands
   for (const p of players) {
      p.hand = sortHand(p.hand);
    }

    // Reveal bonus tiles (flowers, seasons, animals) and draw replacements
    // Clockwise order starting from East
    const eastPlayerIdx = eastPlayerIndex;
    for (let offset = 0; offset < 4; offset++) {
      const p = players[(eastPlayerIdx + offset) % 4];
      while (true) {
        const bonusIdx = p.hand.findIndex(t => isBonus(t));
        if (bonusIdx === -1) break;
        const bonusTile = p.hand.splice(bonusIdx, 1)[0];
        if (!p.bonusTiles) p.bonusTiles = [];
        p.bonusTiles.push(bonusTile);
        // Draw replacement from wall (clockwise from East)
        if (wallIdx < deck.length) {
          p.hand.push(deck[wallIdx++]);
        }
      }
      p.hand = sortHand(p.hand);
    }

    const remainingWall = deck.slice(wallIdx);

    // Check for Tian Hu (天胡): dealer wins with opening hand after replacements
    if (checkWin(players[eastPlayerIndex].hand, players[eastPlayerIndex].melds)) {
      const tempState = { players, config, roundWind } as GameState;
      const result = calculateTai(tempState, eastPlayerIndex, false, false, false, false, undefined, true);
      set({
          nextDealerPlayerId: null,
          dealerPlayerId: eastPlayerIndex,
          selfKongData: null,
          dealerCount: 0,
          debugLogs: [],
          isMultiplayer: false,
          isHost: false,
          myPlayerIndex: 0,
          waitingForRemoteAction: false,
          players,
          wall: remainingWall,
          deadWall: [],
          phase: 'finished',
          winner: eastPlayerIndex,
          winningTiles: [...players[eastPlayerIndex].hand],
          lastDrawnTile: null,
          winMethod: 'tian_hu',
          nextRoundCountdown: null,
          showConfig: false,
          message: `Tian Hu! ${players[eastPlayerIndex].name} wins with the opening hand! (${result.totalTai} tai)`,
          lastAction: `Tian Hu! ${players[eastPlayerIndex].name} wins with the opening hand!`,
          moveHistory: appendMoveHistory([], `Tian Hu! ${players[eastPlayerIndex].name} wins with the opening hand!`),
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
        currentPlayerIndex: eastPlayerIndex,
        roundWind: 'east',
        discardHistory: [],
        waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
      }, 'start_game_auto_win', `Tian Hu detected for ${players[eastPlayerIndex].name}`, {
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
      currentPlayerIndex: eastPlayerIndex,
     phase: 'playing',
     roundWind,
     dealerCount,
     config,
     lastDrawnTile: null,
      lastAction: `Game started! ${players[eastPlayerIndex].name} (East) discards first.`,
     moveHistory: appendMoveHistory([], `Game started! ${players[eastPlayerIndex].name} (East) discards first.`),
     winner: null,
     winningTiles: [],
     nextRoundCountdown: null,
     showConfig: false,
     waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
     message: players[eastPlayerIndex].name + ' (East) discards first.',
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

  drawTile: (playerIndex: number, isBonusReplacement: boolean = false) => {
    const state = get();
    if (state.phase !== 'playing') return;
    if (state.wall.length === 0) {
      const dealerIdx = getDealerPlayerIndex(state);
      set({ phase: 'finished', message: 'Draw game! The wall is empty.', nextDealerPlayerId: (dealerIdx + 1) % 4, dealerPlayerId: dealerIdx });
      return;
    }

    const newPlayers = state.players.map(p => ({ ...p, hand: [...p.hand] }));
    const newWall = [...state.wall];
    const drawnTile = newWall.pop()!;

    newPlayers[playerIndex].hand.push(drawnTile);
    newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);
    appendDebugLog(set, {
      ...state,
      players: newPlayers,
      wall: newWall,
    }, 'draw_tile', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew ${tileDisplay(drawnTile)}`, {
      playerIndex,
      tile: tileDisplay(drawnTile),
      isBonusReplacement,
    });

    // If a bonus tile is drawn, draw a replacement
    // If a bonus tile is drawn, reveal it and draw a replacement
    if (isBonus(drawnTile)) {
      // Qi Qiang Yi (七搶一): another player has 7+ flowers/seasons — transfer and win
      let qqyWinner: number | null = null;
      for (let p = 0; p < newPlayers.length; p++) {
        if (p === playerIndex) continue;
        if ((newPlayers[p].bonusTiles || []).length >= 7) {
          qqyWinner = p;
          break;
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
      set({
        players: newPlayers,
        wall: newWall,
        phase: 'finished',
        winner: qqyWinner,
        winningTiles: [],
        lastDrawnTile: null,
        winMethod: 'qi_qiang_yi',
        nextRoundCountdown: null,
          showConfig: false,
          lastAction: `Qi Qiang Yi! ${state.players[qqyWinner].name} wins with all 8 flowers/seasons!`,
          moveHistory: appendMoveHistory(state.moveHistory, `Qi Qiang Yi! ${state.players[qqyWinner].name} wins with all 8 flowers/seasons!`),
          message: `Qi Qiang Yi! ${state.players[qqyWinner].name} wins with all 8 flowers/seasons! (${qqyResult.totalTai} tai)`,
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
        if (newPlayers[playerIndex].bonusTiles.length >= 8) {
          const hhResult = calculateTai({ ...state, players: newPlayers } as GameState, playerIndex, false, false, false, false, undefined, false, false, false, false, false, true);
      set({
            players: newPlayers,
            wall: newWall,
            phase: 'finished',
            winner: playerIndex,
            winningTiles: [],
            lastDrawnTile: null,
            winMethod: 'hua_hu',
            nextRoundCountdown: null,
            showConfig: false,
            lastAction: `Hua Hu! ${state.players[playerIndex].name} wins with all 8 flowers/seasons!`,
            moveHistory: appendMoveHistory(state.moveHistory, `Hua Hu! ${state.players[playerIndex].name} wins with all 8 flowers/seasons!`),
            message: `Hua Hu! ${state.players[playerIndex].name} wins with all 8 flowers/seasons! (${hhResult.totalTai} tai)`,
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

      // Draw replacement tile
      if (newWall.length > 0) {
        const replacement = newWall.pop()!;
        newPlayers[playerIndex].hand.push(replacement);
        newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);

        isBonusReplacement = true;

        // If replacement is also bonus, recursively handle it
        if (isBonus(replacement)) {
          set({ players: newPlayers, wall: newWall });
          get().drawTile(playerIndex, true);
          return;
        }
      }
    }

    // Check if player can self-kong
    const kongIdx = canSelfKong(newPlayers[playerIndex].hand);

    // Check for self-draw win (Zi Mo)
    const canWinSelf = checkWin(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds);
    const canWinTW = isThirteenWonders(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds);

    // Check for Men Hu (门胡): non-dealer wins on first drawn tile
    const dealerPlayerIdx = getDealerPlayerIndex(state);
    const isMenHu = playerIndex !== dealerPlayerIdx && state.discardHistory.length <= 1 && state.players[playerIndex].melds.length === 0;

    // For human: show Win/Pass buttons if self-draw possible
    const localPlayerIdx = get().myPlayerIndex || 0;
    if (playerIndex === localPlayerIdx && (canWinSelf || canWinTW)) {
      const tempState = { ...state, players: newPlayers, wall: newWall, config: state.config, waitingForClaim: state.waitingForClaim };
      const result = calculateTai(tempState, playerIndex, true, false, isBonusReplacement, false, undefined, false, false, isMenHu, canWinTW);
      const isAutomaticWin = isAutomaticWinResult(result, { menHu: isMenHu, thirteenWonders: canWinTW });
      appendDebugLog(set, tempState, 'self_draw_eval', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} self-draw evaluation`, {
        playerIndex,
        canWinSelf,
        canWinTW,
        isMenHu,
        isAutomaticWin,
        tai: result.totalTai,
        breakdown: result.breakdown,
      });
      if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
          result.totalTai >= state.config.taiThreshold) {
        set({
          players: newPlayers,
          wall: newWall,
          lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew a tile. (${state.players[playerIndex]?.name || 'Player ' + playerIndex}'s turn)`,
          moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew a tile. (${state.players[playerIndex]?.name || 'Player ' + playerIndex}'s turn)`),
          selfDrawWin: true,
          isHuaShang: isBonusReplacement,
          isMenHu: isMenHu,
          isTW: canWinTW,
          lastDrawnTile: drawnTile,
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
      selfKongData,
     selfDrawWin: false,
     isHuaShang: isBonusReplacement,
     isKangShang: false,
     isMenHu: isMenHu,
      isTW: canWinTW,
     lastDrawnTile: drawnTile,
     lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew a tile. (${state.players[playerIndex]?.name || 'Player ' + playerIndex}'s turn)`,
      moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew a tile. (${state.players[playerIndex]?.name || 'Player ' + playerIndex}'s turn)`),
      message: playerIndex === (get().myPlayerIndex || 0) ? 'Your turn to discard.' : `${state.players[playerIndex].name} is thinking...`,
    });
    trackGameEvent('tile_drawn', {
      player_index: playerIndex,
      tile: tileDisplay(drawnTile),
      is_bonus_replacement: isBonusReplacement,
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });

   // If AI drew, check self-draw win or auto-discard
    if (playerIndex !== 0) {
     if (canWinSelf || canWinTW) {
        const tempState = { ...state, players: newPlayers, wall: newWall, config: state.config, waitingForClaim: state.waitingForClaim };
        const result = calculateTai(tempState, playerIndex, true, false, isBonusReplacement, false, undefined, false, false, isMenHu, canWinTW);
        const isAutomaticWin = isAutomaticWinResult(result, { menHu: isMenHu, thirteenWonders: canWinTW });
        appendDebugLog(set, tempState, 'ai_self_draw_eval', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} AI self-draw evaluation`, {
          playerIndex,
          canWinSelf,
          canWinTW,
          isMenHu,
          isAutomaticWin,
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
      lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} discarded ${discardedTile.category === 'suit' ? discardedTile.suit + ' ' + discardedTile.value : discardedTile.category === 'honor' ? discardedTile.type : '?'}`,
      moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} discarded ${discardedTile.category === 'suit' ? discardedTile.suit + ' ' + discardedTile.value : discardedTile.category === 'honor' ? discardedTile.type : '?'}`),
      message: `Player ${playerIndex === (get().myPlayerIndex || 0) ? 'You' : state.players[playerIndex].name} discarded a tile.`,
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
    }, 'discard', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} discarded ${tileDisplay(discardedTile)}`, {
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
        message: `Thirteen Wonders! ${state.players[twWinner].name} wins from ${state.players[playerIndex].name}'s discard!`,
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
      const canDiscardWin = isTWClaim || (!blockedDiscardWin && checkWin([...playerHand, discardedTile], playerMelds));
      if (canDiscardWin) {
        const isDiHu = state.discardHistory.length === 0 && playerIndex === eastPlayerIdx && p !== eastPlayerIdx;
        const canWin = true;
        const result = calculateTai(state, p, false, false, false, false, discardedTile, false, isDiHu, false, false, isTWClaim);
        const isAutomaticWin = isAutomaticWinResult(result, { diHu: isDiHu, thirteenWonders: isTWClaim });
        const discardThreshold = state.config.taiThreshold + 1;
        const meetsThreshold = meetsDiscardWinThreshold(result.totalTai, state.config.taiThreshold);
        const winReason = getWinEvalReason(canWin, isAutomaticWin, meetsThreshold, result.totalTai, discardThreshold);
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: [...state.discardHistory, discardedTile],
        }, 'discard_win_eval', `${state.players[p]?.name || 'Player ' + p} evaluated win on ${tileDisplay(discardedTile)}`, {
          discardedBy: playerIndex,
          playerIndex: p,
          discard: tileDisplay(discardedTile),
          canWin: true,
          isDiHu,
          isThirteenWonders: isTWClaim,
          isAutomaticWin,
          meetsThreshold,
          reason: winReason,
          tai: result.totalTai,
          breakdown: result.breakdown,
        });
        if (isAutomaticWin || meetsThreshold) {
          actions.push('win');
        }
      } else {
        const winReason = blockedDiscardWin
          ? 'Full suit wait can only Zi Mo'
          : getWinEvalReason(false, false, false, 0, state.config.taiThreshold);
        appendDebugLog(set, {
          ...state,
          players: newPlayers,
          discardHistory: [...state.discardHistory, discardedTile],
        }, 'discard_win_eval', `${state.players[p]?.name || 'Player ' + p} cannot win on ${tileDisplay(discardedTile)}`, {
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
      const nextName = state.players[nextPlayer]?.name || 'Player ' + nextPlayer;
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
      if (blockedDiscardWin && !isTWClaim) return;
      const result = calculateTai(state, playerIndex, false, false, false, false, tile, false, isDiHu, false, false, isTWClaim);
      const isAutomaticWin = isAutomaticWinResult(result, { diHu: isDiHu, thirteenWonders: isTWClaim });
      if (isAutomaticWin || meetsDiscardWinThreshold(result.totalTai, state.config.taiThreshold) || state.config.unlimitedTai && meetsDiscardWinThreshold(result.totalTai, state.config.taiThreshold)) {
        const dealerIdx = getDealerPlayerIndex(state);
        const nextDealer = playerIndex !== dealerIdx ? (dealerIdx + 1) % 4 : dealerIdx;
        const winningTiles = [...newPlayers[playerIndex].hand, tile];
        set({
          phase: 'finished',
          winner: playerIndex,
          winningTiles,
          winMethod: 'discard',
          players: newPlayers,
          discardHistory: newDiscardHistory,
          nextDealerPlayerId: playerIndex !== dealerIdx ? nextDealer : null,
          dealerPlayerId: dealerIdx,
          lastAction: `${state.players[playerIndex].name} wins on ${tileDisplay(tile)}!`,
          moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex].name} wins on ${tileDisplay(tile)}!`),
          message: `${state.players[playerIndex].name} wins! (${result.totalTai} tai)`,
        });
        trackGameEvent('round_finished', {
          win_method: 'discard',
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
        }, 'claim_win', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} won on ${tileDisplay(tile)}`, {
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
          const qkResult = calculateTai(state, p, false, false, false, false, tile, false, false, false, false, true);
          const dealerIdx = getDealerPlayerIndex(state);
          const nextDealer = p !== dealerIdx ? (dealerIdx + 1) % 4 : dealerIdx;
          set({
            phase: 'finished',
            winner: p,
            winningTiles: [...state.players[p].hand, tile],
            winMethod: 'qiang_kang',
            players: state.players.map(pl => ({ ...pl, hand: [...pl.hand], melds: [...pl.melds] })),
            discardHistory: newDiscardHistory,
            nextDealerPlayerId: p !== dealerIdx ? nextDealer : null,
            dealerPlayerId: dealerIdx,
            waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
            lastAction: `Qiang Kang! ${state.players[p].name} wins on ${tileDisplay(tile)}.`,
            moveHistory: appendMoveHistory(state.moveHistory, `Qiang Kang! ${state.players[p].name} wins on ${tileDisplay(tile)}.`),
            message: `Qiang Kang! ${state.players[p].name} wins by Thirteen Wonders! (${qkResult.totalTai} tai)`,
          });
          trackGameEvent('round_finished', {
            win_method: 'qiang_kang',
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

    // After kong, draw a replacement tile from the back of the wall
    let kongWall = [...state.wall];
    if (claimType === 'kong' && kongWall.length > 0) {
      let kongDraw = kongWall.pop()!;
      while (isBonus(kongDraw)) {
        if (!newPlayers[playerIndex].bonusTiles) newPlayers[playerIndex].bonusTiles = [];
        newPlayers[playerIndex].bonusTiles.push(kongDraw);
        if (kongWall.length === 0) {
          const dealerIdx = getDealerPlayerIndex(state);
          set({
            players: newPlayers,
            currentPlayerIndex: playerIndex,
            waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
            wall: kongWall,
            phase: 'finished',
            discardHistory: newDiscardHistory,
            nextDealerPlayerId: (dealerIdx + 1) % 4,
            dealerPlayerId: dealerIdx,
            message: 'Draw game! The wall is empty.',
          });
          return;
        }
        kongDraw = kongWall.pop()!;
      }
      newPlayers[playerIndex].hand.push(kongDraw);
     newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);
   }

    // Kang Shang: win on kong replacement tile
    if (claimType === 'kong' && checkWin(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds)) {
      const tempState = { ...state, players: newPlayers, wall: kongWall, config: state.config };
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
            discardHistory: newDiscardHistory,
            selfDrawWin: true,
            isKangShang: true,
            lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew a kong replacement tile. (${state.players[playerIndex]?.name || 'Player ' + playerIndex}'s turn)`,
            moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} drew a kong replacement tile. (${state.players[playerIndex]?.name || 'Player ' + playerIndex}'s turn)`),
            message: `You can win! (Kang Shang) - ${result.totalTai} tai`,
          });
          return;
        }
        const dealerIdx = getDealerPlayerIndex(state);
        const nextDealer = playerIndex !== dealerIdx ? (dealerIdx + 1) % 4 : dealerIdx;
          set({
          phase: 'finished',
          winner: playerIndex,
          winningTiles: [...newPlayers[playerIndex].hand],
          winMethod: 'kang_shang',
          players: newPlayers,
          currentPlayerIndex: playerIndex,
          waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
          wall: kongWall,
          discardHistory: newDiscardHistory,
          selfDrawWin: false,
          nextDealerPlayerId: playerIndex !== dealerIdx ? nextDealer : null,
          dealerPlayerId: dealerIdx,
          isKangShang: true,
          lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by Kang Shang!`,
          moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by Kang Shang!`),
          message: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by Kang Shang! (${result.totalTai} tai)`,
        });
        return;
      }
    }

   set({
      players: newPlayers,
      currentPlayerIndex: playerIndex,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
      wall: claimType === 'kong' ? kongWall : state.wall,
      discardHistory: newDiscardHistory,
      lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} claimed with ${claimType}!`,
      moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} claimed with ${claimType}!`),
      message: playerIndex === (get().myPlayerIndex || 0) ? 'Your turn to discard.' : `${state.players[playerIndex].name} made a ${claimType}!`,
    });
    trackGameEvent('tile_claimed', {
      player_index: playerIndex,
      claim_type: claimType,
      from_player: fromPlayer,
      tile: tileDisplay(tile),
      is_multiplayer: state.isMultiplayer,
      is_host: state.isHost,
    });
    appendDebugLog(set, {
      ...state,
      players: newPlayers,
      wall: claimType === 'kong' ? kongWall : state.wall,
      currentPlayerIndex: playerIndex,
      discardHistory: newDiscardHistory,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    }, 'claim_resolved', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} claimed ${claimType}`, {
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
    }, 'claim_pass', `${state.players[nextPlayer]?.name || 'Player ' + nextPlayer} turn after pass on ${describeTile(tile) || 'tile'}`, {
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

    // If meldIndex >= 0, upgrade an exposed pung to kong
    if (meldIndex >= 0 && meldIndex < newPlayers[playerIndex].melds.length) {
      const tile = newPlayers[playerIndex].hand.splice(handTileIndex, 1)[0];
      newPlayers[playerIndex].melds[meldIndex].tiles.push(tile);
      newPlayers[playerIndex].melds[meldIndex].type = 'kong';
    }

    let newWall = [...state.wall];
    if (newWall.length > 0) {
      let kongDraw = newWall.pop()!;
      while (isBonus(kongDraw)) {
        if (!newPlayers[playerIndex].bonusTiles) newPlayers[playerIndex].bonusTiles = [];
        newPlayers[playerIndex].bonusTiles.push(kongDraw);
        if (newWall.length === 0) break;
        kongDraw = newWall.pop()!;
      }
      newPlayers[playerIndex].hand.push(kongDraw);
      newPlayers[playerIndex].hand = sortHand(newPlayers[playerIndex].hand);

      // Kang Shang: check if replacement tile gives a win
      if (checkWin(newPlayers[playerIndex].hand, newPlayers[playerIndex].melds)) {
        const tempState = { ...state, players: newPlayers, wall: newWall };
        const result = calculateTai(tempState, playerIndex, true, false, false, true);
        const isAutomaticWin = isAutomaticWinResult(result);
        if (isAutomaticWin || (state.config.unlimitedTai && result.totalTai >= state.config.taiThreshold) ||
            result.totalTai >= state.config.taiThreshold) {
          const dealerIdx = getDealerPlayerIndex(state);
          set({
            phase: 'finished', winner: playerIndex, winningTiles: [...newPlayers[playerIndex].hand], lastDrawnTile: kongDraw,
            players: newPlayers, wall: newWall, selfKongData: null, winMethod: 'kang_shang',
            nextRoundCountdown: null,
            dealerPlayerId: dealerIdx,
            lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by Kang Shang!`,
            moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by Kang Shang!`),
            message: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by Kang Shang! (${result.totalTai} tai)`,
          });
          return;
        }
      }
    }

    set({
      players: newPlayers,
      wall: newWall,
      selfKongData: null,
      currentPlayerIndex: playerIndex,
      lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} declared a kong!`,
      moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} declared a kong!`),
      message: playerIndex === (get().myPlayerIndex || 0) ? 'Your turn to discard.' : `${state.players[playerIndex].name} made a kong!`,
    });
  },

  concealedKongAction: (playerIndex: number, tileIndex: number) => {
    get().selfKongAction(playerIndex, -1, tileIndex);
  },

  passSelfKong: () => {
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
      const nextDealer = playerIndex !== dealerIdx ? (dealerIdx + 1) % 4 : dealerIdx;
      set({
        phase: 'finished',
        winner: playerIndex,
        winningTiles: [...newPlayers[playerIndex].hand],
        lastDrawnTile: state.lastDrawnTile,
        winMethod: state.isTW ? 'thirteen_wonders' : state.isMenHu ? 'men_hu' : state.isHuaShang ? 'hua_shang' : state.isKangShang ? 'kang_shang' : 'self_draw',
        players: newPlayers,
        selfDrawWin: false,
        isHuaShang: false,
        isKangShang: false,
       isMenHu: false,
        isTW: false,
        nextDealerPlayerId: playerIndex !== dealerIdx ? nextDealer : null,
        dealerPlayerId: dealerIdx,
        nextRoundCountdown: null,
        lastAction: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by ${state.isTW ? 'Thirteen Wonders' : state.isMenHu ? 'Men Hu' : state.isHuaShang ? 'Hua Shang' : state.isKangShang ? 'Kang Shang' : 'self-draw'}!`,
        moveHistory: appendMoveHistory(state.moveHistory, `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by ${state.isTW ? 'Thirteen Wonders' : state.isMenHu ? 'Men Hu' : state.isHuaShang ? 'Hua Shang' : state.isKangShang ? 'Kang Shang' : 'self-draw'}!`),
        message: `${state.players[playerIndex]?.name || 'Player ' + playerIndex} wins by ${state.isTW ? 'Thirteen Wonders' : state.isMenHu ? 'Men Hu' : state.isHuaShang ? 'Hua Shang' : state.isKangShang ? 'Kang Shang' : 'self-draw'}! (${result.totalTai} tai)`,
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
      }, 'self_draw_win', `${state.players[playerIndex]?.name || 'Player ' + playerIndex} committed self-draw win`, {
        playerIndex,
        tai: result.totalTai,
        breakdown: result.breakdown,
        winMethod: state.isTW ? 'thirteen_wonders' : state.isMenHu ? 'men_hu' : state.isHuaShang ? 'hua_shang' : state.isKangShang ? 'kang_shang' : 'self_draw',
        isAutomaticWin,
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
    appendDebugLog(set, state, 'self_draw_pass', `${state.players[state.currentPlayerIndex]?.name || 'Player ' + state.currentPlayerIndex} passed self-draw win`, {
      playerIndex: state.currentPlayerIndex,
    });
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
}));

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
