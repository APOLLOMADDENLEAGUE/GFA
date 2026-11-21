# GFA Turkey Bowl live auction

The existing GFA bot serves `/auction/captain`, `/auction/host`, and the read-only `/auction/stream` on Railway. `https://officialgfa.com/auction/` opens the draft room.

## Run the draft

1. Open the host desk and connect with the existing GFA organizer Discord account.
2. In **Private captain links**, copy each QB's link and send it to that QB. **Copy all 12 links** copies the ordered list. Each link opens its assigned slot without Discord or approval.
3. Check the Google board sync and QB order, then press **Start Draft**.
4. The current QB selects a player and must enter a starting bid in $10 steps. They may tell the host instead. Every connected captain can bid during any call until **SOLD**, within their remaining budget and six-player roster limit.
5. Host controls are **Going once**, **Going twice**, **Going three times**, and **SOLD**. Every valid new bid clears the call/banner; the next press starts at Going once again.
6. A sale deducts money, fills the winning roster, marks the player taken and advances to the next nominator. The order repeats QB 1 through QB 12, then QB 1 again, skipping full teams and QBs with $0. Each team drafts six players.
7. When no QB with an open slot has money left, **Leftover picks** starts automatically at the first QB with an open slot in the original board order. Each chooses one free player from the remaining pool, then the next eligible QB picks. The order repeats until every roster is full. Full teams are skipped. For example, Jipper and Icczz each needing three players alternate Jipper, Icczz, Jipper, Icczz, Jipper, Icczz.
8. The host can also press **Start leftover picks** between auctions to finish bidding early. In this phase the current QB (or host on their behalf) uses **Pick player · free** with no bid field. Budgets stay unchanged, and picks fill rosters live.

The host can pause, submit proxy bids, pass a player, change the nomination turn, undo the last pick or sale when no nomination is active, and export drafted teams at `/auction/export.csv`.

## Reset and practice

**Reset Draft** asks for confirmation, clears picks/bids, restores starting budgets and player availability, and returns to the lobby at QB 1. Captain links, sessions and assignments stay valid so a group can practice and reset before the real event.

Each reset saves the previous draft in the private database; ten backups are retained. **Undo reset** restores the previous draft while still in the lobby. A changed QB list must be restored on Google before recovering a backup with those QBs.

`?demo=1` runs local practice without posting to the live auction API. The host practice view has **Start Draft**, **Reset Draft**, and **Undo reset**. **Load sample** loads a sample auction; preview buttons demonstrate reveals, bids, calls and celebrations. Practice synchronizes tabs in one browser, not separate devices. A few practice characters start asleep; **Wake a QB** demonstrates presence without affecting real captains.

## Stream and audio

Use `/auction/stream` as a 1920x1080 OBS browser source. In a browser, press **Full Screen** (or F) to fill the display; Escape or **Exit Full Screen** exits. The full broadcast scales to fit the screen while preserving every roster slot and character. All twelve team rosters, six slots each, stay visible above the characters alongside remaining budgets. Sales fill the rosters immediately. Click a character to inspect a team. The full pool and position filters remain available in the draft room.

Nominations reveal the player in the center. QB signs display their latest bids and raise on new bids. Calls pop up at the top. Free picks show PICKED with a position highlight; paid SOLD brings falling cash, a pulsing stamp and a position highlight: a WR catch, a LINE block or sack, or a FLEX catch followed by a block. Effects and sound have separate controls; reduced-motion preferences remove movement.

**Music** starts an original 92 BPM lounge instrumental synthesized locally with keys, bass and drums. Its volume slider is separate from sound effects. Music starts only after a click, and sound effects start off.

Characters sleep until an authenticated captain connects to the auction WebSocket, wake on connection, and sleep after the last connection closes. Multiple tabs/devices count as one online QB. Host-only sessions and spectators do not wake a captain. Interrupted phones may take a heartbeat cycle to disconnect. This measures connection to this room, not Discord status.

## Private links and authorization

Only the authenticated host's `/auction/api/me` response supplies link URLs. Public state/WebSocket responses contain no link keys, session cookies, captain approvals or reset backups. Links bind to one QB and never grant host access. A URL fragment (`#key=`) avoids sending keys in the page request/referrer; the client exchanges the key with a same-origin JSON POST, then removes it from the address bar.

Entry sets a secure, HttpOnly, SameSite=Lax cookie. Session identifiers are stored as hashes in SQLite and survive restarts for up to 30 days. Link records remain private so the host can copy them again. **Replace** invalidates the old link, its sessions and its existing sockets. Anyone holding a captain link can enter as that QB; distribute each only to its intended captain.

The host retains the existing Discord organizer allowlist and identify-only OAuth. Existing approved Discord captains are supported. No new Discord app, secret, server join or message is required. Host browser sessions still require reconnection after a server restart. CSRF/origin checks protect mutations. Transactions serialize bids; revision and lot checks reject stale sales and resets.

## Google board and storage

The server checks spreadsheet `1Jzr9S4IVFj0WbYha9ViQXHNiOswcpaT0KYRwuOkoh8I`, tab `1601740487`, every 15 seconds. Google may briefly cache exports; the host has **Sync board now**. Keep it shared as Anyone with the link / Viewer. The app reads Google and does not write picks or bids back.

The sheet owns QB names/order and player names/positions. Matching QBs by name preserves links when reordered. Sheet budget changes apply in the lobby; after starting, budgets come from the ledger. Extra player rows through 500 are supported. Duplicate/empty exports and failed reads retain the last valid board and show a warning.

Removed available players disappear. Removing the active nominee cancels that nomination without spending and leaves the same QB on the clock. Sold players and their original positions remain recorded, and re-adding them does not make them available. Removing a QB with drafted players or an active bid is rejected; restore them on Google to resolve the sync warning.

The parser expects QB anchors C5,E5,...,Y5, matching row-12 budgets, WR/LINE/FLEX headers C/K/S, and player anchors C/F/H, K/N/P, S/V/X.

Auction tables are separate from registrations: `gfa_auction_state`, `gfa_auction_claims`, `gfa_auction_links`, `gfa_auction_access`, and `gfa_auction_reset_backups`. They use the existing mounted SQLite database. Keep one bot replica. Deployment never resets the draft.

## Verification

Run `python -m unittest discover -s bot/tests -v`, `node --check bot/auction_assets/app.js`, and `node --check bot/auction_assets/music.js`. Tests cover signup regression, private-link and Discord authorization, link replacement, presence, bid amounts/call resets, nomination order, competing bids, stale actions, board reconciliation, persistent state, resetting and recovery.
