# 🀄 Singapore Mahjong

A full-featured **Singapore Mahjong** game with single-player (vs 3 AI) and multiplayer (WebSocket) modes. Built with React, TypeScript, Vite, and Zustand.

> **⚠️ Disclaimer:** This project is created **for entertainment and educational purposes only**. It is **not intended for gambling or real-money play**. All mahjong tile images are sourced from publicly available assets and are not owned by the author.

---

## ✨ Features

- **Single-player** — you vs 3 AI opponents with smart discard and claim AI
- **Multiplayer** — Host a game room, share the 4-character room code, others join via WebSocket
- **Full Singapore Mahjong rules** — including Fei (jokers), bonus tiles, dealer rotation
- **Comprehensive tai system** — 25+ scoring patterns including Ping Hu, Pong Pong Hu, Thirteen Wonders, pure honour hands, and limit hands
- **Smart AI** — scoring-based discard selection, claim priority with delays
- **Configurable** — tai threshold, Fei count, unlimited tai mode
- **Responsive tile display** — player tiles face-up, opponent tiles face-down with rotation
- **Rules reference** — in-game rules page covering all scoring patterns
- **Special hands** — Tian Hu, Di Hu, Men Hu, Thirteen Wonders, Qiang Kang, Da San Yuan, Da Xi Si, Shi Ba Luo Han
- **Self-Kong** & **Kang Shang** — upgrade pungs, concealed kongs, auto-win on kong replacement
- **Round wind rotation** — East → South → West → North, game ends after North
- **AFK warning** — detects player inactivity (>5 min), displays warning to all
- **Move history** — scrollable popup tracking every action per round

## 🖼️ Screenshots

*(Add screenshots here)*

---

## 🛠️ Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| State | Zustand 4 |
| Server | Node.js + ws (WebSocket relay for multiplayer) |
| Styling | Tailwind CSS 3 |
| Tiles | Custom SVGs |

---

## 🚀 Quick Start

```bash
# Clone the repo
git clone https://github.com/hmhm0/sg-mahjong.git
cd singapore-mahjong

# Install dependencies
npm install

# Start the dev server
npm run dev
# → Open http://localhost:5173

# Build for production
npm run build
# → Output in dist/
```

### macOS

Start both the web dev server and WebSocket relay server:

```bash
./start_mahjong.command
```

Or manually:

```bash
# Terminal 1: WebSocket server
node server/index.cjs

# Terminal 2: Vite dev server
npx vite
```

---

## 🎮 How to Play

1. **Configure** — Set tai threshold, Fei count on the home screen
2. **Deal** — Click "Start Game" to deal tiles
3. **Play your turn** — Click a tile to select it, then click "Discard"
4. **Claim** — When a tile is discarded, buttons appear for Win, Kong, Pung, or Chi
5. **Win** — When you have a valid hand with sufficient tai, click "Win!"

### Controls

| Key | Action |
|---|---|
| Click tile | Select/deselect a hand tile |
| Discard button | Discard the selected tile |
| Win / Kong / Pung / Chi | Claim the last discarded tile |
| Pass | Pass on claiming |
| Quit Game | Return to home screen |
| History | Open move history popup |

---

## 📜 Rules Summary

### Tai Scoring

| Pattern | Tai |
|---|---|
| Full Flush Sequence Hand (清一色平胡) | 10 |
| Full Flush Triplets Hand (清一色碰碰胡) | 8 |
| Ping Hu (平胡) | 4 |
| Full Flush (清一色) | 4 |
| Da San Yuan (大三元) | 10 |
| Da Xi Si (大四喜) | 10 |
| Tian Hu (天胡) / Di Hu (地胡) / Men Hu (门胡) | 10 |
| Thirteen Wonders (十三幺) | 10 |
| Qi Qiang Yi (七搶一) | 10 |
| Hua Hu (花胡) | 12 |
| Shi Ba Luo Han (十八罗汉) | 18 |
| Half Flush (混一色) | 2 |
| Pong Pong Hu (碰碰胡) | 2 |
| Xiao San Yuan (小三元) | 4 |
| Xiao Xi Si (小四喜) | 4 |
| All Pungs | 3 |
| +1 patterns | Seat/Round Wind Pung, Dragon Pung, Self-Draw, Concealed Hand, Chou Ping Hu, Hua Shang, Kang Shang, Dragon Eyes, Flowers/Seasons/Animals |

See the full rules reference in-game at `/#/rules`.

---

## 🏗️ Project Structure

```
├── src/
│   ├── components/
│   │   ├── GameTable.tsx      # Main game board UI
│   │   ├── Tile.tsx           # Tile rendering with MeldDisplay
│   │   ├── TileImage.tsx      # SVG tile image mapping
│   │   └── DiceRoll.tsx       # Seating dice roll popup
│   ├── game/
│   │   ├── rules.ts           # Tai scoring, win detection, meld checks
│   │   ├── tiles.ts           # Deck building, shuffling, sorting
│   │   └── ai.ts              # AI discard/claim decision logic
│   ├── store/
│   │   └── gameStore.ts       # Zustand store (all game state)
│   ├── types/
│   │   └── mahjong.ts         # TypeScript type definitions
│   ├── pages/
│   │   ├── Home.tsx           # Game settings + start
│   │   ├── Game.tsx           # Game wrapper
│   │   ├── Rules.tsx          # Rules reference
│   │   ├── Tutorial.tsx       # How to play
│   │   ├── HostGame.tsx       # Multiplayer host (WIP)
│   │   └── JoinGame.tsx       # Multiplayer join (WIP)
│   ├── utils/
│   │   └── connection.ts      # WebSocket client (WIP)
│   ├── App.tsx                # Root component + hash routing
│   └── main.tsx               # Entry point
├── public/tiles/              # 48 SVG tile images
│   ├── bamboo-1.svg – bamboo-9.svg
│   ├── characters-1.svg – characters-9.svg
│   ├── dots-1.svg – dots-9.svg
│   ├── east.svg, south.svg, west.svg, north.svg
│   ├── hong.svg, fa.svg, baak.svg
│   ├── plum-1.svg, orchid-2.svg, bamboo-flower-3.svg, chrysanthemum-4.svg
│   ├── spring-1.svg, summer-2.svg, winter-3.svg, autumn-4.svg
│   ├── cat.svg, rat.svg, chicken.svg, millipede.svg
│   ├── fei.svg               # Joker tile
│   └── back.svg               # Face-down tile
└── server/index.cjs           # WebSocket multiplayer relay
```

---

## 🧠 Architecture

### Multiplayer Architecture

```
Remote Client                Server                  Host (Authority)
```

- **Host** runs the full authoritative game state
- **Join clients** send actions to host, receive full state updates
- **Server** relays messages between clients (pass-through, no game logic)

### Game Flow
```
Home → Configure → DiceRoll → startGame() → Playing → Win/Draw → Home
```

### State Management
Single Zustand store (`gameStore.ts`):
- Game state: players, wall, discards, melds
- Turn management: draw → check → discard → claim → next turn
- AI auto-play with configurable delays (200ms–800ms)
- Multiplayer fields: `isMultiplayer`, `isHost`, `myPlayerIndex`, `waitingForRemoteAction`

### Win Detection

Single-pass recursive backtracking engine:

1. **Try every valid pair** — two identical tiles or fei + any tile
2. **`findMelds(hand, count)`** — finds exactly `count` melds from hand (first tile, all sequences, pung, recurse)
3. **Returns true** if any pair + meld combination forms a valid hand

The solver handles mixed sequence+pung hands and all fei substitution patterns correctly. No greedy phases or fallback steps.

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -am 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

See [UPDATE.md](./UPDATE.md) for the project changelog and current development status.

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

## ⚠️ Disclaimers

### Non-Gambling Notice
This software is a **game of skill for entertainment purposes only**. It does not involve real-money wagering, gambling, or any form of financial transaction. No virtual currency, loot boxes, or microtransactions are present.

### Image Attribution
The mahjong tile SVGs used in this project are sourced from publicly available standard mahjong tile sets. The author does not claim ownership of these images. 

---

## 🙏 Acknowledgements

- Standard mahjong tile designs (public domain / fair use)
- React, Vite, Tailwind CSS, Zustand communities
- Singapore Mahjong rules reference materials
