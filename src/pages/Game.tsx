import { GameTable } from '../components/GameTable';
import { useGameStore } from '../store/gameStore';

export function Game() {
  const reset = useGameStore(s => s.reset);

  return (
    <div className="relative">
      <div className="absolute top-3 right-3 z-10">
        <button
          onClick={reset}
          className="px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
        >
          Quit Game
        </button>
      </div>
      <GameTable />
    </div>
  );
}
