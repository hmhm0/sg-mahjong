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
