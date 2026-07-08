import type { Tile, GameState, Player, Meld } from '../types/mahjong';
import type { Wind, Suit } from '../types/mahjong';
import { isFei, isHonor, sortHand } from './tiles';

// ── Win Detection ──────────────────────────────────────────
// Single-pass recursive backtracking engine.
// Correctly handles fei (joker) substitutions in sequences,
// all pair/meld combinations, and mixed sequence+pung hands.

function tileEqual(a: Tile, b: Tile, allowFei = false): boolean {
  if (a.category === 'fei' && allowFei) return true;
  if (b.category === 'fei' && allowFei) return true;
  if (a.category !== b.category) return false;
  if (a.category === 'suit' && b.category === 'suit') return a.suit === b.suit && a.value === b.value;
  if (a.category === 'bonus' && b.category === 'bonus') return a.bonusType === b.bonusType && a.id === b.id;
  return false;
}

function removeTiles(hand: Tile[], tiles: Tile[]): Tile[] {
  const remaining = [...hand];
  for (const t of tiles) {
    const idx = isFei(t)
      ? remaining.findIndex(r => isFei(r))
      : remaining.findIndex(r => tileEqual(r, t, false));
    if (idx >= 0) remaining.splice(idx, 1);
  }
  return remaining;
}

// ── Unified backtracking meld finder ──
// Finds 'count' melds from 'hand'. Returns meld tiles or null.
// At each step: take the first non-fei tile, try all melds containing it.
// Backtracks through ALL fei assignments for sequences.
function findMelds(hand: Tile[], count: number): Tile[][] | null {
  if (count === 0) return hand.length === 0 ? [] : null;
  if (hand.length < 3) return null;

  const nonFei = hand.filter(t => !isFei(t));
  const feiCount = hand.filter(isFei).length;

  // All fei: consume 3 per meld
  if (nonFei.length === 0) {
    if (feiCount >= 3) {
      const rest = findMelds(hand.slice(3), count - 1);
      if (rest !== null) return [hand.slice(0, 3), ...rest];
    }
    return null;
  }

  const first = hand.find(t => !isFei(t))!;

  // ── Sequence (suit tiles only, with 0-3 fei subs) ──
  if (first.category === 'suit') {
    const suit = first.suit;
    const v = first.value;
    // Try each 3-tile sequence that includes v
    for (let s = Math.max(1, v - 2); s <= Math.min(7, v); s++) {
      const needed = [s, s + 1, s + 2];
      // Try ALL ways to build this sequence (backtracking through non-fei/fei assignments)
      const seqs = collectAllSequences(hand, suit, needed);
      for (const seq of seqs) {
        const remaining = removeTiles(hand, seq);
        const rest = findMelds(remaining, count - 1);
        if (rest !== null) return [seq, ...rest];
      }
    }
  }

  // ── Pung (3 identical non-fei tiles) ──
  const identical = nonFei.filter(t => tileEqual(t, first));
  if (identical.length >= 3) {
    const pung = identical.slice(0, 3);
    const remaining = removeTiles(hand, pung);
    const rest = findMelds(remaining, count - 1);
    if (rest !== null) return [pung, ...rest];
  }

  return null;
}

// Collect ALL possible 3-tile sequences for a given (suit, neededValues) pair.
// Exhaustively tries non-fei then fei at each position (backtracking).
function collectAllSequences(hand: Tile[], suit: string, needed: number[]): Tile[][] {
  const results: Tile[][] = [];
  collectSeqRecur([...hand], suit, needed, 0, [], results);
  return results;
}

function collectSeqRecur(
  remaining: Tile[], suit: string, needed: number[],
  i: number, meld: Tile[], results: Tile[][]
): void {
  if (i === needed.length) {
    if (meld.length === 3) results.push([...meld]);
    return;
  }

  const val = needed[i];

  // Try non-fei tile matching this value
  const nfIdx = remaining.findIndex(t =>
    !isFei(t) && t.category === 'suit' && t.suit === suit && t.value === val
  );
  if (nfIdx >= 0) {
    const t = remaining.splice(nfIdx, 1)[0];
    collectSeqRecur(remaining, suit, needed, i + 1, [...meld, t], results);
    remaining.splice(nfIdx, 0, t); // backtrack
  }

  // Try fei tile as this value
  const feiIdx = remaining.findIndex(isFei);
  if (feiIdx >= 0) {
    const t = remaining.splice(feiIdx, 1)[0];
    collectSeqRecur(remaining, suit, needed, i + 1, [...meld, t], results);
    remaining.splice(feiIdx, 0, t); // backtrack
  }
}

// Find a valid pair by trying ALL pair combinations and checking if
// the remaining tiles can form the correct number of melds.
function hasPair(hand: Tile[]): Tile[] | null {
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const feiInPair = [hand[i], hand[j]].filter(isFei).length;
      if (feiInPair > 1) continue; // fei+fei cannot be a pair
      if (tileEqual(hand[i], hand[j]) || feiInPair === 1) {
        const pair = [hand[i], hand[j]];
        const remaining = removeTiles(hand, pair);
        // remaining tiles must form 4 melds: remaining.length / 3 = 4
        const meldList = findMelds(remaining, 4);
        if (meldList !== null) return pair;
      }
    }
  }
  return null;
}

export function checkWin(hand: Tile[], melds: Meld[]): boolean {
  // Filter out bonus tiles — they don't count in hand
  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Count exposed melds
  let meldCount = 0;
  let meldTiles = 0;
  for (const m of melds) {
    if (m.type === 'chi' || m.type === 'pung') { meldCount++; meldTiles += 3; }
    else if (m.type === 'kong' || m.type === 'concealed-kong') { meldCount++; meldTiles += 4; }
  }

  if (playableHand.length + meldTiles < 14) return false;
  if (meldCount > 4) return false;

  const remainingMeldCount = 4 - meldCount;

  // Try every possible pair, then check if remaining tiles form all melds
  for (let i = 0; i < playableHand.length; i++) {
    for (let j = i + 1; j < playableHand.length; j++) {
      const pair = [playableHand[i], playableHand[j]];
      const feiInPair = pair.filter(isFei).length;
      if (feiInPair > 1) continue; // fei+fei is not a valid pair
      if (tileEqual(playableHand[i], playableHand[j]) || feiInPair === 1) {
        const remaining = removeTiles(playableHand, pair);
        const meldList = findMelds(remaining, remainingMeldCount);
        if (meldList !== null) return true;
      }
    }
  }

  return false;
}


// ── Chou Ping Hu (臭平胡) Detection ──────────────────────

// Chou Ping Hu = +1 tai, all melds are chi (sequences) with specific restrictions:
// 1. Pair (eyes) is not a dragon, round wind, or seat wind
// 2. Winning tile is not the pair
// 3. Winning tile is not an end-of-suit tile (1 or 9)
// 4. Not a side wait (1-2 winning 3, or 8-9 winning 7)
// Works by checking the completed hand: if ANY tile in the sequences could be
// a valid winning tile satisfying all restrictions, the hand is Chou Ping Hu.
function isChouPingHu(hand: Tile[], melds: Meld[], state: GameState, playerId: number): boolean {
  // All melds must be chi (sequences)
  if (melds.length === 0) return false;
  if (!melds.every(m => m.type === 'chi')) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Find the pair
  const pair = hasPair(playableHand);
  if (!pair) return false;

  // Pair cannot be dragon, round wind, or seat wind
  for (const tile of pair) {
    if (tile.category === 'honor') {
      if (['hong', 'fa', 'baak'].includes(tile.type)) return false;
      if (tile.type === state.roundWind) return false;
      if (state.players[playerId] && tile.type === state.players[playerId].seatWind) return false;
    }
  }

  // Remove the pair and find remaining melds
  const remaining = removeTiles(playableHand, pair);
  const expectedMeldCount = 4 - melds.length;
  const meldList = findMelds(remaining, expectedMeldCount);
  if (!meldList) return false;
  if (meldList.length !== expectedMeldCount) return false;

  // Check if ANY tile in the sequences could be a valid winning tile for Chou Ping Hu
  const allMelds: Tile[][] = [...melds.map(m => m.tiles), ...meldList];

  for (const seq of allMelds) {
    for (const tile of seq) {
      if (isValidCPHWinTile(tile, seq)) {
        return true; // At least one valid winning tile exists
      }
    }
  }

  return false;
}

// Check if a specific tile in a chi meld could be the winning tile for Chou Ping Hu
function isValidCPHWinTile(tile: Tile, sequence: Tile[]): boolean {
  if (tile.category !== 'suit') return false; // honors can't be in suit sequences

  // Winning tile cannot be 1 or 9
  if (tile.value === 1 || tile.value === 9) return false;

  // Check for side wait: remove this tile from the sequence and see if
  // the remaining tiles form a 1-2 (waiting for 3) or 8-9 (waiting for 7)
  const others = sequence.filter(t =>
    !(t.category === 'suit' && t.suit === tile.suit && t.value === tile.value)
  );

  if (others.length === 2 && others.every(t => t.category === 'suit' && t.suit === tile.suit)) {
    const vals = others.map(t => (t as any).value).sort((a, b) => a - b);
    // Side wait: 1-2 winning 3, or 8-9 winning 7
    if (tile.value === 3 && vals[0] === 1 && vals[1] === 2) return false;
    if (tile.value === 7 && vals[0] === 8 && vals[1] === 9) return false;
  }

  return true;
}

// ── Ping Hu (平胡) Detection ─────────────────────────────

// Ping Hu = +4 tai, all chi melds, no bonus tiles, pair not honor that gives tai,
// no side wait, no dan diao (waiting for eyes)
function isPingHu(hand: Tile[], melds: Meld[], state: GameState, playerId: number): boolean {
  // All melds must be chi (sequences)
  if (melds.length === 0) return false;
  if (!melds.every(m => m.type === 'chi')) return false;

  // Cannot have any flower, season, or animal tiles
  const player = state.players[playerId];
  if (player && (player.bonusTiles || []).length > 0) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Find the pair
  const pair = hasPair(playableHand);
  if (!pair) return false;

  // Pair cannot be honors that give tai (dragons, round wind, seat wind)
  for (const tile of pair) {
    if (tile.category === 'honor') {
      if (['hong', 'fa', 'baak'].includes(tile.type)) return false;
      if (tile.type === state.roundWind) return false;
      if (state.players[playerId] && tile.type === state.players[playerId].seatWind) return false;
    }
  }

  // Remove the pair and find remaining melds
  const remaining = removeTiles(playableHand, pair);
  const expectedMeldCount = 4 - melds.length;
  const meldList = findMelds(remaining, expectedMeldCount);
  if (!meldList) return false;
  if (meldList.length !== expectedMeldCount) return false;

  // Check if ANY tile in the sequences could be a valid winning tile for Ping Hu
  const allMelds: Tile[][] = [...melds.map(m => m.tiles), ...meldList];

  for (const seq of allMelds) {
    for (const tile of seq) {
      if (isValidPHWinTile(tile, seq)) {
        return true;
      }
    }
  }

  return false;
}

// Check if a specific tile in a chi meld could be the winning tile for Ping Hu
// Ping Hu: no side waits, no dan diao, but 1/9 winning tiles ARE allowed
function isValidPHWinTile(tile: Tile, sequence: Tile[]): boolean {
  if (tile.category !== 'suit') return false;

  // Check for side wait: 1-2 winning 3, or 8-9 winning 7
  const others = sequence.filter(t =>
    !(t.category === 'suit' && t.suit === tile.suit && t.value === tile.value)
  );

  if (others.length === 2 && others.every(t => t.category === 'suit' && t.suit === tile.suit)) {
    const vals = others.map(t => (t as any).value).sort((a, b) => a - b);
    if (tile.value === 3 && vals[0] === 1 && vals[1] === 2) return false;
    if (tile.value === 7 && vals[0] === 8 && vals[1] === 9) return false;
  }

  // Dan Diao (winning tile is the pair) is already excluded naturally:
  // pair tiles are removed before checking sequences, so no sequence tile is ever a pair tile
  // 1 and 9 are allowed as winning tiles for Ping Hu
  return true;
}

// ── Pong Pong Hu (碰碰胡) Detection ──────────────────────

// All 4 melds are pungs/kongs (identical triplets/quads).
// Must win with the eyes (pair) — the winning tile completes the pair, not a pung.
// +2 tai (vs All Pungs +3 which doesn't have the eyes restriction).
function isPungMeld(tiles: Tile[]): boolean {
  if (tiles.length < 3) return false;
  const first = tiles[0];
  return tiles.every(t => {
    if (t.category === 'suit' && first.category === 'suit') return t.suit === first.suit && t.value === first.value;
    if (t.category === 'honor' && first.category === 'honor') return t.type === first.type;
    return false;
  });
}

function isPongPongHu(hand: Tile[], melds: Meld[], winningTile?: Tile): boolean {
  // Must have exposed melds, all must be pungs/kongs
  if (melds.length === 0) return false;
  if (!melds.every(m => m.type === 'pung' || m.type === 'kong' || m.type === 'concealed-kong')) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Find the pair (eyes)
  const pair = hasPair(playableHand);
  if (!pair) return false;

  // Remove pair and find remaining melds
  const remaining = removeTiles(playableHand, pair);
  const expectedMeldCount = 4 - melds.length;
  const meldList = findMelds(remaining, expectedMeldCount);
  if (!meldList) return false;
  if (meldList.length !== expectedMeldCount) return false;

  // All remaining melds must be pungs (3 identical tiles), not sequences
  for (const meld of meldList) {
    if (!isPungMeld(meld)) return false;
  }

  // "Must win with the eyes": winning tile must be part of the pair
  if (winningTile && !pair.some(t => tileEqual(t, winningTile))) return false;

  return true;
}

// ── Kang Kang Hu (杠杠胡) Detection ──────────────────────

// Self-draw win with 4 concealed pungs/kongs and concealed pair.
// No exposed melds — all tiles are in hand as triplets/quads + a pair.
function isKangKangHu(hand: Tile[], melds: Meld[], selfDraw: boolean): boolean {
  // Must be self-draw
  if (!selfDraw) return false;

  // No exposed melds at all (concealed hand)
  if (melds.length > 0) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Find the pair (eyes)
  const pair = hasPair(playableHand);
  if (!pair) return false;

  // Remove pair and find melds — all must be pungs (not sequences)
  const remaining = removeTiles(playableHand, pair);
  const meldList = findMelds(remaining, 4);
  if (!meldList || meldList.length !== 4) return false;

  for (const meld of meldList) {
    if (!isPungMeld(meld)) return false;
  }

  return true;
}

// ── Pure Honours (字一色) Detection ──────────────────────

// All tiles are honor tiles (winds + dragons), all 4 melds are pungs/kongs,
// must win with the eyes. Works for both exposed and concealed melds.
function isPureHonours(hand: Tile[], melds: Meld[], winningTile?: Tile): boolean {
  // All tiles (melds + hand) must be honor tiles
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  for (const t of allTiles) {
    if (t.category !== 'honor') return false;
  }

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Exposed melds must all be pungs/kongs
  if (melds.length > 0 && !melds.every(m => m.type === 'pung' || m.type === 'kong' || m.type === 'concealed-kong')) {
    return false;
  }

  // Find the pair
  const pair = hasPair(playableHand);
  if (!pair) return false;

  // Remove pair, find remaining melds — all must be pungs
  const remaining = removeTiles(playableHand, pair);
  const expected = 4 - melds.length;
  const meldList = findMelds(remaining, expected);
  if (!meldList) return false;
  if (meldList.length !== expected) return false;

  for (const meld of meldList) {
    if (!isPungMeld(meld)) return false;
  }

  // Must win with the eyes
  if (winningTile && !pair.some(t => tileEqual(t, winningTile))) return false;

  return true;
}

// ── Thirteen Wonders (十三幺) Detection ──────────────────

// Hand consisting of all 13 terminal/honor tiles (1 & 9 of each suit,
// all 4 winds, all 3 dragons) plus one duplicate — no standard melds.
export function isThirteenWonders(hand: Tile[], melds: Meld[]): boolean {
  // Standard Thirteen Wonders has no exposed melds
  if (melds.length > 0) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');
  if (playableHand.length !== 14) return false;

  // Count occurrences of each terminal (1/9) and honor tile
  const counts: Record<string, number> = {};
  for (const t of playableHand) {
    if (t.category === 'suit') {
      if (t.value !== 1 && t.value !== 9) return false;
      counts[`${t.suit}-${t.value}`] = (counts[`${t.suit}-${t.value}`] || 0) + 1;
    } else if (t.category === 'honor') {
      counts[`honor-${t.type}`] = (counts[`honor-${t.type}`] || 0) + 1;
    } else {
      return false;
    }
  }

  // All 13 terminal/honor types must be present
  const expectedTypes = [
    'bamboo-1', 'bamboo-9',
    'characters-1', 'characters-9',
    'dots-1', 'dots-9',
    'honor-east', 'honor-south', 'honor-west', 'honor-north',
    'honor-hong', 'honor-fa', 'honor-baak'
  ];
  for (const expected of expectedTypes) {
    if (!counts[expected] || counts[expected] < 1) return false;
  }

  // Exactly one type appears twice (the pair), rest once
  let hasPair = false;
  for (const key of Object.keys(counts)) {
    if (counts[key] === 2) {
      if (hasPair) return false;
      hasPair = true;
    } else if (counts[key] !== 1) {
      return false;
    }
  }

  return hasPair;
}

// ── Tai Scoring ──────────────────────────────────────────
// ── Tai Scoring ──────────────────────────────────────────
// ── Tai Scoring ──────────────────────────────────────────
// ── Tai Scoring ──────────────────────────────────────────
// ── Tai Scoring ──────────────────────────────────────────
// ── Tai Scoring ──────────────────────────────────────────
// ── Tai Scoring ──────────────────────────────────────────

const WIND_ORDER: Wind[] = ['east', 'south', 'west', 'north'];

export interface TaiResult {
  tai: number;
  breakdown: { name: string; tai: number }[];
  feiPenalty: number;
  totalTai: number;
}

export function calculateTai(state: GameState, playerId: number, selfDraw: boolean, visibleOnly: boolean = false, huaShang: boolean = false, kangShang: boolean = false, winningTile?: Tile, tianHu: boolean = false, diHu: boolean = false, menHu: boolean = false, thirteenWonders: boolean = false, qiQiangYi: boolean = false, huaHu: boolean = false): TaiResult {
  const player = state.players[playerId];
  if (!player) return { tai: 0, breakdown: [], feiPenalty: 0, totalTai: 0 };

  const breakdown: { name: string; tai: number }[] = [];
  let tai = 0;

  const hand = player.hand;
  const melds = player.melds;
  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const suitCounts: Record<string, number> = { bamboo: 0, characters: 0, dots: 0 };
  const honorCount = allTiles.filter(t => t.category === 'honor').length;
  const feiCount = allTiles.filter(isFei).length;

  // Count suit tiles
  for (const t of allTiles) {
    if (t.category === 'suit') {
      suitCounts[t.suit]++;
    }
  }

  const nonHonorCount = allTiles.filter(t => t.category === 'suit').length;

  // Seat wind pung
  for (const meld of melds) {
    if ((meld.type === 'pung' || meld.type === 'kong' || meld.type === 'concealed-kong')) {
      const first = meld.tiles[0];
      if (first.category === 'honor' && first.type === player.seatWind) {
        tai += 1;
        breakdown.push({ name: `Seat Wind (${player.seatWind}) Pung`, tai: 1 });
      }
      // Round wind pung
      if (first.category === 'honor' && first.type === state.roundWind) {
        tai += 1;
        breakdown.push({ name: `Round Wind (${state.roundWind}) Pung`, tai: 1 });
      }
      // Dragon pung
      if (first.category === 'honor' && ['hong', 'fa', 'baak'].includes(first.type)) {
        tai += 1;
        breakdown.push({ name: `${first.type} Dragon Pung`, tai: 1 });
      }
    }
  }

  // Full Flush variants skip flag — must be at function scope
  let fullFlushVariantApplied = false;

  // Half flush (same suit + honors): 2 tai - only visible to the player themselves
  if (!visibleOnly) {
    const suitsUsed = Object.entries(suitCounts).filter(([_, c]) => c > 0).length;
    if (suitsUsed === 1 && honorCount > 0) {
      tai += 2;
      breakdown.push({ name: 'Half Flush', tai: 2 });
    }

    if (suitsUsed === 1 && honorCount === 0) {
      const allChi = melds.length > 0 && melds.every(m => m.type === 'chi');
      const noBonuses = player && (!player.bonusTiles || player.bonusTiles.length === 0);
      const allTriplets = isPongPongHu(hand, melds, winningTile);

      // Full Flush Sequence Hand (清一色平胡): +10 tai
      // All chi + one suit + no bonus tiles
      if (allChi && noBonuses) {
        tai += 10;
        breakdown.push({ name: 'Full Flush Sequence Hand (清一色平胡)', tai: 10 });
        fullFlushVariantApplied = true;
      // Full Flush Triplets Hand (清一色碰碰胡): +8 tai
      // All pungs/kongs + one suit, must win with eyes
      } else if (allTriplets) {
        tai += 8;
        breakdown.push({ name: 'Full Flush Triplets Hand (清一色碰碰胡)', tai: 8 });
        fullFlushVariantApplied = true;
      } else {
        // Full flush (same suit only): 4 tai
        tai += 4;
        breakdown.push({ name: 'Full Flush', tai: 4 });
      }
    }
  }

  // Pure Honours (字一色): +10 tai — all honor tiles, all pungs/kongs, win with eyes
  let pureHonoursApplied = false;
  if (!visibleOnly && isPureHonours(hand, melds, winningTile)) {
    tai += 10;
    breakdown.push({ name: 'Pure Honours (字一色)', tai: 10 });
    pureHonoursApplied = true;
  }

  // Pong Pong Hu (碰碰胡): +2 tai / All Pungs: +3 tai
  // Skipped if Full Flush Triplets or Pure Honours already scored this category
  if (!fullFlushVariantApplied && !pureHonoursApplied && !visibleOnly && isPongPongHu(hand, melds, winningTile)) {
    // Check if winning tile is the pair (eyes)
    const playableHand = hand.filter(t => t.category !== 'bonus');
    const pair = hasPair(playableHand);
    const winningWithEyes = winningTile && pair ? pair.some(t => tileEqual(t, winningTile)) : true;
    if (winningWithEyes) {
      tai += 2;
      breakdown.push({ name: 'Pong Pong Hu (碰碰胡)', tai: 2 });
    } else {
      tai += 3;
      breakdown.push({ name: 'All Pungs', tai: 3 });
    }
  }

  // Xiao San Yuan (小三元 / Little Three Dragons): 4 tai
  // 2 dragon pungs (exposed or concealed hand) + dragon pair as eyes
  const exposedDragonPungs = melds.filter(m =>
    (m.type === 'pung' || m.type === 'kong' || m.type === 'concealed-kong') &&
    m.tiles[0]?.category === 'honor' && ['hong', 'fa', 'baak'].includes(m.tiles[0]?.type || '')
  );

  // Count concealed dragon tiles in hand for concealed pungs
  const handDragonCounts: Record<string, number> = {};
  for (const t of hand) {
    if (t.category === 'honor' && ['hong', 'fa', 'baak'].includes((t as any).type)) {
      handDragonCounts[(t as any).type] = (handDragonCounts[(t as any).type] || 0) + 1;
    }
  }
  const concealedDragonTypes = Object.entries(handDragonCounts)
    .filter(([_, count]) => count >= 3)
    .map(([type]) => type);

  const allDragonPungTypes = new Set([
    ...exposedDragonPungs.map(m => (m.tiles[0] as any)?.type),
    ...concealedDragonTypes
  ]);

  if (!visibleOnly && allDragonPungTypes.size === 2) {
    // Check if the eye is the third dragon
    const thirdDragon = ['hong', 'fa', 'baak'].find(d => !allDragonPungTypes.has(d));
    const eyePair = hand.filter(t => !isFei(t)).filter(t => t.category === 'honor' && (t as any).type === thirdDragon);
    if (eyePair.length >= 2) {
      tai += 4;
      breakdown.push({ name: 'Little Three Dragons', tai: 4 });
      // Dragon Eyes: +1 tai for having a dragon tile as the eyes (only with Xiao San Yuan)
      tai += 1;
      breakdown.push({ name: 'Dragon Eyes', tai: 1 });
    }
  }

  // Big Three Dragons: 6 tai
  if (allDragonPungTypes.size === 3) {
    tai += 10;
    breakdown.push({ name: 'Big Three Dragons', tai: 10 });
  }

  // Xiao Xi Si (小四喜): limit (40 tai) — 3 wind pungs + 4th wind as eyes
  const windPungs = melds.filter(m =>
    (m.type === 'pung' || m.type === 'kong' || m.type === 'concealed-kong') &&
    m.tiles[0]?.category === 'honor' && WIND_ORDER.includes(m.tiles[0]?.type as Wind)
  );
  const windTypes = new Set(windPungs.map(m => (m.tiles[0] as any)?.type));
  if (!visibleOnly && windTypes.size === 3) {
    const fourthWind = WIND_ORDER.find(w => !windTypes.has(w));
    const eyePair = hand.filter(t => !isFei(t)).filter(t => t.category === 'honor' && (t as any).type === fourthWind);
    if (eyePair.length >= 2) {
      tai += 40;
      breakdown.push({ name: 'Xiao Xi Si (小四喜)', tai: 40 });
    }
  }
  // Da Xi Si (大四喜): +10 tai — automatic win with all 4 wind pungs, any eyes
  if (windTypes.size === 4) {
    tai += 10;
    breakdown.push({ name: 'Da Xi Si (大四喜)', tai: 10 });
  }

  // Self-draw: 1 tai
  if (selfDraw) {
    tai += 1;
    breakdown.push({ name: 'Self-Draw', tai: 1 });
  }

  // Kang Kang Hu (杠杠胡): +8 tai
  // Self-draw with 4 concealed pungs/kongs and concealed pair, no exposed melds
  let kangKangHuApplied = false;
  if (!visibleOnly && isKangKangHu(hand, melds, selfDraw)) {
    tai += 8;
    breakdown.push({ name: 'Kang Kang Hu (杠杠胡)', tai: 8 });
    kangKangHuApplied = true;
  }

  // Concealed hand (Men Qing / 门清): +1 tai
  // Win without exposing any melds (no chi/pung/kong), must be self-draw
  if (!kangKangHuApplied && !visibleOnly && selfDraw && melds.length === 0) {
    tai += 1;
    breakdown.push({ name: 'Concealed Hand (Men Qing)', tai: 1 });
  }

  // Chou Ping Hu (臭平胡): +1 tai
  // All chi melds, pair not dragon/round wind/seat wind,
  // winning tile not the pair, not 1/9, and not a side wait
  // On discard: can only win if there is at least 1 tai from another source
 const cphHand = winningTile ? [...hand, winningTile] : hand;
 const isCph = isChouPingHu(cphHand, melds, state, playerId);
  const isPh = isPingHu(cphHand, melds, state, playerId);

  // Ping Hu (平胡): +4 tai, takes priority over CPH when both qualify
  // All chi, no bonus tiles, pair not honor that gives tai, no side wait, no dan diao
  if (!visibleOnly && isPh) {
    tai += 4;
    breakdown.push({ name: 'Ping Hu (平胡)', tai: 4 });
  } else if (!visibleOnly && isCph) {
    if (selfDraw) {
      tai += 1;
      breakdown.push({ name: 'Chou Ping Hu (臭平胡)', tai: 1 });
    } else {
      // On discard: check if there's at least 1 tai from other patterns
      // If not, CPH contributes 0 tai (player must self-draw to score it)
      const taiBeforeCPH = tai;
      if (taiBeforeCPH >= 1) {
        tai += 1;
        breakdown.push({ name: 'Chou Ping Hu (臭平胡)', tai: 1 });
      }
    }
  }

 // Flowers/seasons/animals matching seat (bonuses are stored in bonusTiles, not hand)
 const bonuses = (player.bonusTiles || []).filter(t => t.category === 'bonus');
 for (const b of bonuses) {
    // Animals always give 1 tai regardless of seat; flowers/seasons only give tai if seat-matched
    if (b.bonusType === 'animal' || bonusMatchesSeat(b, player.seatWind)) {
     tai += 1;
      breakdown.push({ name: b.bonusType === 'animal' ? `${b.bonusType} ${b.id}` : `${b.bonusType} ${b.id} (Seat)`, tai: 1 });
   }
  }

  // Hua Shang (花上 / Flower Replacement Win): +1 tai
  if (huaShang) {
    tai += 1;
    breakdown.push({ name: 'Hua Shang (Flower Replacement)', tai: 1 });
  }

  // Kang Shang (杠上 / Kong Replacement Win): +1 tai
  if (kangShang) {
    tai += 1;
    breakdown.push({ name: 'Kang Shang (Kong Replacement)', tai: 1 });
  }

 // Fei penalty: each fei in hand reduces tai by 1
  const feiPenalty = 0;

  // Tian Hu (天胡 / Heavenly Hand): +10 tai — dealer wins with opening hand
  if (tianHu) {
    tai += 10;
    breakdown.push({ name: 'Tian Hu (天胡)', tai: 10 });
  }

  // Di Hu (地胡 / Earthly Hand): +10 tai — non-dealer wins on dealer's first discard
  if (diHu) {
    tai += 10;
    breakdown.push({ name: 'Di Hu (地胡)', tai: 10 });
  }

  // Men Hu (门胡 / Door Hand): +10 tai — non-dealer wins on first drawn tile
  if (menHu) {
    tai += 10;
    breakdown.push({ name: 'Men Hu (门胡)', tai: 10 });
  }

  // Thirteen Wonders (十三幺): +10 tai — all 13 terminal/honor + 1 duplicate
  if (thirteenWonders) {
    tai += 10;
    breakdown.push({ name: 'Thirteen Wonders (十三幺)', tai: 10 });
  }

  // Shi Ba Luo Han (十八罗汉): +18 tai — 4 kongs + 1 pair = 18 tiles
  if (!visibleOnly) {
    const kongCount = melds.filter(m => m.type === 'kong' || m.type === 'concealed-kong').length;
    if (kongCount === 4) {
      const completedHand = cphHand.filter(t => t.category !== 'bonus');
      if (completedHand.length === 2 && tileEqual(completedHand[0], completedHand[1], false)) {
        tai += 18;
        breakdown.push({ name: 'Shi Ba Luo Han (十八罗汉)', tai: 18 });
      }
    }
  }

  // Qi Qiang Yi (七搶一): +10 tai — received the 8th flower from another player
  if (qiQiangYi) {
    tai += 10;
    breakdown.push({ name: 'Qi Qiang Yi (七搶一)', tai: 10 });
  }

  // Hua Hu (花胡): +12 tai — self-drawn all 8 flowers/seasons
  if (huaHu) {
    tai += 12;
    breakdown.push({ name: 'Hua Hu (花胡)', tai: 12 });
  }

  return { tai, breakdown, feiPenalty, totalTai: tai };
}

function bonusMatchesSeat(tile: Tile, seat: Wind): boolean {
  if (tile.category !== 'bonus') return false;
  const seatMap: Record<Wind, number> = { east: 1, south: 2, west: 3, north: 4 };
  return tile.id === seatMap[seat];
}

export function hasValidTai(state: GameState, playerId: number, selfDraw: boolean): boolean {
  const result = calculateTai(state, playerId, selfDraw);
  const { config } = state;

  if (config.unlimitedTai) return result.totalTai >= config.taiThreshold;
  return result.totalTai >= config.taiThreshold;
}

// ── Meld Detection from Discards ──────────────────────────

export function canChi(hand: Tile[], discard: Tile): boolean {
  if (discard.category !== 'suit') return false;
  const suit = discard.suit;
  const val = discard.value;

  const handSuit = hand.filter(t => t.category === 'suit' && t.suit === suit);

  // Try to complete a sequence with the discard + 2 from hand (no fei allowed for chi)
  for (let v1 = val - 2; v1 <= val; v1++) {
    if (v1 < 1 || v1 + 2 > 9) continue;
    const needed = [v1, v1 + 1, v1 + 2].filter(v => v !== val);
    const handHas = needed.filter(nv => handSuit.some(t => (t as any).value === nv));
    if (handHas.length === needed.length) {
      return true;
    }
  }
  return false;
}

export function canPung(hand: Tile[], discard: Tile): boolean {
  if (discard.category === 'bonus' || isFei(discard)) return false;
  const matching = hand.filter(t =>
    t.category === discard.category &&
    (discard.category === 'suit' ? (t as any).suit === (discard as any).suit && (t as any).value === (discard as any).value :
     t.category === 'honor' ? (t as any).type === (discard as any).type :
     false)
  );
  return matching.length >= 2;
}

export function canKong(hand: Tile[], discard: Tile): boolean {
  if (discard.category === 'bonus' || isFei(discard)) return false;
  const matching = hand.filter(t =>
    t.category === discard.category &&
    (discard.category === 'suit' ? (t as any).suit === (discard as any).suit && (t as any).value === (discard as any).value :
     t.category === 'honor' ? (t as any).type === (discard as any).type :
     false)
  );
  return matching.length >= 3;
}

export function canUpgradePungToKong(hand: Tile[], melds: Meld[]): { meldIndex: number; handTileIndex: number } | null {
  // Check if any exposed pung meld matches a tile in hand
  for (let mi = 0; mi < melds.length; mi++) {
    const meld = melds[mi];
    if (meld.type !== 'pung') continue;
    const pungTile = meld.tiles[0];
    const handIdx = hand.findIndex(t =>
      t.category === pungTile.category &&
      (pungTile.category === 'suit' ? (t as any).suit === (pungTile as any).suit && (t as any).value === (pungTile as any).value :
       pungTile.category === 'honor' ? (t as any).type === (pungTile as any).type :
       false)
    );
    if (handIdx >= 0) return { meldIndex: mi, handTileIndex: handIdx };
  }
  return null;
}

export function canSelfKong(hand: Tile[]): number | null {
  // Find a tile that has 4 copies in hand
  for (let i = 0; i < hand.length; i++) {
    const t = hand[i];
    if (t.category === 'bonus' || isFei(t)) continue;
    const count = hand.filter(h =>
      h.category === t.category &&
      (t.category === 'suit' ? (h as any).suit === (t as any).suit && (h as any).value === (t as any).value :
       t.category === 'honor' ? (h as any).type === (t as any).type :
       false)
    ).length;
    if (count === 4) return i;
  }
  return null;
}

export function findTilesThatWin(hand: Tile[], melds: Meld[]): Tile[] {
  // Return tiles from the suit set that would complete a winning hand
  const winners: Tile[] = [];

  // Try all possible suit/honor tiles
  const suits: Suit[] = ['bamboo', 'characters', 'dots'];
  const winds: Wind[] = ['east', 'south', 'west', 'north'];
  const dragons = ['hong', 'fa', 'baak'] as const;

  for (const suit of suits) {
    for (let v = 1; v <= 9; v++) {
      const tryTile: Tile = { category: 'suit', suit, value: v as any };
      const testHand = [...hand, tryTile];
      if (checkWin(testHand, melds)) {
        if (!winners.some(w => w.category === 'suit' && w.suit === suit && w.value === v)) {
          winners.push(tryTile);
        }
      }
    }
  }

  for (const wind of winds) {
    const tryTile: Tile = { category: 'honor', type: wind };
    const testHand = [...hand, tryTile];
    if (checkWin(testHand, melds)) {
      if (!winners.some(w => w.category === 'honor' && w.type === wind)) {
        winners.push(tryTile);
      }
    }
  }

  for (const dragon of dragons) {
    const tryTile: Tile = { category: 'honor', type: dragon };
    const testHand = [...hand, tryTile];
    if (checkWin(testHand, melds)) {
      if (!winners.some(w => w.category === 'honor' && w.type === dragon)) {
        winners.push(tryTile);
      }
    }
  }

  return winners;
}
