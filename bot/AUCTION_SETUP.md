# GFA Turkey Bowl live auction

The existing GFA bot serves `/auction/captain`, `/auction/host`, and the public read-only `/auction/stream` on its Railway origin. `https://officialgfa.com/auction/` redirects into the draft room.

## Run the draft

1. Open `/auction/host` and connect with the existing GFA organizer Discord account.
2. QBs open `/auction/captain`, connect Discord, choose their captain slot, and request access. Approve their requests under **Captain access & room settings**.
3. Check the board sync indicator and QB order. Press **Start auction** when ready.
4. The current QB nominates a player with an opening bid, or tells the host who submits it. Captains can enter any whole multiple of $10 within their remaining budget. The host can enter proxy bids.
5. Use **Going once**, **Going twice**, **Going three times**, then **SOLD**. A new bid resets the calls. Selling deducts the price, fills a roster slot, marks the player taken, and advances to the next QB in board order. Each team has six draft slots.
6. Use `/auction/stream` as a 1920×1080 OBS browser source. Sound is off until enabled. Stream view exposes no private captain-access information. Its team cards summarize budgets and draft counts; click a captain character to inspect the complete roster. The host and captain views also keep the full roster cards.

## Google board sync

The server checks the existing public Google draft board every 15 seconds while running. Google may briefly cache exports. The host also has **Sync board now**. The source remains the existing board, spreadsheet `1Jzr9S4IVFj0WbYha9ViQXHNiOswcpaT0KYRwuOkoh8I`, tab `1601740487`.

The sheet owns QB names and left-to-right nomination order, plus player names and positions. Existing captain identity is matched by name, so reordering QBs preserves approved access and current nomination identity. Sheet budget edits apply before the auction starts; after starting, remaining budgets come from the auction ledger.

Player additions, removals and position changes sync during the auction. Removed available players stop appearing. If the currently nominated player is removed, their auction is canceled without deducting money and the same QB chooses another player. Completed picks and their original positions remain recorded even if removed from the sheet. Re-added completed picks remain taken. Replacing a QB who has drafted players or an active bid is rejected with a visible sync error; restore the QB before continuing. Invalid or unavailable exports keep the last valid roster and show the sync warning.

The layout parser expects twelve QB name anchors C5,E5,…,Y5, budgets at the corresponding row-12 anchors, and WR/LINE/FLEX headers in C/K/S. Player anchors are C/F/H, K/N/P, S/V/X. Additional player rows are supported through row 500. Duplicate names are rejected. Keep the sheet shared as **Anyone with the link · Viewer**. The application reads the sheet; it does not write bids or picks back to Google.

## Authentication and storage

Uses the existing Discord OAuth application and registered `/auth/discord/callback`, with `identify` only for auction connections. No Discord message is sent and no guild-membership change is requested. The existing organizer allowlist controls host access. Captains cannot self-approve or bid as other QBs. CSRF and origin checks protect all changes; SQLite transactions serialize competing bids and stale lot/revision checks protect sales.

Auction state and captain approvals persist in the existing volume database as new `gfa_auction_state` and `gfa_auction_claims` tables. Existing registration tables remain separate. Signed-in browser sessions last up to eight hours and require reconnection after a server restart. Captain approvals and auction progress survive a restart. Only one bot replica should write to the mounted SQLite database.

`/auction/export.csv` is organizer-only and downloads the recorded teams, prices and budgets. **Undo last sale** refunds the latest completed pick when no nomination is active. It does not clear the room or earlier picks.

## Practice and verification

Add `?demo=1` to any auction view for browser-local practice. This uses separate local storage and never posts to the live auction API. Practice state can be shared between tabs in the same browser; separate devices do not share practice bids. Reset practice has no effect on the live room.

Run `python -m unittest discover -s bot/tests -v` and `node --check bot/auction_assets/app.js`. Tests cover the signup regression suite, auction identity/authorization, bid amounts, stale sales, concurrent bids, board reconciliation, persistent state and Discord OAuth scope.

## Broadcast effects

New nominations reveal the player in the center. Each QB has an animated football character and a sign showing their latest bid on the current player. A new bid raises that captain's sign; the leader stays highlighted. Clicking a character opens the captain's team details. Host calls show **Going once**, **Going twice**, and **Going three times** at the top. New bids clear the call display. **SOLD** triggers falling cash, streamers, and a pulsing SOLD stamp. Effects and sound have separate controls; sound starts off. Reduced-motion preferences remove the movement. Practice view includes local-only preview buttons for reveals, bids, calls, and the sale celebration.
