# UPDATE.md — Singapore Mahjong

This file tracks all features, improvements, and fixes per development session.  
Update this file whenever a meaningful change is made to the codebase.

---

## [2026-07-16] — Phase: Dependency Security Audit and Vite 8 Upgrade

### Changed

- **Secure build toolchain**: Upgraded Vite from 5.x to `8.1.4` and `@vitejs/plugin-react` to `6.0.3`, removing the esbuild development-server advisory reported by the previous lockfile.
- **VM compatibility**: Confirmed the Oracle VM runs Node `20.20.2`, which satisfies Vite 8's supported Node range.
- **Security documentation**: Added the release rule that `.env` files, SSH private keys, reconnect credentials, and persisted `server/.data/` room snapshots must remain outside Git.

### Security Audit

- `npm audit --omit=dev` reports 0 vulnerabilities.
- Full `npm audit` reports 0 vulnerabilities after the toolchain upgrade.
- Repository secret scans found no private-key blocks, access tokens, API keys, reconnect-token values, `.env` files, or persisted room snapshots in the publish set.
- The documented PostHog/Search Console values are placeholders, and the SSH key references are local filesystem paths only; no key material is present.
- Git remote access was verified against `origin/main` before staging.
- **Proxy-header hardening**: Direct WebSocket clients can no longer spoof `X-Forwarded-For` to bypass per-IP connection and room-creation limits. Proxy headers are trusted only when `TRUST_PROXY` is explicitly enabled behind the future private Nginx proxy.
- **Cryptographic room codes**: Room and rematch codes now use `crypto.randomInt` instead of `Math.random`.

### Verified

- `npm run test:rules`
- `npm run test:server`
- `npm run test:load`
- `npm run test:restart`
- `npm run build`
- `npm audit`
- `git diff --check`
- Vite 8 production build and prerender completed successfully.
- 25 rooms / 100 clients / 300 actions completed with 0 errors, 0 unexpected disconnects, and complete action acknowledgement coverage.

## [2026-07-16] — Phase: Mobile Multiplayer Latency and Render Hardening

### Fixed

- **Duplicate canonical application**: Removed page-level `state_update` writes from Game, Host Game, and Join Game. The persistent App shell is now the single owner that applies VM canonical snapshots.
- **Revision deduplication**: Added a per-room revision gate that rejects duplicate and stale snapshots. Reconnects and recreated room codes reset the gate so legitimate recovery snapshots still apply.
- **Multiplayer self-kong divergence**: Stopped the browser from locally clearing the self-kong prompt after sending a multiplayer kong. The VM canonical response now remains the only multiplayer state mutation.
- **Mobile double-action risk**: Multiplayer actions are single-flight per browser seat, so repeated taps cannot send another discard, claim, pass, win, or kong while the first action is awaiting canonical confirmation.

### Added

- **Canonical action acknowledgements**: Browser actions now carry a bounded client action ID. The VM echoes successful action IDs with the next canonical `state_update`, while rejected actions echo the ID in the error response.
- **Immediate pending feedback**: Mobile and desktop controls show `Sending ...` as soon as an action is sent and use a waiting/disabled state until the VM confirms, rejects, disconnects, or reaches the eight-second timeout.
- **Action latency telemetry**: Canonical acknowledgements measure tap-to-state-confirmation latency. Confirmations at or above 250 ms are shown in the game room, and configured PostHog projects receive action type, measured latency, browser-reported connection type, estimated RTT, and downlink.
- **Canonical structural sharing**: Unchanged players, walls, dead-wall arrays, discard history, winning tiles, and configuration retain their existing references instead of being replaced after every JSON snapshot.
- **Mobile render boundaries**: Converted full-store table subscription to a shallow selector, memoized tile/meld rendering, and split face-down and interactive hand rows into memoized components.
- **Regression fixtures**: Added duplicate/older revision rejection, reconnect reset, new-room revision reset, and unchanged canonical-reference coverage.
- **Load acknowledgement coverage**: The 25-room / 100-client harness now assigns action IDs and fails if canonical acknowledgements do not cover every sent action.

### Verified

- `npm run test:rules`
- `npm run test:server`
- `npm run test:load`
- `npm run test:restart`
- `npm run build`
- `node --check server/index.cjs`
- `node --check scripts/load-test-ws.cjs`
- `git diff --check`
- 25 rooms / 100 clients / 300 actions completed with 0 errors and 0 unexpected disconnects.
- The action-acknowledgement load fixture observed 1,200 delivered acknowledgement entries across the four clients per room, covering all 300 acting-client actions.

### Next Infrastructure Phase

- Keep the Node WebSocket relay private on `127.0.0.1:3002`.
- Point the production domain DNS to the Oracle VM.
- Remove the duplicate Nginx default-server declaration.
- Configure TLS and serve the website through HTTPS on port 443.
- Proxy a same-origin WebSocket path through Nginx and switch browsers to `wss://` on standard port 443.
- Re-run mobile-data latency, reconnect, health, and external WebSocket tests after the secure cutover.

## [2026-07-16] — Phase: Developer Log Removal

### Removed

- **Developer-log UI**: Removed the in-game `Dev Logs` button, overlay, clear action, raw JSON viewer, and mobile developer-log panel.
- **Snapshot generation**: Disabled developer-log creation in the game store so gameplay no longer builds or retains full per-player hand snapshots after draws, discards, claims, and win evaluations.
- **Multiplayer debug transport**: Removed developer-log delta fields and counters from routine canonical synchronization. Move History remains synchronized independently.
- **Persisted debug data**: Room serialization and restart restoration now force `debugLogs` to an empty array, preventing old developer snapshots from remaining in new room persistence files.

### Changed

- **Manual verification scope**: Multiplayer parity and mobile checks now cover Move History only; developer-log parity is no longer an active requirement.
- **100-player capacity result**: The 25-room / 100-client test dropped from approximately 23.4 MB to 12.6 MB outbound traffic after developer snapshots were removed, with 0 errors and 0 unexpected disconnects.

### Verified

- `npm run test:rules`
- `npm run test:server`
- `npm run test:load`
- `npm run test:restart`
- `npm run build`
- `npm run deploy:vm`
- `node --check server/index.cjs`
- `git diff --check`
- Oracle VM frontend returned HTTP 200 through `140.245.104.25`.
- External WebSocket smoke test created and closed a production room and received a 43-character reconnect token.
- `sg-mahjong-ws` and Nginx verified active after deployment.
- `/health` returned `status: ok`; VM WebSocket process memory was approximately 60 MB while idle.
- `server/.data/rooms.json` wrote a version-1 persistence snapshot and retained zero rooms after the smoke room closed.
- Deployed frontend verification confirmed the Dev Logs interface is absent.

### Infrastructure Note

- `sgmahjong.app` currently has no resolvable DNS record from either the development machine or the VM.
- Nginx currently listens on port 80 but not port 443, so the deployed site is presently verified through `http://140.245.104.25` and `ws://140.245.104.25:3002`.
- Nginx still emits the existing non-fatal duplicate default-server warning for `server name "_"`.

## [2026-07-15] — Phase: 100-Player Multiplayer Production Hardening

### Changed

- **Shared room-engine factory**: The browser keeps the existing React Zustand hook while the VM loads the TypeScript engine once and creates isolated lightweight vanilla stores per room, removing the previous per-room TypeScript runtime/transpilation cost.
- **Coalesced canonical sync**: Server store changes are combined into one update per action window instead of broadcasting every internal Zustand `set`.
- **Move-history deltas**: Routine multiplayer updates append only new move-history entries; full canonical state is still sent for starts and reconnects. Delta application remains idempotent under repeated delivery.
- **Server-owned action authorization**: The VM validates that the socket owns the acting seat and that discard, claim, pass, Zi Mo, and kong actions are currently available for that seat.
- **Configuration validation**: Multiplayer game settings, room codes, player names, action indexes, and Chi payloads are normalized and bounded before reaching the canonical engine.

### Added

- **Secure seat reconnects**: Every seat receives a cryptographically random reconnect token. Room code plus player index is no longer enough to replace an active or disconnected seat.
- **Restart room recovery**: Canonical rooms, settings, readiness, chip state, roster, and reconnect credentials are atomically persisted to `server/.data/rooms.json`; restored rooms remain paused until every real-player seat securely rejoins.
- **Persistence-safe deployment**: Git and VM rsync exclude `server/.data/`, so normal code deployments do not delete persisted room snapshots.
- **WebSocket heartbeat**: Server `ping`/`pong` checks terminate stale half-open sockets.
- **Traffic safety limits**: Added total/per-IP connection ceilings, room-count and room-creation limits, per-connection message limits, a 64 KiB payload cap, and server-side validation for unsupported/binary messages.
- **Backpressure handling**: Slow clients exceeding the outbound buffer ceiling are closed instead of allowing unbounded queued state to consume VM memory.
- **Room cleanup matrix**: Host and joined-player reconnect timeouts now close abandoned started rooms; abandoned lobby seats are released and receive rotated reconnect credentials.
- **Reconnect wait parity**: Removed the browser's old 5-second forced exit from paused rooms. Clients now wait for the VM reconnect timeout or can explicitly close the room with Quit Room.
- **Health and metrics endpoints**: Added `/health` JSON and `/metrics` Prometheus output for rooms, connections, CPU, RSS/heap, event-loop p99 delay, traffic, rejections, rate limits, and backpressure.
- **Server fixtures**: Added deterministic coverage for isolated room stores, secure tokens, room-code validation, connection/message limits, and atomic persistence.
- **100-client load harness**: Added a spawned local test that creates 25 four-player rooms, starts every game, drives legal turns, and fails on errors or unexpected disconnects.
- **Restart recovery harness**: Added an end-to-end process restart fixture proving a playing room is restored and can only be rejoined with its seat token.

### Capacity Baseline

- 25 active rooms / 100 WebSocket clients.
- 300 gameplay actions over 15 seconds.
- 0 errors and 0 unexpected disconnects.
- Approximately 23.4 MB outbound traffic, reduced from approximately 471 MB before state coalescing/deltas.
- Approximately 231 MB RSS, 14.9% process CPU, and 88 ms event-loop p99 delay on the local development machine.
- Default production ceilings are 250 connections and 50 active rooms. The documented supported target remains the measured 100 players / 25 rooms until VM telemetry proves a higher limit.

### Verified

- `npm run test:rules`
- `npm run test:server`
- `npm run test:load`
- `npm run test:restart`
- `npx tsc -p tsconfig.app.json --pretty false`
- `node --check server/index.cjs`
- `git diff --check`

## [2026-07-15] — Phase: Host Quit to Singleplayer Isolation

### Fixed

- **Stale room-state race**: Removed the 150 ms delayed disconnect after in-game Quit and Host Game cancellation, preventing the old room from sending a final canonical snapshot after the user has returned to the menu.
- **Singleplayer isolation**: Active and finished singleplayer sessions now reject multiplayer `state_update` messages even if an obsolete room socket somehow emits a delayed event.
- **Retired socket guard**: WebSocket callbacks now verify that they belong to the currently active socket before dispatching messages or reconnecting.
- **Persistent global listeners**: Disconnecting no longer clears every registered connection handler, so App-level room lifecycle listeners remain available when the user hosts or joins another room later in the same browser session.
- **Connecting-socket cleanup**: Disconnect now closes or retires sockets that are still connecting instead of allowing an abandoned socket to open later.

### Added

- **Regression coverage**: Added fixtures proving delayed room state is rejected by active singleplayer games while valid multiplayer and stored-room reconnect snapshots remain accepted.

### Verified

- `npm run test:rules`
- `npm run build`
- Local two-client WebSocket timing test confirmed that `quit_room` still reaches the VM when the host closes the socket immediately afterward.

## [2026-07-15] — Phase: Chip Match End and New-Room Rematch

### Added

- **Chip match boundary**: A settled win now ends the match when any player reaches `$0` or a negative chip balance; the old room cannot advance into another hand after that result.
- **Final chip standings**: Added a mobile-friendly Match Over screen that ranks all four players by final chips and identifies the top player or joint leaders.
- **All-seat Play Again status**: Added per-seat readiness with a visible `X/4 ready` status. Bot seats are ready automatically, while every real player must press Play Again.
- **VM-owned rematch countdown**: Multiplayer rematches now use a server-authoritative 5-second countdown instead of the browser-owned ordinary round countdown.
- **New-room rematch**: After unanimous readiness, the VM creates a new four-character room code, keeps the same roster and exact original configuration, resets Starting Chips, rolls fresh seats, and restarts from East round `1/4`.
- **Explicit room-wide Quit**: The in-game Quit button now sends a dedicated room-close command from any seat. Transient disconnects remain separate so mobile app switching and reconnect recovery still work.
- **Lifecycle helpers and fixtures**: Added shared match-over/standings helpers plus VM fixtures for `$0`/negative detection, ranking, bot readiness, all-seat readiness, exact config preservation, roster preservation, and chip reset.

### Changed

- **Negative chip formatting**: Final balances now render as `-$100` instead of `$-100`.
- **Singleplayer rematch**: Play Again treats the three bots as ready, waits 5 seconds, then starts a fresh match with the same settings and reset chips.

### Verified

- `npm run test:rules`
- `node --check server/index.cjs`
- `node --check server/matchLifecycle.cjs`
- `npm run build`
- Local two-client WebSocket smoke test confirmed that Quit broadcasts `room_closed` and closes the room for both host and joiner.

## [2026-07-15] — Phase: Chip Settlement and Result Parity Audit

### Fixed

- **$0.30 / $0.60 Shooter rows**: Corrected the 1-10 tai Shooter payouts to `$4`, `$7`, `$11`, `$20`, `$40`, `$79`, `$155`, `$308`, `$616`, and `$1,231`.
- **Shooter source of truth**: Settlement now follows the visible `Shooter` On/Off setting even if a legacy `chipSettlementMode` value in a restored snapshot disagrees.
- **Result parity**: Result-screen payout wording and transfer rows now come from shared chip-settlement helpers instead of separately rebuilding settlement rules in the UI.

### Added

- **Settlement invariants**: Added regression checks that every settlement is zero-sum, winner gains equal all payer losses, and every final chip balance exactly matches its displayed delta.
- **Flow-specific payout fixtures**: Added exact result-and-balance parity coverage for non-shooter discard, Shooter discard, Zi Mo, capped payouts, Hua Shang, uncapped 9-tai Kan Kan Hu, and special-capped Kan Kan Hu.
- **Full payout-table fixture**: Added coverage for all 18 tai rows across `$0.10 / $0.20`, `$0.30 / $0.60`, and `$1 / $2`, checking non-discarder, discarder/Zi Mo, and Shooter amounts.

### Verified

- `npm run test:rules`
- `npm run build`

## [2026-07-15] — Phase: Kan Kan Hu Special Classification

### Changed

- **Terminology correction**: The hand is labeled `Kan Kan Hu (坎坎胡)`.
- **Exact hand definition**: Kan Kan Hu requires Zi Mo with four unexposed natural pungs and concealed eyes; discard wins, exposed melds, sequence hands, and Fei-substituted pungs are rejected.
- **Special score plus Zi Mo**: Kan Kan Hu is an 8-tai special hand and its required Zi Mo adds +1 tai, producing 9 tai total; Concealed Hand, wind-pung, dragon-pung, and other ordinary tai still do not stack.
- **Special cap behavior**: Kan Kan Hu bypasses normal `Max Cap Tai` and is affected only by `Caps Max Tai for Special`.
- **Automatic special win**: Kan Kan Hu now follows the same automatic special-win eligibility path as the other locked special hands.
- **Visible-only privacy**: Opponent visible-only scoring does not reveal a concealed Kan Kan Hu before the hand ends.
- **Result payout label**: The result screen recognizes Kan Kan Hu as a special hand when showing whether special payouts are capped or uncapped.

### Added

- **Regression coverage**: Added fixtures for the 8-tai special plus required Zi Mo, 9-tai total, no other ordinary tai stacking, automatic-win behavior, visible-only privacy, normal-cap bypass, special-cap payout, Zi Mo-only eligibility, exposed-meld rejection, sequence rejection, and Fei-pung rejection.

### Verified

- `npm run test:rules`
- `npm run build`

## [2026-07-15] — Phase: Hua Shang Result Parity

### Fixed

- **Hua Shang result total**: The result screen now treats Hua Shang as a Zi Mo win, so the visible tai breakdown includes `Self-Draw +1` and matches the tai total used for win eligibility and chip settlement.
- **Self-draw method classification**: Centralized result-screen self-draw detection for Zi Mo, Hua Shang, Kang Shang, Men Hu, Tian Hu, Hua Hu, and self-drawn Thirteen Wonders while preserving discard attribution when a shooter exists.

### Added

- **Hua Shang parity regression**: Added coverage that the result-screen tai total and settlement `rawTai` are identical and that the Zi Mo line remains visible.

### Verified

- `npm run test:rules`
- `npm run build`

## [2026-07-15] — Phase: Tracker Reconciliation and Special-Flow Fixtures

### Fixed

- **Wall documentation parity**: Corrected the README wall description from the obsolete 14-tile wording to the implemented 15-tile whole-wall cutoff.
- **Flower/season special accuracy**: Qi Qiang Yi and Hua Hu now count only flowers and seasons toward their eight-tile condition; animals no longer trigger either special.
- **Special-flow argument clarity**: Corrected the Qiang Kang scoring call so Thirteen Wonders is passed through the intended special-hand flag instead of an unrelated positional flag.
- **Active TODO reconciliation**: Replaced stale prototype TODOs with the current manual multiplayer, infrastructure, and release-hardening work.

### Added

- **Special-flow regression fixtures**: Added deterministic store-level coverage for Di Hu, Men Hu, Hua Shang, Kang Shang, Qi Qiang Yi, Hua Hu, and Qiang Kang Thirteen Wonders, including result method, tai, shooter, and winning replacement assertions.
- **Negative bonus fixture**: Added coverage proving animals do not complete Qi Qiang Yi or Hua Hu.
- **Manual multiplayer checklist**: Documented the host/join verification path for canonical state, claims, reconnects, result flow, logs, and mobile layouts.

### Verified

- `npm run test:rules`
- `node --check server/index.cjs`
- `npm run build`
- `npm run deploy:vm`
- VM frontend returned `HTTP 200 OK`
- `sg-mahjong-ws` and Nginx verified active after deployment

## Current To-Do

1. **Manual multiplayer regression pass.**
   Verify room state synchronization, ready/countdown, dealer and seat rotation, payout/chip settlement, reconnects, and result-to-next-round behavior with separate host and join browser sessions.
2. **Claim-button routing verification.**
   Verify simultaneous Win/Kong/Pung/Chi eligibility and ensure only the correct local player sees actionable controls.
3. **Move history parity.**
   Verify host and join clients receive equivalent canonical history entries after relayed actions.
4. **Reconnect and room lifecycle matrix.**
   Cover host mobile app-switch, join reconnect, explicit quit, stale socket replacement, paused rooms, and host timeout cleanup.
5. **Result-screen and mobile regression pass.**
   Keep payout breakdowns, winning-discard text, countdowns, and next-round controls compact and synchronized across phone and desktop layouts.
6. **Mobile-data action latency pass.**
   Verify the pending-action status, double-tap lock, measured slow-confirmation line, and reconnect reset on iOS and Android cellular browsers before and after the WSS cutover.
7. **Infrastructure cleanup.**
   Remove the duplicate Nginx default-server declaration that currently emits the non-fatal `conflicting server name "_"` warning.
8. **Match-over multiplayer manual pass.**
   Verify four-real-player readiness, mixed bot readiness, countdown cancellation on disconnect, new room-code propagation, exact settings/chip reset, and room-wide Quit from both host and join clients.
9. **Production VM capacity observation.**
   After deployment, watch `/health` or `/metrics` during real multiplayer sessions and compare VM CPU, RSS, event-loop delay, reconnects, and backpressure against the tested 100-player local baseline before increasing the capacity target.
10. **Production DNS, HTTPS, and WSS.**
   Point `sgmahjong.app` DNS to the Oracle VM, keep Node private on `127.0.0.1:3002`, configure an HTTPS certificate/listener on port 443, proxy a same-origin secure WebSocket path, and then switch production verification from the raw IP and `ws://` to the hostname and `wss://`.

## [2026-07-14] — Phase: Limit-Hand Tai Cap Fix

### Fixed

- **Big Three Dragons cap**: Big Three Dragons now short-circuits the scorer instead of stacking dragon pungs, wind pungs, flush bonuses, or self-draw on top of the limit hand, so the result screen and chip settlement both stay at the intended 10 tai.
- **Thirteen Wonders cap**: Thirteen Wonders now scores at 13 tai instead of 10, and it also short-circuits the scorer so it no longer stacks smaller bonuses on top of the limit hand.
- **Special-hand lock**: Added Shi Ba Luo Han to the same short-circuit path so limit hands return their own maximum tai instead of accumulating ordinary bonuses.
- **Payout bypass rows**: Extended the `$0.10 / $0.20`, `$0.30 / $0.60`, and `$1 / $2` payout tables through 13 tai and 18 tai, and threaded a special-hand payout override through settlement so those hands bypass `Caps Max Tai` while the normal cap still applies to regular hands.
- **Result payout copy**: The round-end payout panel now labels Thirteen Wonders and Shi Ba Luo Han as special 13-tai and 18-tai payout rows so the displayed settlement text matches the bypassed chip logic.
- **Special cap control**: Added a `Caps Max Tai for Special` On/Off control with a slider up to 18 tai so all special hands can be capped separately when desired.
- **Regression coverage**: Added smoke-test assertions that Big Three Dragons returns exactly 10 tai, Thirteen Wonders returns exactly 13 tai, and Shi Ba Luo Han returns exactly 18 tai, including Fei-substituted limit-hand fixtures.

### Verified

- `npm run test:rules`
- `npm run build`

## [2026-07-14] — Phase: Seat Roll and Dealer Direction Cleanup

### Fixed

- **Seat-roll highlight**: The multiplayer seating roll now highlights the actual player row that rolled East instead of hard-highlighting the East seat label, so the result view tracks the player identity directly.
- **Seat-roll self highlight**: The seat-roll overlays now visually mark the local player row during rolling and after the seat assignment so the user can spot their own dice line immediately on both singleplayer and multiplayer starts.
- **Result-screen dealer stability**: Non-dealer wins now keep the current dealer badge on the finished round instead of advancing it early; the next dealer is only applied when the following hand actually starts, which prevents the double-rotation flow on multiplayer restarts.
- **Seat wind direction fix**: Corrected the round-restart seat rotation so the client store and VM round setup both remap winds consistently on a non-dealer win, keeping the seat labels aligned with the dealer progression across singleplayer and multiplayer restarts.
- **Seat wind re-verification**: Re-checked the round restart flow against localhost, singleplayer, and multiplayer restart paths so the wind labels and dealer badge use the same hand-advance mapping on the next round.
- **Round counter fix**: The in-game `Round X/4` label now tracks the dealer-cycle hand count instead of the wind index, so it advances on each new hand within the same wind and only resets when the round wind itself changes.
- **Dealer-win round hold**: Dealer self-draw wins now keep the dealer-cycle count unchanged, so the `Round X/4` label stays on the same number until the dealer actually passes.
- **Concealed kong fix**: Self-kong now handles the concealed-kong branch correctly by removing the four matching tiles from the hand and recording them as a concealed kong meld before drawing the replacement tile.
- **Claim-window text trim**: Simplified the visible claim-window status to `Claim window opened on ...` and kept the eligible claimers only in debug metadata.
- **Seat-roll dealer emphasis trim**: Removed the yellow dealer emphasis from the multiplayer seat-result list so only the local player row stays highlighted during the dice result screen.
- **Max Cap Tai control**: Added a local `Max Cap Tai` slider in the main menu so normal payout settlement can be capped separately from the special-hand cap.
- **Payout text trim**: Simplified the special-hand payout copy down to a single `Special hands are capped at X tai` line and kept the result screen from repeating the special-row explanation.
- **Seat wind rotation**: Singleplayer and multiplayer round restarts now rotate seat winds in the dealer-passes-to-next-player direction consistently, so the dealer badge and wind labels move together after a win.
- **Regression coverage**: Updated the round-restart smoke test so the seat-wind rotation assertion matches the dealer progression used by both the local store and the VM round setup.
- **Result-screen persistence**: Added a finished-round ready-state reset so stale ready flags cannot skip the visible result screen and instantly start the next hand on the same dealer win.
- **Multiplayer auto-advance**: Removed the host-side immediate `start_game` branch so finished rounds advance through the countdown path only, preventing skipped result screens and duplicate round starts.
- **Room code display**: The in-game host header now shows the multiplayer room code beside `Quit Game` so the host can share it without leaving the match screen.

## [2026-07-13] — Phase: Scoring Edge Verification

### Added

- **Concealed honor pung Fei regression**: Added a smoke test that locks down concealed honor pung scoring with Fei substitution, so the honor-pung bonus still applies when the hand is fully concealed instead of only appearing in exposed meld fixtures.
- **Discard ownership labels**: Kept role labels only on the result screen, move history, and developer logs, with the live table trimmed back to the plain discard pile display.
- **Thirteen Wonders discard fix**: Discard wins that are actually Thirteen Wonders now keep the `thirteen_wonders` win method, so the result screen can show the correct limit-hand headline and tai total.
- **Results cleanup**: Trimmed the result screen back to the single “who discarded what to who” status line instead of the full discard-by-player panel.
- **Mobile UX pass**: Added compact viewport handling for the table, hand row scrolling on phones, larger touch targets, and bottom-sheet overlays for history, dev logs, and round-end results.
- **Payout table settlement**: Wired the payout-table setting into round-end chip settlement for both discard wins and self-draw wins, and surfaced the payout summary on the result screen.
- **Payout table wiring**: Implemented the configured lookup tables for `$0.10 / $0.20`, `$0.30 / $0.60`, and `$1 / $2`, including shooter mode, and wired the settlement through both singleplayer and VM-relayed multiplayer state updates.
- **Payout table label trim**: Simplified the home-screen payout menu label back to `Payout Table` after the full behavior had already been wired in.
- **Caps Max Tai cap**: Added a `Caps Max Tai` setting below `Shooter` so payout settlement can cap at a configured tai value while the normal win threshold still controls whether the hand is legal.
- **Result payout details**: The round-end result screen now spells out who gives chips to the winner and how much the winner receives, instead of only showing the aggregate payout note.
- **Mobile payout compacting**: Tightened the round-end payout breakdown into a scrollable compact list so it stays readable on smaller phone screens without extra vertical sprawl.
- **Mobile result compacting**: Tightened the rest of the round-end popup on compact viewports so the headline, hand summary, tai total, and win details fit better on phones.
- **Mobile history compacting**: Tightened the move history and developer log overlays for compact viewports so the panels use less vertical space and read better on phones.
- **Mobile player-row compacting**: Tightened the in-game player rows on phones so the seat labels, tai, chips, and hand stacks take less vertical space.
- **Chip unit fix**: Switched payout settlement and chip display to chip units with decimal payouts, so `$0.10 / $0.20` no longer behaves like whole-chip integer amounts.
- **Role tag cleanup**: Removed the `[Real Player]` and `[Bot]` suffixes from store-generated move history and debug log text so those surfaces only show player names.
- **Room badge cleanup**: Removed the `(Bot)` badges from the host/join room player lists so the lobby rows stay name-only there too.
- **True wall flow**: Converted tile flow to a real mahjong wall split so opening deals draw from the front while flower/animal and kong replacements come from the back of the wall in both singleplayer and VM-owned multiplayer.
- **Wall-at-15 end rule**: Kept the hand draw rule aligned to the table flow where play continues until the wall is down to 15 tiles, flower/animal and kong replacements draw from the back of the same wall, and a kong in the round changes the end state from a plain draw to a kong round.
- **End-of-action wall finalize**: Added a shared wall-exhaustion finalizer that runs once after a draw or kong chain resolves, so the round ends without checking inside every replacement draw.
- **Real-table wording cleanup**: Clarified the code comments and README so the wall model is described as the playable wall plus the back-of-wall replacement flow, matching the rule you specified.

### Verified

- `npm run test:rules`
- `npm run build`

---

## [2026-07-11] — Phase: VM-Owned Round Setup

### Fixed

- **Server-owned round start**: The VM now builds the opening deck, dice results, seat winds, and initial round state for multiplayer instead of asking the browser host to compute the opening table.
- **Host UI simplification**: The Host Game screen now sends the lobby roster and waits for the server-issued `state_update`, which keeps room creation tied to the VM rather than the local browser.
- **Round restart relay**: The finished-round ready flow now asks the server to start the next round, so the same VM-owned setup path is used again after a win.
- **Host/client sync**: The game page now keeps the seat-0 client marked as host while still relaying multiplayer actions and state changes through the server.
- **Server-owned turn relay**: Multiplayer discard, claim, win, kong, and pass actions now run through the VM against the shared game store instance, then broadcast the resulting canonical `state_update` to every client.
- **Relay cleanup**: Removed the last browser-to-server room-state overwrite path and the obsolete dice relay branch, so the VM is the only multiplayer authority for canonical state updates.
- **Persistent app-shell sync**: Added a global `state_update` listener in the app shell so room updates keep flowing even while the host/join pages are mounting or unmounting.
- **Bot turn kickoff**: The VM now schedules the first AI discard after round setup, so a bot East seat actually starts the turn chain in multiplayer instead of leaving both clients waiting.
- **JSON-LD cleanup**: Rewrapped the page metadata structured data as a single graph object to avoid parser errors on the hosted site.
- **Server bot fallback**: The VM no longer depends on the browser AI module at runtime for the first discard, which removes a startup crash path from multiplayer round setup.
- **Internal AI broadcast sync**: The VM now subscribes to the shared engine store and rebroadcasts internal AI follow-up moves, so bot discard and claim chains no longer stall when the next action happens inside the server store instead of from a websocket message.
- **Limit-hand legality**: Added explicit `Big Three Dragons` and `Da Xi Si` win detectors so Fei-substituted limit hands can short-circuit the normal 14-tile solver and still score correctly.
- **Limit-hand fixtures**: Added smoke tests for the reduced-tile Fei-substituted Big Three Dragons and Da Xi Si shapes, matching the auto-win behavior you described.
- **Thirteen Wonders detector**: Reworked the Thirteen Wonders check so it validates required terminal/honor coverage with Fei substitution correctly, instead of rejecting valid duplicate/pair shapes. Added regression coverage for both a textbook 13-orphan hand and the exact Fei-substituted shape you reported.
- **Debug log clarity**: Added explicit rejection logs for failed self-draw and discard-win checks, plus a compact claim-window history entry so failed win branches and stalled turn windows are easier to trace from the browser.
- **History density**: Tightened the in-app move history and developer log surfaces so the important reason data is visible first and the raw JSON stays behind an explicit expansion.
- **Host rejoin fallback**: The Host Game screen now clears stale room state on cancel and falls back to creating a fresh room if a stored host rejoin returns `Room not found`, instead of getting stuck on a dead room code. Added a Back / Cancel action on the initial host screen too.
- **Dealer / seat wind rotation**: Multiplayer round restarts now rotate the seat winds to the next hand while moving the dealer badge to the next dealer. The VM no longer rebuilds the table from fresh dice on every new round, so the hand-to-hand wind rotation follows the current dealer instead of being recomputed from scratch.
- **Multiplayer seat-roll UX**: The host now keeps the dice overlay visible until the server state arrives, and the multiplayer seat list renders in real Mahjong seat order instead of raw player-index order.

### Verified

- `npm run build`
- `npm run test:rules`
- `node --check server/index.cjs`

---

## [2026-07-10] — Phase: Multiplayer Relay Verification Pass

### Fixed

- **Reconnect rehydration**: Room snapshots now restore player names and ready flags, and active rooms replay the authoritative `state_update` for reconnecting clients.
- **Active-game sync**: The join/game screens both listen for host state updates, so reconnecting players land back on the live round instead of a stale lobby view.
- **Round restart consistency**: Dealer progression, seat winds, and discard-pile clearing are preserved across round restarts instead of being recomputed inconsistently per client.
- **Host disconnect handling**: Host disconnect now closes the room immediately with an explicit `host_disconnect` reason and suppresses auto-reconnect into a dead room.
- **Reload race handling**: If a browser refresh reconnects before the old websocket fully clears, the server now replaces the stale socket, broadcasts `player_left`, and refreshes the room snapshot immediately.
- **Room pause on leave**: If a player leaves, the room now enters a paused state, broadcasts the departure clearly, and blocks all gameplay actions until the room is closed.
- **Graceful quit path**: The in-game `Quit Game` action now sends a real `leave_room` message for multiplayer players before disconnecting, instead of dropping the websocket immediately.
- **Browser exit hook**: Closing a tab or refreshing now also sends the same leave signal when possible, so the host sees the leave announcement more reliably.
- **Host mobile reconnect**: Host app-switches now pause the room instead of deleting it immediately, and an explicit host quit still closes the room right away.

### Verified

- `npm run test:rules`
- `npm run build`

---

## [2026-07-10] — Phase: Multiplayer Relay Hardening

### Fixed

- **Reconnect snapshots**: The room server now stores the latest authoritative state plus player names and ready flags, then re-sends that snapshot when a client rejoins or reconnects.
- **Active-game sync**: The game screen now listens for `state_update` messages too, so a reconnecting player stays synced even after the lobby screen has unmounted.
- **Claim/state relay**: Host-authored state remains the single source of truth, while the server now preserves and replays the current room state instead of relying only on live sockets.

---

## [2026-07-10] — Phase: Rule Fixture Expansion

### Added

- **Extra rule fixtures**: Added tests for Fei as the eyes, Fei being disallowed for discard calls, and Fei-substituted seat/round wind pungs.
- **More edge fixtures**: Added tests for exposed-hand no-Men-Qing, partial-suit waits not being blocked, and Fei substitution inside an exposed meld.
- **Rules/tutorial copy**: Clarified the public rules text so Fei discard-call limits and full-suit wait behavior are stated in the app itself, not only in code.

### Fixed

- **Round discard reset**: New rounds now explicitly clear the discard pile in both the shared store start path and the host multiplayer rebuild path, so old tiles do not carry into the next wind.

---

## [2026-07-10] — Phase: Multiplayer Room Cleanup

### Fixed

- **Room-close handling**: Room closure is now handled at the app shell level as well as the lobby pages, so a host disconnect popup appears even if the room drops while the table view is open.
- **Reconnect suppression**: Room closure now marks the socket as a deliberate stop, preventing the client from trying to auto-reconnect into a dead room.
- **Reasoned room close**: The server now labels host-driven room closure explicitly as `host_disconnect`, so the client can distinguish it from the empty-room timeout.

---

## [2026-07-10] — Phase: Multiplayer Ready Flow Fix

### Fixed

- **Next-round start gating**: The host auto-advance effect now triggers from the finished state, which lets the shared ready/countdown flow actually start the next round once all real players are ready.
- **Relay consistency**: Multiplayer still uses the same shared game state and scoring engine path; the host remains the single source of truth for round progression.

---

## [2026-07-10] — Phase: Superseded To-Do

The original multiplayer cleanup list has been reconciled into the current tracker at the top of this file. Completed items such as seat/dealer rotation, result-screen persistence, reconnect snapshots, and concealed honor-pung Fei verification are no longer active TODOs.

---

## [2026-07-10] — Phase: Completed Scoring Engine Roadmap

The original scoring roadmap is now implemented: legality and tai calculation are separated, wait restrictions are wired into win decisions, visible-only scoring is explicit, named fixtures cover the principal hand classes, failed checks expose debug reasons, and multiplayer uses the shared VM-hosted engine rather than a separate scorer.

---

## [2026-07-10] — Phase: Scoring Engine Hardening

### Added

- **Rule smoke tests**: Added `npm run test:rules` plus a small TypeScript smoke suite that verifies Fei-assisted wins, visible-only scoring, discard-vs-self-draw tai thresholds, and automatic limit hands.

### Changed

- **Honor pung scoring**: Refactored the tai calculator to stop depending on the recursive meld inference path for concealed honor pung bonuses, which reduces scoring-time backtracking and keeps hidden-tile scoring from leaking through visible-only mode.
- **Win threshold helpers**: Added shared helpers for required tai and win eligibility so discard wins and self-draw wins use one rule path instead of duplicating the threshold math in the store.

## [2026-07-10] — Phase: Oracle VM Deploy Helper

### Added

- **Single deploy command**: Added `npm run deploy:vm` plus `scripts/deploy-to-oracle-vm.sh` so the local repo can be synced to the Oracle VM, rebuilt there, and published to Nginx in one step. The old `npm run deploy:oracle` alias still works.
- **macOS launcher**: Added `deploy-to-oracle-vm.command` for a double-clickable deploy entrypoint on macOS.
- **Deployment docs**: Documented the VM paths, default SSH key, and override environment variables in the README.

### Fixed

- **Readable public tile assets**: Normalized the Fei and animal SVG tile asset permissions so nginx can serve them from the hosted VM instead of returning 403 errors.

---

## [2026-07-09] — Phase: SEO & Crawlability

### Changed

- **Route-aware SEO shell**: Upgraded the app head management to set route-specific titles, descriptions, keywords, canonical URL, robots directives, Open Graph tags, Twitter card tags, and JSON-LD structured data.
- **Public crawl files**: Added `robots.txt` and `sitemap.xml` for the public site.
- **Social preview asset**: Added a dedicated `og-image.svg` for link previews and search/social sharing.
- **Real page paths**: Switched the public navigation links to path-based URLs so the tutorial, rules, host, and join pages can be indexed as actual site pages instead of hash fragments.
- **Public copy**: Added more Singapore Mahjong keyword-rich explanatory text to the home, rules, and tutorial surfaces without changing the gameplay flow.
- **README refresh**: Updated the README to reflect the SEO-oriented public pages and corrected the clone path.

---

## [2026-07-09] — Phase: Prerender + SPA Hosting Fallback

### Added

- **Prerender script**: Added a post-build prerender step that writes static HTML snapshots for the public `/rules/` and `/tutorial/` routes, plus noindex snapshots for temporary host/join pages.
- **Host rewrites**: Added Netlify and Vercel fallback configs so unmatched routes resolve to `index.html` in production.
- **Temporary page indexing control**: Host/join pages are now treated as `noindex` surfaces so they do not compete in search results.

## [2026-07-09] — Phase: Host/Join Transition + Multiplayer Reconnect

### Changed

- **In-app navigation**: Replaced the host/join menu redirects with internal navigation so opening Host Game, Join Game, Rules, or Tutorial no longer forces a full page reload.
- **Loading overlay**: Added a small transition overlay on the main menu when opening another page so the switch feels deliberate instead of abrupt.
- **Reconnect handling**: The WebSocket client now auto-rejoins the same room after a transient disconnect when the room code and player index are still known.
- **Disconnect cleanup**: Manual disconnects now cancel reconnect timers cleanly and clear the room/session state without leaving stale listeners behind.
- **Rules FAQ**: Added a short public FAQ section covering Fei, win conditions, and why temporary multiplayer pages stay out of search results.
- **App manifest**: Added a public web manifest and app metadata for a more finished installable-app surface.

## [2026-07-09] — Phase: Free Analytics + Search Console

### Added

- **PostHog wiring**: Added a lightweight analytics helper that uses PostHog only when `VITE_POSTHOG_KEY` is present, and tracks page views plus key host/join/menu events.
- **Search Console verification**: Added build-time support for `VITE_GOOGLE_SITE_VERIFICATION` so Google Search Console can verify the public site via HTML tag.
- **Environment template**: Added `.env.example` for PostHog and Search Console variables.



---

## [2026-07-09 00:00 SGT] — Phase: Automatic Win Flow & Winner Popup

### Changed

- **Automatic win gate**: `Big Three Dragons` and `Da Xi Si` now bypass the tai-threshold checks anywhere the game decides whether a discard win or self-draw win is allowed.
- **Winner popup headline**: The end-of-round popup now shows the named winning hand first when a recognized pattern is present, instead of always using a generic `<player> wins` headline.
- **Xiao Xi Si**: Corrected from `40 tai` to `4 tai` in the scoring engine and rules text.
- **Developer logs**: Added an in-game `Dev Logs` viewer with full per-player snapshots for draws, discards, claim windows, claim resolutions, and win evaluations. Logs now reset at the start of each new round.

### Fixed

- **Rules/UI mismatch**: `Four Little Winds` and `Four Great Winds` labels in the rules page now match the active ruleset.
- **Fei-backed discard win detection**: Fixed a tile-key parsing bug in the wildcard solver that caused valid discard wins like `7-8-9` plus Fei-completed honor pungs to be missed.
- **Live tai counter leakage**: The in-game tai counter now shows visible tai only for every seat, instead of projecting hidden hand patterns like `Half Flush` during play.
- **Winner popup details**: The round-end popup now shows the winning hand tiles, the winner's bonus tiles, and the winning discard tile when applicable. Reopening `Show Result` now opens a no-timer version of the popup, and the duplicate `Game Over! Winner:` footer was removed.
- **History and debug trace**: Move History is now written directly from game-state actions instead of relying on a `lastAction` watcher, so discards and claims do not get skipped. Dev Logs are now compact collapsed entries with a quick summary and expandable JSON.
- **Empty room timeout**: Rooms now self-destruct after 10 minutes with no joined players. Joining/rejoining clears the timer, and starting a game disables the idle expiry for that room.
- **Win debug reasons**: Dev Logs now include a short reason when a player cannot win or when a win is blocked by the tai threshold. The round-end popup also shows the winner's melds separately from bonus tiles and hand tiles.
- **Main menu chips/shooter config**: Added `Starting Chips` and `Shooter` settings to the main menu so the values travel with the game config for both single-player and multiplayer setup.
- **Main menu payout table config**: Added a `Payout Table` dropdown above `Starting Chips` with `None`, `$0.10 / $0.20`, `$0.30 / $0.60`, and `$1 / $2` options. The default is `None`.
- **Main menu max-tai config**: Added a `Caps Max Tai` control below `Shooter` so payout settlement can cap the tai row without changing the win threshold.
- **Economy off switch**: Leaving `Starting Chips` blank now disables economy mode entirely, so future chip and payout logic can remain inactive unless the host explicitly enables it.
- **Chip settlement mode**: The shooter toggle now also sets an explicit `default` vs `shooter` chip settlement mode in config, so payout logic can branch later without guessing from UI state.
- **Fei honor scoring fix**: Honor pung scoring now consumes a shared Fei budget across all honor bonus candidates, so one joker cannot be reused to pay for both `fa` and `baak` pungs in the same hand.
- **Dealer seat rotation fix**: Next-round seat winds now advance East -> South -> West -> North instead of rotating backward, so the dealer badge follows the correct wind progression after a non-dealer win.
- **Dealer badge seat mapping**: Finished-round and next-round dealer selection now both use seat-wind progression, so the gold dealer badge tracks the actual East seat instead of sticking to the old player index.
- **Round and chip display**: The game table now shows `Round 1/4` through `Round 4/4` beside the round wind label, and each player row now shows the configured starting chip count next to tai. If no starting chips are set, the display defaults to `0 chips`.
- **Starting chip seeding**: Multiplayer round setup now seeds each player with the configured `startingChips` amount from the main menu, and the smoke tests lock that behavior so a new room starts with the correct chip counts instead of silently falling back to zero.
- **Public disclaimer footer**: Added an on-page disclaimer and copyright notice to the main menu footer for the public build.
- **Public disclaimer coverage**: Added the same disclaimer to the Rules Reference and Tutorial pages, and moved the copyright line to `sgmahjong.app`.
- **Singapore Mahjong branding**: Refreshed the menu, Rules Reference, and Tutorial surfaces to use a more distinctly Singapore Mahjong visual tone and title hierarchy.
- **SEO basics**: Added default head metadata plus route-aware document titles and descriptions for the menu, rules, tutorial, host, join, and live game pages.

---

## [2026-07-08] — Phase: Core Gameplay & Scoring

### Added

#### Winning Hand Patterns
- **Full Flush Sequence Hand** (清一色平胡) — +10 tai, all chi melds, one suit, no bonuses
- **Full Flush Triplets Hand** (清一色碰碰胡) — +8 tai, all pungs/kongs, one suit, win with eyes
- **Ping Hu** (平胡) — +4 tai, all chi melds, no bonuses, no side wait, no dan diao
- **Chou Ping Hu** (臭平胡) — +1 tai, all chi, no side wait, no 1/9 win tile, self-draw unless other tai
- **Pong Pong Hu** (碰碰胡) — +2 tai, all pungs/kongs, win with eyes
- **Kan Kan Hu (坎坎胡)** — 8 tai special + required Zi Mo, 9 tai total
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

### Historical Notes

- This section reflected open items from the earlier prototype state and is retained here only as historical context.
- Current active status should be read from the newest dated entries above.

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

## Historical Prototype Roadmap

This unchecked prototype list was superseded by later implementation passes. The authoritative remaining work is the `Current To-Do` section at the top of this file.

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

## [2026-07-09] — Phase: Scoring and Dealer Badge Fix

### Fixed

- **Fei-backed honor pungs/kongs now score correctly**: wind and dragon pung bonuses now recognize Fei substitutions in the completed hand, including concealed melds inferred during final scoring.
- **Visible tai preview stays clean**: concealed meld inference is only used for the actual win result, not the opponent-facing visible tai display.
- **Round restart no longer reassigns seat winds**: `startGame()` now preserves the existing player seat ordering between rounds and only advances the dealer/current turn flow.
- **Tian Hu round state**: opening-hand scoring now uses the active round wind state instead of hardcoding East.
