const SUITS = ['bamboo', 'characters', 'dots'];
const WINDS = ['east', 'south', 'west', 'north'];
const DRAGONS = ['hong', 'fa', 'baak'];
// Real-table flow: the live wall plays until only 15 tiles remain.
const DEAD_WALL_SIZE = 15;

function createSuitTile(suit, value) {
  return { category: 'suit', suit, value };
}

function createHonorTile(type) {
  return { category: 'honor', type };
}

function createBonusTile(bonusType, id) {
  return { category: 'bonus', bonusType, id };
}

function createFeiTile() {
  return { category: 'fei' };
}

function buildDeck(config) {
  const deck = [];

  for (const suit of SUITS) {
    for (let value = 1; value <= 9; value++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push(createSuitTile(suit, value));
      }
    }
  }

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

  const bonusTypes = ['flower', 'season', 'animal'];
  for (const bonusType of bonusTypes) {
    for (let id = 1; id <= 4; id++) {
      deck.push(createBonusTile(bonusType, id));
    }
  }

  for (let i = 0; i < (config?.feiCount || 0); i++) {
    deck.push(createFeiTile());
  }

  return deck;
}

function seededRandom(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(deck, seed) {
  const random = seededRandom(seed);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isBonus(tile) {
  return tile && tile.category === 'bonus';
}

function sortHand(hand) {
  const suitOrder = { bamboo: 0, characters: 1, dots: 2 };
  const honorOrder = { east: 0, south: 1, west: 2, north: 3, hong: 4, fa: 5, baak: 6 };
  const catOrder = { suit: 0, honor: 1, bonus: 2, fei: 3 };

  return [...hand].sort((a, b) => {
    if (a.category === 'fei') return 1;
    if (b.category === 'fei') return -1;
    if (a.category === 'bonus' && b.category !== 'bonus') return -1;
    if (a.category !== 'bonus' && b.category === 'bonus') return 1;
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

function generateDiceResults(seed, playerCount) {
  let attempt = 0;
  while (true) {
    const rng = seededRandom(seed + 1 + attempt);
    const dice = [];
    const totals = [];
    for (let p = 0; p < playerCount; p++) {
      const d0 = Math.floor(rng() * 6) + 1;
      const d1 = Math.floor(rng() * 6) + 1;
      const d2 = Math.floor(rng() * 6) + 1;
      dice.push([d0, d1, d2]);
      totals.push(d0 + d1 + d2);
    }
    const unique = new Set(totals);
    if (unique.size === totals.length) {
      let maxIdx = 0;
      for (let i = 1; i < totals.length; i++) {
        if (totals[i] > totals[maxIdx]) maxIdx = i;
      }
      return { dice, totals, eastPlayerIdx: maxIdx };
    }
    attempt++;
  }
}

function rotateWind(wind) {
  const order = ['east', 'south', 'west', 'north'];
  const idx = order.indexOf(wind);
  return order[(idx + 1) % order.length];
}

function rotateSeatWindsForNextHand(winds) {
  const next = {
    east: 'north',
    north: 'west',
    west: 'south',
    south: 'east',
  };
  return winds.map(wind => next[wind] || wind);
}

function getPlayerStartingChips(config) {
  return Number.isFinite(config?.startingChips) ? Math.max(0, Math.floor(config.startingChips)) : 0;
}

function splitWallForDeadWall(deck) {
  return {
    wall: [...deck],
    deadWall: [],
  };
}

function drawFromFrontOfWall(wall) {
  const nextWall = [...wall];
  const tile = nextWall.shift() || null;
  return { tile, wall: nextWall };
}

function drawFromBackOfWall(wall) {
  const nextWall = [...wall];
  const tile = nextWall.pop() || null;
  return { tile, wall: nextWall };
}

function buildInitialMultiplayerState({ config, seed, roster, previousState = null }) {
  const deck = buildDeck(config);
  const shuffled = seededShuffle(deck, seed);
  const { wall: liveWall } = splitWallForDeadWall(shuffled);
  const diceResults = generateDiceResults(seed, 4);
  const windOrder = ['east', 'south', 'west', 'north'];
  const previousPlayers = Array.isArray(previousState?.players) && previousState.players.length === 4 ? previousState.players : null;
  const reuseSeating = Boolean(previousPlayers);
  const startingChips = getPlayerStartingChips(config);
  const eastIdx = reuseSeating
    ? (Number.isInteger(previousState?.nextDealerPlayerId)
        ? previousState.nextDealerPlayerId
        : (Number.isInteger(previousState?.dealerPlayerId) ? previousState.dealerPlayerId : diceResults.eastPlayerIdx))
    : diceResults.eastPlayerIdx;
  const seatRankByTotal = [...Array(4).keys()].sort((a, b) => diceResults.totals[b] - diceResults.totals[a]);

  const seatWinds = reuseSeating
    ? (Number.isInteger(previousState?.nextDealerPlayerId)
        ? rotateSeatWindsForNextHand(previousPlayers.map(player => player.seatWind))
        : previousPlayers.map(player => player.seatWind))
    : (() => {
        const windsByPlayer = [];
        for (let seatRank = 0; seatRank < 4; seatRank++) {
          const playerIdx = seatRankByTotal[seatRank];
          windsByPlayer[playerIdx] = windOrder[seatRank];
        }
        return windsByPlayer;
      })();

  let roundWind = typeof previousState?.roundWind === 'string' ? previousState.roundWind : 'east';
  let dealerCount = Number.isFinite(previousState?.dealerCount) ? previousState.dealerCount : 0;
  if (reuseSeating && Number.isInteger(previousState?.nextDealerPlayerId)) {
    dealerCount += 1;
    if (dealerCount >= 4) {
      roundWind = rotateWind(roundWind);
      dealerCount = 0;
    }
  }

  const players = [];
  for (let p = 0; p < 4; p++) {
    const info = Array.isArray(roster) ? roster[p] || {} : {};
    players.push({
      id: p,
      name: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : `Player ${p + 1}`,
      isHuman: typeof info.isHuman === 'boolean' ? info.isHuman : p === 0,
      hand: [],
      melds: [],
      discards: [],
      seatWind: seatWinds[p],
      chips: previousPlayers && typeof previousPlayers[p]?.chips === 'number' ? previousPlayers[p].chips : startingChips,
      isAlive: true,
      bonusTiles: [],
    });
  }

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

  for (let round = 0; round < 3; round++) {
    for (let p = 0; p < 4; p++) {
      for (let i = 0; i < 4; i++) {
        const tile = dealFromWall();
        if (tile) players[p].hand.push(tile);
      }
    }
  }
  for (let p = 0; p < 4; p++) {
    const tile = dealFromWall();
    if (tile) players[p].hand.push(tile);
  }
  const eastBonusTile = dealFromWall();
  if (eastBonusTile) players[eastIdx].hand.push(eastBonusTile);

  for (let offset = 0; offset < 4; offset++) {
    const p = (eastIdx + offset) % 4;
    while (true) {
      const bonusIdx = players[p].hand.findIndex(isBonus);
      if (bonusIdx === -1) break;
      const bonusTile = players[p].hand.splice(bonusIdx, 1)[0];
      players[p].bonusTiles.push(bonusTile);
      const replacement = replaceFromBackOfWall();
        if (!replacement) {
          const moveLine = 'Draw game! No replacement tiles remain.';
          return {
            state: {
              players,
            wall: remainingWall,
            deadWall: [],
            currentPlayerIndex: eastIdx,
            phase: 'finished',
            roundWind,
            config,
            lastAction: moveLine,
            winner: null,
            winningTiles: [],
            lastDrawnTile: null,
            winMethod: null,
            discardHistory: [],
            moveHistory: [moveLine],
            hostDisconnected: false,
            playerLeft: null,
              roomPaused: false,
              roomPauseReason: null,
              roundHadKong: false,
              roundEndReason: 'draw',
              diceResults,
              nextRoundCountdown: null,
              dealerPlayerId: eastIdx,
            dealerCount,
            chipSettlement: null,
            debugLogs: [],
            showConfig: false,
            message: moveLine,
            selfDrawWin: false,
            selfKongData: null,
            isMultiplayer: true,
            isHost: true,
            myPlayerIndex: 0,
            waitingForRemoteAction: false,
            isHuaShang: false,
            isKangShang: false,
            isMenHu: false,
            isTW: false,
            waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
          },
          diceResults,
        };
      }
      players[p].hand.push(replacement);
    }
    players[p].hand = sortHand(players[p].hand);
  }

  const moveLine = `Game started! Player ${eastIdx + 1} (East) discards first.`;

  return {
    state: {
      players,
      wall: remainingWall,
      deadWall: [],
      currentPlayerIndex: eastIdx,
      phase: 'playing',
      roundWind,
      config,
      lastAction: moveLine,
      winner: null,
      winningTiles: [],
      lastDrawnTile: null,
      winMethod: null,
      discardHistory: [],
      moveHistory: [moveLine],
      hostDisconnected: false,
      playerLeft: null,
      roomPaused: false,
      roomPauseReason: null,
      roundHadKong: false,
      roundEndReason: null,
      diceResults,
      nextRoundCountdown: null,
      dealerPlayerId: eastIdx,
      dealerCount,
      chipSettlement: null,
      debugLogs: [],
      showConfig: false,
      message: `Player ${eastIdx + 1} (East) discards first.`,
      selfDrawWin: false,
      selfKongData: null,
      isMultiplayer: true,
      isHost: true,
      myPlayerIndex: 0,
      waitingForRemoteAction: false,
      isHuaShang: false,
      isKangShang: false,
      isMenHu: false,
      isTW: false,
      waitingForClaim: { tile: null, fromPlayer: -1, eligiblePlayers: [] },
    },
    diceResults,
  };
}

module.exports = {
  buildDeck,
  seededShuffle,
  generateDiceResults,
  buildInitialMultiplayerState,
};
