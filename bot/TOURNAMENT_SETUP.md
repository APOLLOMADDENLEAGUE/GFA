# GFA Turkey Bowl Auction Tournament · November 20, 2026

The public entry point is https://officialgfa.com/turkey-bowl/.
Positions are QB, WR, LINE, and FLEX. The existing Discord callback and Tournament role are reused.
Players enter their name, position, and Discord username, authorize Discord,
review the verified account, and complete signup. The bot adds them to GFA and
grants the Tournament role. Server rule screening must be completed first.

The signup server runs alongside the existing GFA Discord bot on port 8080.
Registrations are stored in SQLite on the Railway volume at `/data`.
Turkey Bowl uses separate `turkey_bowl_registrations` and
`turkey_bowl_manual_registrations` tables with event key `turkey-bowl-2026-11-20`.
One entry per event and verified Discord ID is enforced by the database.
The Halloween `registrations` and `manual_registrations` tables are preserved;
no players are automatically copied into Turkey Bowl.
OAuth tokens live only in server memory for at most 20 minutes and are removed
after successful signup. A restart requires pending visitors to verify again.

## Existing Discord configuration

Open the GFA bot application in https://discord.com/developers/applications.
In OAuth2, add this exact redirect URL and save:

`https://gfa-discord-bot-production.up.railway.app/auth/discord/callback`

Copy the OAuth2 Client Secret into Railway as `DISCORD_CLIENT_SECRET` on the
**gfa-discord-bot** service in the production environment. Keep it out of code
and chat. `DISCORD_CLIENT_ID` is discovered from the existing bot application;
the bot and OAuth application must be the same application.

The bot requires Manage Roles and Create Instant Invite, and its highest role
must be above Tournament. It reuses an existing role named Tournament or
creates that role with no extra permissions. To use another existing role,
set `GFA_TOURNAMENT_ROLE_ID` to its Discord role ID.

## Organizer list

https://gfa-discord-bot-production.up.railway.app/organizer

The GFA server owner and the bot application owner can sign in to view and
export the roster, grouped by QB, WR, LINE, and FLEX. The default board and CSV
show Turkey Bowl only. The Halloween archive tab uses
`/organizer?event=halloween-2026-10-24`; its CSV carries the same `event` query.
Both boards require organizer authorization. Table selection is allowlisted.
Additional organizer Discord IDs can be listed in
`GFA_TOURNAMENT_ADMIN_IDS` (comma separated). No roster is public.

`GFA_TOURNAMENT_REGISTRATION_OPEN=false` closes registration.
`GFA_TOURNAMENT_PUBLIC_ORIGIN` holds the public HTTPS signup origin.
`GFA_TOURNAMENT_DB` defaults to the mounted volume’s `tournament.sqlite3`.

The site checks the signup server’s readiness and disables submission when the
server reports that registration, OAuth, the role, or durable storage is unavailable. Role or join failures
remain visible in the organizer list and can be retried without duplicate rows.

## Verification

Run `python -m unittest discover -s tests -v` from this directory.
Run `python -m py_compile bot.py tournament.py` to check the bot integration.
