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
- **Chip match lifecycle** — after settlement leaves any player at `$0` or below, the match ends with final chip standings instead of starting another round
- **Server-owned rematches** — Play Again waits for all four seats, counts down for 5 seconds, then creates a new multiplayer room code with the original settings, roster, and reset Starting Chips
- **Responsive tile display** — player tiles face-up, opponent tiles face-down with rotation
- **Rules reference** — in-game rules page covering all scoring patterns
- **Special hands** — Tian Hu, Di Hu, Men Hu, Thirteen Wonders, Qiang Kang, Da San Yuan, Da Xi Si, Kan Kan Hu (坎坎胡), Shi Ba Luo Han
- **Self-Kong** & **Kang Shang** — upgrade pungs, concealed kongs, auto-win on kong replacement
- **Real wall flow** — normal draws continue until the whole wall is down to 15 tiles, while flower/animal and kong replacements draw from the back of that same wall; there is no separately reserved hidden dead wall
- **Round wind rotation** — East → South → West → North, game ends after North
- **AFK warning** — detects player inactivity (>5 min), displays warning to all
- **Move history** — scrollable popup tracking every action per round
- **Mobile action feedback** — multiplayer controls immediately show a pending state, reject accidental double taps, and report slow canonical confirmations
- **Revision-safe synchronization** — one app-shell listener applies each VM state revision once, including reconnect-aware revision resets
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
| Build | Vite 8 |
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

# Run multiplayer server fixtures
npm run test:server
# → Verifies isolated room stores, reconnect tokens, limits, and room persistence

# Run the local 25-room / 100-client load test
npm run test:load
# → Starts a temporary server, drives legal turns, and reports traffic, CPU, memory, event-loop delay, and disconnects

# Verify room recovery across a WebSocket process restart
npm run test:restart
# → Restarts a temporary server and securely rejoins the persisted canonical room
```

### Environment Variables

Create a local `.env` file from `.env.example` when you want analytics or Search Console verification:

```bash
VITE_POSTHOG_KEY=your_posthog_project_key
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_GOOGLE_SITE_VERIFICATION=your_google_verification_token
```

If these are left blank, the app still runs normally and analytics stays disabled.

### Dependency Security

- Production and development dependencies are checked with `npm audit` before release commits.
- The current dependency tree reports zero known vulnerabilities.
- Vite 8 and the matching React plugin replace the older Vite/esbuild toolchain that carried a development-server advisory.
- Secrets, `.env` files, SSH private keys, and persisted room snapshots must never be committed. The repository ignores `.env*` and `server/.data/`, while deployment reads the SSH key from the local filesystem.

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

### Current Production Status

The 2026-07-16 production deployment is running on the Oracle VM:

- Frontend: `http://140.245.104.25` returns HTTP 200.
- Multiplayer: external `ws://140.245.104.25:3002` room creation and room closure passed.
- Services: `sg-mahjong-ws` and Nginx are active.
- Health: `http://127.0.0.1:3002/health` reports `status: ok` on the VM.
- Persistence: secure room tokens are issued and `server/.data/rooms.json` writes version-1 snapshots without retaining closed rooms.
- Bundle verification: the deployed frontend no longer contains the Dev Logs interface.

The `sgmahjong.app` hostname currently does not resolve through DNS, and this VM currently listens on HTTP port 80 rather than HTTPS port 443. Until DNS and TLS are configured, production is reachable through the VM IP and uses `ws://` rather than `wss://`.

### Multiplayer Capacity And Operations

The multiplayer relay remains VM-authoritative and runs as one Node.js process, but active rooms are no longer tied only to process memory:

- The TypeScript game engine is loaded once. Each room receives an isolated lightweight Zustand store instead of transpiling a private module graph.
- Canonical room snapshots and per-seat reconnect tokens are written atomically to `server/.data/rooms.json`.
- `server/.data/` is excluded from Git and deployment rsync deletion, so a normal `sg-mahjong-ws` restart can restore active rooms.
- Restored rooms start paused. Every real-player seat must securely rejoin before play resumes.
- Rejoining requires the room code, seat index, and a cryptographically random token stored in that browser tab's `sessionStorage`.
- A restored room closes if its real players do not reconnect within the restart-recovery timeout.
- Routine state synchronization is coalesced and sends move-history deltas. Full canonical state remains available for initial joins, reconnects, restart recovery, and round starts.
- The app shell is the only canonical `state_update` owner. Server revision numbers reject duplicate or stale snapshots while reconnects explicitly reset the revision gate before accepting a recovery snapshot.
- Human gameplay actions carry a client action ID. The VM echoes that ID with the next canonical state, allowing the browser to keep controls single-flight and measure tap-to-canonical-confirmation latency.
- Unchanged player, wall, meld, and tile-array references are preserved when applying canonical state. Memoized hand and tile render boundaries reduce unnecessary SVG reconciliation on mobile browsers.
- Browser WebSockets are checked with server `ping`/`pong` heartbeats. Dead and excessively backlogged clients are terminated so stale sockets do not consume a room indefinitely.

Operational endpoints are served on the WebSocket port:

```bash
curl http://127.0.0.1:3002/health
curl http://127.0.0.1:3002/metrics
```

`/health` reports active/started/paused rooms, connections, process CPU, RSS/heap memory, event-loop p99 delay, traffic counters, rejected messages, rate limits, and backpressure disconnects. `/metrics` exposes the same core values in Prometheus text format.

Default safety limits:

| Setting | Default |
|---|---:|
| Total WebSocket connections | 250 |
| Connections per source IP | 32 |
| Active rooms | 50 |
| Incoming WebSocket payload | 64 KiB |
| Buffered outbound data per client | 1 MiB |
| Messages per connection | 120 per 10 seconds |
| Room creations per source IP | 10 per minute |
| Heartbeat interval | 30 seconds |
| Host reconnect timeout | 2 minutes |
| Joined-player reconnect timeout | 2 minutes |
| Restart recovery timeout | 10 minutes |

These values can be changed through `MAX_CONNECTIONS`, `MAX_CONNECTIONS_PER_IP`, `MAX_ROOMS`, `MAX_PAYLOAD_BYTES`, `MAX_BUFFERED_BYTES`, `MESSAGE_LIMIT`, `MESSAGE_WINDOW_MS`, `ROOM_CREATE_LIMIT`, `ROOM_CREATE_WINDOW_MS`, `HEARTBEAT_INTERVAL_MS`, `HOST_DISCONNECT_TIMEOUT_MS`, `PLAYER_DISCONNECT_TIMEOUT_MS`, `RESTART_RECOVERY_TIMEOUT_MS`, and `ROOM_STATE_FILE`.

`TRUST_PROXY` defaults to off. Keep it off while clients connect directly to port `3002`; otherwise a client could spoof `X-Forwarded-For` and evade per-IP limits. Enable it only after Node is bound privately behind the trusted Nginx reverse proxy.

The current measured local baseline is:

- 25 active rooms
- 100 connected players
- 300 relayed gameplay actions over 15 seconds
- 1,200 delivered action acknowledgements across the four clients in each room, covering all 300 acting-client actions
- 0 message errors
- 0 unexpected disconnects
- Approximately 12.8 MB sent with action acknowledgements enabled
- Approximately 225 MB process RSS
- Approximately 14.9% process CPU
- Approximately 77 ms event-loop p99 delay

This establishes **100 concurrent players / 25 rooms as the tested local target**, not a guarantee for every VM or mobile network. Check the VM health metrics during real usage before raising the documented target.

The server is intentionally still single-VM. Do not place multiple independent WebSocket instances behind a load balancer: room state and reconnect credentials are local to one VM. Multi-VM operation requires a shared room-state/coordination layer such as Redis plus sticky routing or explicit room ownership.

### Multiplayer Verification

Multiplayer gameplay is verified manually with separate host and join browser sessions because the VM owns the canonical room state. The main regression checklist is:

1. Create and join a room, then confirm both clients receive the same player names, seat winds, dealer badge, chips, and room state.
2. Verify ready/countdown and result-to-next-round behavior, including a dealer win and a non-dealer win.
3. Verify Win, Kong, Pung, Chi, and Pass controls only appear for the eligible local player.
4. Compare move history after relayed actions.
5. Test host app-switch/reconnect, join reconnect, explicit quit, paused-room handling, and room closure.
6. Check the table, result screen, payout breakdown, and history on mobile browsers.
7. On mobile data, confirm each action immediately shows `Sending ...`, controls cannot be double-tapped while pending, and slow confirmations display their measured milliseconds.
8. Reduce one player to `$0` or below, confirm final chip standings, verify bot/real-player ready status, and confirm the 5-second rematch creates a different room code with the original settings and reset chips.
9. Press Quit from a non-host seat and confirm the room closes for every connected client while transient socket disconnects still use the reconnect path.

### Mobile Multiplayer Latency

Multiplayer remains VM-authoritative: the browser does not commit a discard or claim until the VM validates it and returns canonical state. To keep that safe model responsive on phones:

- Only one gameplay action may be pending per browser seat.
- The selected action displays immediately as `Sending ...`.
- The VM returns the client action ID with the canonical state that processed it.
- Confirmations taking at least 250 ms display their measured round-trip time for diagnosis.
- PostHog records `multiplayer_action_latency` when analytics is configured, including the browser-reported connection type, estimated network RTT, and downlink where available.
- Duplicate or stale state revisions are ignored, while reconnects reset the revision gate before rehydration.

The current raw-IP deployment still uses plaintext `ws://` on port `3002`. The preferred production network layout for mobile reliability is HTTPS and WSS through Nginx on standard port `443`, with the Node relay kept private on `127.0.0.1:3002`. That cutover belongs to the domain/DNS/TLS phase and should happen only after the hostname points to the VM.

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
| Quit Game | Close the multiplayer room for everyone, or return to the menu in singleplayer |
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
| Kan Kan Hu (坎坎胡) — 8 tai special + required Zi Mo | 9 |
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
- Match-over detection at `$0` or below, final standings, all-seat rematch readiness, and fresh-match chip/config reset.
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
