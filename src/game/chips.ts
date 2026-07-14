import type { GameConfig, Player } from '../types/mahjong';

export type PayoutTableKey = GameConfig['payoutTable'];
export type SettlementStyle = 'default' | 'shooter';
export type SettlementMode = 'discard' | 'self_draw';

export interface ChipDelta {
  playerIndex: number;
  delta: number;
}

export interface ChipSettlementSummary {
  payoutTable: Exclude<PayoutTableKey, 'none'>;
  settlementStyle: SettlementStyle;
  mode: SettlementMode;
  tai: number;
  rawTai: number;
  maxTai: number;
  winnerIndex: number;
  winnerDelta: number;
  playerDeltas: ChipDelta[];
  nonShooterPerTai: number;
  shooterPerTai: number;
  selfDrawPerTai: number;
  shooterIndex: number | null;
}

interface PayoutRow {
  nonShooterPerTai: number;
  shooterPerTai: number;
  selfDrawPerTai: number;
}

const MAX_TAI = 10;
const CHIP_PRECISION = 100;

function normalizeChipAmount(amount: number): number {
  return Math.round(amount * CHIP_PRECISION) / CHIP_PRECISION;
}

const PAYOUT_ROWS: Record<Exclude<PayoutTableKey, 'none'>, PayoutRow[]> = {
  '010_020': [
    { nonShooterPerTai: 0.1, shooterPerTai: 0.4, selfDrawPerTai: 0.2 },
    { nonShooterPerTai: 0.2, shooterPerTai: 0.8, selfDrawPerTai: 0.4 },
    { nonShooterPerTai: 0.4, shooterPerTai: 1.6, selfDrawPerTai: 0.8 },
    { nonShooterPerTai: 0.8, shooterPerTai: 3.2, selfDrawPerTai: 1.6 },
    { nonShooterPerTai: 1.6, shooterPerTai: 6.4, selfDrawPerTai: 3.2 },
    { nonShooterPerTai: 3.2, shooterPerTai: 12.8, selfDrawPerTai: 6.4 },
    { nonShooterPerTai: 6.4, shooterPerTai: 25.6, selfDrawPerTai: 12.8 },
    { nonShooterPerTai: 12.8, shooterPerTai: 51.2, selfDrawPerTai: 25.6 },
    { nonShooterPerTai: 25.6, shooterPerTai: 102.4, selfDrawPerTai: 51.2 },
    { nonShooterPerTai: 51.2, shooterPerTai: 204.8, selfDrawPerTai: 102.4 },
    { nonShooterPerTai: 102.4, shooterPerTai: 409.6, selfDrawPerTai: 204.8 },
    { nonShooterPerTai: 204.8, shooterPerTai: 819.2, selfDrawPerTai: 409.6 },
    { nonShooterPerTai: 409.6, shooterPerTai: 1638.4, selfDrawPerTai: 819.2 },
    { nonShooterPerTai: 819.2, shooterPerTai: 3276.8, selfDrawPerTai: 1638.4 },
    { nonShooterPerTai: 1638.4, shooterPerTai: 6553.6, selfDrawPerTai: 3276.8 },
    { nonShooterPerTai: 3276.8, shooterPerTai: 13107.2, selfDrawPerTai: 6553.6 },
    { nonShooterPerTai: 6553.6, shooterPerTai: 26214.4, selfDrawPerTai: 13107.2 },
    { nonShooterPerTai: 13107.2, shooterPerTai: 52428.8, selfDrawPerTai: 26214.4 },
  ],
  '030_060': [
    { nonShooterPerTai: 1, shooterPerTai: 2, selfDrawPerTai: 2 },
    { nonShooterPerTai: 2, shooterPerTai: 3, selfDrawPerTai: 3 },
    { nonShooterPerTai: 3, shooterPerTai: 5, selfDrawPerTai: 5 },
    { nonShooterPerTai: 5, shooterPerTai: 10, selfDrawPerTai: 10 },
    { nonShooterPerTai: 10, shooterPerTai: 20, selfDrawPerTai: 20 },
    { nonShooterPerTai: 20, shooterPerTai: 39, selfDrawPerTai: 39 },
    { nonShooterPerTai: 39, shooterPerTai: 77, selfDrawPerTai: 77 },
    { nonShooterPerTai: 77, shooterPerTai: 154, selfDrawPerTai: 154 },
    { nonShooterPerTai: 154, shooterPerTai: 308, selfDrawPerTai: 308 },
    { nonShooterPerTai: 308, shooterPerTai: 615, selfDrawPerTai: 615 },
    { nonShooterPerTai: 615, shooterPerTai: 2459, selfDrawPerTai: 1229 },
    { nonShooterPerTai: 1229, shooterPerTai: 4916, selfDrawPerTai: 2458 },
    { nonShooterPerTai: 2458, shooterPerTai: 9832, selfDrawPerTai: 4916 },
    { nonShooterPerTai: 4916, shooterPerTai: 19663, selfDrawPerTai: 9831 },
    { nonShooterPerTai: 9831, shooterPerTai: 39323, selfDrawPerTai: 19661 },
    { nonShooterPerTai: 19661, shooterPerTai: 78644, selfDrawPerTai: 39322 },
    { nonShooterPerTai: 39322, shooterPerTai: 157288, selfDrawPerTai: 78644 },
    { nonShooterPerTai: 78644, shooterPerTai: 314575, selfDrawPerTai: 157287 },
  ],
  '1_2': [
    { nonShooterPerTai: 1, shooterPerTai: 4, selfDrawPerTai: 2 },
    { nonShooterPerTai: 2, shooterPerTai: 8, selfDrawPerTai: 4 },
    { nonShooterPerTai: 4, shooterPerTai: 16, selfDrawPerTai: 8 },
    { nonShooterPerTai: 8, shooterPerTai: 32, selfDrawPerTai: 16 },
    { nonShooterPerTai: 16, shooterPerTai: 64, selfDrawPerTai: 32 },
    { nonShooterPerTai: 32, shooterPerTai: 128, selfDrawPerTai: 64 },
    { nonShooterPerTai: 64, shooterPerTai: 256, selfDrawPerTai: 128 },
    { nonShooterPerTai: 128, shooterPerTai: 512, selfDrawPerTai: 256 },
    { nonShooterPerTai: 256, shooterPerTai: 1024, selfDrawPerTai: 512 },
    { nonShooterPerTai: 512, shooterPerTai: 2048, selfDrawPerTai: 1024 },
    { nonShooterPerTai: 1024, shooterPerTai: 4096, selfDrawPerTai: 2048 },
    { nonShooterPerTai: 2048, shooterPerTai: 8192, selfDrawPerTai: 4096 },
    { nonShooterPerTai: 4096, shooterPerTai: 16384, selfDrawPerTai: 8192 },
    { nonShooterPerTai: 8192, shooterPerTai: 32768, selfDrawPerTai: 16384 },
    { nonShooterPerTai: 16384, shooterPerTai: 65536, selfDrawPerTai: 32768 },
    { nonShooterPerTai: 32768, shooterPerTai: 131072, selfDrawPerTai: 65536 },
    { nonShooterPerTai: 65536, shooterPerTai: 262144, selfDrawPerTai: 131072 },
    { nonShooterPerTai: 131072, shooterPerTai: 524288, selfDrawPerTai: 262144 },
  ],
};

export function getPayoutTableLabel(payoutTable: PayoutTableKey): string {
  switch (payoutTable) {
    case '010_020':
      return '$0.10 / $0.20';
    case '030_060':
      return '$0.30 / $0.60';
    case '1_2':
      return '$1 / $2';
    default:
      return 'No payout';
  }
}

export function formatPayoutAmount(amount: number): string {
  const rounded = normalizeChipAmount(amount);
  return Number.isInteger(rounded) ? `$${rounded.toLocaleString('en-US')}` : `$${rounded.toFixed(2)}`;
}

function getPayoutRow(payoutTable: Exclude<PayoutTableKey, 'none'>, tai: number): PayoutRow {
  const rows = PAYOUT_ROWS[payoutTable];
  const index = Math.max(1, Math.min(rows.length, Math.floor(tai))) - 1;
  return rows[index] || rows[rows.length - 1];
}

export function settleRoundChips(
  players: Player[],
  config: GameConfig,
  winnerIndex: number,
  tai: number,
  shooterIndex: number | null,
  payoutTaiOverride?: number | null,
): { players: Player[]; summary: ChipSettlementSummary | null } {
  if (config.payoutTable === 'none') {
    return { players, summary: null };
  }

  const rawTai = Math.max(1, Math.floor(tai));
  const maxTai = Math.max(1, Math.floor(config.maxTai ?? MAX_TAI));
  const payoutTai = Math.max(1, Math.floor(payoutTaiOverride ?? Math.min(MAX_TAI, rawTai, maxTai)));
  const row = getPayoutRow(config.payoutTable, payoutTai);
  const settlementStyle: SettlementStyle = config.chipSettlementMode === 'shooter' ? 'shooter' : 'default';
  const playerDeltas: ChipDelta[] = players.map((_, playerIndex) => ({ playerIndex, delta: 0 }));

  if (shooterIndex !== null && shooterIndex >= 0) {
    if (settlementStyle === 'shooter') {
      const winnerDelta = normalizeChipAmount(row.shooterPerTai);
      playerDeltas[winnerIndex].delta += winnerDelta;
      playerDeltas[shooterIndex].delta -= winnerDelta;
    } else {
      const winnerDelta = normalizeChipAmount(row.nonShooterPerTai * 2 + row.selfDrawPerTai);
      for (let i = 0; i < players.length; i++) {
        if (i === winnerIndex) continue;
        playerDeltas[i].delta -= i === shooterIndex ? row.selfDrawPerTai : row.nonShooterPerTai;
      }
      playerDeltas[winnerIndex].delta += winnerDelta;
      return {
        players: applyDeltas(players, playerDeltas),
        summary: {
          payoutTable: config.payoutTable,
          settlementStyle,
          mode: 'discard',
          tai: payoutTai,
          rawTai,
          maxTai,
          winnerIndex,
          winnerDelta,
          playerDeltas,
          nonShooterPerTai: row.nonShooterPerTai,
          shooterPerTai: row.shooterPerTai,
          selfDrawPerTai: row.selfDrawPerTai,
          shooterIndex,
        },
      };
    }
    const winnerDelta = normalizeChipAmount(row.shooterPerTai);
    return {
      players: applyDeltas(players, playerDeltas),
      summary: {
        payoutTable: config.payoutTable,
        settlementStyle,
        mode: 'discard',
        tai: payoutTai,
        rawTai,
        maxTai,
        winnerIndex,
        winnerDelta,
        playerDeltas,
        nonShooterPerTai: row.nonShooterPerTai,
        shooterPerTai: row.shooterPerTai,
        selfDrawPerTai: row.selfDrawPerTai,
        shooterIndex,
      },
    };
  }

  const winnerDelta = normalizeChipAmount(row.selfDrawPerTai * 3);
  for (let i = 0; i < players.length; i++) {
    if (i === winnerIndex) continue;
    playerDeltas[i].delta -= row.selfDrawPerTai;
  }
  playerDeltas[winnerIndex].delta += winnerDelta;
  return {
    players: applyDeltas(players, playerDeltas),
    summary: {
      payoutTable: config.payoutTable,
      settlementStyle,
      mode: 'self_draw',
      tai: payoutTai,
      rawTai,
      maxTai,
      winnerIndex,
      winnerDelta,
      playerDeltas,
      nonShooterPerTai: row.nonShooterPerTai,
      shooterPerTai: row.shooterPerTai,
      selfDrawPerTai: row.selfDrawPerTai,
      shooterIndex: null,
    },
  };
}

function applyDeltas(players: Player[], playerDeltas: ChipDelta[]): Player[] {
  return players.map((player, playerIndex) => {
    const delta = playerDeltas[playerIndex]?.delta || 0;
    if (delta === 0) return player;
    const current = typeof player.chips === 'number' && Number.isFinite(player.chips) ? player.chips : 0;
    return { ...player, chips: normalizeChipAmount(current + delta) };
  });
}
