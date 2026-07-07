import { useGameStore } from '../store/gameStore';
import { useState } from 'react';
import { DiceRoll } from '../components/DiceRoll';



export function Home() {
  const [showDice, setShowDice] = useState(false);
  const startGame = useGameStore(s => s.startGame);
  const config = useGameStore(s => s.config);
  const nextDealerPlayerId = useGameStore(s => s.nextDealerPlayerId);

  const handleStartGame = () => {
    if (nextDealerPlayerId !== null) {
      // Skip dice roll, use stored next dealer
      startGame(config);
      return;
    }
    setShowDice(true);
  };

  const handleDiceComplete = (humanWind: string) => {
    setShowDice(false);
    startGame(config, humanWind as any);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 via-green-800 to-green-900 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-6xl font-bold text-yellow-300 mb-3">
          Mahjong
        </h1>
        <p className="text-green-300 text-sm">Singapore Variant</p>
      </div>

      <div className="bg-green-800/60 backdrop-blur rounded-2xl p-6 w-full max-w-md border border-green-700/50">
        <h2 className="text-xl font-bold text-green-100 mb-4 text-center">Game Settings</h2>

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
                onChange={(e) => useGameStore.setState({ config: { ...config, taiThreshold: parseInt(e.target.value) } })}
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
                onChange={(e) => useGameStore.setState({ config: { ...config, feiCount: parseInt(e.target.value) } })}
                className="flex-1 accent-yellow-500"
              />
              <span className="text-yellow-300 font-bold w-8 text-center">{config.feiCount}</span>
            </div>
            <p className="text-[10px] text-green-400/50 mt-0.5">Only in multiples of 4 (0, 4, 8, 12, 16, 20)</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-6">
          <button onClick={handleStartGame}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-95">
            Start Game (Singleplayer, 3 Bots)
          </button>
          <a href="#/host"
            className="w-full py-3 bg-blue-700 hover:bg-blue-600 text-white rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 text-center block">
            Host Game
          </a>
          <a href="#/join"
            className="w-full py-3 bg-green-700 hover:bg-green-600 text-white rounded-xl font-bold text-sm transition-all hover:scale-[1.02] active:scale-95 text-center block">
            Join Game
          </a>
        </div>
      </div>

      <div className="flex gap-4 mt-6">
        <a href="#/tutorial" className="text-green-400 hover:text-green-200 underline text-sm">How to Play</a>
        <a href="#/rules" className="text-green-400 hover:text-green-200 underline text-sm">Rules Reference</a>
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
