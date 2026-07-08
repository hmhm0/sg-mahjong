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
  isAlive: boolean; // false if they've won
  bonusTiles: Tile[]; // flowers, seasons, animals drawn by this player
}

export interface GameConfig {
  taiThreshold: number;
  unlimitedTai: boolean;
  feiCount: number; // 0, 4, 8, 12, 16, 20
}

export interface GameState {
  players: Player[];
  wall: Tile[];
  deadWall: Tile[]; // bonus tiles drawn from wall
  currentPlayerIndex: number;
  phase: GamePhase;
  roundWind: Wind;
  config: GameConfig;
  lastAction: string;
  winner: number | null;
  winningTiles: Tile[];
  winMethod: 'discard' | 'self_draw' | 'qiang_kang' | 'kang_shang' | 'tian_hu' | 'di_hu' | 'men_hu' | 'qi_qiang_yi' | 'hua_hu' | 'hua_shang' | 'thirteen_wonders' | null;
  discardHistory: Tile[];
  moveHistory: string[];
  hostDisconnected: boolean;
  playerLeft: { playerIndex: number; playerName: string } | null;
  diceResults: {
    dice: [number, number, number][];
    totals: number[];
    eastPlayerIdx: number;
  } | null;
}

export type Direction = 'player' | 'left' | 'across' | 'right';
