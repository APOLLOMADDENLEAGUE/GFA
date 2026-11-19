"""Persistent, Discord-authenticated Turkey Bowl auction and public broadcast view."""
import asyncio
import copy
import csv
import hashlib
import io
import json
import secrets
import sqlite3
import time
import logging
from contextlib import closing
from pathlib import Path

from aiohttp import web
from tournament import FlowError

EVENT = "turkey-bowl-2026-11-20"
ASSETS = Path(__file__).with_name("auction_assets")
SEED = Path(__file__).with_name("auction_seed.json")
BOARD_CSV = "https://docs.google.com/spreadsheets/d/1Jzr9S4IVFj0WbYha9ViQXHNiOswcpaT0KYRwuOkoh8I/export?format=csv&gid=1601740487"
COLORS = ["#eea143", "#61c9bc", "#ef7c75", "#bc9aef", "#9fc96b", "#67b5e8",
          "#efbf5b", "#ea8fbd", "#92abc7", "#e4a683", "#80cfb4", "#b5a0e9"]


class AuctionError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def now():
    return int(time.time() * 1000)


def normalized(value):
    return " ".join(str(value).casefold().split())


def stable_id(kind, name):
    return kind + "-" + hashlib.sha256(normalized(name).encode()).hexdigest()[:16]


def parse_board(text):
    """Read the existing merged-cell board, including extra player rows."""
    rows = list(csv.reader(io.StringIO(text)))
    def value(row, col):
        return rows[row][col].strip() if row < len(rows) and col < len(rows[row]) else ""
    header = next((r for r in range(12, min(len(rows), 100))
                   if [value(r, c).upper() for c in (2, 10, 18)] == ["WR", "LINE", "FLEX"]), None)
    if header is None or value(4, 0).casefold() != "captain":
        raise AuctionError("Draft board headings changed. The last valid board was kept.", 409)
    captains, names = [], set()
    for i in range(12):
        col = 2 + 2 * i
        name = value(4, col)
        amount = value(11, col).replace("$", "").replace(",", "")
        key = normalized(name)
        if not name or key in names or not amount.isdigit():
            raise AuctionError("Check the twelve QB names and budgets on the board.", 409)
        names.add(key)
        captains.append({"id": stable_id("captain", name), "name": name, "budget": money(int(amount))})
    players, seen = [], set()
    for r in range(header + 1, min(len(rows), 500)):
        for position, columns in {"WR": (2, 5, 7), "LINE": (10, 13, 15), "FLEX": (18, 21, 23)}.items():
            for col in columns:
                name = value(r, col)
                if not name:
                    continue
                key = normalized(name)
                if key in seen or key in names or len(name) > 80:
                    raise AuctionError("A duplicate or invalid player name is on the board. The last valid board was kept.", 409)
                seen.add(key)
                players.append({"id": stable_id("player", name), "name": name, "position": position})
    if not players:
        raise AuctionError("The player pool is empty. The last valid board was kept.", 409)
    return {"title": "Turkey Bowl Auction Tournament", "date": "2026-11-20",
            "captains": captains, "players": players}


def reconcile_board(state, seed):
    """Sheet owns names, positions and nomination order; auction owns sales."""
    old_captains = {normalized(c["name"]): c for c in state["captains"]}
    current_turn = state["captains"][state["turn"]]["id"]
    incoming_names = {normalized(c["name"]) for c in seed["captains"]}
    removed_captains = [c for k, c in old_captains.items() if k not in incoming_names]
    protected_ids = {state["lot"][k] for k in ("nominatorId", "leaderId")} if state["lot"] else set()
    if any(c["roster"] or c["id"] in protected_ids for c in removed_captains):
        raise AuctionError("A removed QB has drafted players or an active bid. Restore that QB on the sheet before syncing.", 409)
    captains = []
    for i, incoming in enumerate(seed["captains"]):
        previous = old_captains.get(normalized(incoming["name"]))
        captain = copy.deepcopy(previous) if previous else {**incoming, "startingBudget": incoming["budget"], "roster": [], "color": COLORS[i]}
        captain["name"] = incoming["name"]
        if state["phase"] == "setup":
            captain.update(budget=incoming["budget"], startingBudget=incoming["budget"])
        captains.append(captain)
    old_players = {normalized(p["name"]): p for p in state["players"]}
    players = []
    for incoming in seed["players"]:
        previous = old_players.get(normalized(incoming["name"]))
        player = {**incoming, "status": "available", "onBoard": True}
        if previous:
            player.update(id=previous["id"], status=previous["status"] if previous["status"] in {"sold", "nominated"} else "available")
            # A completed pick keeps its position at the time of sale.
            if previous["status"] == "sold":
                player["position"] = previous["position"]
        players.append(player)
    incoming_keys = {normalized(p["name"]) for p in seed["players"]}
    for key, previous in old_players.items():
        if key not in incoming_keys:
            players.append({**previous, "onBoard": False, "status": "sold" if previous["status"] == "sold" else "removed"})
    if state["lot"]:
        active = next(p for p in players if p["id"] == state["lot"]["playerId"])
        if active["status"] == "removed":
            state.update(lot=None, phase="nominating")
            add_event(state, "sync", f"{active['name']} was removed from the board. Nominate another player.")
    state["captains"], state["players"] = captains, players
    if state["phase"] == "setup":
        state["turn"] = 0
    else:
        state["turn"] = next((i for i, c in enumerate(captains) if c["id"] == current_turn), 0)
    return state


def money(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 10 or value % 10:
        raise AuctionError("Enter a bid of $10 or more, in multiples of $10.")
    return value


def fresh_state(seed):
    captains = []
    for index, captain in enumerate(seed["captains"]):
        budget = money(captain["budget"])
        captains.append({**captain, "startingBudget": budget, "roster": [],
                         "color": COLORS[index % len(COLORS)]})
    return {"event": EVENT, "title": seed["title"], "date": seed["date"],
            "revision": 0, "phase": "setup", "paused": False, "turn": 0,
            "round": 1, "slots": 6, "captains": captains,
            "players": [{**p, "status": "available"} for p in seed["players"]],
            "lot": None, "sales": [], "feed": [], "lastEvent": None}


def captain_for(state, captain_id):
    captain = next((c for c in state["captains"] if c["id"] == captain_id), None)
    if captain is None:
        raise AuctionError("Choose a listed captain.")
    return captain


def add_event(state, kind, text, **details):
    event = {"id": secrets.token_hex(8), "kind": kind, "text": text,
             "at": now(), **details}
    state["feed"] = [event, *state["feed"]][:40]
    state["lastEvent"] = event


def advance_turn(state, previous):
    count = len(state["captains"])
    for offset in range(1, count + 1):
        index = (previous + offset) % count
        if len(state["captains"][index]["roster"]) < state["slots"]:
            state["turn"] = index
            state["phase"] = "nominating"
            break
    else:
        state["phase"] = "complete"
    state["round"] = min(6, len(state["sales"]) // count + 1)


def apply_action(state, action, actor):
    """Pure state transition; the store serializes and commits it atomically."""
    kind = action.get("type")
    host = actor.get("host", False)
    if kind in {"start", "reset", "pause", "turn", "call", "sold", "pass", "undo"}:
        if not host:
            raise AuctionError("Only the host can use this control.", 403)
        if action.get("revision") != state["revision"]:
            raise AuctionError("The room changed. Review the latest bid and try again.", 409)
    if kind == "reset":
        if action.get("confirmation") != "RESET":
            raise AuctionError("Confirm Reset Draft before clearing the picks.")
        seed = {"title": state["title"], "date": state["date"],
                "captains": [{"id": c["id"], "name": c["name"], "budget": c["startingBudget"]} for c in state["captains"]],
                "players": [{"id": p["id"], "name": p["name"], "position": p["position"]} for p in state["players"] if p.get("onBoard", True)]}
        revision = state["revision"]
        state.clear()
        state.update(fresh_state(seed), revision=revision)
        add_event(state, "reset", "Draft reset. Budgets restored; waiting for Start Draft.")
    elif kind == "start":
        if state["phase"] != "setup":
            raise AuctionError("The auction has already started.", 409)
        state["phase"] = "nominating"
        add_event(state, "start", "The Turkey Bowl auction is open.")
    elif kind == "pause":
        state["paused"] = not state["paused"]
        add_event(state, "pause", "Auction paused." if state["paused"] else "Auction resumed.")
    elif kind == "turn":
        if state["lot"]:
            raise AuctionError("Finish the current player before changing the turn.", 409)
        captain = captain_for(state, action.get("captainId"))
        if len(captain["roster"]) >= state["slots"]:
            raise AuctionError("That captain's roster is full.")
        state["turn"] = state["captains"].index(captain)
        add_event(state, "turn", f"{captain['name']} is on the clock.")
    elif kind == "nominate":
        if state["paused"] or state["phase"] != "nominating" or state["lot"]:
            raise AuctionError("Wait for nominations to open.", 409)
        captain = state["captains"][state["turn"]]
        if not host and actor.get("captainId") != captain["id"]:
            raise AuctionError("It is another captain's nomination turn.", 403)
        if len(captain["roster"]) >= state["slots"]:
            raise AuctionError("This captain's roster is full.")
        player = next((p for p in state["players"] if p["id"] == action.get("playerId")), None)
        if not player or player["status"] != "available":
            raise AuctionError("That player is no longer available.", 409)
        amount = money(action.get("amount"))
        if amount > captain["budget"]:
            raise AuctionError("The opening bid exceeds the captain's remaining budget.")
        player["status"] = "nominated"
        state["lot"] = {"id": secrets.token_hex(12), "playerId": player["id"],
                        "nominatorId": captain["id"], "amount": amount,
                        "leaderId": captain["id"], "bids": {captain["id"]: amount}, "call": 0, "openedAt": now()}
        state["phase"] = "bidding"
        add_event(state, "nomination", f"{captain['name']} nominates {player['name']} for \u0024{amount}.",
                  playerId=player["id"], captainId=captain["id"], amount=amount)
    elif kind == "bid":
        lot = state["lot"]
        if state["paused"] or state["phase"] != "bidding" or not lot:
            raise AuctionError("Bidding is not open.", 409)
        if action.get("lotId") != lot["id"]:
            raise AuctionError("That player's auction has ended.", 409)
        captain_id = action.get("captainId") if host else actor.get("captainId")
        if not captain_id:
            raise AuctionError("Open your private captain link to bid.", 403)
        captain = captain_for(state, captain_id)
        if len(captain["roster"]) >= state["slots"]:
            raise AuctionError("Your six-player roster is full.")
        amount = money(action.get("amount"))
        if amount <= lot["amount"]:
            raise AuctionError(f"Enter at least \u0024{lot['amount'] + 10}.", 409)
        if amount > captain["budget"]:
            raise AuctionError("That bid exceeds your remaining budget.")
        lot.update(amount=amount, leaderId=captain["id"], call=0)
        lot.setdefault("bids", {})[captain["id"]] = amount
        add_event(state, "bid", f"{captain['name']} bids \u0024{amount}.",
                  captainId=captain["id"], playerId=lot["playerId"], amount=amount)
    elif kind == "call":
        if not state["lot"] or state["phase"] != "bidding":
            raise AuctionError("There is no active player.", 409)
        state["lot"]["call"] = min(3, state["lot"]["call"] + 1)
        text = ["", "Going once.", "Going twice.", "Going three times."][state["lot"]["call"]]
        add_event(state, "call", text)
    elif kind == "sold":
        lot = state["lot"]
        if not lot or state["phase"] != "bidding" or action.get("lotId") != lot["id"]:
            raise AuctionError("There is no matching player to sell.", 409)
        captain = captain_for(state, lot["leaderId"])
        if lot["amount"] > captain["budget"] or len(captain["roster"]) >= state["slots"]:
            raise AuctionError("This winning bid is no longer valid.", 409)
        player = next(p for p in state["players"] if p["id"] == lot["playerId"])
        sale = {"id": secrets.token_hex(8), "playerId": player["id"],
                "captainId": captain["id"], "amount": lot["amount"],
                "turnBefore": state["turn"], "nominatorId": lot["nominatorId"], "at": now()}
        captain["budget"] -= lot["amount"]
        captain["roster"].append({"playerId": player["id"], "amount": lot["amount"]})
        player["status"] = "sold"
        state["sales"].append(sale)
        state["lot"] = None
        advance_turn(state, state["turn"])
        add_event(state, "sold", f"{player['name']} sold to {captain['name']} for \u0024{sale['amount']}.",
                  **{k: sale[k] for k in ("playerId", "captainId", "amount")})
    elif kind == "pass":
        if not state["lot"]:
            raise AuctionError("There is no active nomination.", 409)
        player = next(p for p in state["players"] if p["id"] == state["lot"]["playerId"])
        player["status"] = "available" if player.get("onBoard", True) else "removed"
        state["lot"] = None
        advance_turn(state, state["turn"])
        add_event(state, "pass", f"{player['name']} returns to the player pool.")
    elif kind == "undo":
        if state["lot"] or not state["sales"]:
            raise AuctionError("Finish the current nomination before undoing the last sale.", 409)
        sale = state["sales"].pop()
        captain = captain_for(state, sale["captainId"])
        captain["budget"] += sale["amount"]
        captain["roster"] = [p for p in captain["roster"] if p["playerId"] != sale["playerId"]]
        player = next(p for p in state["players"] if p["id"] == sale["playerId"])
        player["status"] = "available" if player.get("onBoard", True) else "removed"
        turn = next((i for i, c in enumerate(state["captains"]) if c["id"] == sale.get("nominatorId")), sale["turnBefore"])
        state.update(turn=turn, phase="nominating")
        state["round"] = min(6, len(state["sales"]) // len(state["captains"]) + 1)
        add_event(state, "undo", f"Last sale undone. {player['name']} is available again.")
    else:
        raise AuctionError("Unknown auction action.")
    state["revision"] += 1
    return state


class AuctionStore:
    def __init__(self, path, seed):
        self.path, self.seed = Path(path), seed

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        return db

    def initialize(self):
        with closing(self.connect()) as db, db:
            db.execute("""CREATE TABLE IF NOT EXISTS gfa_auction_state
                (event_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS gfa_auction_claims
                (event_key TEXT NOT NULL, discord_id TEXT NOT NULL, captain_id TEXT NOT NULL,
                 display_name TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0,
                 created_at INTEGER NOT NULL, PRIMARY KEY(event_key,discord_id))""")
            db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS gfa_auction_approved_captain
                ON gfa_auction_claims(event_key,captain_id) WHERE approved=1""")
            db.execute("""CREATE TABLE IF NOT EXISTS gfa_auction_links
                (event_key TEXT NOT NULL, captain_id TEXT NOT NULL, token TEXT NOT NULL,
                 token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
                 PRIMARY KEY(event_key,captain_id))""")
            db.execute("""CREATE TABLE IF NOT EXISTS gfa_auction_access
                (session_hash TEXT PRIMARY KEY, event_key TEXT NOT NULL, captain_id TEXT NOT NULL,
                 link_hash TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS gfa_auction_reset_backups
                (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL,
                 created_at INTEGER NOT NULL, payload TEXT NOT NULL)""")
            db.execute("INSERT OR IGNORE INTO gfa_auction_state VALUES (?,?,?)",
                       (EVENT, 0, json.dumps(fresh_state(self.seed))))
            state = json.loads(db.execute("SELECT payload FROM gfa_auction_state WHERE event_key=?", (EVENT,)).fetchone()[0])
            self.ensure_links(db, state)
            db.execute("DELETE FROM gfa_auction_access WHERE expires<?", (int(time.time()),))

    def ensure_links(self, db, state):
        for c in state["captains"]:
            token = secrets.token_urlsafe(32)
            db.execute("INSERT OR IGNORE INTO gfa_auction_links VALUES (?,?,?,?,?)",
                       (EVENT, c["id"], token, hashlib.sha256(token.encode()).hexdigest(), now()))

    def links(self):
        with closing(self.connect()) as db:
            return [{"captainId": r["captain_id"], "token": r["token"]} for r in db.execute(
                "SELECT captain_id,token FROM gfa_auction_links WHERE event_key=?", (EVENT,))]

    def rotate_link(self, captain_id):
        captain_for(self.state(), captain_id)
        token = secrets.token_urlsafe(32)
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE gfa_auction_links SET token=?,token_hash=?,created_at=? WHERE event_key=? AND captain_id=?",
                       (token, hashlib.sha256(token.encode()).hexdigest(), now(), EVENT, captain_id))
            db.execute("DELETE FROM gfa_auction_access WHERE event_key=? AND captain_id=?", (EVENT, captain_id))

    def redeem(self, token):
        if not isinstance(token, str) or not 30 <= len(token) <= 100:
            raise AuctionError("This private link is invalid or has been replaced. Ask the host for your latest link.", 401)
        digest = hashlib.sha256(token.encode()).hexdigest()
        with closing(self.connect()) as db, db:
            link = db.execute("SELECT * FROM gfa_auction_links WHERE event_key=? AND token_hash=?", (EVENT, digest)).fetchone()
            if not link or not secrets.compare_digest(link["token"], token):
                raise AuctionError("This private link is invalid or has been replaced. Ask the host for your latest link.", 401)
            captain_for(self.state(), link["captain_id"])
            raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            db.execute("INSERT INTO gfa_auction_access VALUES (?,?,?,?,?,?)",
                       (hashlib.sha256(raw.encode()).hexdigest(), EVENT, link["captain_id"], digest, csrf, int(time.time()) + 30 * 86400))
            return raw

    def access_session(self, raw):
        if not isinstance(raw, str) or not 30 <= len(raw) <= 100:
            return None
        with closing(self.connect()) as db:
            row = db.execute("""SELECT a.* FROM gfa_auction_access a JOIN gfa_auction_links l
                ON a.event_key=l.event_key AND a.captain_id=l.captain_id AND a.link_hash=l.token_hash
                WHERE a.session_hash=? AND a.event_key=? AND a.expires>?""",
                             (hashlib.sha256(raw.encode()).hexdigest(), EVENT, int(time.time()))).fetchone()
            if not row:
                return None
            c = next((c for c in self.state()["captains"] if c["id"] == row["captain_id"]), None)
            if not c:
                return None
            return {"csrf": row["csrf"], "access": "link", "captainId": c["id"],
                    "user": {"id": "invite:" + c["id"], "username": c["name"]}}

    def has_reset_backup(self):
        with closing(self.connect()) as db:
            return db.execute("SELECT 1 FROM gfa_auction_reset_backups WHERE event_key=? LIMIT 1", (EVENT,)).fetchone() is not None

    def restore_reset(self, revision):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            state = json.loads(db.execute("SELECT payload FROM gfa_auction_state WHERE event_key=?", (EVENT,)).fetchone()[0])
            if state["revision"] != revision or state["phase"] != "setup" or state["sales"]:
                raise AuctionError("Restore a reset before starting another draft.", 409)
            row = db.execute("SELECT * FROM gfa_auction_reset_backups WHERE event_key=? ORDER BY id DESC LIMIT 1", (EVENT,)).fetchone()
            if not row:
                raise AuctionError("There is no reset to restore.", 409)
            restored = json.loads(row["payload"])
            if {c["id"] for c in restored["captains"]} != {c["id"] for c in state["captains"]}:
                raise AuctionError("Restore the previous QB names on the board before restoring this draft.", 409)
            restored["revision"] = state["revision"] + 1
            add_event(restored, "restore", "The draft before the last reset was restored.")
            db.execute("UPDATE gfa_auction_state SET revision=?,payload=? WHERE event_key=?", (restored["revision"], json.dumps(restored), EVENT))
            db.execute("DELETE FROM gfa_auction_reset_backups WHERE id=?", (row["id"],))
            return restored

    def state(self):
        with closing(self.connect()) as db:
            return json.loads(db.execute("SELECT payload FROM gfa_auction_state WHERE event_key=?",
                                         (EVENT,)).fetchone()[0])

    def mutate(self, action, actor):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            state = json.loads(db.execute("SELECT payload FROM gfa_auction_state WHERE event_key=?",
                                          (EVENT,)).fetchone()[0])
            before = copy.deepcopy(state) if action.get("type") == "reset" else None
            state = apply_action(state, action, actor)
            if before is not None:
                db.execute("INSERT INTO gfa_auction_reset_backups(event_key,created_at,payload) VALUES (?,?,?)", (EVENT, now(), json.dumps(before)))
                db.execute("DELETE FROM gfa_auction_reset_backups WHERE event_key=? AND id NOT IN (SELECT id FROM gfa_auction_reset_backups WHERE event_key=? ORDER BY id DESC LIMIT 10)", (EVENT, EVENT))
            db.execute("UPDATE gfa_auction_state SET revision=?,payload=? WHERE event_key=?",
                       (state["revision"], json.dumps(state), EVENT))
            return state

    def claim(self, user):
        with closing(self.connect()) as db:
            row = db.execute("SELECT * FROM gfa_auction_claims WHERE event_key=? AND discord_id=?",
                             (EVENT, user["id"])).fetchone()
            return dict(row) if row else None

    def requests(self):
        with closing(self.connect()) as db:
            return [dict(r) for r in db.execute(
                "SELECT * FROM gfa_auction_claims WHERE event_key=? ORDER BY created_at", (EVENT,))]

    def request_captain(self, user, captain_id):
        captain_for(self.state(), captain_id)
        with closing(self.connect()) as db, db:
            previous = db.execute("SELECT * FROM gfa_auction_claims WHERE event_key=? AND discord_id=?",
                                  (EVENT, user["id"])).fetchone()
            if previous and previous["approved"]:
                raise AuctionError("Your captain slot is already approved.", 409)
            taken = db.execute("SELECT discord_id FROM gfa_auction_claims WHERE event_key=? AND captain_id=? AND approved=1",
                               (EVENT, captain_id)).fetchone()
            if taken:
                raise AuctionError("That captain slot is already assigned.", 409)
            display = (user.get("global_name") or user["username"])[:80]
            db.execute("""INSERT INTO gfa_auction_claims VALUES (?,?,?,?,0,?)
                ON CONFLICT(event_key,discord_id) DO UPDATE SET
                captain_id=excluded.captain_id,display_name=excluded.display_name,created_at=excluded.created_at""",
                       (EVENT, user["id"], captain_id, display, now()))

    def approve(self, discord_id, revoke=False):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM gfa_auction_claims WHERE event_key=? AND discord_id=?",
                             (EVENT, discord_id)).fetchone()
            if not row:
                raise AuctionError("That captain request no longer exists.", 404)
            if revoke:
                db.execute("DELETE FROM gfa_auction_claims WHERE event_key=? AND discord_id=?", (EVENT, discord_id))
            else:
                taken = db.execute("""SELECT discord_id FROM gfa_auction_claims
                    WHERE event_key=? AND captain_id=? AND approved=1 AND discord_id<>?""",
                                   (EVENT, row["captain_id"], discord_id)).fetchone()
                if taken:
                    raise AuctionError("Revoke the existing captain assignment before replacing it.", 409)
                db.execute("UPDATE gfa_auction_claims SET approved=1 WHERE event_key=? AND discord_id=?",
                           (EVENT, discord_id))

    def sync_seed(self, seed):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            state = json.loads(db.execute("SELECT payload FROM gfa_auction_state WHERE event_key=?", (EVENT,)).fetchone()[0])
            updated = reconcile_board(copy.deepcopy(state), seed)
            if updated != state:
                updated["revision"] = state["revision"] + 1
                db.execute("UPDATE gfa_auction_state SET revision=?,payload=? WHERE event_key=?",
                           (updated["revision"], json.dumps(updated), EVENT))
                valid = [c["id"] for c in updated["captains"]]
                db.execute("DELETE FROM gfa_auction_claims WHERE event_key=? AND captain_id NOT IN (%s)" % ",".join("?" * len(valid)), (EVENT, *valid))
                db.execute("DELETE FROM gfa_auction_links WHERE event_key=? AND captain_id NOT IN (%s)" % ",".join("?" * len(valid)), (EVENT, *valid))
                db.execute("DELETE FROM gfa_auction_access WHERE event_key=? AND captain_id NOT IN (%s)" % ",".join("?" * len(valid)), (EVENT, *valid))
                self.ensure_links(db, updated)
            return updated


class AuctionServer:
    def __init__(self, tournament, *, seed=None):
        self.t = tournament
        self.store = AuctionStore(tournament.db_path, seed or json.loads(SEED.read_text()))
        self.store.initialize()
        self.lock = asyncio.Lock()
        self.sockets = set()
        self.socket_captains = {}
        self.last_seen = {}
        self.closing = False
        self.rates = {}
        self.sync_status = {"lastSuccess": None, "error": None, "interval": 15}
        self.sync_task = None
        self.sync_lock = asyncio.Lock()

    def snapshot(self, state=None):
        state = state or self.store.state()
        active = {captain_id for ws, captain_id in self.socket_captains.items() if not ws.closed}
        return {**state, "boardSync": dict(self.sync_status),
                "presence": {c["id"]: {"online": c["id"] in active, "lastSeen": self.last_seen.get(c["id"])} for c in state["captains"]}}

    @property
    def access_cookie(self):
        return "__Host-gfa_auction_access" if self.t.secure else "gfa_auction_access"

    def identity(self, request):
        try:
            discord_session = self.t.session(request, verified=True)
        except FlowError:
            discord_session = None
        if discord_session and discord_session["user"]["id"] in self.t.admin_ids:
            return {"host": True, "captainId": None}, discord_session
        session = self.store.access_session(request.cookies.get(self.access_cookie, ""))
        if session:
            return {"host": False, "captainId": session["captainId"]}, session
        if discord_session:
            claim = self.store.claim(discord_session["user"])
            return {"host": False, "captainId": claim["captain_id"] if claim and claim["approved"] else None}, discord_session
        raise FlowError("Open your private captain link, or connect as the host.", 401)

    def actor(self, request):
        actor, session = self.identity(request)
        self.t.check_csrf(session, request.headers.get("X-CSRF-Token"))
        origin = request.headers.get("Origin", "")
        if origin and origin != self.t.public_origin:
            raise AuctionError("Open the auction from its GFA link.", 403)
        uid = session["user"]["id"]
        recent = self.rates.get(uid, [])
        recent = [v for v in recent if time.monotonic() - v < 2]
        if len(recent) >= 10:
            raise AuctionError("Please wait a moment before trying again.", 429)
        self.rates[uid] = [*recent, time.monotonic()]
        return actor, session

    async def page(self, request):
        return web.Response(text=(ASSETS / "index.html").read_text(), content_type="text/html")

    async def asset(self, request):
        name = request.match_info["filename"]
        types = {"app.js": "application/javascript", "music.js": "application/javascript", "style.css": "text/css"}
        if name not in types:
            raise web.HTTPNotFound()
        return web.Response(body=(ASSETS / name).read_bytes(), content_type=types[name])

    async def login(self, request):
        if not self.t.client_id or not self.t.client_secret or not self.t.public_origin.startswith("https://"):
            raise FlowError("Discord connection is not ready yet. Please try again shortly.", 503)
        path = "/auction/host" if request.query.get("view") == "host" else "/auction/captain"
        return self.t.new_session(request, {"return_to": path}, "auction")

    async def state(self, request):
        return web.json_response(self.snapshot())

    async def me(self, request):
        try:
            actor, session = self.identity(request)
        except FlowError:
            return web.json_response({"role": "viewer"})
        user = session["user"]
        claim = self.store.claim(user) if session.get("access") != "link" else None
        host = actor["host"]
        result = {"role": "host" if host else "captain" if claim and claim["approved"] else "pending" if claim else "unassigned",
                  "name": user.get("global_name") or user["username"], "csrf": session["csrf"],
                  "captainId": actor["captainId"] or (claim["captain_id"] if claim else None)}
        if session.get("access") == "link":
            result.update(role="captain", access="private-link")
        if host:
            result["requests"] = self.store.requests()
            result["captainLinks"] = [{"captainId": link["captainId"], "url": self.t.public_origin + "/auction/captain#key=" + link["token"]} for link in self.store.links()]
            result["hasResetBackup"] = self.store.has_reset_backup()
        return web.json_response(result)

    async def enter(self, request):
        try:
            if request.headers.get("Origin") != self.t.public_origin or request.content_type != "application/json":
                raise AuctionError("Open your private link directly from GFA.", 403)
            payload = await request.json()
            if not isinstance(payload, dict):
                raise AuctionError("Invalid private link.", 400)
            key = "enter:" + str(request.remote)
            recent = [v for v in self.rates.get(key, []) if time.monotonic() - v < 10]
            if len(recent) >= 20:
                raise AuctionError("Please wait a moment and open your link again.", 429)
            self.rates[key] = [*recent, time.monotonic()]
            async with self.lock:
                raw = self.store.redeem(payload.get("key"))
            response = web.json_response({"ok": True})
            response.set_cookie(self.access_cookie, raw, max_age=30 * 86400,
                                secure=self.t.secure, httponly=True, samesite="Lax", path="/")
            return response
        except AuctionError as error:
            return web.json_response({"error": error.message}, status=error.status)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return web.json_response({"error": "Invalid private link."}, status=400)

    async def action(self, request):
        try:
            actor, session = self.actor(request)
            payload = await request.json()
            if not isinstance(payload, dict):
                raise AuctionError("Invalid auction request.")
            if payload.get("type") == "sync":
                if not actor["host"]:
                    raise AuctionError("Only the host can refresh the player pool.", 403)
                state = await self.sync_board()
                return web.json_response(self.snapshot(state))
            async with self.lock:
                if payload.get("type") == "claim":
                    if session.get("access") == "link":
                        raise AuctionError("Your private link already assigns your QB slot.", 403)
                    self.store.request_captain(session["user"], payload.get("captainId"))
                    return web.json_response({"ok": True})
                if payload.get("type") == "rotate_link":
                    if not actor["host"]:
                        raise AuctionError("Only the host can replace captain links.", 403)
                    self.store.rotate_link(payload.get("captainId"))
                    for ws, captain_id in tuple(self.socket_captains.items()):
                        if captain_id == payload.get("captainId"):
                            await ws.close(code=4001, message=b"Captain link replaced")
                    return web.json_response({"ok": True})
                if payload.get("type") == "restore_reset":
                    if not actor["host"]:
                        raise AuctionError("Only the host can restore a draft.", 403)
                    state = self.store.restore_reset(payload.get("revision"))
                else:
                    state = None
                if payload.get("type") in {"approve", "revoke"}:
                    if not actor["host"]:
                        raise AuctionError("Only the host can approve captain slots.", 403)
                    self.store.approve(str(payload.get("discordId", "")), payload["type"] == "revoke")
                    return web.json_response({"ok": True})
                if state is None:
                    state = self.store.mutate(payload, actor)
            await self.broadcast(state)
            return web.json_response(self.snapshot(state))
        except (AuctionError, FlowError) as error:
            return web.json_response({"error": error.message}, status=error.status)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return web.json_response({"error": "Invalid auction request."}, status=400)

    async def sync_board(self):
        async with self.sync_lock:
            try:
                async with self.t.client.get(BOARD_CSV + "&cache=" + str(now()), timeout=12,
                                             headers={"Cache-Control": "no-cache"}) as response:
                    if response.status != 200:
                        raise AuctionError("Google board is unavailable. The last valid roster was kept.", 502)
                    raw = await response.content.read(1024 * 1024 + 1)
                    if len(raw) > 1024 * 1024:
                        raise AuctionError("Google board export is too large. The last valid roster was kept.", 502)
                    seed = parse_board(raw.decode("utf-8-sig"))
                async with self.lock:
                    state = self.store.sync_seed(seed)
                self.sync_status.update(lastSuccess=now(), error=None)
            except Exception as error:
                message = error.message if isinstance(error, AuctionError) else "Google board sync is delayed. The last valid roster was kept."
                self.sync_status["error"] = message
                await self.broadcast(self.store.state())
                raise AuctionError(message, 502) from error
            await self.broadcast(state)
            return state

    async def sync_loop(self):
        while True:
            try:
                await self.sync_board()
            except AuctionError:
                logging.getLogger(__name__).warning("GFA auction board sync delayed")
            await asyncio.sleep(15)

    async def startup(self, app):
        if self.t.client is not None:
            self.sync_task = asyncio.create_task(self.sync_loop())

    async def websocket(self, request):
        origin = request.headers.get("Origin", "")
        if origin and origin != self.t.public_origin:
            raise web.HTTPForbidden()
        ws = web.WebSocketResponse(heartbeat=25, max_msg_size=1024)
        await ws.prepare(request)
        self.sockets.add(ws)
        try:
            actor, _ = self.identity(request)
            captain_id = actor["captainId"]
        except FlowError:
            captain_id = None
        if captain_id:
            self.socket_captains[ws] = captain_id
            self.last_seen[captain_id] = now()
        try:
            if captain_id:
                await self.broadcast(self.store.state())
            else:
                await ws.send_json(self.snapshot())
            async for message in ws:
                pass
        finally:
            self.sockets.discard(ws)
            self.socket_captains.pop(ws, None)
            if captain_id:
                self.last_seen[captain_id] = now()
                if not self.closing:
                    await self.broadcast(self.store.state())
        return ws

    async def broadcast(self, state):
        async def send(ws):
            try:
                await asyncio.wait_for(ws.send_json(self.snapshot(state)), timeout=5)
            except (ConnectionError, RuntimeError, asyncio.TimeoutError):
                self.sockets.discard(ws)
        await asyncio.gather(*(send(ws) for ws in tuple(self.sockets)))

    async def export(self, request):
        self.t.session(request, verified=True, admin=True)
        state = self.store.state()
        players = {p["id"]: p for p in state["players"]}
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["Captain", "Player", "Position", "Auction price", "Remaining budget"])
        def clean(value):
            text = str(value)
            return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text
        for captain in state["captains"]:
            for pick in captain["roster"]:
                player = players[pick["playerId"]]
                writer.writerow([clean(captain["name"]), clean(player["name"]), player["position"],
                                 pick["amount"], captain["budget"]])
        return web.Response(text=out.getvalue(), content_type="text/csv",
                            headers={"Content-Disposition": 'attachment; filename="gfa-turkey-bowl-auction.csv"'})

    async def close(self, app):
        self.closing = True
        if self.sync_task:
            self.sync_task.cancel()
            await asyncio.gather(self.sync_task, return_exceptions=True)
        for ws in tuple(self.sockets):
            await ws.close(code=1001, message=b"Server restarting")

    def mount(self, app):
        app.add_routes([
            web.get("/auction", self.page), web.get("/auction/", self.page),
            web.get("/auction/host", self.page), web.get("/auction/captain", self.page),
            web.get("/auction/stream", self.page),
            web.get("/auction/login", self.login),
            web.get("/auction/assets/{filename}", self.asset),
            web.get("/auction/api/state", self.state), web.get("/auction/api/me", self.me),
            web.post("/auction/api/enter", self.enter),
            web.post("/auction/api/action", self.action),
            web.get("/auction/live", self.websocket),
            web.get("/auction/export.csv", self.export),
        ])
        app.on_shutdown.append(self.close)
        app.on_startup.append(self.startup)
