import type { GameState, Meld, Player, Tile } from '../types/mahjong';

export class MultiplayerStateRevisionGate {
  private roomCode = '';
  private lastRevision = -1;

  reset(roomCode = '') {
    this.roomCode = roomCode;
    this.lastRevision = -1;
  }

  shouldApply(roomCode: string, revision: unknown): boolean {
    if (!roomCode) return false;
    if (roomCode !== this.roomCode) {
      this.reset(roomCode);
    }
    if (!Number.isInteger(revision) || Number(revision) < 0) return true;
    const nextRevision = Number(revision);
    if (nextRevision <= this.lastRevision) return false;
    this.lastRevision = nextRevision;
    return true;
  }
}

export function shouldAcceptMultiplayerState(
  currentState: Pick<GameState, 'phase'> & { isMultiplayer?: boolean },
  roomCode: string,
): boolean {
  if (!roomCode) return false;
  const activeLocalGame =
    (currentState.phase === 'playing' || currentState.phase === 'finished') &&
    !currentState.isMultiplayer;
  return !activeLocalGame;
}

function sameTile(left: Tile, right: Tile): boolean {
  if (left.category !== right.category) return false;
  if (left.category === 'suit' && right.category === 'suit') {
    return left.suit === right.suit && left.value === right.value;
  }
  if (left.category === 'honor' && right.category === 'honor') {
    return left.type === right.type;
  }
  if (left.category === 'bonus' && right.category === 'bonus') {
    return left.bonusType === right.bonusType && left.id === right.id;
  }
  return left.category === 'fei' && right.category === 'fei';
}

function sameTiles(left: Tile[] | undefined, right: Tile[] | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((tile, index) => sameTile(tile, right[index]));
}

function sameMeld(left: Meld, right: Meld): boolean {
  return left.type === right.type &&
    left.fromPlayer === right.fromPlayer &&
    sameTiles(left.tiles, right.tiles);
}

function sameMelds(left: Meld[], right: Meld[]): boolean {
  return left.length === right.length && left.every((meld, index) => sameMeld(meld, right[index]));
}

function samePlayer(left: Player, right: Player): boolean {
  return left.id === right.id &&
    left.name === right.name &&
    left.isHuman === right.isHuman &&
    left.seatWind === right.seatWind &&
    left.chips === right.chips &&
    left.isAlive === right.isAlive &&
    sameTiles(left.hand, right.hand) &&
    sameTiles(left.discards, right.discards) &&
    sameTiles(left.bonusTiles, right.bonusTiles) &&
    sameMelds(left.melds, right.melds);
}

function preserveCanonicalReferences(currentState: GameState, patch: Partial<GameState> & Record<string, any>) {
  if (Array.isArray(patch.players) && Array.isArray(currentState.players)) {
    const nextPlayers = patch.players.map((player: Player, index: number) => {
      const currentPlayer = currentState.players[index];
      return currentPlayer && samePlayer(currentPlayer, player) ? currentPlayer : player;
    });
    patch.players = nextPlayers.every((player: Player, index: number) => player === currentState.players[index])
      ? currentState.players
      : nextPlayers;
  }

  for (const key of ['wall', 'deadWall', 'discardHistory', 'winningTiles'] as const) {
    const nextTiles = patch[key];
    const currentTiles = currentState[key];
    if (Array.isArray(nextTiles) && sameTiles(currentTiles, nextTiles)) {
      patch[key] = currentTiles as any;
    }
  }

  if (patch.config && Object.keys(patch.config).every(
    key => patch.config?.[key as keyof typeof patch.config] === currentState.config[key as keyof typeof currentState.config],
  )) {
    patch.config = currentState.config;
  }
}

export function buildMultiplayerStatePatch(
  currentState: GameState,
  message: any,
): (Partial<GameState> & Record<string, any>) | null {
  if (!message?.state || typeof message.state !== 'object') return null;
  if (message.full !== false) {
    const patch = { ...message.state } as Partial<GameState> & Record<string, any>;
    preserveCanonicalReferences(currentState, patch);
    return patch;
  }

  const patch = { ...message.state } as Partial<GameState> & Record<string, any>;
  const moveHistoryStart = Number.isInteger(message.moveHistoryStart) ? message.moveHistoryStart : currentState.moveHistory.length;
  const movePrefix = message.resetMoveHistory ? [] : currentState.moveHistory.slice(0, moveHistoryStart);

  patch.moveHistory = [
    ...movePrefix,
    ...(Array.isArray(message.moveHistoryAppend) ? message.moveHistoryAppend : []),
  ];
  preserveCanonicalReferences(currentState, patch);
  return patch;
}
