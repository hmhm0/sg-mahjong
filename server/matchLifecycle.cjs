function isChipMatchOverState(state) {
  const config = state?.config;
  if (state?.phase !== 'finished' || !Number.isInteger(state?.winner) || !state?.chipSettlement) return false;
  if (!config?.economyEnabled || config.payoutTable === 'none') return false;
  return Array.isArray(state?.players) && state.players.some(player =>
    Number.isFinite(player?.chips) && player.chips <= 0
  );
}

function createMatchReadyState(players) {
  return Array.from({ length: 4 }, (_, playerIndex) => {
    const player = Array.isArray(players) ? players[playerIndex] : null;
    return Boolean(player && player.isHuman === false);
  });
}

function areAllMatchSeatsReady(ready) {
  return Array.isArray(ready) && ready.length === 4 && ready.every(Boolean);
}

module.exports = {
  isChipMatchOverState,
  createMatchReadyState,
  areAllMatchSeatsReady,
};
