import { calculateTai, canKong, canPung, canWinWithTai, checkWin, isAutomaticWinResult, isBlockedDiscardWinByFullSuitWait, isBigThreeDragons, isDaXiSi, isWinningHand } from '../src/game/rules';
import { createBonusTile, createFeiTile, createHonorTile, createSuitTile } from '../src/game/tiles';
import { isSelfDrawWinMethod } from '../src/game/winMethods';
import type { GameState, Meld, Player, Tile, Wind } from '../src/types/mahjong';

declare const require: any;
declare const console: {
  log: (...args: any[]) => void;
};

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected} but received ${actual}`);
  }
}

function assertOk(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function makePlayer(index: number, seatWind: Wind, hand: Tile[], melds: Meld[] = [], bonusTiles: Tile[] = []): Player {
  return {
    id: index,
    name: `Player ${index + 1}`,
    isHuman: index === 0,
    hand,
    melds,
    discards: [],
    seatWind,
    isAlive: true,
    bonusTiles,
  };
}

function makeState(players: Player[], roundWind: Wind = 'south'): GameState {
  return {
    players,
    wall: [],
    deadWall: [],
    currentPlayerIndex: 0,
    phase: 'playing',
    roundWind,
    config: {
      taiThreshold: 1,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: null,
      shooterEnabled: false,
      economyEnabled: false,
      chipSettlementMode: 'default',
    },
    lastAction: '',
    winner: null,
    winningTiles: [],
    lastDrawnTile: null,
    winMethod: null,
    discardHistory: [],
    moveHistory: [],
    hostDisconnected: false,
    playerLeft: null,
    roomPaused: false,
    roomPauseReason: null,
    diceResults: null,
    nextRoundCountdown: null,
    dealerPlayerId: null,
    chipSettlement: null,
    debugLogs: [],
  };
}

function primeStoreState(overrides: Record<string, unknown>) {
  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.setState({
    players: [],
    wall: [],
    deadWall: [],
    currentPlayerIndex: 0,
    phase: 'playing',
    roundWind: 'east',
    config: {
      taiThreshold: 1,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: null,
      shooterEnabled: false,
      economyEnabled: false,
      chipSettlementMode: 'default',
    },
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
    dealerPlayerId: 0,
    chipSettlement: null,
    debugLogs: [],
    waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    showConfig: false,
    message: '',
    selfDrawWin: false,
    isHuaShang: false,
    isKangShang: false,
    isMenHu: false,
    isTW: false,
    nextDealerPlayerId: null,
    selfKongData: null,
    dealerCount: 0,
    isMultiplayer: false,
    isHost: false,
    myPlayerIndex: 0,
    waitingForRemoteAction: false,
    ...overrides,
  });
}

function run(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok - ${name}`);
}

function standardWaitingHand(): Tile[] {
  return [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('characters', 1), createSuitTile('characters', 2), createSuitTile('characters', 3),
    createSuitTile('dots', 5),
  ];
}

function thirteenWondersWaitingHand(): Tile[] {
  return [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 9),
    createSuitTile('characters', 1), createSuitTile('characters', 9),
    createSuitTile('dots', 1), createSuitTile('dots', 9),
    createHonorTile('east'), createHonorTile('south'), createHonorTile('west'), createHonorTile('north'),
    createHonorTile('hong'), createHonorTile('fa'), createHonorTile('baak'),
  ];
}

function fillerWall(count: number): Tile[] {
  return Array.from({ length: count }, (_, index) =>
    createSuitTile(index % 2 === 0 ? 'characters' : 'dots', (index % 9) + 1)
  );
}

function kanKanHuHand(): Tile[] {
  return [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 1), createSuitTile('bamboo', 1),
    createSuitTile('characters', 2), createSuitTile('characters', 2), createSuitTile('characters', 2),
    createSuitTile('dots', 3), createSuitTile('dots', 3), createSuitTile('dots', 3),
    createHonorTile('east'), createHonorTile('east'), createHonorTile('east'),
    createHonorTile('fa'), createHonorTile('fa'),
  ];
}

run('Fei can complete a standard win shape', () => {
  const hand: Tile[] = [
    createHonorTile('east'), createHonorTile('east'), createHonorTile('east'),
    createHonorTile('south'), createHonorTile('south'), createHonorTile('south'),
    createHonorTile('west'), createHonorTile('west'), createHonorTile('west'),
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createFeiTile(),
    createSuitTile('dots', 5), createSuitTile('dots', 5),
  ];
  assertEqual(checkWin(hand, []), true, 'Fei hand should be a win');
});

run('Fei can act as the eyes in a winning hand', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createHonorTile('hong'), createHonorTile('hong'), createHonorTile('hong'),
    createFeiTile(), createFeiTile(),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Fei pair fixture should be a winning hand');
  assertOk(calculateTai(state, 0, true).breakdown.some(entry => entry.name === 'Self-Draw'), 'Fei pair fixture should still score self-draw');
});

run('Fei cannot be used to call a discard', () => {
  assertEqual(canPung([createFeiTile(), createFeiTile()], createFeiTile()), false, 'Fei should not be pung-callable from a discard');
  assertEqual(canKong([createFeiTile(), createFeiTile(), createFeiTile()], createFeiTile()), false, 'Fei should not be kong-callable from a discard');
});

run('Concealed Hand does not score when melds are exposed', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createHonorTile('hong'), createHonorTile('hong'), createHonorTile('hong'),
    createSuitTile('bamboo', 5), createSuitTile('bamboo', 5),
  ], [
    { type: 'chi', tiles: [createSuitTile('dots', 1), createSuitTile('dots', 2), createSuitTile('dots', 3)], fromPlayer: 2 },
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertEqual(result.breakdown.some(entry => entry.name === 'Concealed Hand (Men Qing)'), false, 'Exposed hand should not score Men Qing');
});

run('Ping Hu scores as a legal sequence hand', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('characters', 1), createSuitTile('characters', 2), createSuitTile('characters', 3),
    createSuitTile('dots', 5), createSuitTile('dots', 5),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Ping Hu fixture should be a winning hand');
  assertOk(result.breakdown.some(entry => entry.name === 'Ping Hu (平胡)'), 'Ping Hu fixture should score Ping Hu');
  assertEqual(result.totalTai, 6, 'Ping Hu fixture should total 6 tai with self-draw and Men Qing');
});

run('Chou Ping Hu scores when bonus tiles block Ping Hu', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('dots', 1), createSuitTile('dots', 2), createSuitTile('dots', 3),
    createSuitTile('dots', 5), createSuitTile('dots', 5),
  ], [], [createBonusTile('flower', 1)]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Chou Ping Hu fixture should still be a winning hand');
  assertOk(result.breakdown.some(entry => entry.name === 'Chou Ping Hu (臭平胡)'), 'Chou Ping Hu fixture should score Chou Ping Hu');
  assertOk(!result.breakdown.some(entry => entry.name === 'Ping Hu (平胡)'), 'Chou Ping Hu fixture should not score Ping Hu');
});

run('Full Flush scores at 4 tai', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 5), createSuitTile('bamboo', 5),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertOk(result.breakdown.some(entry => entry.name === 'Full Flush'), 'Full Flush fixture should score Full Flush');
  assertEqual(result.totalTai, 10, 'Full Flush fixture should total 10 tai with self-draw, Men Qing, and Ping Hu');
});

run('Half Flush scores when one suit mixes with honors', () => {
  const player = makePlayer(0, 'west', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createHonorTile('east'), createHonorTile('east'), createHonorTile('east'),
    createSuitTile('bamboo', 5), createSuitTile('bamboo', 5),
  ], [], []);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'east', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertOk(result.breakdown.some(entry => entry.name === 'Half Flush'), 'Half Flush fixture should score Half Flush');
  assertEqual(result.totalTai >= 3, true, 'Half Flush fixture should score at least 3 tai including self-draw');
});

run('Big Three Dragons is an automatic win fixture', () => {
  const player = makePlayer(0, 'east', [
    createHonorTile('hong'), createHonorTile('hong'), createHonorTile('hong'),
    createHonorTile('fa'), createHonorTile('fa'), createHonorTile('fa'),
    createHonorTile('baak'), createHonorTile('baak'), createHonorTile('baak'),
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createHonorTile('east'), createHonorTile('east'),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertOk(result.breakdown.some(entry => entry.name === 'Big Three Dragons'), 'Big Three Dragons fixture should score Big Three Dragons');
  assertEqual(result.totalTai, 10, 'Big Three Dragons fixture should cap at 10 tai');
  assertEqual(result.breakdown.length, 1, 'Big Three Dragons fixture should not stack lower patterns');
  assertEqual(isAutomaticWinResult(result), true, 'Big Three Dragons fixture should be automatic');
});

run('Big Three Dragons can win without a 14-tile eyes shape', () => {
  const player = makePlayer(0, 'east', [
    createHonorTile('hong'),
    createHonorTile('fa'), createHonorTile('fa'), createHonorTile('fa'),
    createFeiTile(), createFeiTile(), createFeiTile(), createFeiTile(), createFeiTile(),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(isBigThreeDragons(player.hand, player.melds), true, 'Fei-substituted Big Three Dragons should be detected directly');
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Fei-substituted Big Three Dragons should be a win');
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Big Three Dragons'), 'Fei-substituted Big Three Dragons should score');
  assertEqual(result.totalTai, 10, 'Fei-substituted Big Three Dragons should cap at 10 tai');
});

run('Xiao San Yuan scores with two dragon pungs and dragon eyes', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createHonorTile('baak'), createHonorTile('baak'),
  ], [
    { type: 'pung', tiles: [createHonorTile('hong'), createHonorTile('hong'), createHonorTile('hong')], fromPlayer: 1 },
    { type: 'pung', tiles: [createHonorTile('fa'), createHonorTile('fa'), createHonorTile('fa')], fromPlayer: 2 },
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Little Three Dragons'), 'Xiao San Yuan fixture should score Little Three Dragons');
  assertOk(result.breakdown.some(entry => entry.name === 'Dragon Eyes'), 'Xiao San Yuan fixture should score Dragon Eyes');
});

run('Xiao Xi Si scores with three wind pungs and fourth wind eyes', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createHonorTile('north'), createHonorTile('north'),
  ], [
    { type: 'pung', tiles: [createHonorTile('east'), createHonorTile('east'), createHonorTile('east')], fromPlayer: 1 },
    { type: 'pung', tiles: [createHonorTile('south'), createHonorTile('south'), createHonorTile('south')], fromPlayer: 2 },
    { type: 'pung', tiles: [createHonorTile('west'), createHonorTile('west'), createHonorTile('west')], fromPlayer: 3 },
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Xiao Xi Si (小四喜)'), 'Xiao Xi Si fixture should score Xiao Xi Si');
});

run('Da Xi Si scores as an automatic win fixture', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2),
  ], [
    { type: 'pung', tiles: [createHonorTile('east'), createHonorTile('east'), createHonorTile('east')], fromPlayer: 1 },
    { type: 'pung', tiles: [createHonorTile('south'), createHonorTile('south'), createHonorTile('south')], fromPlayer: 2 },
    { type: 'pung', tiles: [createHonorTile('west'), createHonorTile('west'), createHonorTile('west')], fromPlayer: 3 },
    { type: 'pung', tiles: [createHonorTile('north'), createHonorTile('north'), createHonorTile('north')], fromPlayer: 0 },
  ], []);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Da Xi Si (大四喜)'), 'Da Xi Si fixture should score Da Xi Si');
  assertEqual(isAutomaticWinResult(result), true, 'Da Xi Si fixture should be automatic');
});

run('Da Xi Si can win without a 14-tile eyes shape', () => {
  const player = makePlayer(0, 'east', [
    createHonorTile('east'),
    createHonorTile('south'), createHonorTile('south'), createHonorTile('south'),
    createHonorTile('west'), createHonorTile('west'), createHonorTile('west'),
    createHonorTile('north'), createHonorTile('north'), createHonorTile('north'),
    createFeiTile(), createFeiTile(),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(isDaXiSi(player.hand, player.melds), true, 'Fei-substituted Da Xi Si should be detected directly');
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Fei-substituted Da Xi Si should be a win');
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Da Xi Si (大四喜)'), 'Fei-substituted Da Xi Si should score');
});

run('Thirteen Wonders scores a textbook terminal-honor hand', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1),
    createSuitTile('bamboo', 9),
    createSuitTile('characters', 1),
    createSuitTile('characters', 9),
    createSuitTile('dots', 1),
    createSuitTile('dots', 9),
    createHonorTile('east'),
    createHonorTile('south'),
    createHonorTile('west'),
    createHonorTile('north'),
    createHonorTile('hong'),
    createHonorTile('fa'),
    createHonorTile('baak'),
    createSuitTile('dots', 9),
  ]);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Textbook Thirteen Wonders should win');
  assertEqual(checkWin(player.hand, player.melds), true, 'Textbook Thirteen Wonders should pass the win check');
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Thirteen Wonders (十三幺)'), 'Textbook Thirteen Wonders should score the limit hand');
  assertEqual(result.totalTai, 13, 'Textbook Thirteen Wonders should score 13 tai');
});

run('Thirteen Wonders accepts Fei substitution for missing terminals and honors', () => {
  const player = makePlayer(0, 'west', [
    createSuitTile('bamboo', 9),
    createSuitTile('characters', 1),
    createSuitTile('characters', 9),
    createSuitTile('dots', 1),
    createSuitTile('dots', 9),
    createSuitTile('dots', 9),
    createHonorTile('east'),
    createHonorTile('south'),
    createHonorTile('west'),
    createHonorTile('hong'),
    createHonorTile('fa'),
    createHonorTile('baak'),
    createFeiTile(),
    createFeiTile(),
  ]);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Fei-substituted Thirteen Wonders should win');
  assertEqual(checkWin(player.hand, player.melds), true, 'Fei-substituted Thirteen Wonders should pass the win check');
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Thirteen Wonders (十三幺)'), 'Fei-substituted Thirteen Wonders should score the limit hand');
  assertEqual(result.totalTai, 13, 'Fei-substituted Thirteen Wonders should score 13 tai');
});

run('Shi Ba Luo Han scores at its own 18-tai limit', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 9),
    createSuitTile('bamboo', 9),
  ], [
    { type: 'kong', tiles: [createSuitTile('bamboo', 1), createSuitTile('bamboo', 1), createSuitTile('bamboo', 1), createSuitTile('bamboo', 1)], fromPlayer: null },
    { type: 'kong', tiles: [createSuitTile('characters', 2), createSuitTile('characters', 2), createSuitTile('characters', 2), createSuitTile('characters', 2)], fromPlayer: null },
    { type: 'kong', tiles: [createSuitTile('dots', 3), createSuitTile('dots', 3), createSuitTile('dots', 3), createSuitTile('dots', 3)], fromPlayer: null },
    { type: 'kong', tiles: [createSuitTile('bamboo', 4), createSuitTile('bamboo', 4), createSuitTile('bamboo', 4), createSuitTile('bamboo', 4)], fromPlayer: null },
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Shi Ba Luo Han (十八罗汉)'), 'Shi Ba Luo Han should score the limit hand');
  assertEqual(result.totalTai, 18, 'Shi Ba Luo Han should score 18 tai');
  assertEqual(result.breakdown.length, 1, 'Shi Ba Luo Han should not stack lower patterns');
});

run('Kan Kan Hu is an 8-tai special hand plus required Zi Mo', () => {
  const player = makePlayer(0, 'east', kanKanHuHand());
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertEqual(result.totalTai, 9, 'Kan Kan Hu should total 9 tai after its required Zi Mo');
  assertEqual(result.breakdown.length, 2, 'Kan Kan Hu should show only its 8-tai special and required Zi Mo');
  assertEqual(result.breakdown[0]?.name, 'Kan Kan Hu (坎坎胡)', 'Kan Kan Hu should use the special-hand result label');
  assertEqual(result.breakdown[0]?.tai, 8, 'Kan Kan Hu should retain its 8-tai special value');
  assertEqual(result.breakdown[1]?.name, 'Self-Draw', 'Kan Kan Hu should show the required Zi Mo line');
  assertEqual(result.breakdown[1]?.tai, 1, 'Kan Kan Hu Zi Mo should add 1 tai');
  assertEqual(isAutomaticWinResult(result), true, 'Kan Kan Hu should qualify as an automatic special win');

  const visibleResult = calculateTai(state, 0, true, true);
  assertEqual(visibleResult.breakdown.some(entry => entry.name === 'Kan Kan Hu (坎坎胡)'), false, 'Visible-only scoring should not reveal concealed Kan Kan Hu');
});

run('Kan Kan Hu requires Zi Mo with four unexposed natural pungs and concealed eyes', () => {
  const concealedPlayer = makePlayer(0, 'east', kanKanHuHand());
  const discardState = makeState([concealedPlayer, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(calculateTai(discardState, 0, false).breakdown.some(entry => entry.name.startsWith('Kan Kan Hu')), false, 'Kan Kan Hu cannot win from a discard');

  const exposedPlayer = makePlayer(0, 'east', [
    createSuitTile('characters', 2), createSuitTile('characters', 2), createSuitTile('characters', 2),
    createSuitTile('dots', 3), createSuitTile('dots', 3), createSuitTile('dots', 3),
    createHonorTile('east'), createHonorTile('east'), createHonorTile('east'),
    createHonorTile('fa'), createHonorTile('fa'),
  ], [{
    type: 'pung',
    tiles: [createSuitTile('bamboo', 1), createSuitTile('bamboo', 1), createSuitTile('bamboo', 1)],
    fromPlayer: 1,
  }]);
  const exposedState = makeState([exposedPlayer, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(calculateTai(exposedState, 0, true).breakdown.some(entry => entry.name.startsWith('Kan Kan Hu')), false, 'An exposed pung disqualifies Kan Kan Hu');

  const sequencePlayer = makePlayer(0, 'east', standardWaitingHand());
  sequencePlayer.hand.push(createSuitTile('dots', 5));
  const sequenceState = makeState([sequencePlayer, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(calculateTai(sequenceState, 0, true).breakdown.some(entry => entry.name.startsWith('Kan Kan Hu')), false, 'A sequence-based concealed hand is not Kan Kan Hu');

  const feiPungPlayer = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 1), createFeiTile(),
    createSuitTile('characters', 2), createSuitTile('characters', 2), createSuitTile('characters', 2),
    createSuitTile('dots', 3), createSuitTile('dots', 3), createSuitTile('dots', 3),
    createHonorTile('east'), createHonorTile('east'), createHonorTile('east'),
    createHonorTile('fa'), createHonorTile('fa'),
  ]);
  const feiPungState = makeState([feiPungPlayer, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(calculateTai(feiPungState, 0, true).breakdown.some(entry => entry.name.startsWith('Kan Kan Hu')), false, 'Fei cannot substitute inside a Kan Kan Hu pung');
});

run('Kan Kan Hu payout ignores normal Max Tai and obeys only the special cap', () => {
  const players = [
    { ...makePlayer(0, 'east', kanKanHuHand()), chips: 1000 },
    { ...makePlayer(1, 'south', []), chips: 1000 },
    { ...makePlayer(2, 'west', []), chips: 1000 },
    { ...makePlayer(3, 'north', []), chips: 1000 },
  ];
  const baseConfig = {
    taiThreshold: 10,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020' as const,
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 2,
    economyEnabled: true,
    chipSettlementMode: 'default' as const,
  };

  primeStoreState({
    players,
    config: {
      ...baseConfig,
      specialTaiCapEnabled: false,
      specialTaiCap: 18,
    },
  });
  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().selfDrawWinAction(0);
  let state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Kan Kan Hu should win automatically even above the ordinary tai threshold');
  assertEqual(state.chipSettlement?.rawTai, 9, 'Kan Kan Hu settlement should preserve its 9-tai total');
  assertEqual(state.chipSettlement?.tai, 9, 'Normal Max Tai should not cap Kan Kan Hu');

  primeStoreState({
    players,
    config: {
      ...baseConfig,
      specialTaiCapEnabled: true,
      specialTaiCap: 5,
    },
  });
  useGameStore.getState().selfDrawWinAction(0);
  state = useGameStore.getState();
  assertEqual(state.chipSettlement?.rawTai, 9, 'Special-capped Kan Kan Hu should retain 9 raw tai');
  assertEqual(state.chipSettlement?.tai, 5, 'Caps Max Tai for Special should cap Kan Kan Hu payout');
});

run('Tian Hu, Di Hu, and Men Hu each add ten tai', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('characters', 1), createSuitTile('characters', 2), createSuitTile('characters', 3),
    createSuitTile('dots', 5), createSuitTile('dots', 5),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const tian = calculateTai(state, 0, true, false, false, false, undefined, true);
  const di = calculateTai(state, 0, false, false, false, false, undefined, false, true);
  const men = calculateTai(state, 0, true, false, false, false, undefined, false, false, true);
  assertOk(tian.breakdown.some(entry => entry.name === 'Tian Hu (天胡)'), 'Tian Hu fixture should score Tian Hu');
  assertOk(di.breakdown.some(entry => entry.name === 'Di Hu (地胡)'), 'Di Hu fixture should score Di Hu');
  assertOk(men.breakdown.some(entry => entry.name === 'Men Hu (门胡)'), 'Men Hu fixture should score Men Hu');
});

run('Di Hu discard flow finishes the round as a 10-tai limit hand', () => {
  const winningTile = createSuitTile('dots', 5);
  primeStoreState({
    players: [
      makePlayer(0, 'south', standardWaitingHand()),
      makePlayer(1, 'east', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    dealerPlayerId: 1,
    discardHistory: [winningTile],
    waitingForClaim: {
      tile: winningTile,
      fromPlayer: 1,
      eligiblePlayers: [{ playerIndex: 0, actions: ['win'] }],
    },
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().claimTile(0, 'win');
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Di Hu claim should finish the round');
  assertEqual(state.winner, 0, 'Di Hu claimant should be the winner');
  assertEqual(state.winMethod, 'discard', 'Di Hu should remain a discard win method');
  assertOk(state.message.includes('(10 tai)'), 'Di Hu result should use the locked 10-tai score');
  assertEqual(state.winningDiscardPlayer, 1, 'Di Hu should preserve the dealer as the shooter');
});

run('Men Hu draw flow exposes and commits the 10-tai limit hand', () => {
  const winningTile = createSuitTile('dots', 5);
  primeStoreState({
    players: [
      makePlayer(0, 'south', standardWaitingHand()),
      makePlayer(1, 'east', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    dealerPlayerId: 1,
    wall: [winningTile, ...fillerWall(15)],
    discardHistory: [createSuitTile('bamboo', 9)],
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  assertEqual(useGameStore.getState().selfDrawWin, true, 'Men Hu draw should expose the Win action');
  assertEqual(useGameStore.getState().isMenHu, true, 'Men Hu draw should set the special-flow flag');
  useGameStore.getState().selfDrawWinAction(0);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Men Hu commit should finish the round');
  assertEqual(state.winMethod, 'men_hu', 'Men Hu commit should preserve its result-screen method');
  assertOk(state.message.includes('(10 tai)'), 'Men Hu result should use the locked 10-tai score');
});

run('Hua Shang replacement flow preserves the winning replacement tile', () => {
  const replacementFlower = createBonusTile('flower', 2);
  const winningTile = createSuitTile('dots', 5);
  primeStoreState({
    players: [
      {
        ...makePlayer(0, 'east', [
          createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
          createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
          createSuitTile('characters', 1), createSuitTile('characters', 2), createSuitTile('characters', 3),
          createSuitTile('dots', 5),
        ], [
          {
            type: 'pung',
            tiles: [createHonorTile('fa'), createHonorTile('fa'), createHonorTile('fa')],
            fromPlayer: 1,
          },
        ], [createBonusTile('flower', 1)]),
        chips: 1000,
      },
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [replacementFlower, ...fillerWall(15), winningTile],
    config: {
      taiThreshold: 4,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: '1_2',
      startingChips: 1000,
      shooterEnabled: false,
      economyEnabled: true,
      chipSettlementMode: 'default',
    },
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  assertEqual(useGameStore.getState().selfDrawWin, true, 'Hua Shang replacement should expose the Win action');
  assertEqual(useGameStore.getState().isHuaShang, true, 'Hua Shang replacement should set the special-flow flag');
  assertEqual((useGameStore.getState().lastDrawnTile as any)?.value, 5, 'Hua Shang should preserve the back-wall winning tile');
  useGameStore.getState().selfDrawWinAction(0);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Hua Shang commit should finish the round');
  assertEqual(state.winMethod, 'hua_shang', 'Hua Shang commit should preserve its result-screen method');
  assertEqual(isSelfDrawWinMethod(state.winMethod, state.winningDiscardPlayer), true, 'Hua Shang results should retain Zi Mo scoring');
  const resultScreenScore = calculateTai(state, 0, true, false, true);
  assertEqual(resultScreenScore.totalTai, state.chipSettlement?.rawTai, 'Hua Shang result tai should match settlement tai');
  assertEqual(resultScreenScore.totalTai, 4, 'Hua Shang fixture should total exactly 4 tai');
  assertOk(resultScreenScore.breakdown.some(entry => entry.name === 'Self-Draw'), 'Hua Shang result should show the Zi Mo tai line');
});

run('Qi Qiang Yi transfers the eighth flower or season and ends the round', () => {
  const sevenFlowersAndSeasons = [
    createBonusTile('flower', 1), createBonusTile('flower', 2),
    createBonusTile('flower', 3), createBonusTile('flower', 4),
    createBonusTile('season', 1), createBonusTile('season', 2),
    createBonusTile('season', 3),
  ];
  const eighthBonus = createBonusTile('season', 4);
  primeStoreState({
    players: [
      makePlayer(0, 'east', [], [], sevenFlowersAndSeasons),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    currentPlayerIndex: 1,
    wall: [eighthBonus, ...fillerWall(15)],
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(1);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Qi Qiang Yi should finish the round immediately');
  assertEqual(state.winner, 0, 'The player holding seven flowers/seasons should win');
  assertEqual(state.winMethod, 'qi_qiang_yi', 'Qi Qiang Yi should preserve its result-screen method');
  assertEqual(state.players[0].bonusTiles.length, 8, 'The eighth flower/season should transfer to the winner');
  assertOk(state.message.includes('(10 tai)'), 'Qi Qiang Yi should use its locked 10-tai score');
});

run('Animals do not complete Qi Qiang Yi or Hua Hu', () => {
  const sevenFlowersAndSeasons = [
    createBonusTile('flower', 1), createBonusTile('flower', 2),
    createBonusTile('flower', 3), createBonusTile('flower', 4),
    createBonusTile('season', 1), createBonusTile('season', 2),
    createBonusTile('season', 3),
  ];
  primeStoreState({
    players: [
      makePlayer(0, 'east', [], [], sevenFlowersAndSeasons),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    currentPlayerIndex: 1,
    wall: [createBonusTile('animal', 1), ...fillerWall(15), createSuitTile('dots', 5)],
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(1);
  const state = useGameStore.getState();
  assertEqual(state.winMethod, null, 'An animal should not complete Qi Qiang Yi');
  assertEqual(state.winner, null, 'An animal should not create a flower/season special winner');
});

run('Hua Hu self-draw flow ends on the eighth flower or season', () => {
  const sevenFlowersAndSeasons = [
    createBonusTile('flower', 1), createBonusTile('flower', 2),
    createBonusTile('flower', 3), createBonusTile('flower', 4),
    createBonusTile('season', 1), createBonusTile('season', 2),
    createBonusTile('season', 3),
  ];
  primeStoreState({
    players: [
      makePlayer(0, 'east', [], [], sevenFlowersAndSeasons),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [createBonusTile('season', 4), ...fillerWall(15)],
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Hua Hu should finish the round immediately');
  assertEqual(state.winner, 0, 'The player self-drawing the eighth flower/season should win');
  assertEqual(state.winMethod, 'hua_hu', 'Hua Hu should preserve its result-screen method');
  assertOk(state.message.includes('(12 tai)'), 'Hua Hu should use its locked 12-tai score');
});

run('Qiang Kang Thirteen Wonders flow preserves 13 tai and the shooter', () => {
  const robbedTile = createHonorTile('east');
  const claimantHand = [createHonorTile('east'), createHonorTile('east'), createHonorTile('east')];
  primeStoreState({
    players: [
      makePlayer(0, 'north', thirteenWondersWaitingHand()),
      makePlayer(1, 'east', claimantHand),
      makePlayer(2, 'south', []),
      makePlayer(3, 'west', []),
    ],
    dealerPlayerId: 1,
    wall: fillerWall(16),
    discardHistory: [robbedTile],
    waitingForClaim: {
      tile: robbedTile,
      fromPlayer: 1,
      eligiblePlayers: [{ playerIndex: 1, actions: ['kong'] }],
    },
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().claimTile(1, 'kong');
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Qiang Kang should finish the round before the kong resolves');
  assertEqual(state.winner, 0, 'The Thirteen Wonders player should win by Qiang Kang');
  assertEqual(state.winMethod, 'thirteen_wonders', 'Qiang Kang should retain the Thirteen Wonders result method');
  assertEqual(state.winningDiscardPlayer, 1, 'The kong declarer should be recorded as the shooter');
  assertOk(state.message.includes('(13 tai)'), 'Qiang Kang Thirteen Wonders should retain its 13-tai limit');
});

run('Kang Shang self-kong flow ends on the back-wall winning tile', () => {
  const winningTile = createSuitTile('dots', 5);
  primeStoreState({
    players: [
      makePlayer(0, 'east', [
        createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
        createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
        createSuitTile('characters', 1), createSuitTile('characters', 2), createSuitTile('characters', 3),
        createSuitTile('dots', 5),
        createSuitTile('bamboo', 7),
      ], [
        {
          type: 'pung',
          tiles: [createSuitTile('bamboo', 7), createSuitTile('bamboo', 7), createSuitTile('bamboo', 7)],
          fromPlayer: 1,
        },
      ]),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [...fillerWall(15), winningTile],
  });

  const { useGameStore } = require('../src/store/gameStore');
  const handTileIndex = useGameStore.getState().players[0].hand.length - 1;
  useGameStore.getState().selfKongAction(0, 0, handTileIndex);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Kang Shang should finish after the replacement completes the hand');
  assertEqual(state.winner, 0, 'The kong declarer should win by Kang Shang');
  assertEqual(state.winMethod, 'kang_shang', 'Kang Shang should preserve its result-screen method');
  assertEqual((state.lastDrawnTile as any)?.value, 5, 'Kang Shang should preserve the back-wall winning tile');
});

run('Fei-substituted wins are legal and score normally', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createFeiTile(),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('dots', 1), createSuitTile('dots', 2), createSuitTile('dots', 3),
    createSuitTile('dots', 5), createSuitTile('dots', 5),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, true);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Fei-substituted fixture should win');
  assertOk(result.breakdown.some(entry => entry.name === 'Ping Hu (平胡)'), 'Fei-substituted fixture should score Ping Hu');
});

run('Payout tables settle discard and self-draw wins with the configured rows', () => {
  const {
    settleRoundChips,
    formatPayoutAmount,
    getChipSettlementRuleText,
    getChipSettlementTransfers,
    getPayoutTableLabel,
  } = require('../src/game/chips');
  assertEqual(getPayoutTableLabel('010_020'), '$0.10 / $0.20', '010_020 label should match the non-shooter table');
  assertEqual(getPayoutTableLabel('030_060'), '$0.30 / $0.60', '030_060 label should match the non-shooter table');
  assertEqual(getPayoutTableLabel('1_2'), '$1 / $2', '1_2 label should match the non-shooter table');
  assertEqual(formatPayoutAmount(0.1), '$0.10', '0.1 chip should format as $0.10');
  assertEqual(formatPayoutAmount(615), '$615', '615 chips should format as $615');

  const players = [
    { ...makePlayer(0, 'east', []), chips: 1000 },
    { ...makePlayer(1, 'south', []), chips: 1000 },
    { ...makePlayer(2, 'west', []), chips: 1000 },
    { ...makePlayer(3, 'north', []), chips: 1000 },
  ];

  const defaultSettlement = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020',
    startingChips: 1000,
    shooterEnabled: false,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 1, 2);
  assertEqual(defaultSettlement.players[0].chips, 1000.4, 'Default discard settlement should add 0.4 chips to the winner at 1 tai');
  assertEqual(defaultSettlement.players[1].chips, 999.9, 'Default discard settlement should charge the non-discarding opponent 0.1 chips');
  assertEqual(defaultSettlement.players[2].chips, 999.8, 'Default discard settlement should charge the shooter 0.2 chips');
  assertEqual(defaultSettlement.players[3].chips, 999.9, 'Default discard settlement should charge the other non-discarding opponent 0.1 chips');
  assertEqual(defaultSettlement.summary?.mode, 'discard', 'Default discard settlement should report discard mode');
  assertEqual(defaultSettlement.summary?.settlementStyle, 'default', 'Default discard settlement should report default style');
  assertEqual(
    getChipSettlementRuleText(defaultSettlement.summary),
    'Non-shooter pay: each non-discarder pays $0.10 and the discarder pays $0.20 for 1 tai.',
    'Default discard result wording should use the amounts applied to chip balances',
  );

  const shooterSettlement = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020',
    startingChips: 1000,
    shooterEnabled: true,
    economyEnabled: true,
    chipSettlementMode: 'shooter',
  }, 0, 1, 2);
  assertEqual(shooterSettlement.players[0].chips, 1000.4, 'Shooter settlement should add 0.4 chips to the winner at 1 tai');
  assertEqual(shooterSettlement.players[1].chips, 1000, 'Shooter settlement should leave non-shooters unchanged');
  assertEqual(shooterSettlement.players[2].chips, 999.6, 'Shooter settlement should charge only the shooter');
  assertEqual(shooterSettlement.players[3].chips, 1000, 'Shooter settlement should leave the other non-shooter unchanged');
  assertEqual(
    getChipSettlementRuleText(shooterSettlement.summary),
    'Shooter pay: only the shooter pays $0.40 for 1 tai.',
    'Shooter result wording should use the amount applied to the shooter',
  );

  const selfDrawSettlement = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '030_060',
    startingChips: 1000,
    shooterEnabled: false,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 4, null);
  assertEqual(selfDrawSettlement.players[0].chips, 1030, 'Self-draw settlement should add 30 chips to the winner at 4 tai');
  assertEqual(selfDrawSettlement.players[1].chips, 990, 'Self-draw settlement should charge each opponent 10 chips at 4 tai');
  assertEqual(selfDrawSettlement.players[2].chips, 990, 'Self-draw settlement should charge each opponent 10 chips at 4 tai');
  assertEqual(selfDrawSettlement.players[3].chips, 990, 'Self-draw settlement should charge each opponent 10 chips at 4 tai');
  assertEqual(selfDrawSettlement.summary?.mode, 'self_draw', 'Self-draw settlement should report self-draw mode');
  assertEqual(
    getChipSettlementRuleText(selfDrawSettlement.summary),
    'Self-draw pay: each opponent pays $10 for 4 tai.',
    'Zi Mo result wording should use the amount applied to every opponent',
  );

  for (const settlement of [defaultSettlement, shooterSettlement, selfDrawSettlement]) {
    const summary = settlement.summary;
    assertOk(summary, 'Enabled payout table should produce a settlement summary');
    const transfers = getChipSettlementTransfers(summary);
    const totalDelta = transfers.reduce((total: number, entry: { delta: number }) => total + entry.delta, 0);
    const payerLosses = transfers
      .filter((entry: { delta: number }) => entry.delta < 0)
      .reduce((total: number, entry: { delta: number }) => total + Math.abs(entry.delta), 0);
    assertEqual(Math.round(totalDelta * 100), 0, 'Every settlement should remain zero-sum at chip precision');
    assertEqual(
      Math.round(summary.winnerDelta * 100),
      Math.round(payerLosses * 100),
      'Winner gain should equal the combined payer losses at chip precision',
    );
    for (const delta of summary.playerDeltas) {
      assertEqual(
        settlement.players[delta.playerIndex].chips,
        1000 + delta.delta,
        `P${delta.playerIndex + 1} final chips should exactly match the displayed settlement delta`,
      );
    }
  }

  const shooter030 = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '030_060',
    startingChips: 1000,
    shooterEnabled: true,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 10, 2);
  assertEqual(shooter030.summary?.settlementStyle, 'shooter', 'The visible Shooter toggle should be authoritative if legacy mode data drifts');
  assertEqual(shooter030.summary?.shooterPerTai, 1231, '030_060 Shooter payout should use the supplied 10-tai Shooter row');
  assertEqual(shooter030.players[0].chips, 2231, '030_060 10-tai Shooter win should credit $1,231');
  assertEqual(shooter030.players[2].chips, -231, '030_060 10-tai Shooter loss should debit $1,231');
  assertEqual(
    getChipSettlementRuleText(shooter030.summary),
    'Shooter pay: only the shooter pays $1,231 for 10 tai.',
    '030_060 Shooter result wording should match the corrected chip transfer',
  );
  const shooter030Rows = [4, 7, 11, 20, 40, 79, 155, 308, 616, 1231];
  shooter030Rows.forEach((expected: number, index: number) => {
    const tai = index + 1;
    const settlement = settleRoundChips(players, {
      taiThreshold: 1,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: '030_060',
      startingChips: 1000,
      shooterEnabled: true,
      economyEnabled: true,
      chipSettlementMode: 'shooter',
    }, 0, tai, 2);
    assertEqual(settlement.summary?.shooterPerTai, expected, `030_060 Shooter row should match the supplied ${tai}-tai payout`);
    assertEqual(settlement.summary?.winnerDelta, expected, `030_060 ${tai}-tai winner gain should match the result amount`);
    assertEqual(settlement.summary?.playerDeltas[2]?.delta, -expected, `030_060 ${tai}-tai shooter loss should match the result amount`);
  });

  const special030SelfDraw = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '030_060',
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 10,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 13, null, 13);
  assertEqual(special030SelfDraw.summary?.tai, 13, '030_060 special self-draw should bypass the cap');
  assertEqual(special030SelfDraw.summary?.selfDrawPerTai, 4916, '030_060 special self-draw should use the 13-tai row');

  const special030Shooter = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '030_060',
    startingChips: 1000,
    shooterEnabled: true,
    maxTai: 10,
    economyEnabled: true,
    chipSettlementMode: 'shooter',
  }, 0, 18, 2, 18);
  assertEqual(special030Shooter.summary?.tai, 18, '030_060 special shooter settlement should bypass the cap');
  assertEqual(special030Shooter.summary?.shooterPerTai, 314575, '030_060 special shooter settlement should use the 18-tai row');

  const specialSelfDrawSettlement = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020',
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 10,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 13, null, 13);
  assertEqual(specialSelfDrawSettlement.summary?.rawTai, 13, 'Special self-draw settlement should preserve the raw tai total');
  assertEqual(specialSelfDrawSettlement.summary?.tai, 13, 'Special self-draw settlement should bypass the cap');
  assertEqual(specialSelfDrawSettlement.summary?.selfDrawPerTai, 819.2, 'Special self-draw settlement should use the 13-tai row');

  const specialShooterSettlement = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '1_2',
    startingChips: 1000,
    shooterEnabled: true,
    maxTai: 10,
    economyEnabled: true,
    chipSettlementMode: 'shooter',
  }, 0, 18, 2, 18);
  assertEqual(specialShooterSettlement.summary?.rawTai, 18, 'Special shooter settlement should preserve the raw tai total');
  assertEqual(specialShooterSettlement.summary?.tai, 18, 'Special shooter settlement should bypass the cap');
  assertEqual(specialShooterSettlement.summary?.shooterPerTai, 524288, 'Special shooter settlement should use the 18-tai row');

  const specialCapOnSettlement = settleRoundChips(players, {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020',
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 2,
    specialTaiCapEnabled: true,
    specialTaiCap: 9,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 13, null, 9);
  assertEqual(specialCapOnSettlement.summary?.tai, 9, 'Special cap should limit special hands to the configured tai');
  assertEqual(specialCapOnSettlement.summary?.maxTai, 2, 'Special cap should not change the normal max tai cap');
  assertEqual(specialCapOnSettlement.summary?.selfDrawPerTai, 51.2, 'Special cap should use the 9-tai row for 010_020');
});

run('Hua Shang and Kan Kan Hu chip settlement matches the result-screen payout rows', () => {
  const { settleRoundChips, getChipSettlementRuleText } = require('../src/game/chips');
  const players = [
    { ...makePlayer(0, 'east', []), chips: 1000 },
    { ...makePlayer(1, 'south', []), chips: 1000 },
    { ...makePlayer(2, 'west', []), chips: 1000 },
    { ...makePlayer(3, 'north', []), chips: 1000 },
  ];
  const config = {
    taiThreshold: 4,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '1_2' as const,
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 10,
    specialTaiCapEnabled: false,
    specialTaiCap: 18,
    economyEnabled: true,
    chipSettlementMode: 'default' as const,
  };

  const huaShang = settleRoundChips(players, config, 0, 4, null);
  assertEqual(huaShang.summary?.selfDrawPerTai, 16, '4-tai Hua Shang should use the $16 Zi Mo row');
  assertEqual(huaShang.summary?.winnerDelta, 48, '4-tai Hua Shang winner should receive $48 total');
  assertEqual(huaShang.players[0].chips, 1048, 'Hua Shang winner chips should increase by $48');
  assertEqual(huaShang.players[1].chips, 984, 'Each Hua Shang opponent should pay $16');
  assertEqual(getChipSettlementRuleText(huaShang.summary), 'Self-draw pay: each opponent pays $16 for 4 tai.', 'Hua Shang result wording should match its deltas');

  const kanKanHu = settleRoundChips(players, config, 0, 9, null, 9);
  assertEqual(kanKanHu.summary?.selfDrawPerTai, 512, '9-tai Kan Kan Hu should use the $512 Zi Mo row');
  assertEqual(kanKanHu.summary?.winnerDelta, 1536, '9-tai Kan Kan Hu winner should receive $1,536 total');
  assertEqual(kanKanHu.players[0].chips, 2536, 'Kan Kan Hu winner chips should increase by $1,536');
  assertEqual(kanKanHu.players[1].chips, 488, 'Each Kan Kan Hu opponent should pay $512');
  assertEqual(getChipSettlementRuleText(kanKanHu.summary), 'Self-draw pay: each opponent pays $512 for 9 tai.', 'Kan Kan Hu result wording should match its deltas');

  const cappedKanKanHu = settleRoundChips(players, {
    ...config,
    specialTaiCapEnabled: true,
    specialTaiCap: 5,
  }, 0, 9, null, 5);
  assertEqual(cappedKanKanHu.summary?.tai, 5, 'Special cap should select the 5-tai Kan Kan Hu payout row');
  assertEqual(cappedKanKanHu.summary?.selfDrawPerTai, 32, 'Special-capped Kan Kan Hu should charge $32 per opponent');
  assertEqual(cappedKanKanHu.summary?.winnerDelta, 96, 'Special-capped Kan Kan Hu winner should receive $96 total');
  assertEqual(cappedKanKanHu.players[0].chips, 1096, 'Special-capped winner chips should increase by $96');
  assertEqual(cappedKanKanHu.players[1].chips, 968, 'Each special-capped opponent should pay $32');
  assertEqual(getChipSettlementRuleText(cappedKanKanHu.summary), 'Self-draw pay: each opponent pays $32 for 5 tai.', 'Special-cap wording should match applied deltas');
});

run('Every configured payout row is used consistently for discard, Shooter, and Zi Mo', () => {
  const { settleRoundChips } = require('../src/game/chips');
  const players = [
    { ...makePlayer(0, 'east', []), chips: 1000000 },
    { ...makePlayer(1, 'south', []), chips: 1000000 },
    { ...makePlayer(2, 'west', []), chips: 1000000 },
    { ...makePlayer(3, 'north', []), chips: 1000000 },
  ];
  const tables = [
    {
      key: '010_020',
      nonShooter: [0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6, 819.2, 1638.4, 3276.8, 6553.6, 13107.2],
      shooter: [0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6, 819.2, 1638.4, 3276.8, 6553.6, 13107.2, 26214.4, 52428.8],
      selfDraw: [0.2, 0.4, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6, 51.2, 102.4, 204.8, 409.6, 819.2, 1638.4, 3276.8, 6553.6, 13107.2, 26214.4],
    },
    {
      key: '030_060',
      nonShooter: [1, 2, 3, 5, 10, 20, 39, 77, 154, 308, 615, 1229, 2458, 4916, 9831, 19661, 39322, 78644],
      shooter: [4, 7, 11, 20, 40, 79, 155, 308, 616, 1231, 2459, 4916, 9832, 19663, 39323, 78644, 157288, 314575],
      selfDraw: [2, 3, 5, 10, 20, 39, 77, 154, 308, 615, 1229, 2458, 4916, 9831, 19661, 39322, 78644, 157287],
    },
    {
      key: '1_2',
      nonShooter: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072],
      shooter: [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288],
      selfDraw: [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144],
    },
  ] as const;

  for (const table of tables) {
    for (let index = 0; index < 18; index++) {
      const tai = index + 1;
      const baseConfig = {
        taiThreshold: 1,
        unlimitedTai: false,
        feiCount: 4,
        payoutTable: table.key,
        startingChips: 1000000,
        maxTai: 10,
        economyEnabled: true,
      };
      const discard = settleRoundChips(players, {
        ...baseConfig,
        shooterEnabled: false,
        chipSettlementMode: 'default',
      }, 0, tai, 2, tai);
      const shooter = settleRoundChips(players, {
        ...baseConfig,
        shooterEnabled: true,
        chipSettlementMode: 'shooter',
      }, 0, tai, 2, tai);
      const selfDraw = settleRoundChips(players, {
        ...baseConfig,
        shooterEnabled: false,
        chipSettlementMode: 'default',
      }, 0, tai, null, tai);

      assertEqual(discard.summary?.nonShooterPerTai, table.nonShooter[index], `${table.key} ${tai}-tai non-discarder row should match configuration`);
      assertEqual(discard.summary?.selfDrawPerTai, table.selfDraw[index], `${table.key} ${tai}-tai discarder row should match configuration`);
      assertEqual(shooter.summary?.shooterPerTai, table.shooter[index], `${table.key} ${tai}-tai Shooter row should match configuration`);
      assertEqual(selfDraw.summary?.selfDrawPerTai, table.selfDraw[index], `${table.key} ${tai}-tai Zi Mo row should match configuration`);
    }
  }
});

run('Chip match-over detection and final standings use settled balances', () => {
  const { formatPayoutAmount, getChipStandings, isChipMatchOver } = require('../src/game/chips');
  const players = [
    { ...makePlayer(0, 'east', []), chips: 1120 },
    { ...makePlayer(1, 'south', []), chips: 0 },
    { ...makePlayer(2, 'west', []), chips: 980 },
    { ...makePlayer(3, 'north', []), chips: -100 },
  ];
  const economyConfig = {
    taiThreshold: 1,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '1_2' as const,
    startingChips: 1000,
    shooterEnabled: false,
    economyEnabled: true,
    chipSettlementMode: 'default' as const,
  };

  assertEqual(isChipMatchOver(players, economyConfig), true, 'A settled $0 or negative balance should end the chip match');
  assertEqual(isChipMatchOver(players, { ...economyConfig, economyEnabled: false }), false, 'Disabled chip economy should not trigger match over');
  assertEqual(isChipMatchOver(players, { ...economyConfig, payoutTable: 'none' }), false, 'No-payout games should not trigger chip match over');
  const standings = getChipStandings(players);
  assertEqual(standings.map((standing: any) => standing.playerIndex).join(','), '0,2,1,3', 'Final standings should rank players by chips descending');
  assertEqual(standings[0].chips, 1120, 'The top player should retain the highest settled chip balance');
  assertEqual(formatPayoutAmount(-100), '-$100', 'Negative final balances should use readable currency formatting');
});

run('Match Play Again readiness includes bots and requires every seat', () => {
  const { createMatchReadyState, areAllMatchSeatsReady, isChipMatchOverState } = require('../../../server/matchLifecycle.cjs');
  const players = [
    { ...makePlayer(0, 'east', []), chips: 1000, isHuman: true },
    { ...makePlayer(1, 'south', []), chips: 0, isHuman: true },
    { ...makePlayer(2, 'west', []), chips: 1000, isHuman: false },
    { ...makePlayer(3, 'north', []), chips: 1000, isHuman: false },
  ];
  const state = makeState(players);
  state.phase = 'finished';
  state.winner = 0;
  state.chipSettlement = {
    payoutTable: '1_2',
    settlementStyle: 'default',
    mode: 'discard',
    tai: 1,
    rawTai: 1,
    maxTai: 10,
    winnerIndex: 0,
    winnerDelta: 4,
    playerDeltas: [
      { playerIndex: 0, delta: 4 },
      { playerIndex: 1, delta: -2 },
      { playerIndex: 2, delta: -1 },
      { playerIndex: 3, delta: -1 },
    ],
    nonShooterPerTai: 1,
    shooterPerTai: 4,
    selfDrawPerTai: 2,
    shooterIndex: 1,
  };
  state.config = {
    ...state.config,
    payoutTable: '1_2',
    startingChips: 1000,
    economyEnabled: true,
  };

  assertEqual(isChipMatchOverState(state), true, 'The VM should detect the same settled match-over boundary as the browser');
  const ready = createMatchReadyState(players);
  assertEqual(ready.join(','), 'false,false,true,true', 'Bot seats should be ready automatically');
  assertEqual(areAllMatchSeatsReady(ready), false, 'Human seats must still press Play Again');
  ready[0] = true;
  ready[1] = true;
  assertEqual(areAllMatchSeatsReady(ready), true, 'The rematch countdown should start only after all four seats are ready');
});

run('Stale multiplayer state cannot replace an active singleplayer game', () => {
  const { shouldAcceptMultiplayerState } = require('../src/utils/multiplayerState');
  assertEqual(
    shouldAcceptMultiplayerState({ phase: 'playing', isMultiplayer: false }, 'ABCD'),
    false,
    'An active singleplayer game should reject delayed room state',
  );
  assertEqual(
    shouldAcceptMultiplayerState({ phase: 'finished', isMultiplayer: false }, 'ABCD'),
    false,
    'A finished singleplayer game should reject delayed room state',
  );
  assertEqual(
    shouldAcceptMultiplayerState({ phase: 'playing', isMultiplayer: true }, 'ABCD'),
    true,
    'An active multiplayer game should continue accepting canonical room state',
  );
  assertEqual(
    shouldAcceptMultiplayerState({ phase: 'setup', isMultiplayer: false }, 'ABCD'),
    true,
    'A stored-room reconnect should accept its initial multiplayer snapshot',
  );
  assertEqual(
    shouldAcceptMultiplayerState({ phase: 'setup', isMultiplayer: false }, ''),
    false,
    'State updates should be rejected after room identity is cleared',
  );
});

run('Multiplayer move-history deltas are compact and idempotent', () => {
  const { buildMultiplayerStatePatch } = require('../src/utils/multiplayerState');
  const current = {
    ...makeState([
      makePlayer(0, 'east', []),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ]),
    moveHistory: ['first move'],
  } as any;
  const message = {
    full: false,
    state: { currentPlayerIndex: 1 },
    moveHistoryStart: 1,
    moveHistoryAppend: ['second move'],
  };
  const firstPatch = buildMultiplayerStatePatch(current, message);
  const next = { ...current, ...firstPatch };
  const secondPatch = buildMultiplayerStatePatch(next, message);
  const repeated = { ...next, ...secondPatch };
  assertEqual(next.moveHistory.join(','), 'first move,second move', 'Move-history deltas should append new canonical entries');
  assertEqual(repeated.moveHistory.join(','), 'first move,second move', 'Duplicate listeners must not duplicate move-history entries');
});

run('Canonical patches preserve references for unchanged table data', () => {
  const { buildMultiplayerStatePatch } = require('../src/utils/multiplayerState');
  const current = {
    ...makeState([
      makePlayer(0, 'east', [createSuitTile('bamboo', 1)]),
      makePlayer(1, 'south', [createSuitTile('dots', 2)]),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ]),
    wall: [createSuitTile('characters', 3)],
    moveHistory: [],
  } as any;
  const incoming = JSON.parse(JSON.stringify(current));
  incoming.currentPlayerIndex = 1;
  const patch = buildMultiplayerStatePatch(current, { full: true, state: incoming });
  assertEqual(patch.players, current.players, 'Unchanged player rows should retain the current array reference');
  assertEqual(patch.players[0], current.players[0], 'Unchanged player objects should retain their references');
  assertEqual(patch.wall, current.wall, 'An unchanged wall should retain its current reference');

  incoming.players[1].hand.push(createSuitTile('dots', 3));
  const changedPatch = buildMultiplayerStatePatch(current, { full: true, state: incoming });
  assertEqual(changedPatch.players[0], current.players[0], 'Unchanged seats should remain referentially stable');
  assertEqual(changedPatch.players[1] === current.players[1], false, 'A changed seat must receive the new canonical player object');
});

run('Multiplayer revisions reject duplicate snapshots and reset for reconnects', () => {
  const { MultiplayerStateRevisionGate } = require('../src/utils/multiplayerState');
  const gate = new MultiplayerStateRevisionGate();
  assertEqual(gate.shouldApply('ABCD', 1), true, 'The first canonical revision should apply');
  assertEqual(gate.shouldApply('ABCD', 1), false, 'The same canonical revision should not apply twice');
  assertEqual(gate.shouldApply('ABCD', 0), false, 'An older canonical revision should be rejected');
  assertEqual(gate.shouldApply('ABCD', 2), true, 'A newer canonical revision should apply');
  gate.reset('ABCD');
  assertEqual(gate.shouldApply('ABCD', 2), true, 'Reconnect reset should accept a full snapshot at the current revision');
  assertEqual(gate.shouldApply('WXYZ', 1), true, 'A newly recreated room should start a separate revision sequence');
  assertEqual(gate.shouldApply('', 2), false, 'Snapshots without an active room identity should be rejected');
});

run('Ordinary draws come from the front of the live wall', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', []),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createSuitTile('bamboo', 1),
      createSuitTile('bamboo', 2),
      createSuitTile('bamboo', 3),
      createSuitTile('bamboo', 4),
      createSuitTile('bamboo', 5),
      createSuitTile('bamboo', 6),
      createSuitTile('bamboo', 7),
      createSuitTile('bamboo', 8),
      createSuitTile('bamboo', 9),
      createSuitTile('characters', 1),
      createSuitTile('characters', 2),
      createSuitTile('characters', 3),
      createSuitTile('characters', 4),
      createSuitTile('characters', 5),
      createSuitTile('characters', 6),
      createSuitTile('characters', 7),
      createSuitTile('characters', 8),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  const state = useGameStore.getState();
  assertEqual(state.players[0].hand.length, 1, 'Front draw should add one tile');
  assertEqual(state.lastDrawnTile?.category, 'suit', 'Front draw should add a suit tile');
  assertEqual((state.lastDrawnTile as any)?.suit, 'bamboo', 'Front draw should take the first live-wall tile');
  assertEqual((state.lastDrawnTile as any)?.value, 1, 'Front draw should take the first live-wall tile value');
  assertEqual((state.wall[0] as any).suit, 'bamboo', 'Live wall should advance from the front');
  assertEqual((state.wall[0] as any).value, 2, 'Live wall should keep the remaining front tile');
  assertEqual(state.deadWall.length, 0, 'There should be no hidden dead wall reserve');
});

run('Bonus replacement draws from the back of the wall', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', []),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createBonusTile('flower', 1),
      createSuitTile('bamboo', 1),
      createSuitTile('characters', 1),
      createSuitTile('dots', 1),
      createSuitTile('bamboo', 3),
      createSuitTile('characters', 3),
      createSuitTile('dots', 3),
      createSuitTile('bamboo', 4),
      createSuitTile('characters', 4),
      createSuitTile('dots', 4),
      createSuitTile('bamboo', 5),
      createSuitTile('characters', 5),
      createSuitTile('dots', 5),
      createSuitTile('bamboo', 6),
      createSuitTile('characters', 6),
      createSuitTile('characters', 7),
      createSuitTile('characters', 8),
      createSuitTile('bamboo', 2),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  const state = useGameStore.getState();
  assertEqual(state.players[0].bonusTiles.length, 1, 'Bonus draw should move the flower into bonus tiles');
  assertEqual(state.players[0].hand.length, 1, 'Bonus draw should leave one replacement tile in hand');
  assertEqual((state.lastDrawnTile as any)?.suit, 'bamboo', 'Bonus replacement should come from the back of the wall');
  assertEqual((state.lastDrawnTile as any)?.value, 2, 'Bonus replacement should come from the back of the wall');
  assertEqual(state.deadWall.length, 0, 'There should be no hidden dead wall reserve');
});

run('Kong replacement draws from the back of the wall', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', [
        createSuitTile('dots', 5),
      ], [
        { type: 'pung', tiles: [createSuitTile('dots', 5), createSuitTile('dots', 5), createSuitTile('dots', 5)], fromPlayer: 1 },
      ]),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createSuitTile('bamboo', 1),
      createSuitTile('characters', 1),
      createSuitTile('bamboo', 2),
      createSuitTile('characters', 3),
      createSuitTile('bamboo', 3),
      createSuitTile('characters', 4),
      createSuitTile('bamboo', 4),
      createSuitTile('characters', 5),
      createSuitTile('bamboo', 5),
      createSuitTile('characters', 6),
      createSuitTile('bamboo', 6),
      createSuitTile('characters', 7),
      createSuitTile('bamboo', 7),
      createSuitTile('characters', 8),
      createSuitTile('bamboo', 8),
      createSuitTile('characters', 2),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
    waitingForClaim: {
      tile: createSuitTile('dots', 5),
      fromPlayer: 1,
      eligiblePlayers: [{ playerIndex: 0, actions: ['kong'] }],
    },
    discardHistory: [createSuitTile('dots', 5)],
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().claimTile(0, 'kong');
  const state = useGameStore.getState();
  assertEqual(state.players[0].melds.some(meld => meld.type === 'kong'), true, 'Kong claim should resolve the meld');
  assertEqual(state.players[0].hand.length, 1, 'Kong claim should draw a replacement tile');
  assertEqual((state.players[0].hand.find(tile => tile.category === 'suit') as any)?.suit, 'characters', 'Kong replacement should come from the back of the wall');
  assertEqual((state.players[0].hand.find(tile => tile.category === 'suit') as any)?.value, 2, 'Kong replacement should come from the back of the wall');
  assertEqual(state.deadWall.length, 0, 'There should be no hidden dead wall reserve');
});

run('Wall at 15 ends after a normal draw resolves', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', []),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createSuitTile('bamboo', 1),
      createSuitTile('bamboo', 2),
      createSuitTile('bamboo', 3),
      createSuitTile('bamboo', 4),
      createSuitTile('bamboo', 5),
      createSuitTile('bamboo', 6),
      createSuitTile('bamboo', 7),
      createSuitTile('bamboo', 8),
      createSuitTile('bamboo', 9),
      createSuitTile('characters', 1),
      createSuitTile('characters', 2),
      createSuitTile('characters', 3),
      createSuitTile('characters', 4),
      createSuitTile('characters', 5),
      createSuitTile('characters', 6),
      createSuitTile('characters', 7),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
    roundHadKong: false,
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Wall-at-15 should end the round after a normal draw');
  assertEqual(state.winner, null, 'Wall-at-15 should not create a winner on a plain draw');
  assertEqual(state.roundEndReason, 'draw', 'Wall-at-15 without a kong should be labeled as a draw');
  assertEqual(state.nextDealerPlayerId, 1, 'Wall-at-15 should advance the dealer to the next player');
  assertEqual(state.dealerPlayerId, 0, 'Wall-at-15 should preserve the current dealer until the next round starts');
  assertOk(state.message.includes('15 tiles'), 'Wall-at-15 should use the new draw message');
});

run('Wall at 15 ends the round after a kong happened', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', [
        createSuitTile('dots', 5),
      ], [
        { type: 'pung', tiles: [createSuitTile('dots', 5), createSuitTile('dots', 5), createSuitTile('dots', 5)], fromPlayer: 1 },
      ]),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createSuitTile('bamboo', 1),
      createSuitTile('bamboo', 2),
      createSuitTile('bamboo', 3),
      createSuitTile('bamboo', 4),
      createSuitTile('bamboo', 5),
      createSuitTile('bamboo', 6),
      createSuitTile('bamboo', 7),
      createSuitTile('bamboo', 8),
      createSuitTile('bamboo', 9),
      createSuitTile('characters', 1),
      createSuitTile('characters', 2),
      createSuitTile('characters', 3),
      createSuitTile('characters', 4),
      createSuitTile('characters', 5),
      createSuitTile('characters', 6),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
    roundHadKong: true,
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().drawTile(0);
  const state = useGameStore.getState();
  assertEqual(state.phase, 'finished', 'Wall-at-15 should end the round');
  assertEqual(state.winner, null, 'Wall-at-15 should not create a winner');
  assertEqual(state.roundEndReason, 'kong_exhaustion', 'Wall-at-15 after a kong should not be labeled as a plain draw');
  assertEqual(state.nextDealerPlayerId, 1, 'Wall-at-15 should advance the dealer to the next player');
  assertEqual(state.dealerPlayerId, 0, 'Wall-at-15 should preserve the current dealer until the next round starts');
  assertEqual(state.roundHadKong, true, 'Wall-at-15 should record that a kong happened in the round');
  assertOk(state.message.includes('Kong round ended'), 'Wall-at-15 should use a kong-specific message');
});

run('Self-kong replacement also draws from the back of the wall', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', [
        createSuitTile('bamboo', 7),
      ], [
        { type: 'pung', tiles: [createSuitTile('bamboo', 7), createSuitTile('bamboo', 7), createSuitTile('bamboo', 7)], fromPlayer: 1 },
      ]),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createSuitTile('dots', 1),
      createSuitTile('dots', 2),
      createSuitTile('dots', 3),
      createSuitTile('dots', 4),
      createSuitTile('dots', 5),
      createSuitTile('dots', 6),
      createSuitTile('dots', 7),
      createSuitTile('dots', 8),
      createSuitTile('dots', 9),
      createSuitTile('characters', 1),
      createSuitTile('characters', 2),
      createSuitTile('characters', 3),
      createSuitTile('characters', 4),
      createSuitTile('characters', 5),
      createSuitTile('characters', 6),
      createSuitTile('dots', 9),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().selfKongAction(0, 0, 0);
  const state = useGameStore.getState();
  assertEqual(state.players[0].melds.some(meld => meld.type === 'kong'), true, 'Self-kong should upgrade the pung');
  assertEqual(state.players[0].hand.length, 1, 'Self-kong should draw a replacement tile');
  assertEqual((state.players[0].hand.find(tile => tile.category === 'suit') as any)?.suit, 'dots', 'Self-kong replacement should come from the back of the wall');
  assertEqual((state.players[0].hand.find(tile => tile.category === 'suit') as any)?.value, 9, 'Self-kong replacement should come from the back of the wall');
  assertEqual(state.deadWall.length, 0, 'There should be no hidden dead wall reserve');
});

run('Concealed kong moves all four matching tiles into a meld', () => {
  primeStoreState({
    players: [
      makePlayer(0, 'east', [
        createSuitTile('dots', 2),
        createSuitTile('bamboo', 7),
        createSuitTile('bamboo', 7),
        createSuitTile('bamboo', 7),
        createSuitTile('bamboo', 7),
      ]),
      makePlayer(1, 'south', []),
      makePlayer(2, 'west', []),
      makePlayer(3, 'north', []),
    ],
    wall: [
      createSuitTile('characters', 1),
      createSuitTile('characters', 2),
      createSuitTile('characters', 3),
      createSuitTile('characters', 4),
      createSuitTile('characters', 5),
      createSuitTile('characters', 6),
      createSuitTile('characters', 7),
      createSuitTile('characters', 8),
      createSuitTile('characters', 9),
      createSuitTile('dots', 1),
      createSuitTile('dots', 3),
      createSuitTile('dots', 4),
      createSuitTile('dots', 5),
      createSuitTile('dots', 6),
      createSuitTile('dots', 7),
      createSuitTile('dots', 8),
    ],
    deadWall: [],
    currentPlayerIndex: 0,
    dealerPlayerId: 0,
  });

  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.getState().selfKongAction(0, -1, 1);
  const state = useGameStore.getState();
  assertEqual(state.players[0].melds.some(meld => meld.type === 'concealed-kong'), true, 'Concealed kong should create a concealed-kong meld');
  assertEqual(state.players[0].hand.some(tile => tile.category === 'suit' && (tile as any).suit === 'bamboo' && (tile as any).value === 7), false, 'Concealed kong tiles should be removed from the hand');
  assertEqual(state.players[0].hand.length, 2, 'Concealed kong should leave the replacement tile and the non-kong tile in hand');
  assertEqual(state.players[0].hand.some(tile => tile.category === 'suit' && (tile as any).suit === 'dots' && (tile as any).value === 8), true, 'Concealed kong replacement should come from the back of the wall');
});

run('Max Tai caps payout settlement without changing the win threshold', () => {
  const { settleRoundChips } = require('../src/game/chips');
  const players = [
    { ...makePlayer(0, 'east', []), chips: 1000 },
    { ...makePlayer(1, 'south', []), chips: 1000 },
    { ...makePlayer(2, 'west', []), chips: 1000 },
    { ...makePlayer(3, 'north', []), chips: 1000 },
  ];

  const discardCapSettlement = settleRoundChips(players, {
    taiThreshold: 4,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020',
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 2,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 9, 2);
  assertEqual(discardCapSettlement.summary?.rawTai, 9, 'Discard settlement should preserve the raw tai total');
  assertEqual(discardCapSettlement.summary?.tai, 2, 'Discard settlement should cap the payout tai');
  assertEqual(discardCapSettlement.summary?.maxTai, 2, 'Discard settlement should report the max tai cap');
  assertEqual(discardCapSettlement.players[0].chips, 1000.8, 'Discard settlement should use the capped row for the winner');
  assertEqual(discardCapSettlement.players[1].chips, 999.8, 'Discard settlement should use the capped row for non-shooters');
  assertEqual(discardCapSettlement.players[2].chips, 999.6, 'Discard settlement should use the capped row for the shooter');
  assertEqual(discardCapSettlement.players[3].chips, 999.8, 'Discard settlement should use the capped row for the other non-shooter');

  const selfDrawCapSettlement = settleRoundChips(players, {
    taiThreshold: 4,
    unlimitedTai: false,
    feiCount: 4,
    payoutTable: '010_020',
    startingChips: 1000,
    shooterEnabled: false,
    maxTai: 2,
    economyEnabled: true,
    chipSettlementMode: 'default',
  }, 0, 9, null);
  assertEqual(selfDrawCapSettlement.summary?.rawTai, 9, 'Self-draw settlement should preserve the raw tai total');
  assertEqual(selfDrawCapSettlement.summary?.tai, 2, 'Self-draw settlement should cap the payout tai');
  assertEqual(selfDrawCapSettlement.players[0].chips, 1001.2, 'Self-draw settlement should use the capped row for the winner');
  assertEqual(selfDrawCapSettlement.players[1].chips, 999.6, 'Self-draw settlement should use the capped row for opponents');
  assertEqual(selfDrawCapSettlement.players[2].chips, 999.6, 'Self-draw settlement should use the capped row for opponents');
  assertEqual(selfDrawCapSettlement.players[3].chips, 999.6, 'Self-draw settlement should use the capped row for opponents');
});

run('Discard Thirteen Wonders sets the win method so the result screen can score it', () => {
  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.setState({
    players: [
      { ...makePlayer(0, 'east', [
        createSuitTile('bamboo', 1),
        createSuitTile('bamboo', 9),
        createSuitTile('characters', 1),
        createSuitTile('characters', 9),
        createSuitTile('dots', 1),
        createSuitTile('dots', 9),
        createHonorTile('east'),
        createHonorTile('south'),
        createHonorTile('west'),
        createHonorTile('north'),
        createHonorTile('hong'),
        createHonorTile('fa'),
        createHonorTile('baak'),
      ]), chips: 1000 },
      { ...makePlayer(1, 'south', []), chips: 1000 },
      { ...makePlayer(2, 'west', []), chips: 1000 },
      { ...makePlayer(3, 'north', []), chips: 1000 },
    ],
    wall: [],
    deadWall: [],
    currentPlayerIndex: 0,
    phase: 'playing',
    roundWind: 'east',
    config: {
      taiThreshold: 1,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: null,
      shooterEnabled: false,
      economyEnabled: false,
      chipSettlementMode: 'default',
    },
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
    diceResults: null,
    nextRoundCountdown: null,
    dealerPlayerId: 0,
    debugLogs: [],
    waitingForClaim: {
      tile: createSuitTile('dots', 9),
      fromPlayer: 1,
      eligiblePlayers: [{ playerIndex: 0, actions: ['win'] }],
    },
  });

  useGameStore.getState().claimTile(0, 'win');
  const state = useGameStore.getState();
  assertEqual(state.winMethod, 'thirteen_wonders', 'Discard Thirteen Wonders should be tagged as Thirteen Wonders');
  assertEqual(state.winner, 0, 'Discard Thirteen Wonders should finish the round');
  const result = calculateTai(state, 0, false, false, false, false, createSuitTile('dots', 9), false, false, false, true);
  assertOk(result.breakdown.some(entry => entry.name === 'Thirteen Wonders (十三幺)'), 'Discard Thirteen Wonders should score the limit hand');
  assertOk(result.totalTai >= 10, 'Discard Thirteen Wonders should include the limit tai');
});

run('Non-dealer win keeps the current dealer badge until the next hand starts', () => {
  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.setState({
    players: [
      { ...makePlayer(0, 'east', []), chips: 1000 },
      { ...makePlayer(1, 'south', [
        createSuitTile('bamboo', 1),
        createSuitTile('bamboo', 9),
        createSuitTile('characters', 1),
        createSuitTile('characters', 9),
        createSuitTile('dots', 1),
        createSuitTile('dots', 9),
        createHonorTile('east'),
        createHonorTile('south'),
        createHonorTile('west'),
        createHonorTile('north'),
        createHonorTile('hong'),
        createHonorTile('fa'),
        createHonorTile('baak'),
      ]), chips: 1000 },
      { ...makePlayer(2, 'west', []), chips: 1000 },
      { ...makePlayer(3, 'north', []), chips: 1000 },
    ],
    wall: [],
    deadWall: [],
    currentPlayerIndex: 0,
    phase: 'playing',
    roundWind: 'east',
    config: {
      taiThreshold: 1,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: null,
      shooterEnabled: false,
      economyEnabled: false,
      chipSettlementMode: 'default',
    },
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
    diceResults: null,
    nextRoundCountdown: null,
    dealerPlayerId: 0,
    nextDealerPlayerId: null,
    debugLogs: [],
    waitingForClaim: {
      tile: createSuitTile('dots', 9),
      fromPlayer: 2,
      eligiblePlayers: [{ playerIndex: 1, actions: ['win'] }],
    },
  });

  useGameStore.getState().claimTile(1, 'win');
  const state = useGameStore.getState();
  assertEqual(state.winner, 1, 'South player should win the discard');
  assertEqual(state.dealerPlayerId, 0, 'Current dealer badge should stay on the old dealer during the result screen');
  assertEqual(state.nextDealerPlayerId, 1, 'Next dealer should be stored for the following hand');
});

run('Dealer win keeps the dealer-cycle round count unchanged on the next hand', () => {
  const { useGameStore } = require('../src/store/gameStore');
  useGameStore.setState({
    players: [
      { ...makePlayer(0, 'east', [
        createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
        createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
        createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
        createHonorTile('hong'), createHonorTile('hong'), createHonorTile('hong'),
        createSuitTile('bamboo', 5), createSuitTile('bamboo', 5),
      ]), chips: 1000 },
      { ...makePlayer(1, 'south', []), chips: 1000 },
      { ...makePlayer(2, 'west', []), chips: 1000 },
      { ...makePlayer(3, 'north', []), chips: 1000 },
    ],
    wall: [],
    deadWall: [],
    currentPlayerIndex: 0,
    phase: 'playing',
    roundWind: 'east',
    config: {
      taiThreshold: 1,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: null,
      shooterEnabled: false,
      economyEnabled: false,
      chipSettlementMode: 'default',
    },
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
    diceResults: null,
    nextRoundCountdown: null,
    dealerPlayerId: 0,
    nextDealerPlayerId: null,
    dealerCount: 2,
    debugLogs: [],
    waitingForClaim: {
      tile: null,
      fromPlayer: -1,
      eligiblePlayers: [],
    },
  });

  useGameStore.getState().selfDrawWinAction(0);
  const finished = useGameStore.getState();
  assertEqual(finished.winner, 0, 'Dealer should win the self-draw hand');
  assertEqual(finished.dealerPlayerId, 0, 'Dealer badge should stay on the dealer');
  assertEqual(finished.dealerCount, 2, 'Dealer win should not advance the dealer-cycle count');

  finished.reset();
  const resetState = useGameStore.getState();
  assertEqual(resetState.dealerCount, 2, 'Reset should preserve the dealer-cycle count after a dealer win');
});

run('Discard-win is blocked by a full-suit wait', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('characters', 1), createSuitTile('characters', 2), createSuitTile('characters', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('characters', 7), createSuitTile('characters', 8), createSuitTile('characters', 9),
    createSuitTile('dots', 1), createSuitTile('dots', 2), createSuitTile('dots', 3),
    createFeiTile(),
  ]);
  const blocked = isBlockedDiscardWinByFullSuitWait(player.hand, [], createSuitTile('bamboo', 1));
  assertEqual(blocked, true, 'Full suit wait fixture should block discard wins on bamboo');
});

run('Partial suit waits are not blocked', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createHonorTile('east'), createHonorTile('east'), createHonorTile('east'),
    createSuitTile('bamboo', 5), createSuitTile('bamboo', 5),
  ]);
  const blocked = isBlockedDiscardWinByFullSuitWait(player.hand, [], createSuitTile('bamboo', 5));
  assertEqual(blocked, false, 'Partial bamboo wait should not be treated as a full-suit wait');
});

run('Seat wind and round wind pungs score with Fei substitution', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createHonorTile('baak'), createHonorTile('baak'),
  ], [
    { type: 'pung', tiles: [createHonorTile('east'), createHonorTile('east'), createFeiTile()], fromPlayer: 1 },
    { type: 'pung', tiles: [createHonorTile('south'), createHonorTile('south'), createFeiTile()], fromPlayer: 2 },
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Seat Wind (east) Pung'), 'Seat wind pung should score with Fei substitution');
  assertOk(result.breakdown.some(entry => entry.name === 'Round Wind (south) Pung'), 'Round wind pung should score with Fei substitution');
});

run('Honor pung scoring only counts each honor once even with multiple Fei fill options', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createSuitTile('bamboo', 5), createSuitTile('bamboo', 5),
  ], [
    { type: 'pung', tiles: [createHonorTile('hong'), createHonorTile('hong'), createFeiTile()], fromPlayer: 1 },
    { type: 'pung', tiles: [createHonorTile('baak'), createHonorTile('baak'), createFeiTile()], fromPlayer: 2 },
    { type: 'pung', tiles: [createHonorTile('baak'), createHonorTile('baak'), createFeiTile()], fromPlayer: 3 },
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  const entries = result.breakdown.filter(entry => entry.name === 'hong Dragon Pung' || entry.name === 'baak Dragon Pung');
  assertEqual(entries.length, 2, 'Each honor pung should only score once');
});

run('Fei are not reused across separate honor pung bonuses', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createHonorTile('fa'),
    createHonorTile('baak'),
    createHonorTile('baak'),
    createFeiTile(),
    createFeiTile(),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])], 'north');
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Fixture should still be a valid winning hand');
  const result = calculateTai(state, 0, false);
  const honorEntries = result.breakdown.filter(entry => entry.name === 'fa Dragon Pung' || entry.name === 'baak Dragon Pung');
  assertEqual(honorEntries.length, 1, 'Only one honor pung should score when Fei are limited');
  assertEqual(honorEntries[0]?.name, 'baak Dragon Pung', 'The cheaper honor pung should consume the Fei budget first');
});

run('Concealed honor pung scores with Fei substitution', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('characters', 4), createSuitTile('characters', 5), createSuitTile('characters', 6),
    createSuitTile('dots', 7), createSuitTile('dots', 8), createSuitTile('dots', 9),
    createHonorTile('hong'), createHonorTile('hong'), createFeiTile(),
    createHonorTile('baak'), createHonorTile('baak'),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  assertEqual(isWinningHand(player.hand, player.melds), true, 'Concealed honor pung fixture should be a winning hand');
  const result = calculateTai(state, 0, true);
  assertOk(result.breakdown.some(entry => entry.name === 'hong Dragon Pung'), 'Concealed honor pung should score with one Fei');
});

run('Visible-only scoring hides concealed hand patterns', () => {
  const player = makePlayer(0, 'east', [
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5), createSuitTile('bamboo', 6),
    createSuitTile('bamboo', 7), createSuitTile('bamboo', 8), createSuitTile('bamboo', 9),
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createSuitTile('bamboo', 4), createSuitTile('bamboo', 5),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);

  const fullResult = calculateTai(state, 0, true, false);
  assertOk(fullResult.breakdown.some(entry => entry.name === 'Full Flush'), 'Visible full result should include the full flush');
  assertOk(fullResult.breakdown.some(entry => entry.name === 'Concealed Hand (Men Qing)'), 'Visible full result should include Men Qing');

  const visibleResult = calculateTai(state, 0, true, true);
  assertOk(!visibleResult.breakdown.some(entry => entry.name === 'Full Flush'), 'Visible-only result should hide the full flush');
  assertOk(!visibleResult.breakdown.some(entry => entry.name === 'Concealed Hand (Men Qing)'), 'Visible-only result should hide Men Qing');
  assertOk(visibleResult.breakdown.some(entry => entry.name === 'Self-Draw'), 'Visible-only result should still show the self-draw tai');
});

run('Multiplayer round restarts rotate seat winds and move the dealer', () => {
  const { buildInitialMultiplayerState } = require('../../../server/roundSetup.cjs');
  const first = buildInitialMultiplayerState({
    config: {
      taiThreshold: 4,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: null,
      shooterEnabled: false,
      economyEnabled: false,
      chipSettlementMode: 'default',
    },
    seed: 123456,
    roster: [
      { name: 'Player 1', isHuman: true },
      { name: 'Player 2', isHuman: false },
      { name: 'Player 3', isHuman: false },
      { name: 'Player 4', isHuman: false },
    ],
  });
  const previousState = {
    ...first.state,
    dealerCount: 1,
    nextDealerPlayerId: (first.state.dealerPlayerId + 1) % 4,
  };
  const next = buildInitialMultiplayerState({
    config: first.state.config,
    seed: 654321,
    roster: [
      { name: 'Player 1', isHuman: true },
      { name: 'Player 2', isHuman: false },
      { name: 'Player 3', isHuman: false },
      { name: 'Player 4', isHuman: false },
    ],
    previousState,
  });
  const expectedSeatWinds = previousState.players.map((p: any) => {
    const nextSeat: Record<string, string> = {
      east: 'north',
      north: 'west',
      west: 'south',
      south: 'east',
    };
    return nextSeat[p.seatWind] || p.seatWind;
  });
  assertEqual(
    next.state.players.map((p: any) => p.seatWind).join(','),
    expectedSeatWinds.join(','),
    'Seat winds should rotate to the next hand positions',
  );
  assertEqual(
    next.state.dealerPlayerId,
    previousState.nextDealerPlayerId,
    'Dealer should move to the next player',
  );
  assertEqual(next.state.roundWind, previousState.roundWind, 'Round wind should not advance until the dealer cycle completes');
  assertEqual(next.state.currentPlayerIndex, next.state.dealerPlayerId, 'The dealer should start the hand');
});

run('Fresh multiplayer setup starts with the dealer as the first player', () => {
  const { buildInitialMultiplayerState } = require('../../../server/roundSetup.cjs');
  const fresh = buildInitialMultiplayerState({
    config: {
      taiThreshold: 4,
      unlimitedTai: false,
      feiCount: 4,
      payoutTable: 'none',
      startingChips: 1000,
      shooterEnabled: true,
      economyEnabled: false,
      chipSettlementMode: 'shooter',
    },
    seed: 777777,
    roster: [
      { name: 'Player 1', isHuman: true },
      { name: 'Player 2', isHuman: false },
      { name: 'Player 3', isHuman: false },
      { name: 'Player 4', isHuman: false },
    ],
  });
  assertEqual(fresh.state.currentPlayerIndex, fresh.state.dealerPlayerId, 'Dealer should take the first turn on a new hand');
  assertEqual(fresh.state.players.every((p: any) => p.chips === 1000), true, 'Fresh multiplayer setup should seed all players with the configured starting chips');
  assertEqual(fresh.state.config.shooterEnabled, true, 'Multiplayer state should preserve the Shooter toggle');
  assertEqual(fresh.state.config.chipSettlementMode, 'shooter', 'Multiplayer state should preserve the compatible Shooter settlement mode');
});

run('Multiplayer rematch setup preserves settings and resets the match', () => {
  const { buildInitialMultiplayerState } = require('../../../server/roundSetup.cjs');
  const config = {
    taiThreshold: 6,
    unlimitedTai: false,
    feiCount: 12,
    payoutTable: '030_060',
    startingChips: 2500,
    shooterEnabled: true,
    maxTai: 8,
    specialTaiCapEnabled: true,
    specialTaiCap: 13,
    economyEnabled: true,
    chipSettlementMode: 'shooter',
  };
  const roster = [
    { name: 'Host', isHuman: true },
    { name: 'Friend', isHuman: true },
    { name: 'Sakura', isHuman: false },
    { name: 'Kenji', isHuman: false },
  ];
  const rematch = buildInitialMultiplayerState({
    config,
    seed: 246810,
    roster,
    previousState: null,
  });

  assertEqual(JSON.stringify(rematch.state.config), JSON.stringify(config), 'A new-room rematch should preserve the exact original settings');
  assertEqual(rematch.state.players.every((player: any) => player.chips === 2500), true, 'A new-room rematch should reset every seat to Starting Chips');
  assertEqual(rematch.state.players.map((player: any) => player.name).join(','), 'Host,Friend,Sakura,Kenji', 'A new-room rematch should preserve the roster');
  assertEqual(rematch.state.roundWind, 'east', 'A new-room rematch should reset to the East round');
  assertEqual(rematch.state.dealerCount, 0, 'A new-room rematch should reset the round counter');
});

run('Discard wins need one more tai than self-draw wins', () => {
  const result = { tai: 1, breakdown: [{ name: 'Seat Wind (east) Pung', tai: 1 }], feiPenalty: 0, totalTai: 1 };
  assertEqual(canWinWithTai(result, 1, true, false), true, 'Self-draw should win at 1 tai when threshold is 1');
  assertEqual(canWinWithTai(result, 1, false, false), false, 'Discard should not win at 1 tai when threshold is 1');
  assertEqual(canWinWithTai(result, 1, false, true), true, 'Automatic win should ignore the tai threshold');
});

run('Big Three Dragons is treated as an automatic win', () => {
  const player = makePlayer(0, 'east', [
    createHonorTile('hong'), createHonorTile('hong'), createHonorTile('hong'),
    createHonorTile('fa'), createHonorTile('fa'), createHonorTile('fa'),
    createHonorTile('baak'), createHonorTile('baak'), createHonorTile('baak'),
    createSuitTile('bamboo', 1), createSuitTile('bamboo', 2), createSuitTile('bamboo', 3),
    createHonorTile('east'), createHonorTile('east'),
  ]);
  const state = makeState([player, makePlayer(1, 'south', []), makePlayer(2, 'west', []), makePlayer(3, 'north', [])]);
  const result = calculateTai(state, 0, false);
  assertOk(result.breakdown.some(entry => entry.name === 'Big Three Dragons'), 'Big Three Dragons should appear in the breakdown');
  assertEqual(isAutomaticWinResult(result), true, 'Big Three Dragons should be an automatic win');
});
