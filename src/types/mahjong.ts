import type { ChipSettlementSummary } from '../game/chips';

export type Suit = 'bamboo' | 'characters' | 'dots';
export type Wind = 'east' | 'south' | 'west' | 'north';
export type Dragon = 'hong' | 'fa' | 'baak';
export type BonusType = 'flower' | 'season' | 'animal';

export type TileCategory = 'suit' | 'wind' | 'dragon' | 'bonus' | 'fei';

export interface SuitTile {
  category: 'suit';
  suit: Suit;
  value: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface HonorTile {
  category: 'honor';
  type: Wind | Dragon;
}

export interface BonusTile {
  category: 'bonus';
  bonusType: BonusType;
  id: number; // 1-4 for flower/season, 1-4 for animal (cat=1, mouse=2, rooster=3, centipede=4)
}

export interface FeiTile {
  category: 'fei';
}

export type Tile = SuitTile | HonorTile | BonusTile | FeiTile;

export interface Meld {
  type: 'chi' | 'pung' | 'kong' | 'concealed-kong';
  tiles: Tile[];
  fromPlayer: number | null; // null for concealed / self-drawn kong
}

export type GamePhase = 'setup' | 'dealing' | 'playing' | 'finished';

export interface Player {
  id: number;
  name: string;
  isHuman: boolean;
  hand: Tile[];
  melds: Meld[];
  discards: Tile[];
  seatWind: Wind;
  chips?: number;
  isAlive: boolean; // false if they've won
  bonusTiles: Tile[]; // flowers, seasons, animals drawn by this player
}

export interface GameConfig {
  taiThreshold: number;
  unlimitedTai: boolean;
  feiCount: number; // 0, 4, 8, 12, 16, 20
  payoutTable: 'none' | '010_020' | '030_060' | '1_2';
  startingChips: number | null;
  shooterEnabled: boolean;
  maxTai?: number;
  specialTaiCapEnabled?: boolean;
  specialTaiCap?: number;
  economyEnabled: boolean;
  chipSettlementMode: 'default' | 'shooter';
}

export interface DebugPlayerSnapshot {
  playerIndex: number;
  name: string;
  isHuman: boolean;
  seatWind: Wind;
  hand: string[];
  bonusTiles: string[];
  melds: { type: Meld['type']; tiles: string[]; fromPlayer: number | null }[];
  discards: string[];
}

export interface DebugLogEntry {
  id: string;
  ts: string;
  type: string;
  message: string;
  currentPlayerIndex: number;
  roundWind: Wind;
  wallCount: number;
  discardTile?: string;
  snapshot: {
    players: DebugPlayerSnapshot[];
    discardHistory: string[];
    waitingForClaim?: {
      tile: string | null;
      fromPlayer: number;
      eligiblePlayers: { playerIndex: number; actions: string[] }[];
    };
  };
  details?: Record<string, unknown>;
}

export interface GameState {
  players: Player[];
  wall: Tile[];
  deadWall: Tile[]; // bonus tiles drawn from wall
  currentPlayerIndex: number;
  phase: GamePhase;
  multiplayerStartPending?: boolean;
  roundWind: Wind;
  config: GameConfig;
  lastAction: string;
  winner: number | null;
  winningTiles: Tile[];
  winningDiscardPlayer?: number | null;
  lastDrawnTile: Tile | null;
  winMethod: 'discard' | 'self_draw' | 'qiang_kang' | 'kang_shang' | 'tian_hu' | 'di_hu' | 'men_hu' | 'qi_qiang_yi' | 'hua_hu' | 'hua_shang' | 'thirteen_wonders' | null;
  discardHistory: Tile[];
  moveHistory: string[];
  hostDisconnected: boolean;
  playerLeft: { playerIndex: number; playerName: string } | null;
  roomPaused: boolean;
  roomPauseReason: { type: 'player_left'; playerIndex: number } | null;
  roundHadKong?: boolean;
  roundEndReason?: 'draw' | 'kong_exhaustion' | null;
  diceResults: {
    dice: [number, number, number][];
    totals: number[];
    eastPlayerIdx: number;
  } | null;
  nextRoundCountdown: number | null;
  dealerPlayerId: number | null;
  chipSettlement: ChipSettlementSummary | null;
  debugLogs: DebugLogEntry[];
  waitingForRemoteAction?: boolean;
  pendingRemoteActionLabel?: string | null;
  lastRemoteActionLatencyMs?: number | null;
}

export type Direction = 'player' | 'left' | 'across' | 'right';
