import { type Tile as TileType } from '../types/mahjong';
import { TileImage, TileImageBack } from './TileImage';

interface TileProps {
  tile: TileType;
  selected?: boolean;
  onClick?: () => void;
  faceDown?: boolean;
  rotate?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  highlight?: boolean;
}

const PIXEL_SIZES = { sm: 34, md: 44, lg: 48, xl: 52 };

export function Tile({ tile, selected, onClick, faceDown, size = "md", highlight, rotate }: TileProps) {
  const px = PIXEL_SIZES[size];

  const baseClasses = `
    cursor-${onClick ? 'pointer' : 'default'}
    select-none transition-all duration-150
    inline-flex items-center justify-center
  `;

 const selectionClasses = selected
   ? 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-green-900 scale-110 -translate-y-2 rounded-lg'
   : highlight
    ? 'ring-2 ring-red-400 ring-offset-2 ring-offset-green-900 shadow-lg shadow-red-500/30 rounded-lg'
   : '';

  const hoverClasses = onClick ? 'hover:scale-105 hover:-translate-y-1 hover:drop-shadow-lg' : '';

  if (faceDown) {
    return (
      <div className={`${baseClasses} ${selectionClasses}`} onClick={onClick}>
        <TileImageBack size={px} rotate={rotate | 0} />
      </div>
    );
  }

  return (
    <div className={`${baseClasses} ${selectionClasses} ${hoverClasses} active:scale-95`}
      onClick={onClick} title={tileDisplay(tile)}>
      <TileImage tile={tile} size={px} />
    </div>
  );
}

export function MeldDisplay({ tiles, type, size = 'sm' }: { tiles: TileType[]; type: string; size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center gap-0.5">
     {tiles.map((t, i) => (
       <Tile key={i} tile={t} size={size} />
     ))}
   </div>
  );
}

export function EmptyTile({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const px = PIXEL_SIZES[size];
  return (
    <div className="bg-green-700/30 border-2 border-dashed border-green-600 rounded-lg"
      style={{ width: px, height: Math.round(px * 1.4) }} />
  );
}

function tileDisplay(tile: TileType): string {
  if (tile.category === 'suit') {
    const suitName = tile.suit === 'bamboo' ? 'Bamboo' : tile.suit === 'characters' ? 'Characters' : 'Dots';
    return `${tile.value} of ${suitName}`;
  }
  if (tile.category === 'honor') {
    const names: Record<string, string> = {
      east: 'East Wind', south: 'South Wind', west: 'West Wind', north: 'North Wind',
      hong: 'Red Dragon', fa: 'Green Dragon', baak: 'White Dragon',
    };
    return names[tile.type] || tile.type;
  }
  if (tile.category === 'bonus') {
    return `${tile.bonusType} ${tile.id}`;
  }
  return 'Fei (Joker)';
}
