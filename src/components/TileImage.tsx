import type { Tile } from '../types/mahjong';

function tileImagePath(tile: Tile): string {
  const c = tile.category;

  if (c === 'suit') {
    const s = tile.suit;
    if (s === 'bamboo') return `/tiles/bamboo-${tile.value}.svg`;
    if (s === 'characters') return `/tiles/characters-${tile.value}.svg`;
    if (s === 'dots') return `/tiles/dots-${tile.value}.svg`;
  }

  if (c === 'honor') {
    const names: Record<string, string> = {
      east: 'east', south: 'south', west: 'west', north: 'north',
      hong: 'hong', fa: 'fa', baak: 'baak',
    };
    return `/tiles/${names[tile.type]}.svg`;
  }

 if (c === 'bonus') {
   if (tile.bonusType === 'flower') {
      const names = ['plum-1', 'orchid-2', 'bamboo-flower-3', 'chrysanthemum-4'];
     return `/tiles/${names[tile.id - 1]}.svg`;
   }
   if (tile.bonusType === 'season') {
      const names = ['spring-1', 'summer-2', 'winter-3', 'autumn-4'];
     return `/tiles/${names[tile.id - 1]}.svg`;
   }
    if (tile.bonusType === 'animal') {
      const names = ['cat', 'rat', 'chicken', 'millipede'];
      return `/tiles/${names[tile.id - 1]}.svg`;
    }
  }

  if (c === 'fei') return '/tiles/fei.svg';
  return '/tiles/back.svg';
}

export function TileImage({ tile, size = 48 }: { tile: Tile; size?: number }) {
  const h = Math.round(size * 1.214);
  const src = tileImagePath(tile);

  return (
    <img
      src={src}
      alt="mahjong tile"
      width={size}
      height={h}
      style={{ display: 'block', flexShrink: 0, aspectRatio: `${size} / ${h}` }}
    />
  );
}

export function TileImageBack({ size = 48, rotate = 0 }: { size?: number; rotate?: number }) {
  const rotated = rotate % 180 !== 0;
  const w = rotated ? Math.round(size * 1.214) : size;
  const h = rotated ? size : Math.round(size * 1.214);
  return (
    <img
      src="/tiles/back.svg"
      alt="tile back"
      width={w}
      height={h}
      style={{ display: 'block', flexShrink: 0, transform: `rotate(${rotate}deg)` }}
    />
  );
}
