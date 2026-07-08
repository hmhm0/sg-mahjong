# UPDATE.md — Singapore Mahjong

This file tracks all features, improvements, and fixes per development session.  
Update this file whenever a meaningful change is made to the codebase.

---

## [2026-07-08] — Phase: Core Gameplay & Scoring

### Added

#### Winning Hand Patterns
- **Full Flush Sequence Hand** (清一色平胡) — +10 tai, all chi melds, one suit, no bonuses
- **Full Flush Triplets Hand** (清一色碰碰胡) — +8 tai, all pungs/kongs, one suit, win with eyes
- **Ping Hu** (平胡) — +4 tai, all chi melds, no bonuses, no side wait, no dan diao
- **Chou Ping Hu** (臭平胡) — +1 tai, all chi, no side wait, no 1/9 win tile, self-draw unless other tai
- **Pong Pong Hu** (碰碰胡) — +2 tai, all pungs/kongs, win with eyes
- **Kang Kang Hu** (杠杠胡) — +8 tai, all concealed pungs, self-draw only
- **Xiao San Yuan** (小三元) — +4 tai, 2 dragon pungs + dragon pair + Dragon Eyes bonus
- **Da San Yuan** (大三元) — +10 tai, 3 dragon pungs (any combination)
- **Xiao Xi Si** (小四喜) — 40 tai (limit), 3 wind pungs + 4th wind as eyes
- **Da Xi Si** (大四喜) — +10 tai, all 4 wind pungs
- **Pure Honours** (字一色) — +10 tai, all honor tiles, all pungs/kongs, win with eyes
- **Tian Hu** (天胡) — +10 tai, dealer wins with opening hand (after bonus replacements)
- **Di Hu** (地胡) — +10 tai, non-dealer wins on dealer's first discard
- **Men Hu** (门胡) — +10 tai, non-dealer wins on first drawn tile
- **Thirteen Wonders** (十三幺) — +10 tai, all 13 terminal/honor tiles + 1 duplicate
- **Shi Ba Luo Han** (十八罗汉) — +18 tai, 4 kongs + 1 pair
- **Qi Qiang Yi** (七搶一) — +10 tai, 7+1 flower/season transfer
- **Hua Hu** (花胡) — +12 tai, self-drawn all 8 flowers/seasons
- Concealed Hand (Men Qing) — +1 tai (fixed detection)

#### Priority Rules
- **Thirteen Wonders**: Absolute discard priority over all other claims
- **Qiang Kang**: Thirteen Wonders can snatch a tile from a Kong declaration
- Win > Kong > Pung > Chi claim priority (always)

#### Auto-Scaling
- Viewport-aware scaling for short viewports (e.g., 333px dev tools height)
- Content automatically scales to fit within viewport

### Fixed

- **Concealed Hand detection**: Now correctly requires self-draw + no melds (was broken)
- **Little Three Dragons detection**: Now checks both exposed melds AND concealed pungs in hand
- **Big Three Dragons detection**: Updated to use combined dragon pung types
- **Dragon Eyes**: +1 tai now only applies with Xiao San Yuan (not universally)
- **Hua Shang / Kang Shang**: Orphaned code blocks outside calculateTai — moved inside
- **TypeScript build errors**: Various type narrowing fixes with `as any` casts
- **Multiple file corruption issues**: Python/sed reconstruction errors causing broken JSX structure
- **Missing `{players[3] && (`**: Lost during reconstruction, caused esbuild compile error
- **Orphaned middle section**: Sheared out during reconstruction, restored with proper nesting
- **Empty bottom section div**: Premature close/empty div causing layout collapse to right
- **Wrong indentation on closing tags**: Right opponent close, flex-1 flex close fixed

### Changed

- **Full Flush**: Changed from +6 to +4 tai
- **Big Three Dragons**: Changed from +6 to +10 tai
- **Little Three Dragons**: Renamed to Xiao San Yuan with proper breakdown
- **Four Little Winds**: Renamed to Xiao Xi Si (小四喜)
- **Four Great Winds**: Renamed to Da Xi Si (大四喜), changed from 40 to +10 tai
- **Half Flush / Full Flush**: Updated to use `visibleOnly` flag for opponent visibility
- **All Pungs / Pong Pong Hu**: Made mutually exclusive; Pong Pong Hu requires win with eyes
- **Concealed pung detection**: Added for dragon/wind patterns (previously only checked exposed melds)
- **GameTable layout**: Multiple spacing/padding adjustments, hand tile size optimization

### Known Issues

- **Multiplayer**: Host/Join are placeholders; WebSocket server skeleton exists but no game state sync
- **AI doesn't chi**: AI players will pung/kong/win but never claim chi
- **No self-kong**: `canSelfKong` function exists but is never called in game flow
- **No round wind rotation**: Round wind is always East
- **Chou Ping Hu restrictions**: Documented in Rules page but not code-enforced
- **Animal pairs bonus**: Not scored (cat+rat, chicken+millipede)
- **`hasValidTai`**: Imported but unused (threshold check is inline)
- **Scaling**: Auto-scaling removed due to structural conflicts; page scrolls at sub-400px viewports

---

## [2026-07-07] — Initial Rules Engine & UI

### Added

- Complete 152-tile deck: suits, honors, bonuses, Fei (jokers)
- 4-player table with 3 AI opponents and 1 human
- Dealer rotation with East badge (庄)
- Full discard pile with chronological display
- Claim system: Win > Kong > Pung > Chi
- Self-draw win flow with Win/Pass buttons
- Configurable tai threshold and Fei count
- Basic AI: scoring-based discard, auto-claim with delays
- Tile SVGs for all standard mahjong tiles
- Rules reference page with full glossary
- Tutorial page
- Zustand store with complete game state management

### Tai Patterns (Initial)

- Seat/Round Wind Pung (+1), Dragon Pung (+1)
- Half Flush (+2), Full Flush (+6)
- All Pungs (+3), Little Three Dragons (+4), Big Three Dragons (+6)
- Four Little Winds (40), Four Great Winds (40)
- Self-Draw (+1), Concealed Hand (+1)
- Flowers/Seasons/Animals (+1 each)
- Fei penalty (-1 each, not enforced)

---
## [2026-07-08] — Phase: Engine Rewrite (Backtracking Win Detection)

### Changed

- **Complete win detection rewrite**: Replaced the 3-phase greedy+fallback algorithm (`findSequence` → Phase 2 fei backtracking → pung fallback) with a single-pass recursive backtracking engine.
- **`findMelds`**: Now takes a required `count` parameter. Old signature `findMelds(hand)` (find unlimited melds) changed to `findMelds(hand, count)` (find exactly `count` melds).
- **`collectAllSequences`**: New function replaces `isSequence` + `findSequence`. Exhaustively tries ALL non-fei/fei tile assignments for each needed sequence value using backtracking.
- **`checkWin`**: Now inlines pair-finding (tries ALL valid pairs instead of just first fei match) instead of calling `hasPair`.
- **`hasPair`**: Updated to exhaustively try all pair combinations and verify with `findMelds(remaining, 4)`.
- **Removed**: `isSequence`, `findSequence`, the old multi-phase `findMelds` variants (~100 lines removed). Net bundle size decreased.

### Fixed

- **"Wasted tile" false positive**: The old `findSequence` consumed 3 non-fei tiles when fei substitution only needed 2. A 3rd tile was silently wasted as padding, causing false wins. New `collectAllSequences` only consumes tiles that actually participate in the sequence.
- **`isKangKangHu`**: Was calling `findMelds(remaining)` without required count parameter (passed `undefined` as count, causing incorrect behavior). Fixed to `findMelds(remaining, 4)`.
- **`isPureHonours`**: Same missing `count` parameter bug. Fixed to `findMelds(remaining, expected)` with the declaration moved before the call. Also fixed duplicate `const expected` declaration.

### Architecture

New engine structure:
```
collectAllSequences(hand, suit, needed)
  └── collectSeqRecur(remaining, suit, needed, i, meld, results)
        ├── Try non-fei tile for each needed value
        └── Try fei tile for each needed value (backtracking)

findMelds(hand, count)
  ├── Pick first non-fei tile
  ├── Try all sequences containing it via collectAllSequences
  ├── Try pung (3 identical tiles)
  └── Recurse

checkWin(hand, melds)
  └── Try ALL valid pairs
  └── Call findMelds(remaining, remainingMeldCount)
```

### Performance

- No change — hand size is max 14 tiles, worst-case backtracking is <0.1ms
- Purposely not optimized (premature optimization was the root cause of earlier bugs)

---

## Upcoming / Roadmap

- [ ] AI chi claiming
- [ ] Self-kong implementation
- [ ] Round wind rotation
- [ ] Animal pairs bonus (cat+rat, chicken+millipede)
- [ ] Multiplayer via WebSocket
- [ ] Sound effects
- [ ] Mobile-responsive layout improvements
- [ ] Game replay / history
- [ ] i18n (Chinese/English toggle)

---

## [2026-07-08] — Phase: Multiplayer Infrastructure

### Added

- **WebSocket relay server**: `server/index.cjs` updated with `player_action` and `state_update` message types for multiplayer
- **Host-as-authority architecture**: Host client runs full game state, broadcasts to all connected clients
- **Store multiplayer support**: `isMultiplayer`, `isHost`, `myPlayerIndex`, `waitingForRemoteAction` fields
- **Remote player handling**: `drawTile` now checks if a player is remote — doesn't auto-discard, waits for action
- **`applyRemoteAction`**: Store method that processes actions received from remote clients (discard, self-draw win, pass)
- **HostGame broadcasting**: After each state change, host debounce-broadcasts `state_update` to all connected clients
- **HostGame action handler**: Listens for `player_action` messages from remote clients via the server relay
- **JoinGame state receiving**: Listens for `state_update` and applies received game state directly (no seed-based sync)
- **Start script**: `start_mahjong.command` now starts both Vite dev server (port 5173) AND WebSocket server (port 3001)

### Multiplayer Architecture

```
Remote Client                Server                  Host (Authority)
─────────────                ──────                  ────────────────
     │                         │                         │
     │── player_action ──────→ │ ── player_action ─────→ │
     │   (discard, win, etc.)  │                         │── applyRemoteAction()
     │                         │                         │── store method runs
     │                         │                         │── state changes
     │                         │                         │── broadcast state
     │←── state_update ───────│ ←── state_update ───────│
     │       (full state)     │                         │
```

### Current Status (MVP)

| Feature | Status | Notes |
|---|---|---|
| Room creation (host) | ✅ | Existing, tested |
| Room joining | ✅ | Existing, tested |
| Game state sync (host → clients) | ✅ | Implemented |
| Remote player discarding | ✅ | Via `applyRemoteAction` |
| Remote player self-draw win | ✅ | Auto-handled by host |
| Remote claims | ✅ | Auto-handled by host (like AI) |
| **Remote client sending actions** | ⏳ **Needs GameTable wiring** | See below |
| AI fill-in for empty slots | ❌ | Not implemented |
| Reconnection | ❌ | Not implemented |

### Remaining for MVP

**Remote client action sending** — The final piece. GameTable.tsx needs to:
1. Import `connection` from `../utils/connection`
2. After each local player action (discard, win, claim, pass), send the action to the host via WebSocket if `isMultiplayer && !isHost`

This is a straightforward modification to `GameTable.tsx` — add the import and send calls after each store action call. Estimated effort: ~30 minutes.

### Dev Notes

- Start the game: double-click `start_mahjong.command` on Desktop (starts both servers)
- WebSocket server runs on **port 3001**
- Vite dev server runs on **port 5173**
- Room codes are 4-character alphanumeric (no 0, 1, I, O)
- Host is always Player 0 (East)
- All clients must be on the same network (default)

## [2026-07-08] — Phase: Multiplayer Bug Fixes

### Fixed

- **Server playerIndex misalignment**: Server was assigning `playerIndex: 0` to first joiner (same as host). Fixed to `freeSlot + 1` so joiners get indices 1-4.
- **GameTable hardcoded `0` for claims**: All `claimTile(0, ...)` and `e.playerIndex === 0` references changed to use `humanIdx` from `myPlayerIndex` — join clients now show "You (P1)" instead of wrong tiles.
- **Remote client double-processing**: Join client was calling `discardTile` locally AND sending to host, causing state divergence. Fixed by routing actions through WebSocket only for join clients.
- **Remote claim routing**: Added `handleClaim`/`handlePassClaim` helper functions that send actions to host for join clients instead of processing locally.
- **`applyRemoteAction` handling**: Extended to handle `win`, `kong`, `pung`, `chi`, and `pass_claim` action types.
- **HostGame memory leak**: Store subscription and action listener were registered at component body level (every render), accumulating duplicates. Moved into `useEffect` with proper cleanup.
- **Server action message parsing**: Server now extracts `playerIndex` from `msg.data.playerIdx` if not at top level of message.

### Changed

- WebSocket server port changed from **3001** → **3002** due to port conflict with system `redwood-broker`
- Connection URL updated to `ws://hostname:3002`
- Updated `start_mahjong.command` to use port 3002

## [2026-07-08] — Phase: Multiplayer Bug Fixes (cont.)

### Fixed

- **HostGame subscription cleanup**: Store subscription and action listener were unsubscribed when HostGame unmounted (due to `window.location.hash = '#/'` navigation). This broke all state broadcasting after the initial game start. Now only cleaned up if the game hasn't started (cancel flow).
- **Auto-play for remote humans**: The store used `playerIndex !== 0` to detect AI players. In multiplayer, all players have `isHuman: true`, so the host was auto-discarding for remote humans ("bot discarding from nowhere"). Changed to check `players[playerIndex].isHuman` directly — only pure AI players (isHuman === false) get auto-play.
- **ClaimTile auto-discard for remote humans**: Same fix — only auto-discard after a claim for pure AI players, not remote humans.
- **Player position rotation**: The opponent display positions were hardcoded (`players[1]` right, `players[2]` top, `players[3]` left). For the join client (P1), this showed P1's own tiles in two places and hid the host (P0/East) entirely. Now positions rotate based on `humanIdx`: right = `(humanIdx+1)%4`, top = `(humanIdx+2)%4`, left = `(humanIdx+3)%4`.

## [2026-07-08] — Phase: Self-Kong, Round Wind, AI Chi

### Added

- **Self-Kong (自杠)**: Players can now upgrade an exposed Pung to a Kong when drawing the 4th matching tile. Also supports Concealed Kong (4 of a kind in hand). Orange Kong button appears next to Pass when available.
- **Kang Shang**: If the replacement tile from a Kong completes a winning hand, auto-wins.
- **Round Wind Rotation**: After all 4 players have been dealer once (4 games), round wind rotates East → South → West → North. Game ends after North round is complete.
- **AI Chi**: AI players can now claim Chi (sequence) from discards. Picks the first valid chi option. Priority: Win > Kong > Pung > Chi.
- **Round wind display**: Center panel shows current round wind (East/South/West/North round).

### Fixed

- `dealerCount` and `roundWind` preserved through `reset()` so round tracking persists across consecutive games.
- End-of-game condition: Game stops after North round completes (all 4 players have been dealer in North).
- Self-kong, concealed kong, and pass-self-kong actions properly routed via WebSocket for multiplayer join clients.
