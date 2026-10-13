# GFA Halloween Horror Nights Tourney

The public entry point is https://officialgfa.com/halloween-horror-nights/.
Players enter their name, position, and Discord username, authorize Discord,
review the verified account, and complete signup. The bot adds them to GFA and
grants the Tournament role. Server rule screening must be completed first.

The signup server runs alongside the existing GFA Discord bot on port 8080.
Registrations are stored in SQLite on the Railway volume at `/data`.
One entry per event and verified Discord ID is enforced by the database.
OAuth tokens live only in server memory for at most 20 minutes and are removed
after successful signup. A restart requires pending visitors to verify again.

## One Discord setting still needed

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
export the roster. Additional organizer Discord IDs can be listed in
`GFA_TOURNAMENT_ADMIN_IDS` (comma separated). No roster is public.

`GFA_TOURNAMENT_REGISTRATION_OPEN=false` closes registration.
`GFA_TOURNAMENT_PUBLIC_ORIGIN` holds the public HTTPS signup origin.
`GFA_TOURNAMENT_DB` defaults to the mounted volume’s `tournament.sqlite3`.

The site checks the signup server’s readiness and keeps submission disabled
until OAuth, the role, and durable storage are connected. Role or join failures
remain visible in the organizer list and can be retried without duplicate rows.

## Verification

Run `python -m unittest discover -s tests -v` from this directory.
Run `python -m py_compile bot.py tournament.py` to check the bot integration.
