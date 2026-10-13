"""Discord-verified GFA registrations. OAuth tokens stay in short-lived server memory."""
import asyncio
import csv
import hashlib
import html
import io
import os
from pathlib import Path
import secrets
import sqlite3
import time
from contextlib import closing
from urllib.parse import urlencode

import aiohttp
from aiohttp import web

EVENT = "halloween-2026-10-24"
VALID_POSITIONS = ("QB", "WR", "LINE", "FLEX")
API = "https://discord.com/api/v10"
SESSION_TTL = 20 * 60


class FlowError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def safe(value):
    return html.escape(str(value or ""), quote=True)


def signup_position(value):
    position = str(value).strip().upper()
    if position not in VALID_POSITIONS:
        raise FlowError("Choose QB, WR, LINE, or FLEX as your position.")
    return position


class TournamentServer:
    def __init__(self, bot, guild_id, *, database=None, public_origin=None, secure=True):
        self.bot, self.guild_id, self.secure = bot, int(guild_id), secure
        self.public_origin = (public_origin or os.getenv("GFA_TOURNAMENT_PUBLIC_ORIGIN", "")).rstrip("/")
        self.client_id = os.getenv("DISCORD_CLIENT_ID", "")
        self.client_secret = os.getenv("DISCORD_CLIENT_SECRET", "")
        self.bot_token = os.getenv("DISCORD_TOKEN", "")
        self.db_path = Path(database or os.getenv("GFA_TOURNAMENT_DB", str(Path(os.getenv("RAILWAY_VOLUME_MOUNT_PATH", "data")) / "tournament.sqlite3")))
        self.durable = bool(database or os.getenv("RAILWAY_VOLUME_MOUNT_PATH") or not os.getenv("RAILWAY_ENVIRONMENT_ID"))
        self.sessions, self.locks = {}, {}
        self.guild = self.role = self.client = self.runner = self.cleaner = None
        self.admin_ids = {item.strip() for item in os.getenv("GFA_TOURNAMENT_ADMIN_IDS", "").split(",") if item.strip()}
        self.setup_issues = []

    @property
    def registration_open(self):
        return os.getenv("GFA_TOURNAMENT_REGISTRATION_OPEN", "true").lower() == "true"

    @property
    def ready(self):
        return bool(self.client_id and self.client_secret and self.public_origin.startswith("https://") and self.guild and self.role and self.durable)

    @property
    def cookie_name(self):
        return "__Host-gfa_tournament" if self.secure else "gfa_tournament"

    def initialize_database(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.db_path)) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS registrations (
                event_key TEXT NOT NULL, discord_id TEXT NOT NULL,
                name TEXT NOT NULL, position TEXT NOT NULL,
                entered_discord_name TEXT NOT NULL, discord_username TEXT NOT NULL,
                discord_display_name TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (event_key, discord_id))""")
        self.db_path.chmod(0o600)

    def save_registration(self, session, status):
        draft, user = session["draft"], session["user"]
        with closing(sqlite3.connect(self.db_path, timeout=5)) as db, db:
            db.execute("""INSERT INTO registrations
                (event_key, discord_id, name, position, entered_discord_name,
                 discord_username, discord_display_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(event_key, discord_id) DO UPDATE SET
                name=excluded.name, position=excluded.position,
                entered_discord_name=excluded.entered_discord_name,
                discord_username=excluded.discord_username,
                discord_display_name=excluded.discord_display_name,
                status=excluded.status, updated_at=CURRENT_TIMESTAMP""",
                (EVENT, user["id"], draft["name"], draft["position"], draft["discord_name"],
                 user["username"], user.get("global_name") or "", status))

    def roster(self):
        with closing(sqlite3.connect(self.db_path)) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute("SELECT * FROM registrations WHERE event_key=? ORDER BY created_at, discord_id", (EVENT,))]

    async def prepare_discord(self):
        self.setup_issues = []
        try:
            app = await self.bot.application_info()
            if self.client_id and self.client_id != str(app.id):
                raise FlowError("DISCORD_CLIENT_ID must match the GFA bot application.")
            self.client_id = str(app.id)
            if app.owner:
                self.admin_ids.add(str(app.owner.id))
            print(f"Tournament Discord application ID: {self.client_id}", flush=True)
            self.guild = await self.bot.fetch_guild(self.guild_id)
            self.admin_ids.add(str(self.guild.owner_id))
            member = await self.guild.fetch_member(self.bot.user.id)
            if not member.guild_permissions.manage_roles:
                raise FlowError("The GFA bot needs Manage Roles to assign the Tournament role.")
            if not member.guild_permissions.create_instant_invite:
                raise FlowError("The GFA bot needs Create Invite to add verified players to the server.")
            roles = await self.guild.fetch_roles()
            configured = os.getenv("GFA_TOURNAMENT_ROLE_ID", "")
            role = next((role for role in roles if str(role.id) == configured), None) if configured else next((role for role in roles if role.name.casefold() == "tournament"), None)
            if configured and role is None:
                raise FlowError("GFA_TOURNAMENT_ROLE_ID does not identify a GFA server role.")
            if role is None:
                role = await self.guild.create_role(name="Tournament", reason="GFA Halloween Horror Nights Tourney signup")
            if role.managed or role.is_default() or role >= member.top_role:
                raise FlowError("Move the GFA bot role above the Tournament role in Discord.")
            # Refresh the role cache after creation so membership verification sees it.
            self.guild = await self.bot.fetch_guild(self.guild_id)
            self.role = next(item for item in self.guild.roles if item.id == role.id)
            print(f"Tournament role ready: {role.id}", flush=True)
        except FlowError as error:
            self.role = None
            self.setup_issues.append(error.message)
        except Exception as error:
            self.role = None
            self.setup_issues.append(f"Discord setup unavailable ({type(error).__name__}). Check the GFA guild and bot permissions.")
        if not self.client_secret:
            self.setup_issues.append("Set DISCORD_CLIENT_SECRET and add the OAuth callback in the Discord Developer Portal.")
        if not self.public_origin.startswith("https://"):
            self.setup_issues.append("Set GFA_TOURNAMENT_PUBLIC_ORIGIN to the public HTTPS signup origin.")
        if not self.durable:
            self.setup_issues.append("Mount a Railway volume for durable tournament registrations.")
        for issue in self.setup_issues:
            print(f"Tournament setup: {issue}", flush=True)

    def session(self, request, *, verified=False, admin=False):
        raw = request.cookies.get(self.cookie_name, "")
        key = hashlib.sha256(raw.encode()).hexdigest()
        session = self.sessions.get(key)
        if not session or session["expires"] < time.time():
            self.sessions.pop(key, None)
            raise FlowError("Your verification session expired. Return to GFA and sign up again.", 401)
        if verified and not session.get("user"):
            raise FlowError("Verify your Discord account before completing signup.", 401)
        if admin and session.get("user", {}).get("id") not in self.admin_ids:
            raise FlowError("This player list is available to GFA organizers only.", 403)
        return session

    def check_csrf(self, session, value):
        if not value or not secrets.compare_digest(session["csrf"], str(value)):
            raise FlowError("The signup request could not be verified. Reload the page and try again.", 403)

    def new_session(self, request, draft, mode):
        self.prune_sessions()
        if len(self.sessions) >= 1000:
            raise FlowError("Signups are busy. Please try again shortly.", 503)
        old = request.cookies.get(self.cookie_name, "")
        self.sessions.pop(hashlib.sha256(old.encode()).hexdigest(), None)
        raw = secrets.token_urlsafe(32)
        session = {"draft": draft, "mode": mode, "state": secrets.token_urlsafe(32),
                   "csrf": secrets.token_urlsafe(32), "expires": time.time() + SESSION_TTL}
        self.sessions[hashlib.sha256(raw.encode()).hexdigest()] = session
        params = {"response_type": "code", "client_id": self.client_id,
                  "redirect_uri": self.public_origin + "/auth/discord/callback",
                  "scope": "identify" if mode == "organizer" else "identify guilds.join",
                  "state": session["state"], "prompt": "consent"}
        response = web.Response(status=302, headers={"Location": "https://discord.com/oauth2/authorize?" + urlencode(params)})
        response.set_cookie(self.cookie_name, raw, max_age=SESSION_TTL, secure=self.secure, httponly=True, samesite="Lax", path="/")
        return response

    def prune_sessions(self):
        now = time.time()
        for key in [key for key, value in self.sessions.items() if value["expires"] < now]:
            del self.sessions[key]

    async def cleanup_sessions(self):
        while True:
            await asyncio.sleep(60)
            self.prune_sessions()

    async def status(self, request):
        response = web.json_response({"ready": self.ready, "registration_open": self.registration_open, "date": "2026-10-24"})
        origin = request.headers.get("Origin", "")
        if origin in {"https://officialgfa.com", "https://www.officialgfa.com", "https://apollomaddenleague.github.io", "https://gfa-gridiron.chazz-carnevale0.chatgpt.site"}:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        return response

    async def health(self, request):
        return web.json_response({"status": "ok", "signup_ready": self.ready})

    async def start_signup(self, request):
        if not self.ready or not self.registration_open:
            raise FlowError("Discord signups are not open yet. Please return to GFA shortly.", 503)
        form = await request.post()
        draft = {}
        for key, maximum in [("name", 64), ("position", 40), ("discord_name", 64)]:
            value = form.get(key, "")
            if not isinstance(value, str):
                raise FlowError("Enter your name, position, and Discord username.")
            value = value.strip()
            if not value or len(value) > maximum or any(ord(character) < 32 for character in value):
                raise FlowError("Enter a valid name, position, and Discord username.")
            draft[key] = value
        draft["position"] = signup_position(draft["position"])
        if form.get("consent") != "yes":
            raise FlowError("Agree to Discord verification and joining the GFA server to continue.")
        return self.new_session(request, draft, "signup")

    async def organizer_login(self, request):
        if not self.client_id or not self.client_secret or not self.public_origin.startswith("https://"):
            raise FlowError("Discord verification is still being connected.", 503)
        return self.new_session(request, {}, "organizer")

    async def revoke(self, token):
        if not token:
            return
        try:
            async with self.client.post(API + "/oauth2/token/revoke", data={"client_id": self.client_id, "client_secret": self.client_secret, "token": token}, timeout=aiohttp.ClientTimeout(total=5)) as response:
                await response.read()
        except (aiohttp.ClientError, asyncio.TimeoutError):
            pass

    async def callback(self, request):
        session = self.session(request)
        expected = session.pop("state", None)
        actual = request.query.get("state", "")
        if not expected or not actual or not secrets.compare_digest(expected, actual):
            raise FlowError("Discord verification could not be confirmed. Start signup again.", 403)
        if request.query.get("error") or not request.query.get("code"):
            raise FlowError("Discord verification was canceled. You can return to GFA and try again.")
        try:
            async with self.client.post(API + "/oauth2/token", data={"client_id": self.client_id, "client_secret": self.client_secret,
                    "grant_type": "authorization_code", "code": request.query["code"],
                    "redirect_uri": self.public_origin + "/auth/discord/callback"}) as response:
                if response.status != 200:
                    raise FlowError("Discord verification failed. Please start signup again.", 502)
                token = await response.json()
            access_token = token.get("access_token")
            session["access_token"] = access_token
            scopes = set(token.get("scope", "").split())
            required = {"identify"} if session["mode"] == "organizer" else {"identify", "guilds.join"}
            if not access_token or not required.issubset(scopes):
                raise FlowError("Discord did not grant the permissions needed for signup. Try verification again.", 403)
            async with self.client.get(API + "/users/@me", headers={"Authorization": "Bearer " + access_token}) as response:
                if response.status != 200:
                    raise FlowError("Your Discord account could not be confirmed. Start signup again.", 502)
                user = await response.json()
            if not str(user.get("id", "")).isdigit() or not user.get("username"):
                raise FlowError("Discord returned an invalid account. Start signup again.", 502)
            session["user"] = {key: str(user.get(key) or "") for key in ("id", "username", "global_name")}
            session["expires"] = time.time() + min(SESSION_TTL, int(token.get("expires_in", SESSION_TTL)))
            if session["mode"] == "organizer":
                await self.revoke(session.pop("access_token", None))
                if user["id"] not in self.admin_ids:
                    return self.organizer_denied_page(session)
                return web.Response(status=302, headers={"Location": "/organizer"})
            return web.Response(status=302, headers={"Location": "/signup/review"})
        except Exception:
            await self.revoke(session.pop("access_token", None))
            session.pop("user", None)
            raise

    def review_page(self, session, message="", status=200):
        user, draft = session["user"], session["draft"]
        body = f'<div class="verified">DISCORD VERIFIED</div><h2>Confirm your spot.</h2><p>Review your details, then complete your signup.</p><dl><dt>Name</dt><dd>{safe(draft["name"])}</dd><dt>Position</dt><dd>{safe(draft["position"])}</dd><dt>Verified Discord</dt><dd>@{safe(user["username"])}</dd></dl>'
        if message:
            body += f'<p class="alert" role="alert">{safe(message)}</p>'
        body += f'<form method="post" action="/signup/complete"><input type="hidden" name="csrf" value="{safe(session["csrf"])}"><button type="submit">COMPLETE SIGNUP →</button></form><p class="small">This adds you to the GFA server and gives you the Tournament role. If the server asks you to accept its rules, finish that step and retry here.</p><a href="https://officialgfa.com/halloween-horror-nights/">← Edit details or use another account</a>'
        return self.page("Confirm your signup", body, status)

    async def review(self, request):
        session = self.session(request, verified=True)
        if session.get("completed"):
            return self.success_page(session)
        if session["mode"] != "signup":
            raise FlowError("Start signup from the GFA website.", 403)
        return self.review_page(session)

    def success_page(self, session):
        return self.page("You’re signed up", f'<div class="verified">REGISTRATION CONFIRMED</div><h2>You’re in.</h2><p><strong>{safe(session["draft"]["name"])}</strong>, your spot for October 24 is saved.</p><dl><dt>Position</dt><dd>{safe(session["draft"]["position"])}</dd><dt>Discord</dt><dd>@{safe(session["user"]["username"])}</dd><dt>GFA server role</dt><dd>Tournament ✓</dd></dl><a class="button" href="https://discord.com/channels/{self.guild_id}">OPEN GFA DISCORD ↗</a><p class="small">Watch the GFA server for tournament updates.</p><a href="https://officialgfa.com/halloween-horror-nights/">← Back to GFA</a>')

    async def complete(self, request):
        session = self.session(request, verified=True)
        form = await request.post()
        self.check_csrf(session, form.get("csrf"))
        if session.get("completed"):
            return self.success_page(session)
        if session["mode"] != "signup" or not session.get("access_token"):
            raise FlowError("Start signup from GFA and verify your Discord account.", 401)
        if not self.ready or not self.registration_open:
            raise FlowError("Registration is currently unavailable. Please try again later.", 503)
        session["draft"]["position"] = signup_position(session["draft"]["position"])
        uid = session["user"]["id"]
        async with self.locks.setdefault(uid, asyncio.Lock()):
            self.save_registration(session, "pending")
            try:
                async with self.client.put(API + f"/guilds/{self.guild_id}/members/{uid}", headers={"Authorization": "Bot " + self.bot_token}, json={"access_token": session["access_token"]}) as response:
                    if response.status not in (201, 204):
                        self.save_registration(session, "join_failed")
                        return self.review_page(session, "We saved your details but could not add you to the GFA server. Retry here, or contact a GFA organizer.", 502)
                    await response.read()
                member = await self.guild.fetch_member(int(uid))
                if member.pending:
                    self.save_registration(session, "waiting_for_server_rules")
                    return self.review_page(session, "You’ve joined GFA. Open Discord and accept the server rules, then return here and complete signup.", 409)
                await member.add_roles(self.role, reason="Verified Halloween Horror Nights Tourney signup")
                member = await self.guild.fetch_member(int(uid))
                if not any(role.id == self.role.id for role in member.roles):
                    raise FlowError("Tournament role was not applied.")
                self.save_registration(session, "confirmed")
            except (sqlite3.Error,):
                raise
            except Exception:
                self.save_registration(session, "role_pending")
                return self.review_page(session, "Your details are saved, but the Tournament role could not be applied yet. Retry here, or contact a GFA organizer.", 502)
            session["completed"] = True
            await self.revoke(session.pop("access_token", None))
            return self.success_page(session)

    def organizer_denied_page(self, session):
        username = safe(session.get("user", {}).get("username", ""))
        return self.page("Organizer access required", f'<h2>Organizer access required.</h2><p>Signed in as <strong>@{username}</strong>.</p><p>This Discord account does not have access to the private player list.</p><a class="button" href="/organizer/login">SIGN IN WITH ANOTHER ACCOUNT</a><p class="small">Use the Discord account that owns the GFA bot or the GFA server.</p><a href="https://officialgfa.com/halloween-horror-nights/">Back to GFA signup</a>', 403)

    async def organizer(self, request):
        try:
            session = self.session(request, verified=True)
        except FlowError as error:
            if error.status == 401:
                return self.page("GFA organizer", '<h2>Player registrations</h2><p>Sign in with an authorized GFA organizer Discord account.</p><a class="button" href="/organizer/login">SIGN IN WITH DISCORD ↗</a>')
            raise
        if session["user"]["id"] not in self.admin_ids:
            return self.organizer_denied_page(session)
        rows = self.roster()
        confirmed = sum(row["status"] == "confirmed" for row in rows)
        groups = {position: [] for position in VALID_POSITIONS}
        other = []
        for row in rows:
            position = str(row["position"]).strip().upper()
            (groups[position] if position in groups else other).append(row)
        body = f'<h2>Tournament roster</h2><p>{confirmed} confirmed · {len(rows) - confirmed} waiting</p><a class="button" href="/organizer/roster.csv">DOWNLOAD CSV ↓</a>'
        body += '<nav class="position-nav" aria-label="Jump to position">'
        body += "".join(f'<a href="#position-{position}"><strong>{position}</strong><span>{len(groups[position])}</span></a>' for position in VALID_POSITIONS)
        body += '</nav>'
        sections = [(position, groups[position]) for position in VALID_POSITIONS]
        if other:
            sections.append(("Needs a position update", other))
        for position, players in sections:
            group_id = position if position in VALID_POSITIONS else "unassigned"
            group_confirmed = sum(row["status"] == "confirmed" for row in players)
            body += f'<section class="position-group" id="position-{group_id}" aria-labelledby="heading-{group_id}"><div class="position-head"><h3 id="heading-{group_id}">{safe(position)}</h3><span class="position-count">{len(players)} player{"s" if len(players) != 1 else ""}</span></div>'
            if players:
                body += f'<p class="position-summary">{group_confirmed} confirmed · {len(players) - group_confirmed} waiting</p><div class="table"><table><thead><tr><th>Name</th>'
                if group_id == "unassigned":
                    body += '<th>Position</th>'
                body += '<th>Verified Discord</th><th>Status</th></tr></thead><tbody>'
                for row in players:
                    body += f'<tr><td>{safe(row["name"])}</td>'
                    if group_id == "unassigned":
                        body += f'<td>{safe(row["position"])}</td>'
                    body += f'<td>@{safe(row["discord_username"])}</td><td>{safe(row["status"].replace("_", " "))}</td></tr>'
                body += '</tbody></table></div>'
            else:
                body += f'<p class="empty-position">No {safe(position)} players signed up yet.</p>'
            body += '</section>'
        return self.page("GFA tournament roster", body)

    async def export_csv(self, request):
        self.session(request, verified=True, admin=True)
        output = io.StringIO()
        columns = ["name", "position", "discord_username", "discord_display_name", "discord_id", "entered_discord_name", "status", "created_at", "updated_at"]
        writer = csv.writer(output)
        writer.writerow(columns)
        for row in self.roster():
            values = []
            for key in columns:
                value = str(row[key])
                # Preserve Discord IDs as text; prevent spreadsheet formula evaluation.
                values.append("'" + value if key == "discord_id" or value.lstrip().startswith(("=", "+", "-", "@")) else value)
            writer.writerow(values)
        return web.Response(text=output.getvalue(), content_type="text/csv", headers={"Content-Disposition": 'attachment; filename="gfa-halloween-2026-signups.csv"'})

    def page(self, title, body, status=200):
        return web.Response(status=status, content_type="text/html", text=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{safe(title)} | GFA</title><style>
        *{{box-sizing:border-box}}body{{margin:0;background:#111116;color:#e9e8ed;font:16px/1.6 Arial,sans-serif}}header{{border-bottom:1px solid #38343b;padding:18px 6%;display:flex;align-items:center;gap:14px}}header img{{width:48px;height:48px;object-fit:contain}}header a{{font-weight:800;color:#fff;text-decoration:none}}main{{max-width:740px;margin:55px auto;padding:0 22px}}.event{{font-size:13px;letter-spacing:1px;color:#ffac6c}}h1{{font-size:clamp(27px,5vw,42px);line-height:1.13;margin:12px 0 10px}}.card{{background:#fff;color:#152035;border-top:4px solid #ff8a32;border-radius:4px;padding:30px;margin-top:28px}}h2{{font-size:29px;line-height:1.2;margin:12px 0}}p{{color:#545d6c}}.verified{{color:#226938;font-size:12px;font-weight:bold;letter-spacing:1px}}dl{{padding:12px 0;border-top:1px solid #dedee5;border-bottom:1px solid #dedee5;margin:25px 0}}dt{{font-size:12px;color:#687080;margin-top:12px}}dd{{margin:0 0 10px;font-weight:bold;overflow-wrap:anywhere}}button,.button{{display:inline-block;width:100%;text-align:center;padding:16px 20px;background:#ff8a32;color:#201407;border:0;border-radius:3px;font:700 14px/1.4 Arial,sans-serif;text-decoration:none;cursor:pointer}}a{{color:#274e95}}a:focus-visible,button:focus-visible{{outline:3px solid #1262ed;outline-offset:4px}}.small{{font-size:13px}}.alert{{background:#fff1df;border:1px solid #e0ad70;color:#6b380c;padding:15px;border-radius:3px}}.table{{overflow:auto;margin-top:24px}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{text-align:left;padding:12px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}}@media(max-width:500px){{main{{margin-top:30px}}.card{{padding:22px 18px}}}}</style></head><body><header><a href="https://officialgfa.com"><img src="https://officialgfa.com/assets/logo.png" alt="GFA"></a><a href="https://officialgfa.com">GFA / GRIDIRON</a></header><main><div class="event">SATURDAY · OCTOBER 24, 2026</div><h1>HALLOWEEN HORROR NIGHTS TOURNEY</h1><section class="card">{body}</section></main></body></html>''')

    def make_app(self):
        @web.middleware
        async def security(request, handler):
            try:
                response = await handler(request)
            except web.HTTPException as response_error:
                response = web.Response(status=response_error.status, text=response_error.text, headers=response_error.headers)
            except FlowError as error:
                response = self.page("Signup needs attention", f'<h2>One more step.</h2><p role="alert">{safe(error.message)}</p><a class="button" href="https://officialgfa.com/halloween-horror-nights/">BACK TO GFA SIGNUP</a>', error.status)
            except Exception as error:
                print(f"Tournament request failed: {type(error).__name__}", flush=True)
                response = self.page("Signup temporarily unavailable", '<h2>Please try again.</h2><p>We couldn’t complete this request. Return to GFA and try again shortly.</p><a href="https://officialgfa.com/halloween-horror-nights/">Back to GFA signup</a>', 503)
            response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https://officialgfa.com; form-action 'self' https://discord.com; frame-ancestors 'none'; base-uri 'none'"})
            if self.secure:
                response.headers["Strict-Transport-Security"] = "max-age=31536000"
            return response
        app = web.Application(middlewares=[security], client_max_size=8192)
        app.add_routes([web.get("/health", self.health), web.get("/tournament/status", self.status),
            web.post("/signup/start", self.start_signup), web.get("/auth/discord/callback", self.callback),
            web.get("/signup/review", self.review), web.post("/signup/complete", self.complete),
            web.get("/organizer", self.organizer), web.get("/organizer/login", self.organizer_login),
            web.get("/organizer/roster.csv", self.export_csv)])
        return app

    async def start(self):
        self.initialize_database()
        self.client = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
        self.runner = web.AppRunner(self.make_app(), access_log=None)
        await self.runner.setup()
        await web.TCPSite(self.runner, "0.0.0.0", int(os.getenv("PORT", "8080"))).start()
        self.cleaner = asyncio.create_task(self.cleanup_sessions())
        print("GFA tournament signup server started", flush=True)
        await self.prepare_discord()

    async def close(self):
        if self.cleaner:
            self.cleaner.cancel()
        if self.runner:
            await self.runner.cleanup()
        if self.client:
            await self.client.close()
