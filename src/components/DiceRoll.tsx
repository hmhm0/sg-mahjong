import { useState, useRef } from 'react';

const DOTS: number[][] = [
  [0,0,0, 0,1,0, 0,0,0],
  [0,0,1, 0,0,0, 1,0,0],
  [0,0,1, 0,1,0, 1,0,0],
  [1,0,1, 0,0,0, 1,0,1],
  [1,0,1, 0,1,0, 1,0,1],
  [1,0,1, 1,0,1, 1,0,1],
];

function DiceFace({ value, size = 56 }: { value: number; size?: number }) {
  const dots = DOTS[value - 1];
  const dotSize = Math.round(size * 0.18);
  const gap = Math.round(size * 0.1);

  return (
    <div style={{
      width: size, height: size,
      background: '#fff',
      borderRadius: Math.round(size * 0.12),
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gridTemplateRows: '1fr 1fr 1fr',
      padding: gap, gap: gap,
      boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.2)',
    }}>
      {dots.map((filled, i) => (
        <div key={i} style={{
          width: dotSize, height: dotSize,
          borderRadius: '50%',
          background: filled ? '#111' : 'transparent',
          justifySelf: 'center', alignSelf: 'center',
        }} />
      ))}
    </div>
  );
}

const WINDS = ['east', 'south', 'west', 'north'] as const;
const WIND_CHARS: Record<string, string> = {
  east: '東', south: '南', west: '西', north: '北',
};
const WIND_COLORS: Record<string, string> = {
  east: 'white', south: 'white', west: 'white', north: 'white',
};

interface DiceRollProps {
  onComplete: (humanWind: string) => void;
  onCancel: () => void;
}

function rollD3(): [number, number, number] {
  return [
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
    Math.floor(Math.random() * 6) + 1,
  ];
}

export function DiceRoll({ onComplete, onCancel }: DiceRollProps) {
  const [phase, setPhase] = useState<'idle' | 'rolling' | 'result'>('idle');
  const [dice, setDice] = useState<[number, number, number]>([1, 1, 1]);
  const [result, setResult] = useState<{
    humanWind: string; humanTotal: number;
    aiTotals: number[]; humanIsDealer: boolean;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const handleRoll = () => {
    setPhase('rolling');

    timerRef.current = setInterval(() => {
      setDice(rollD3());
    }, 80);

    setTimeout(() => {
      if (timerRef.current) clearInterval(timerRef.current);

      let humanTotal = 0;
      let aiTotals: number[] = [];
      let allTotals: number[] = [];
      while (true) {
        const [d1, d2, d3] = rollD3();
        humanTotal = d1 + d2 + d3;
        setDice([d1, d2, d3]);

        aiTotals = [
          rollD3().reduce((a, b) => a + b, 0),
          rollD3().reduce((a, b) => a + b, 0),
          rollD3().reduce((a, b) => a + b, 0),
        ];
        allTotals = [humanTotal, ...aiTotals];
        if (new Set(allTotals).size === allTotals.length) break;
      }

      const sortedTotals = [...allTotals].sort((a, b) => b - a);
      const humanRank = sortedTotals.indexOf(humanTotal);
      const humanWind = WINDS[humanRank];

      setResult({ humanWind, humanTotal, aiTotals, humanIsDealer: humanRank === 0 });
      setPhase('result');
    }, 2500);
  };

 return (
    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-green-800 rounded-xl p-8 text-center max-w-sm mx-4 border border-green-600/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-yellow-300 mb-2">Determine Seating</h2>
        <p className="text-green-300 text-sm mb-4">Roll the dice to determine who sits where!</p>

        {/* 3 Dice display */}
        <div className="flex justify-center gap-4 my-6">
          {dice.map((val, i) => (
            <DiceFace key={i} value={val} size={60} />
          ))}
        </div>

        {phase === 'idle' && (
          <button onClick={handleRoll}
            className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-bold text-lg transition-all">
            Roll Dice
          </button>
        )}

        {phase === 'rolling' && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-yellow-300 text-sm animate-pulse">Rolling...</p>
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{animationDelay: '0s'}} />
              <span className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{animationDelay: '0.15s'}} />
              <span className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{animationDelay: '0.3s'}} />
            </div>
          </div>
        )}

        {phase === 'result' && result && (
          <div className="mt-4">
            <p className="text-green-200 text-sm mb-2">
              You rolled: <span className="text-yellow-300 font-bold text-lg">{result.humanTotal}</span>
            </p>
            {result.humanIsDealer && (
              <p className="text-green-300 text-sm mb-1 animate-pulse">Highest roll! You are the dealer.</p>
            )}

            <div className="bg-cyan-700/20 border border-cyan-300/50 rounded-lg p-4 mb-4 ring-1 ring-cyan-300/30">
              <div style={{
                fontSize: '48px',
                color: WIND_COLORS[result.humanWind],
                fontWeight: 'bold',
                fontFamily: 'serif',
                marginBottom: '4px',
              }}>
                {WIND_CHARS[result.humanWind]}
              </div>
              <p className="text-cyan-50 text-base">
                You sit at: <span className="text-yellow-300 font-bold">{result.humanWind}</span>
              </p>
            </div>

            <button onClick={() => onComplete(result.humanWind)}
              className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-bold text-base transition-all">
              Start Game
            </button>
            <button onClick={onCancel}
              className="block mx-auto mt-2 text-green-400 hover:text-green-200 text-xs underline">
              Back to Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
