import type { GameState } from '../types/mahjong';

export function isSelfDrawWinMethod(
  winMethod: GameState['winMethod'],
  winningDiscardPlayer: number | null | undefined,
): boolean {
  if (typeof winningDiscardPlayer === 'number') return false;

  return winMethod === 'self_draw' ||
    winMethod === 'hua_shang' ||
    winMethod === 'kang_shang' ||
    winMethod === 'men_hu' ||
    winMethod === 'tian_hu' ||
    winMethod === 'hua_hu' ||
    winMethod === 'thirteen_wonders';
}
