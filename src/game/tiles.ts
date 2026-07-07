import type { Tile, Suit, Wind, Dragon, BonusType, GameConfig } from '../types/mahjong';

const SUITS: Suit[] = ['bamboo', 'characters', 'dots'];
const WINDS: Wind[] = ['east', 'south', 'west', 'north'];
const DRAGONS: Dragon[] = ['hong', 'fa', 'baak'];
const ANIMAL_NAMES = ['cat', 'mouse', 'rooster', 'centipede'];

export function createSuitTile(suit: Suit, value: number): Tile {
  return { category: 'suit', suit, value: value as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 };
}

export function createHonorTile(type: Wind | Dragon): Tile {
  return { category: 'honor', type };
}

export function createBonusTile(bonusType: BonusType, id: number): Tile {
  return { category: 'bonus', bonusType, id: id as 1 | 2 | 3 | 4 };
}

export function createFeiTile(): Tile {
  return { category: 'fei' };
}

export function tileId(tile: Tile): string {
  if (tile.category === 'suit') return `${tile.suit}-${tile.value}`;
  if (tile.category === 'honor') return `honor-${tile.type}`;
  if (tile.category === 'bonus') return `bonus-${tile.bonusType}-${tile.id}`;
  return 'fei';
}

export function tileDisplay(tile: Tile): string {
  if (tile.category === 'suit') {
    const suitSymbol = tile.suit === 'bamboo' ? 'B' : tile.suit === 'characters' ? 'C' : 'D';
    return `${tile.value}${suitSymbol}`;
  }
  if (tile.category === 'honor') {
    const names: Record<string, string> = {
      east: 'E', south: 'S', west: 'W', north: 'N',
      hong: 'H', fa: 'F', baak: 'B',
    };
    return names[tile.type];
  }
  if (tile.category === 'bonus') {
    if (tile.bonusType === 'flower') return `F${tile.id}`;
    if (tile.bonusType === 'season') return `S${tile.id}`;
    return `A${tile.id}`;
  }
  return 'Fei';
}

export function tileEmoji(tile: Tile): string {
  if (tile.category === 'suit') {
    const suitSymbols: Record<string, string> = {
      bamboo: '🎋', characters: '🀇', dots: '●',
    };
    const suitEmoji = tile.suit === 'bamboo' ? '🎋' : tile.suit === 'characters' ? '🀇' : '●';
    return `${tile.value}${suitEmoji}`;
  }
  if (tile.category === 'honor') {
    const map: Record<string, string> = {
      east: '🀀', south: '🀁', west: '🀂', north: '🀃',
      hong: '🀄', fa: '🀅', baak: '🀆',
    };
    return map[tile.type] || tile.type;
  }
  if (tile.category === 'bonus') {
    if (tile.bonusType === 'flower') return `🌸${tile.id}`;
    if (tile.bonusType === 'season') return `🍂${tile.id}`;
    const animals = ['🐱', '🐭', '🐔', '🐛'];
    return animals[tile.id - 1] || '🀢';
  }
  return '⭐';
}

export function buildDeck(config: GameConfig): Tile[] {
  const deck: Tile[] = [];

  // Add suit tiles: 4 copies of each suit 1-9
  for (const suit of SUITS) {
    for (let value = 1; value <= 9; value++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push(createSuitTile(suit, value));
      }
    }
  }

  // Add honor tiles (winds + dragons): 4 copies each
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push(createHonorTile(wind));
    }
  }
  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push(createHonorTile(dragon));
    }
  }

  // Add bonus tiles: flowers (1-4), seasons (1-4), animals (cat, mouse, rooster, centipede)
  const bonusTypes: BonusType[] = ['flower', 'season', 'animal'];
  for (const bonusType of bonusTypes) {
    for (let id = 1; id <= 4; id++) {
      deck.push(createBonusTile(bonusType, id));
    }
  }

  // Add fei tiles
  for (let i = 0; i < config.feiCount; i++) {
    deck.push(createFeiTile());
  }

  return deck;
}

export function shuffleDeck(deck: Tile[]): Tile[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(deck: Tile[], seed: number): Tile[] {
  const random = seededRandom(seed);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function isFei(tile: Tile): boolean {
  return tile.category === 'fei';
}

export function isBonus(tile: Tile): boolean {
  return tile.category === 'bonus';
}

export function isHonor(tile: Tile): boolean {
  return tile.category === 'honor';
}

export function canFormSequence(a: Tile, b: Tile, c: Tile): boolean {
  // All must be suit tiles of the same suit
  if (a.category !== 'suit' || b.category !== 'suit' || c.category !== 'suit') return false;
  if (a.suit !== b.suit || b.suit !== c.suit) return false;

  const vals = [a.value, b.value, c.value].sort((x, y) => x - y);
  return vals[1] === vals[0] + 1 && vals[2] === vals[1] + 1;
}

export function canFormPung(tiles: Tile[]): boolean {
  if (tiles.length < 3) return false;
  const first = tiles[0];
  return tiles.every(t =>
    t.category === first.category &&
    (first.category === 'suit' ? (t as any).suit === (first as any).suit && (t as any).value === (first as any).value :
     first.category === 'honor' ? (t as any).type === (first as any).type :
     t.category === 'fei')
  );
}

export function sortHand(hand: Tile[]): Tile[] {
  const suitOrder: Record<Suit, number> = { bamboo: 0, characters: 1, dots: 2 };
  const honorOrder: Record<string, number> = { east: 0, south: 1, west: 2, north: 3, hong: 4, fa: 5, baak: 6 };

  return [...hand].sort((a, b) => {
    // Fei always last
    if (a.category === 'fei') return 1;
    if (b.category === 'fei') return -1;

    // Bonus before others
    if (a.category === 'bonus' && b.category !== 'bonus') return -1;
    if (a.category !== 'bonus' && b.category === 'bonus') return 1;

    const catOrder: Record<Tile['category'], number> = { suit: 0, honor: 1, bonus: 2, fei: 3 };
    if (a.category !== b.category) return catOrder[a.category] - catOrder[b.category];

    if (a.category === 'suit' && b.category === 'suit') {
      if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
      return a.value - b.value;
    }
    if (a.category === 'honor' && b.category === 'honor') {
      return honorOrder[a.type] - honorOrder[b.type];
    }
    if (a.category === 'bonus' && b.category === 'bonus') {
      if (a.bonusType !== b.bonusType) return a.bonusType.localeCompare(b.bonusType);
      return a.id - b.id;
    }
    return 0;
  });
}
