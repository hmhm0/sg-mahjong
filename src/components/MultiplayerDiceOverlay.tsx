import { useState, useEffect } from 'react';

const DOTS: number[][] = [
  [0,0,0, 0,1,0, 0,0,0],
  [0,0,1, 0,0,0, 1,0,0],
  [0,0,1, 0,1,0, 1,0,0],
  [1,0,1, 0,0,0, 1,0,1],
  [1,0,1, 0,1,0, 1,0,1],
  [1,0,1, 1,0,1, 1,0,1],
];

function DiceFace({ value, size = 44 }: { value: number; size?: number }) {
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
const WIND_CHARS: Record<string, string> = { east: '東', south: '南', west: '西', north: '北' };

function mulberry32(seed: number) {
  let s = seed | 0;
  return function() {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generateDiceResults(seed: number, playerCount: number) {
  let attempt = 0;
  while (true) {
    const rng = mulberry32(seed + 1 + attempt);
    const dice: [number, number, number][] = [];
    const totals: number[] = [];
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

interface Props {
  dice: [number, number, number][];
  totals: number[];
  eastPlayerIdx: number;
  myPlayerIndex: number;
  playerCount: number;
  playerNames?: string[];
  onComplete: () => void;
}

export function MultiplayerDiceOverlay({ dice, totals, eastPlayerIdx, myPlayerIndex, playerCount, playerNames, onComplete }: Props) {
  const [phase, setPhase] = useState<'rolling' | 'result' | 'countdown'>('rolling');
  const [animValues, setAnimValues] = useState<[number, number, number][]>(
    Array.from({ length: playerCount }, () => [1, 1, 1] as [number, number, number])
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimValues(Array.from({ length: playerCount }, () => [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ]));
    }, 80);

    const rollTimer = setTimeout(() => {
      clearInterval(interval);
      setAnimValues(dice);
      setPhase('result');
    }, 2500);

    return () => { clearInterval(interval); clearTimeout(rollTimer); };
  }, []);

  useEffect(() => {
    if (phase === 'result') {
      const t = setTimeout(() => setPhase('countdown'), 1500);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const [count, setCount] = useState(3);
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, count]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-green-800 rounded-2xl p-6 text-center max-w-md mx-4 border border-green-600/50 w-full">
        <h2 className="text-xl font-bold text-yellow-300 mb-3">Rolling for Seats</h2>
        {phase === 'rolling' && (
          <p className="text-yellow-300 text-sm animate-pulse mb-4">Rolling the dice...</p>
        )}

        {phase === 'countdown' && (
          <div className="flex flex-col items-center gap-2 my-4">
            <div className="text-yellow-300 text-5xl font-bold animate-ping">{count > 0 ? count : ''}</div>
            <p className="text-green-300 text-sm">Starting game...</p>
          </div>
        )}
        {phase === 'result' && (
          <p className="text-green-200 text-sm mb-4">
            {eastPlayerIdx === myPlayerIndex
              ? 'You rolled the highest! You are the dealer (East).'
              : `Player ${eastPlayerIdx + 1} is the dealer (East).`}
          </p>
        )}

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {Array.from({ length: playerCount }).map((_, pIdx) => {
            const vals = animValues[pIdx] || [1, 1, 1];
            const isEast = (phase === 'result' || phase === 'countdown') && pIdx === eastPlayerIdx;
            const isMe = pIdx === myPlayerIndex;
            const total = totals[pIdx] || 0;
            return (
              <div key={pIdx} className={`flex items-center gap-3 p-2 rounded-lg ${isEast ? 'bg-yellow-700/40 ring-1 ring-yellow-500' : 'bg-green-700/30'}`}>
                <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {pIdx + 1}
                </div>
                <div className="flex-1 text-left">
                  <span className="text-green-200 text-sm">{isMe ? 'You' : (playerNames?.[pIdx] || `Player ${pIdx + 1}`)}</span>
                  {isEast && <span className="ml-2 text-yellow-300 text-xs font-bold">東</span>}
                </div>
                <div className="flex gap-1">
                  {vals.map((v, di) => <DiceFace key={di} value={v} size={36} />)}
                </div>
                <div className="w-10 text-right">
                  <span className={`font-bold ${phase === 'result' || phase === 'countdown' ? 'text-yellow-300' : 'text-green-400'}`}>
                    {phase === 'result' || phase === 'countdown' ? total : '?'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {(phase === 'result' || phase === 'countdown') && (
          <div className="mt-4 p-3 bg-green-700/50 rounded-xl">
            <div style={{ fontSize: '36px', color: '#fff', fontWeight: 'bold', fontFamily: 'serif' }}>
              {WIND_CHARS[WINDS[[...Array(totals.length).keys()].sort((a, b) => totals[b] - totals[a]).indexOf(myPlayerIndex)]]}
            </div>
            <p className="text-green-100 text-xs">
              You sit at: <span className="text-yellow-300 font-bold">{WINDS[[...Array(totals.length).keys()].sort((a, b) => totals[b] - totals[a]).indexOf(myPlayerIndex)]}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
