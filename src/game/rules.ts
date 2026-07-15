import type { Tile, GameState, Player, Meld } from '../types/mahjong';
import type { Wind, Suit, Dragon } from '../types/mahjong';
import { isFei, isHonor, sortHand } from './tiles';

// ── Win Detection ──────────────────────────────────────────
// Single-pass recursive backtracking engine.
// Correctly handles fei (joker) substitutions across winning hand formation:
// sequences, pungs/kongs, pair completion, and mixed hands.

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

type MeldMode = 'mixed' | 'sequences' | 'pungs';

function getTileKey(tile: Tile): string | null {
  if (tile.category === 'suit') return `suit:${tile.suit}:${tile.value}`;
  if (tile.category === 'honor') return `honor:${tile.type}`;
  return null;
}

function tileFromKey(key: string): Tile {
  const parts = key.split(':');
  if (parts[0] === 'suit' && parts.length === 3) {
    return {
      category: 'suit',
      suit: parts[1] as Suit,
      value: Number(parts[2]) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
    };
  }
  if (parts[0] === 'honor' && parts.length === 2) {
    return {
      category: 'honor',
      type: parts[1] as Wind | Dragon,
    };
  }
  throw new Error(`Unsupported tile key: ${key}`);
}

function buildPool(hand: Tile[]): { counts: Record<string, number>; fei: number; total: number } {
  const counts: Record<string, number> = {};
  let fei = 0;
  let total = 0;

  for (const tile of hand) {
    if (tile.category === 'bonus') continue;
    total++;
    if (isFei(tile)) {
      fei++;
      continue;
    }
    const key = getTileKey(tile);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }

  return { counts, fei, total };
}

function poolTotal(counts: Record<string, number>, fei: number): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0) + fei;
}

function cloneCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts)) as Record<string, number>;
}

function poolKey(counts: Record<string, number>, fei: number, remaining: number, mode: MeldMode): string {
  const parts = Object.keys(counts)
    .filter(k => counts[k] > 0)
    .sort()
    .map(k => `${k}:${counts[k]}`)
    .join('|');
  return `${mode}|${remaining}|${fei}|${parts}`;
}

function firstNaturalKey(counts: Record<string, number>): string | null {
  const keys = Object.keys(counts).filter(k => counts[k] > 0).sort();
  return keys.length > 0 ? keys[0] : null;
}

function consumeSequence(
  counts: Record<string, number>,
  fei: number,
  suit: Suit,
  values: number[],
  index: number,
  anchorKey: string,
  consumedAnchor: boolean,
): { counts: Record<string, number>; fei: number } | null {
  if (index === values.length) {
    return consumedAnchor ? { counts, fei } : null;
  }

  const key = `suit:${suit}:${values[index]}`;
  const isAnchorPosition = key === anchorKey;

  if (counts[key] > 0) {
    const nextCounts = cloneCounts(counts);
    nextCounts[key] -= 1;
    const result = consumeSequence(
      nextCounts,
      fei,
      suit,
      values,
      index + 1,
      anchorKey,
      consumedAnchor || isAnchorPosition,
    );
    if (result) return result;
  }

  if (!isAnchorPosition && fei > 0) {
    const result = consumeSequence(
      counts,
      fei - 1,
      suit,
      values,
      index + 1,
      anchorKey,
      consumedAnchor,
    );
    if (result) return result;
  }

  return null;
}

function canCompleteMelds(
  counts: Record<string, number>,
  fei: number,
  remaining: number,
  mode: MeldMode,
  memo: Map<string, boolean>,
): boolean {
  const total = poolTotal(counts, fei);
  if (remaining === 0) return total === 0;
  if (total !== remaining * 3) return false;
  if (total === 0) return false;
  if (fei === total) return total === remaining * 3;

  const key = poolKey(counts, fei, remaining, mode);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  const anchorKey = firstNaturalKey(counts);
  if (!anchorKey) {
    const ok = fei === remaining * 3;
    memo.set(key, ok);
    return ok;
  }

  const anchorTile = tileFromKey(anchorKey);

  if (mode !== 'pungs' && anchorTile.category === 'suit') {
    for (let start = Math.max(1, anchorTile.value - 2); start <= Math.min(7, anchorTile.value); start++) {
      const values = [start, start + 1, start + 2];
      const result = consumeSequence(cloneCounts(counts), fei, anchorTile.suit, values, 0, anchorKey, false);
      if (result && canCompleteMelds(result.counts, result.fei, remaining - 1, mode, memo)) {
        memo.set(key, true);
        return true;
      }
    }
  }

  if (mode !== 'sequences') {
    const naturalCount = counts[anchorKey] || 0;
    for (let useNatural = Math.min(3, naturalCount); useNatural >= 1; useNatural--) {
      const useFei = 3 - useNatural;
      if (useFei > fei) continue;
      const nextCounts = cloneCounts(counts);
      nextCounts[anchorKey] -= useNatural;
      const ok = canCompleteMelds(nextCounts, fei - useFei, remaining - 1, mode, memo);
      if (ok) {
        memo.set(key, true);
        return true;
      }
    }
  }

  memo.set(key, false);
  return false;
}

function canCompleteHand(playableHand: Tile[], exposedMeldCount: number, mode: MeldMode): boolean {
  const pool = buildPool(playableHand);
  const remainingMelds = 4 - exposedMeldCount;
  if (remainingMelds < 0) return false;
  if (pool.total !== remainingMelds * 3 + 2) return false;

  const memo = new Map<string, boolean>();

  if (pool.fei >= 2) {
    const nextCounts = cloneCounts(pool.counts);
    if (canCompleteMelds(nextCounts, pool.fei - 2, remainingMelds, mode, memo)) return true;
  }

  for (const key of Object.keys(pool.counts).sort()) {
    const naturalCount = pool.counts[key];
    if (naturalCount <= 0) continue;

    if (naturalCount >= 2) {
      const nextCounts = cloneCounts(pool.counts);
      nextCounts[key] -= 2;
      if (canCompleteMelds(nextCounts, pool.fei, remainingMelds, mode, memo)) return true;
    }

    if (pool.fei >= 1) {
      const nextCounts = cloneCounts(pool.counts);
      nextCounts[key] -= 1;
      if (canCompleteMelds(nextCounts, pool.fei - 1, remainingMelds, mode, memo)) return true;
    }
  }

  return false;
}

function canCompleteAfterPair(playableHand: Tile[], pair: Tile[], exposedMeldCount: number, mode: MeldMode): boolean {
  const remaining = removeTiles(playableHand, pair);
  const pool = buildPool(remaining);
  const remainingMelds = 4 - exposedMeldCount;
  if (remainingMelds < 0) return false;
  if (pool.total !== remainingMelds * 3) return false;
  return canCompleteMelds(pool.counts, pool.fei, remainingMelds, mode, new Map<string, boolean>());
}

// Find a valid pair by trying ALL pair combinations and checking if
// the remaining tiles can form the correct number of melds.
function hasPair(hand: Tile[], exposedMeldCount = 0): Tile[] | null {
  const playableHand = hand.filter(t => t.category !== 'bonus');
  const pool = buildPool(playableHand);
  const pairCandidates = getPairCandidates(playableHand, pool);

  for (const pair of pairCandidates) {
    const remaining = removeTiles(playableHand, pair);
    const remainingPool = buildPool(remaining);
    const remainingMelds = 4 - exposedMeldCount;
    if (remainingMelds < 0) continue;
    if (remainingPool.total !== remainingMelds * 3) continue;
    if (canCompleteMelds(remainingPool.counts, remainingPool.fei, remainingMelds, 'mixed', new Map<string, boolean>())) {
      return pair;
    }
  }

  return null;
}

function getPairCandidates(playableHand: Tile[], pool = buildPool(playableHand)): Tile[][] {
  const pairCandidates: Tile[][] = [];

  const feiTiles = playableHand.filter(isFei);
  if (feiTiles.length >= 2) {
    pairCandidates.push([feiTiles[0], feiTiles[1]]);
  }

  for (const key of Object.keys(pool.counts).sort()) {
    const tile = tileFromKey(key);

    if ((pool.counts[key] || 0) >= 2) {
      pairCandidates.push([tile, tile]);
    }
    if ((pool.counts[key] || 0) >= 1 && pool.fei >= 1) {
      pairCandidates.push([tile, feiTiles[0]]);
    }
  }

  return pairCandidates;
}

function collectHonorPungBonuses(
  hand: Tile[],
  melds: Meld[],
  player: Player,
  roundWind: Wind,
  visibleOnly: boolean,
  isWinningShape: boolean,
): { tai: number; breakdown: { name: string; tai: number }[] } {
  let tai = 0;
  const breakdown: { name: string; tai: number }[] = [];
  const honorOrder: (Wind | Dragon)[] = [player.seatWind, roundWind, 'hong', 'fa', 'baak'];
  const honorPriority = new Map<Wind | Dragon, number>(honorOrder.map((honor, index) => [honor, index]));

  const candidateCounts: Record<string, number> = { east: 0, south: 0, west: 0, north: 0, hong: 0, fa: 0, baak: 0 };
  let availableFei = 0;
  const sourceTiles = visibleOnly
    ? melds.flatMap(m => m.tiles)
    : [...hand, ...melds.flatMap(m => m.tiles)];

  for (const tile of sourceTiles) {
    if (tile.category === 'bonus') continue;
    if (isFei(tile)) {
      availableFei += 1;
      continue;
    }
    if (tile.category === 'honor') {
      candidateCounts[tile.type] = (candidateCounts[tile.type] || 0) + 1;
    }
  }

  const opportunities = honorOrder
    .map(honor => {
      const count = candidateCounts[honor] || 0;
      if (count <= 0) return null;
      return {
        honor,
        cost: Math.max(0, 3 - Math.min(count, 3)),
        priority: honorPriority.get(honor) ?? 0,
      };
    })
    .filter((entry): entry is { honor: Wind | Dragon; cost: number; priority: number } => entry !== null)
    .sort((a, b) => a.cost - b.cost || a.priority - b.priority);

  for (const opportunity of opportunities) {
    if (opportunity.cost > availableFei) continue;
    availableFei -= opportunity.cost;

    const label =
      opportunity.honor === player.seatWind
        ? `Seat Wind (${player.seatWind}) Pung`
        : opportunity.honor === roundWind
          ? `Round Wind (${roundWind}) Pung`
          : `${opportunity.honor} Dragon Pung`;

    tai += 1;
    breakdown.push({ name: label, tai: 1 });
  }

  return { tai, breakdown };
}

function canFormHonorLimitHand(hand: Tile[], melds: Meld[], targets: (Wind | Dragon)[]): boolean {
  const counts: Record<string, number> = {};
  let fei = 0;

  for (const tile of [...hand, ...melds.flatMap(m => m.tiles)]) {
    if (tile.category === 'bonus') continue;
    if (isFei(tile)) {
      fei++;
      continue;
    }
    if (tile.category !== 'honor') continue;
    if (!targets.includes(tile.type as Wind | Dragon)) continue;
    counts[tile.type] = (counts[tile.type] || 0) + 1;
  }

  function search(index: number, feiLeft: number): boolean {
    if (index === targets.length) return true;
    const key = targets[index];
    const natural = counts[key] || 0;

    for (let useNatural = Math.min(3, natural); useNatural >= 0; useNatural--) {
      const needFei = 3 - useNatural;
      if (useNatural === 0 && natural > 0) continue;
      if (needFei > feiLeft) continue;
      if (search(index + 1, feiLeft - needFei)) return true;
    }
    return false;
  }

  return search(0, fei);
}

export function isBigThreeDragons(hand: Tile[], melds: Meld[]): boolean {
  return canFormHonorLimitHand(hand, melds, ['hong', 'fa', 'baak']);
}

export function isDaXiSi(hand: Tile[], melds: Meld[]): boolean {
  return canFormHonorLimitHand(hand, melds, ['east', 'south', 'west', 'north']);
}

export function isWinningHand(hand: Tile[], melds: Meld[]): boolean {
  // Filter out bonus tiles — they don't count in hand
  const playableHand = hand.filter(t => t.category !== 'bonus');
  if (isThirteenWonders(hand, melds)) return true;
  if (isBigThreeDragons(hand, melds)) return true;
  if (isDaXiSi(hand, melds)) return true;

  // Count exposed melds
  let meldCount = 0;
  let meldTiles = 0;
  for (const m of melds) {
    if (m.type === 'chi' || m.type === 'pung') { meldCount++; meldTiles += 3; }
    else if (m.type === 'kong' || m.type === 'concealed-kong') { meldCount++; meldTiles += 4; }
  }

  if (playableHand.length + meldTiles < 14) return false;
  if (meldCount > 4) return false;
  return canCompleteHand(playableHand, meldCount, 'mixed');
}

export function checkWin(hand: Tile[], melds: Meld[]): boolean {
  return isWinningHand(hand, melds);
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
  // All exposed melds, if any, must be chi (sequences)
  if (!melds.every(m => m.type === 'chi')) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Find the pair
  const pair = hasPair(playableHand, melds.length);
  if (!pair) return false;

  // Pair cannot be dragon, round wind, or seat wind
  for (const tile of pair) {
    if (tile.category === 'honor') {
      if (['hong', 'fa', 'baak'].includes(tile.type)) return false;
      if (tile.type === state.roundWind) return false;
      if (state.players[playerId] && tile.type === state.players[playerId].seatWind) return false;
    }
  }

  const expectedMeldCount = 4 - melds.length;
  return expectedMeldCount >= 0 && canCompleteAfterPair(playableHand, pair, melds.length, 'sequences');
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
  // All exposed melds, if any, must be chi (sequences)
  if (!melds.every(m => m.type === 'chi')) return false;

  // Cannot have any flower, season, or animal tiles
  const player = state.players[playerId];
  if (player && (player.bonusTiles || []).length > 0) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Find the pair
  const pair = hasPair(playableHand, melds.length);
  if (!pair) return false;

  // Pair cannot be honors that give tai (dragons, round wind, seat wind)
  for (const tile of pair) {
    if (tile.category === 'honor') {
      if (['hong', 'fa', 'baak'].includes(tile.type)) return false;
      if (tile.type === state.roundWind) return false;
      if (state.players[playerId] && tile.type === state.players[playerId].seatWind) return false;
    }
  }

  const expectedMeldCount = 4 - melds.length;
  return expectedMeldCount >= 0 && canCompleteAfterPair(playableHand, pair, melds.length, 'sequences');
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

  const pair = hasPair(playableHand, melds.length);
  if (!pair) return false;
  if (!canCompleteAfterPair(playableHand, pair, melds.length, 'pungs')) return false;

  // "Must win with the eyes": winning tile must be part of the pair
  if (winningTile && !pair.some(t => tileEqual(t, winningTile))) return false;

  return true;
}

// ── Kan Kan Hu Detection ─────────────────────────────────

function canCompleteKanKanHuTiles(playableHand: Tile[]): boolean {
  const pool = buildPool(playableHand);
  if (pool.total !== 14) return false;

  const leavesFourNaturalPungs = (counts: Record<string, number>, remainingFei: number): boolean =>
    remainingFei === 0 && Object.values(counts).every(count => count % 3 === 0);

  // The concealed eyes can use the normal Fei pair rule, but Fei cannot fill pungs.
  if (pool.fei >= 2 && leavesFourNaturalPungs(pool.counts, pool.fei - 2)) {
    return true;
  }

  for (const key of Object.keys(pool.counts)) {
    const naturalCount = pool.counts[key];
    if (naturalCount >= 2) {
      const nextCounts = cloneCounts(pool.counts);
      nextCounts[key] -= 2;
      if (leavesFourNaturalPungs(nextCounts, pool.fei)) return true;
    }
    if (naturalCount >= 1 && pool.fei >= 1) {
      const nextCounts = cloneCounts(pool.counts);
      nextCounts[key] -= 1;
      if (leavesFourNaturalPungs(nextCounts, pool.fei - 1)) return true;
    }
  }

  return false;
}

// Zi Mo with four concealed natural pungs and concealed eyes.
// Any exposed meld disqualifies the hand.
function isKanKanHu(hand: Tile[], melds: Meld[], selfDraw: boolean): boolean {
  // Must be self-draw
  if (!selfDraw) return false;

  // No exposed melds at all (concealed hand)
  if (melds.length > 0) return false;

  const playableHand = hand.filter(t => t.category !== 'bonus');
  return canCompleteKanKanHuTiles(playableHand);
}

// ── Pure Honours (字一色) Detection ──────────────────────

// All tiles are honor tiles (winds + dragons), all 4 melds are pungs/kongs,
// must win with the eyes. Works for both exposed and concealed melds.
function isPureHonours(hand: Tile[], melds: Meld[], winningTile?: Tile): boolean {
  // Non-fei tiles must all be honor tiles; fei can stand in for missing honors.
  const nonFeiTiles = [...hand, ...melds.flatMap(m => m.tiles)].filter(t => !isFei(t));
  for (const t of nonFeiTiles) {
    if (t.category !== 'honor') return false;
  }

  const playableHand = hand.filter(t => t.category !== 'bonus');

  // Exposed melds must all be pungs/kongs
  if (melds.length > 0 && !melds.every(m => m.type === 'pung' || m.type === 'kong' || m.type === 'concealed-kong')) {
    return false;
  }

  // Find the pair
  const pair = hasPair(playableHand, melds.length);
  if (!pair) return false;
  if (!canCompleteAfterPair(playableHand, pair, melds.length, 'pungs')) return false;

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

  const expectedTypes = [
    'bamboo-1', 'bamboo-9',
    'characters-1', 'characters-9',
    'dots-1', 'dots-9',
    'honor-east', 'honor-south', 'honor-west', 'honor-north',
    'honor-hong', 'honor-fa', 'honor-baak'
  ] as const;

  const counts: Record<string, number> = {};
  let feiCount = 0;
  for (const t of playableHand) {
    if (isFei(t)) {
      feiCount++;
      continue;
    }
    if (t.category === 'suit') {
      if (t.value !== 1 && t.value !== 9) return false;
      counts[`${t.suit}-${t.value}`] = (counts[`${t.suit}-${t.value}`] || 0) + 1;
    } else if (t.category === 'honor') {
      counts[`honor-${t.type}`] = (counts[`honor-${t.type}`] || 0) + 1;
    } else {
      return false;
    }
  }

  for (const pairType of expectedTypes) {
    let requiredFei = 0;
    let invalid = false;
    for (const expected of expectedTypes) {
      const required = expected === pairType ? 2 : 1;
      const actual = counts[expected] || 0;
      if (actual > required) {
        invalid = true;
        break;
      }
      requiredFei += required - actual;
    }
    if (!invalid && requiredFei <= feiCount) return true;
  }
  return false;
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

export function isAutomaticWinResult(
  result: TaiResult,
  flags: {
    tianHu?: boolean;
    diHu?: boolean;
    menHu?: boolean;
    thirteenWonders?: boolean;
    qiQiangYi?: boolean;
    huaHu?: boolean;
  } = {},
): boolean {
  if (flags.tianHu || flags.diHu || flags.menHu || flags.thirteenWonders || flags.qiQiangYi || flags.huaHu) {
    return true;
  }

  return result.breakdown.some(({ name }) =>
    name.startsWith('Thirteen Wonders') ||
    name.startsWith('Big Three Dragons') ||
    name.startsWith('Da Xi Si') ||
    name.startsWith('Kan Kan Hu') ||
    name.startsWith('Shi Ba Luo Han')
  );
}

function isShiBaLuoHan(hand: Tile[], melds: Meld[]): boolean {
  const kongCount = melds.filter(m => m.type === 'kong' || m.type === 'concealed-kong').length;
  if (kongCount !== 4) return false;

  const completedHand = [...hand, ...melds.flatMap(m => m.tiles)].filter(t => t.category !== 'bonus');
  if (completedHand.length !== 18) return false;

  const tileCounts = new Map<string, number>();
  for (const tile of completedHand) {
    const key = tile.category === 'suit'
      ? `suit:${tile.suit}:${tile.value}`
      : tile.category === 'honor'
        ? `honor:${tile.type}`
        : tile.category === 'fei'
          ? 'fei'
          : null;
    if (!key) continue;
    tileCounts.set(key, (tileCounts.get(key) || 0) + 1);
  }

  return Array.from(tileCounts.values()).some(count => count === 2);
}

function getLimitHandScore(
  hand: Tile[],
  melds: Meld[],
  flags: {
    tianHu?: boolean;
    diHu?: boolean;
    menHu?: boolean;
    thirteenWonders?: boolean;
    qiQiangYi?: boolean;
    huaHu?: boolean;
    kanKanHu?: boolean;
  } = {},
): { name: string; tai: number } | null {
  if (flags.tianHu) return { name: 'Tian Hu (天胡)', tai: 10 };
  if (flags.diHu) return { name: 'Di Hu (地胡)', tai: 10 };
  if (flags.menHu) return { name: 'Men Hu (门胡)', tai: 10 };
  if (flags.thirteenWonders || isThirteenWonders(hand, melds)) return { name: 'Thirteen Wonders (十三幺)', tai: 13 };
  if (flags.qiQiangYi) return { name: 'Qi Qiang Yi (七搶一)', tai: 10 };
  if (flags.huaHu) return { name: 'Hua Hu (花胡)', tai: 12 };
  if (isBigThreeDragons(hand, melds)) return { name: 'Big Three Dragons', tai: 10 };
  if (isDaXiSi(hand, melds)) return { name: 'Da Xi Si (大四喜)', tai: 10 };
  if (flags.kanKanHu) return { name: 'Kan Kan Hu (坎坎胡)', tai: 8 };
  if (isShiBaLuoHan(hand, melds)) return { name: 'Shi Ba Luo Han (十八罗汉)', tai: 18 };
  return null;
}

export function calculateTai(state: GameState, playerId: number, selfDraw: boolean, visibleOnly: boolean = false, huaShang: boolean = false, kangShang: boolean = false, winningTile?: Tile, tianHu: boolean = false, diHu: boolean = false, menHu: boolean = false, thirteenWonders: boolean = false, qiQiangYi: boolean = false, huaHu: boolean = false): TaiResult {
  const player = state.players[playerId];
  if (!player) return { tai: 0, breakdown: [], feiPenalty: 0, totalTai: 0 };

  const breakdown: { name: string; tai: number }[] = [];
  let tai = 0;

  const hand = winningTile ? [...player.hand, winningTile] : player.hand;
  const melds = player.melds;
  const isWinningShape = checkWin(hand, melds);

  const limitHand = getLimitHandScore(hand, melds, {
    tianHu,
    diHu,
    menHu,
    thirteenWonders,
    qiQiangYi,
    huaHu,
    kanKanHu: !visibleOnly && isKanKanHu(hand, melds, selfDraw),
  });
  if (limitHand) {
    const limitBreakdown = [limitHand];
    if (limitHand.name.startsWith('Kan Kan Hu')) {
      limitBreakdown.push({ name: 'Self-Draw', tai: 1 });
    }
    const limitTai = limitBreakdown.reduce((sum, entry) => sum + entry.tai, 0);
    return {
      tai: limitTai,
      breakdown: limitBreakdown,
      feiPenalty: 0,
      totalTai: limitTai,
    };
  }

  const allTiles = [...hand, ...melds.flatMap(m => m.tiles)];
  const playableHand = hand.filter(t => t.category !== 'bonus');
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

  const honorBonus = collectHonorPungBonuses(hand, melds, player, state.roundWind, visibleOnly, isWinningShape);
  tai += honorBonus.tai;
  breakdown.push(...honorBonus.breakdown);

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
      // Full flush (same suit only): 4 tai
      tai += 4;
      breakdown.push({ name: 'Full Flush', tai: 4 });
      fullFlushVariantApplied = true;
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
    const pair = hasPair(playableHand, melds.length);
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

  // Xiao Xi Si (小四喜): 4 tai — 3 wind pungs + 4th wind as eyes
  const windPungs = melds.filter(m =>
    (m.type === 'pung' || m.type === 'kong' || m.type === 'concealed-kong') &&
    m.tiles[0]?.category === 'honor' && WIND_ORDER.includes(m.tiles[0]?.type as Wind)
  );
  const windTypes = new Set(windPungs.map(m => (m.tiles[0] as any)?.type));
  if (!visibleOnly && windTypes.size === 3) {
    const fourthWind = WIND_ORDER.find(w => !windTypes.has(w));
    const eyePair = hand.filter(t => !isFei(t)).filter(t => t.category === 'honor' && (t as any).type === fourthWind);
    if (eyePair.length >= 2) {
      tai += 4;
      breakdown.push({ name: 'Xiao Xi Si (小四喜)', tai: 4 });
    }
  }
  // Da Xi Si (大四喜): +10 tai — automatic win with all 4 wind pungs, any eyes
  if (windTypes.size === 4 || isDaXiSi(hand, melds)) {
    tai += 10;
    breakdown.push({ name: 'Da Xi Si (大四喜)', tai: 10 });
  }

  // Self-draw: 1 tai
  if (selfDraw) {
    tai += 1;
    breakdown.push({ name: 'Self-Draw', tai: 1 });
  }

  // Concealed hand (Men Qing / 门清): +1 tai
  // Win without exposing any melds (no chi/pung/kong), must be self-draw
  if (!visibleOnly && selfDraw && melds.length === 0) {
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

 // Fei has no tai penalty in this ruleset
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

  // Thirteen Wonders (十三幺): +13 tai — all 13 terminal/honor + 1 duplicate
  if (thirteenWonders) {
    tai += 13;
    breakdown.push({ name: 'Thirteen Wonders (十三幺)', tai: 13 });
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

export function getRequiredTaiForWin(threshold: number, selfDraw: boolean): number {
  return selfDraw ? threshold : threshold + 1;
}

export function canWinWithTai(
  result: TaiResult,
  threshold: number,
  selfDraw: boolean,
  automaticWin: boolean = false,
): boolean {
  if (automaticWin) return true;
  return result.totalTai >= getRequiredTaiForWin(threshold, selfDraw);
}

export function getWinThresholdReason(
  result: TaiResult,
  threshold: number,
  selfDraw: boolean,
  automaticWin: boolean = false,
): string {
  if (automaticWin) return 'Automatic win';
  const requiredTai = getRequiredTaiForWin(threshold, selfDraw);
  return `Requires ${requiredTai} tai (${result.totalTai}/${requiredTai})`;
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

export function isBlockedDiscardWinByFullSuitWait(hand: Tile[], melds: Meld[], discard: Tile): boolean {
  if (discard.category !== 'suit') return false;

  const winners = findTilesThatWin(hand, melds);
  const suitWins = winners.filter(
    tile => tile.category === 'suit' && tile.suit === discard.suit,
  );

  return suitWins.length === 9;
}
