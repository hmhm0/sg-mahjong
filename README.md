# 🀄 Singapore Mahjong

A full-featured **Singapore Mahjong** game with single-player (vs 3 AI) and multiplayer (WebSocket) modes. Built with React, TypeScript, Vite, and Zustand.

> **⚠️ Disclaimer:** This project is created **for entertainment and educational purposes only**. It is **not intended for gambling or real-money play**. All mahjong tile images are sourced from publicly available assets and are not owned by the author.

Copyright &copy; 2026 sgmahjong.app. All rights reserved.

---

## ✨ Features

- **Single-player** — you vs 3 AI opponents with smart discard and claim AI
- **Multiplayer** — Host a game room, share the 4-character room code, others join via WebSocket
- **Full Singapore Mahjong rules** — including Fei (jokers), bonus tiles, dealer rotation
- **Comprehensive tai system** — 25+ scoring patterns including Ping Hu, Pong Pong Hu, Thirteen Wonders, pure honour hands, and limit hands
- **Smart AI** — scoring-based discard selection, claim priority with delays
- **Configurable** — tai threshold, Fei count, unlimited tai mode
- **Special-hand cap toggle** — optional `Caps Max Tai for Special` switch with a slider up to 18 tai for special wins
- **Responsive tile display** — player tiles face-up, opponent tiles face-down with rotation
- **Rules reference** — in-game rules page covering all scoring patterns
- **Special hands** — Tian Hu, Di Hu, Men Hu, Thirteen Wonders, Qiang Kang, Da San Yuan, Da Xi Si, Shi Ba Luo Han
- **Self-Kong** & **Kang Shang** — upgrade pungs, concealed kongs, auto-win on kong replacement
- **Real wall flow** — normal draws continue until the whole wall is down to 15 tiles, while flower/animal and kong replacements draw from the back of that same wall; there is no separately reserved hidden dead wall
- **Round wind rotation** — East → South → West → North, game ends after North
- **AFK warning** — detects player inactivity (>5 min), displays warning to all
- **Move history** — scrollable popup tracking every action per round
- **Developer logs** — in-game trace of hands, bonus tiles, discards, and win-evaluation snapshots for debugging
- **SEO-ready pages** — route-specific titles, descriptions, canonical tags, structured data, robots.txt, sitemap.xml, and social preview metadata
- **Prerendered public pages** — the build writes static HTML snapshots for `/rules/` and `/tutorial/`, while temporary room pages stay `noindex`
- **Clean host/join flow** — in-app navigation opens Host/Join without a full reload, and multiplayer reconnects can resume the same room after a transient disconnect
- **App manifest** — includes a web manifest and app metadata so the site behaves more like a finished installable app
- **Free analytics** — PostHog is wired behind environment variables, with Google Search Console verification support via build-time env injection

### UI Direction

- From this point onward, new UI work should stay mobile-friendly first. Keep layouts compact, touch targets usable, and result/history panels readable on phones before polishing desktop extras.

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
cd sg-mahjong

# Install dependencies
npm install

# Start the dev server
npm run dev
# → Open http://localhost:5173

# Build for production
npm run build
# → Output in dist/

# Run the scoring smoke tests
npm run test:rules
# → Verifies scoring, payouts, wall flow, dealer rotation, kongs, and special-win transitions
```

### Environment Variables

Create a local `.env` file from `.env.example` when you want analytics or Search Console verification:

```bash
VITE_POSTHOG_KEY=your_posthog_project_key
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_GOOGLE_SITE_VERIFICATION=your_google_verification_token
```

If these are left blank, the app still runs normally and analytics stays disabled.

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

### Oracle VM Deploy

The production VM is configured to serve the built frontend from `/var/www/sg-mahjong` and run the multiplayer relay from `/home/ubuntu/sg-mahjong/server/index.cjs`.

Use the one-command deploy helper after making code changes:

```bash
npm run deploy:vm
```

On macOS, you can also double-click:

```bash
./deploy-to-oracle-vm.command
```

What it does:

1. Builds the project locally.
2. Rsyncs the repo to the Oracle VM at `/home/ubuntu/sg-mahjong`, excluding `.git`, `node_modules`, `dist`, and local env files.
3. Runs `npm ci` and `npm run build` on the VM.
4. Copies the new `dist/` output to `/var/www/sg-mahjong`.
5. Restarts `sg-mahjong-ws` and reloads Nginx.

Defaults used by the script:

- Host: `140.245.104.25`
- User: `ubuntu`
- SSH key: `~/Downloads/ssh-key-2026-07-09.key`
- App directory: `/home/ubuntu/sg-mahjong`
- Web root: `/var/www/sg-mahjong`

You can override these per shell session if needed:

```bash
REMOTE_HOST=1.2.3.4 REMOTE_USER=ubuntu SSH_KEY=~/.ssh/your_key npm run deploy:vm
```

If you change only documentation, you do not need to deploy.

### Multiplayer Verification

Multiplayer gameplay is verified manually with separate host and join browser sessions because the VM owns the canonical room state. The main regression checklist is:

1. Create and join a room, then confirm both clients receive the same player names, seat winds, dealer badge, chips, and room state.
2. Verify ready/countdown and result-to-next-round behavior, including a dealer win and a non-dealer win.
3. Verify Win, Kong, Pung, Chi, and Pass controls only appear for the eligible local player.
4. Compare move history and developer logs after relayed actions.
5. Test host app-switch/reconnect, join reconnect, explicit quit, paused-room handling, and room closure.
6. Check the table, result screen, payout breakdown, history, and developer logs on mobile browsers.

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
| Thirteen Wonders (十三幺) | 13 |
| Qi Qiang Yi (七搶一) | 10 |
| Hua Hu (花胡) | 12 |
| Shi Ba Luo Han (十八罗汉) | 18 |
| Half Flush (混一色) | 2 |
| Pong Pong Hu (碰碰胡) | 2 |
| Xiao San Yuan (小三元) | 4 |
| Xiao Xi Si (小四喜) | 4 |
| All Pungs | 3 |
| +1 patterns | Seat/Round Wind Pung, Dragon Pung, Self-Draw, Concealed Hand, Chou Ping Hu, Hua Shang, Kang Shang, Dragon Eyes, Flowers/Seasons/Animals |

See the full rules reference in-game at `/rules`.

### Regression Coverage

`npm run test:rules` includes deterministic fixtures for:

- Standard, Fei-assisted, and visible-only scoring.
- Discard and Zi Mo tai thresholds.
- Payout tables, shooter mode, chip settlement, and tai caps.
- Front-wall draws, back-wall replacements, the 15-tile cutoff, and kong exhaustion.
- Dealer-cycle counts and seat-wind rotation.
- Tian Hu, Di Hu, Men Hu, Hua Shang, Kang Shang, Qi Qiang Yi, Hua Hu, Qiang Kang Thirteen Wonders, and the locked limit-hand totals.

---

## 🔎 Search Visibility

The public site is structured to be easy to discover for searches such as:

- Singapore Mahjong
- Singapore Mahjong rules
- Fei joker Mahjong
- Mahjong tai scoring
- Online Singapore Mahjong game

The home page, tutorial page, and rules reference each expose their own page titles and descriptions, with crawl files, static prerendered HTML, and social preview metadata included for search engines and link previews. Host and join room pages are marked `noindex` because they are temporary multiplayer surfaces.

### Hosting Notes

When deploying, make sure the host serves `/index.html` as the SPA fallback for unmatched routes. The repo also includes Netlify and Vercel fallback configs so the public routes keep working after publish.

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
│   │   ├── HostGame.tsx       # Multiplayer host lobby
│   │   └── JoinGame.tsx       # Multiplayer join lobby
│   ├── utils/
│   │   └── connection.ts      # WebSocket client
│   ├── App.tsx                # Root component + route handling
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
└── server/index.cjs           # WebSocket multiplayer relay and round setup authority
```

---

## 🧠 Architecture

### Multiplayer Architecture

```
Remote Client                VM Server               Seat 0 Client
```

- **VM/server** owns room creation, reconnect snapshots, round setup, and the canonical room state
- **VM/server** now applies multiplayer turn actions, then broadcasts the canonical state back to every client
- **Seat 0 client** renders the table and sends the same actions as everyone else; it is no longer the room brain
- **Join clients** send actions to the VM relay, receive full state updates, and rehydrate from room snapshots

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
