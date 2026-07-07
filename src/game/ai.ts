import type { Tile, Meld, Player } from '../types/mahjong';
import type { Wind, Suit } from '../types/mahjong';
import { canChi, canPung, canKong, findTilesThatWin } from './rules';
import { isFei, isHonor, isBonus, sortHand } from './tiles';

// ── Discard Decision ──────────────────────────────────────

function tileValue(tile: Tile): number {
  // Higher = more valuable, lower = more likely to discard
  if (isBonus(tile)) return 0; // always keep bonuses
  if (isFei(tile)) return 100; // never discard fei

  if (tile.category === 'honor') {
    // Winds and dragons are medium value
    return 60;
  }

  if (tile.category === 'suit') {
    // Terminal tiles (1, 9) are less valuable
    // Middle tiles (4-6) are most valuable
    // Edge tiles (2, 3, 7, 8) are medium
    if (tile.value === 1 || tile.value === 9) return 10;
    if (tile.value === 2 || tile.value === 8) return 25;
    if (tile.value === 3 || tile.value === 7) return 40;
    return 55; // 4, 5, 6
  }

  return 0;
}

function countTileInHand(hand: Tile[], target: Tile): number {
  return hand.filter(t => {
    if (t.category !== target.category) return false;
    if (t.category === 'suit' && target.category === 'suit') return t.suit === target.suit && t.value === target.value;
    if (t.category === 'honor' && target.category === 'honor') return t.type === (target as any).type;
    return false;
  }).length;
}

function countSimilarTiles(hand: Tile[], tile: Tile): number {
  // Count tiles in hand that could form a sequence with this tile
  if (tile.category !== 'suit') return countTileInHand(hand, tile);

  let count = 0;
  const suit = tile.suit;
  const val = tile.value;

  // Check neighbors for sequence potential
  for (let v = Math.max(1, val - 2); v <= Math.min(9, val + 2); v++) {
    count += hand.filter(t => t.category === 'suit' && (t as any).suit === suit && (t as any).value === v).length;
  }

  return count;
}

export function chooseDiscard(hand: Tile[], melds: Meld[]): number {
  // Don't discard fei or bonus tiles
  const discards = hand.map((t, i) => ({ tile: t, index: i }))
    .filter(({ tile }) => !isFei(tile) && !isBonus(tile));

  if (discards.length === 0) return 0;

  // Score each possible discard
  const scored = discards.map(({ tile, index }) => {
    const baseValue = tileValue(tile);
    const paired = countTileInHand(hand, tile) >= 2 ? 20 : 0;
    const neighbors = countSimilarTiles(hand, tile);
    const orphaned = baseValue <= 10 && neighbors <= 2 ? -20 : 0;
    const alone = countTileInHand(hand, tile) === 1 ? -10 : 0;

    return { index, score: baseValue + paired + neighbors + orphaned + alone };
  });

  // Sort by score ascending (lowest score = most likely to discard)
  scored.sort((a, b) => a.score - b.score);
  return scored[0].index;
}

// ── Call Decision (chi / pung / kong) ─────────────────────

export function shouldPung(hand: Tile[], discard: Tile): boolean {
  // Always pung if it forms 3+ tai
  // Pung if it's a dragon or seat wind
  return canPung(hand, discard);
}

export function shouldKong(hand: Tile[], discard: Tile): boolean {
  return canKong(hand, discard);
}

export function shouldChi(hand: Tile[], discard: Tile): boolean {
  // Only chi if it doesn't mess up the hand too much
  return canChi(hand, discard);
}

export function shouldSelfKong(hand: Tile[]): boolean {
  // Always self-kong if possible (more melds, more power)
  return false; // AI will do this when it improves hand
}

// ── Win Decision ──────────────────────────────────────────

export function shouldWin(hand: Tile[], melds: Meld[]): boolean {
  // Always win if possible
  return true;
}

export function generateAIDecision(hand: Tile[], melds: Meld[], discard: Tile): 'pass' | 'pung' | 'chi' | 'kong' | 'win' {
  // Check win first
  const winningTiles = findTilesThatWin(hand, melds);
  if (winningTiles.some(t =>
    t.category === discard.category &&
    (t.category === 'suit' ? (t as any).suit === (discard as any).suit && (t as any).value === (discard as any).value :
     t.category === 'honor' ? (t as any).type === (discard as any).type :
     false)
  )) {
    return 'win';
  }

  if (canPung(hand, discard)) return 'pung';
  if (canChi(hand, discard)) return 'chi';
  return 'pass';
}
