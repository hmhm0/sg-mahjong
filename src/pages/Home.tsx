import { useGameStore } from '../store/gameStore';
import { useState } from 'react';
import { DiceRoll } from '../components/DiceRoll';
import { navigate } from '../utils/navigation';
import { track } from '../utils/analytics';



export function Home() {
  const [showDice, setShowDice] = useState(false);
  const [startingChipsInput, setStartingChipsInput] = useState('');
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const startGame = useGameStore(s => s.startGame);
  const config = useGameStore(s => s.config);
  const nextDealerPlayerId = useGameStore(s => s.nextDealerPlayerId);

  const updateConfig = (patch: Partial<typeof config>) => {
    useGameStore.setState({ config: { ...config, ...patch } });
  };

  const handleStartingChipsChange = (value: string) => {
    setStartingChipsInput(value);
    if (value.trim() === '') {
      updateConfig({ startingChips: null, economyEnabled: false, chipSettlementMode: 'default' });
      return;
    }
    const parsed = parseInt(value, 10);
    const chips = Number.isFinite(parsed) ? Math.max(0, parsed) : null;
    updateConfig({ startingChips: chips, economyEnabled: chips !== null, chipSettlementMode: config.shooterEnabled ? 'shooter' : 'default' });
  };

  const handleStartGame = () => {
    track('singleplayer_start_clicked', { mode: 'singleplayer' });
    if (nextDealerPlayerId !== null) {
      // Skip dice roll, use stored next dealer
      startGame(config);
      return;
    }
    setShowDice(true);
  };

  const handleNavigate = (path: string) => {
    track('main_menu_navigation', { path });
    setPendingRoute(path);
    window.setTimeout(() => navigate(path), 80);
  };

  const handleDiceComplete = (humanWind: string) => {
    setShowDice(false);
    startGame(config, humanWind as any);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.18),_transparent_36%),linear-gradient(180deg,_#0f3d2e_0%,_#0b2f24_45%,_#09261d_100%)] flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-yellow-400/30 bg-yellow-400/10 text-[11px] uppercase tracking-[0.25em] text-yellow-200 mb-4">
          <span>SG Mahjong</span>
        </div>
        <h1 className="text-4xl md:text-6xl font-black text-yellow-200 mb-3 tracking-tight">
          Singapore Mahjong
        </h1>
        <p className="text-green-200 text-sm">Tai, Fei, winds, and local house rules in one table</p>
        <p className="text-green-200/80 text-sm leading-relaxed mt-3 max-w-2xl mx-auto">
          Singapore Mahjong online with Fei jokers, tai threshold scoring, round wind rotation, self-draw wins, and private multiplayer rooms.
          Practice against 3 AI opponents or host a room for friends on the same ruleset.
        </p>
      </div>

      <div className="bg-green-900/55 backdrop-blur rounded-2xl p-6 w-full max-w-md border border-green-700/50 shadow-2xl shadow-black/20">
        <h2 className="text-xl font-bold text-yellow-200 mb-4 text-center">Game Settings</h2>

        <div className="space-y-5">
          {/* Tai Threshold */}
          <div>
            <label className="text-green-300 text-sm block mb-1">Tai Threshold (Minimum to win/zimo)</label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min="1"
                max="10"
                value={config.taiThreshold}
                onChange={(e) => updateConfig({ taiThreshold: parseInt(e.target.value) })}
                className="flex-1 accent-yellow-500"
              />
              <span className="text-yellow-300 font-bold w-8 text-center">{config.taiThreshold}</span>
            </div>
          </div>

          {/* Fei Count */}
          <div>
            <label className="text-green-300 text-sm block mb-1">Fei Count (Jokers)</label>
            <div className="flex gap-2 items-center">
              <input
                type="range"
                min="0"
                max="20"
                step="4"
                value={config.feiCount}
                onChange={(e) => updateConfig({ feiCount: parseInt(e.target.value) })}
                className="flex-1 accent-yellow-500"
              />
              <span className="text-yellow-300 font-bold w-8 text-center">{config.feiCount}</span>
            </div>
            <p className="text-[10px] text-green-400/50 mt-0.5">Only in multiples of 4 (0, 4, 8, 12, 16, 20)</p>
          </div>

          {/* Starting Chips */}
          <div>
            <label className="text-green-300 text-sm block mb-1">Starting Chips</label>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                inputMode="numeric"
                value={startingChipsInput}
                onChange={(e) => handleStartingChipsChange(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Optional"
                className="flex-1 bg-green-900/50 border border-green-600 rounded-lg px-3 py-2 text-green-200 text-sm outline-none focus:border-yellow-500"
              />
              <span className="text-yellow-300 font-bold w-12 text-center">chips</span>
            </div>
            <p className="text-[10px] text-green-400/50 mt-0.5">Leave blank for no chip amount yet.</p>
          </div>

          {/* Shooter Toggle */}
          <div>
            <label className="text-green-300 text-sm block mb-1">Shooter</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => updateConfig({ shooterEnabled: true, chipSettlementMode: 'shooter' })}
                className={`py-2 rounded-lg font-bold text-sm transition-colors ${config.shooterEnabled ? 'bg-yellow-600 text-white' : 'bg-green-900/50 text-green-200 border border-green-600 hover:bg-green-800/70'}`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => updateConfig({ shooterEnabled: false, chipSettlementMode: 'default' })}
                className={`py-2 rounded-lg font-bold text-sm transition-colors ${!config.shooterEnabled ? 'bg-yellow-600 text-white' : 'bg-green-900/50 text-green-200 border border-green-600 hover:bg-green-800/70'}`}
              >
                No
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-6">
          <button onClick={handleStartGame}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-95">
            Start Game (Singleplayer, 3 Bots)
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('/host/')}
            className="w-full py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 text-center block">
            Host Game
          </button>
          <button
            type="button"
            onClick={() => handleNavigate('/join/')}
            className="w-full py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 text-center block">
            Join Game
          </button>
        </div>
      </div>

      <div className="flex gap-4 mt-6">
        <button type="button" onClick={() => handleNavigate('/tutorial/')} className="text-green-200 hover:text-white underline text-sm">How to Play</button>
        <button type="button" onClick={() => handleNavigate('/rules/')} className="text-green-200 hover:text-white underline text-sm">Rules Reference</button>
      </div>
      {pendingRoute && (
        <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-50">
          <div className="bg-green-900/95 border border-green-700/60 rounded-xl px-5 py-4 text-center shadow-2xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-yellow-300 border-t-transparent" />
            <p className="text-yellow-200 text-sm font-semibold">Opening {pendingRoute.includes('host') ? 'Host Game' : pendingRoute.includes('join') ? 'Join Game' : pendingRoute.includes('rules') ? 'Rules' : 'Tutorial'}...</p>
          </div>
        </div>
      )}
      <div className="mt-4 text-center text-[11px] leading-5 text-green-300/70 max-w-lg">
        <p>This website is for entertainment and educational purposes only. It is not intended for gambling or real-money play.</p>
        <p>Mahjong tile images are sourced from publicly available assets and are not owned by the author.</p>
        <p>Copyright &copy; 2026 sgmahjong.app. All rights reserved.</p>
      </div>
      {showDice && (
        <DiceRoll
          onComplete={handleDiceComplete}
          onCancel={() => setShowDice(false)}
        />
      )}
    </div>
  );
}
