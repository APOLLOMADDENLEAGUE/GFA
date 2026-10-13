import asyncio
from pathlib import Path
import re
import sys
import tempfile
import unittest
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import aiohttp
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tournament import TournamentServer


class FakeResponse:
    def __init__(self, data=None, status=200):
        self.data, self.status = data, status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def json(self):
        return self.data

    async def read(self):
        return b""


class FakeDiscordHTTP:
    def __init__(self):
        self.user = {"id": "123456789012345678", "username": "verified_player", "global_name": "Verified Player"}
        self.scope = "identify guilds.join"
        self.join_status = 201
        self.joins = []
        self.revoked = []

    def post(self, url, **kwargs):
        if url.endswith("/revoke"):
            self.revoked.append(kwargs["data"]["token"])
            return FakeResponse(status=200)
        return FakeResponse({"access_token": "unit-test-user-token", "scope": self.scope, "expires_in": 3600})

    def get(self, url, **kwargs):
        return FakeResponse(self.user)

    def put(self, url, **kwargs):
        self.joins.append((url, kwargs))
        return FakeResponse(status=self.join_status)


class FakeMember:
    def __init__(self):
        self.pending = False
        self.roles = []
        self.role_failure = False
        self.add_count = 0

    async def add_roles(self, role, **kwargs):
        if self.role_failure:
            raise PermissionError("Bot cannot manage role")
        self.add_count += 1
        self.roles = [role]


class FakeGuild:
    def __init__(self):
        self.member = FakeMember()

    async def fetch_member(self, uid):
        return self.member


class TournamentFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = TournamentServer(None, 987654321, database=Path(self.temp.name) / "registrations.sqlite3", public_origin="https://signup.example.com", secure=False)
        self.server.client_id = "111111111111111111"
        self.server.client_secret = "unit-test-client-secret"
        self.server.bot_token = "unit-test-bot-token"
        self.server.guild = FakeGuild()
        self.server.role = SimpleNamespace(id=555)
        self.server.admin_ids = {"999999999999999999"}
        self.server.client = FakeDiscordHTTP()
        self.server.initialize_database()
        self.browser = TestClient(TestServer(self.server.make_app()), cookie_jar=aiohttp.CookieJar(unsafe=True))
        await self.browser.start_server()

    async def asyncTearDown(self):
        await self.browser.close()
        self.temp.cleanup()

    async def verify(self, *, name="Player", position="WR", entered="another_username"):
        response = await self.browser.post("/signup/start", data={"name": name, "position": position, "discord_name": entered, "consent": "yes"}, allow_redirects=False)
        self.assertEqual(response.status, 302)
        location = response.headers["Location"]
        params = parse_qs(urlparse(location).query)
        self.assertEqual(set(params["scope"][0].split()), {"identify", "guilds.join"})
        cookie = response.cookies["gfa_tournament"]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")
        self.assertNotIn("unit-test-user-token", cookie.value)
        response = await self.browser.get("/auth/discord/callback", params={"state": params["state"][0], "code": "unit-test-code"}, allow_redirects=False)
        self.assertEqual(response.status, 302)
        return next(iter(self.server.sessions.values()))

    async def submit(self, session):
        return await self.browser.post("/signup/complete", data={"csrf": session["csrf"]})

    async def test_verified_identity_controls_registration_and_role(self):
        session = await self.verify()
        self.assertEqual(len(self.server.client.joins), 0)
        self.assertEqual(self.server.roster(), [])
        review = await self.browser.get("/signup/review")
        self.assertIn("@verified_player", await review.text())
        response = await self.submit(session)
        self.assertEqual(response.status, 200)
        self.assertIn("REGISTRATION CONFIRMED", await response.text())
        row = self.server.roster()[0]
        self.assertEqual(row["discord_id"], self.server.client.user["id"])
        self.assertEqual(row["discord_username"], "verified_player")
        self.assertEqual(row["entered_discord_name"], "another_username")
        self.assertEqual(row["status"], "confirmed")
        self.assertIn("/guilds/987654321/members/123456789012345678", self.server.client.joins[0][0])
        self.assertNotIn("roles", self.server.client.joins[0][1]["json"])
        self.assertEqual(self.server.guild.member.roles[0].id, 555)
        self.assertNotIn("access_token", session)
        self.assertEqual(len(self.server.client.revoked), 1)

    async def test_unverified_users_cannot_register_or_read_roster(self):
        response = await self.browser.post("/signup/complete", data={"csrf": "forged"})
        self.assertEqual(response.status, 401)
        response = await self.browser.get("/organizer/roster.csv")
        self.assertEqual(response.status, 401)
        self.assertEqual(self.server.roster(), [])
        self.assertEqual(len(self.server.client.joins), 0)

    async def test_forged_oauth_state_is_rejected_before_token_exchange(self):
        response = await self.browser.post("/signup/start", data={"name": "Player", "position": "WR", "discord_name": "player", "consent": "yes"}, allow_redirects=False)
        self.assertEqual(response.status, 302)
        response = await self.browser.get("/auth/discord/callback", params={"state": "forged", "code": "attacker-code"}, allow_redirects=False)
        self.assertEqual(response.status, 403)
        self.assertEqual(self.server.roster(), [])
        self.assertEqual(len(self.server.client.joins), 0)
        self.assertFalse(next(iter(self.server.sessions.values())).get("user"))

    async def test_missing_oauth_join_scope_is_rejected(self):
        response = await self.browser.post("/signup/start", data={"name": "Player", "position": "WR", "discord_name": "player", "consent": "yes"}, allow_redirects=False)
        state = parse_qs(urlparse(response.headers["Location"]).query)["state"][0]
        self.server.client.scope = "identify"
        response = await self.browser.get("/auth/discord/callback", params={"state": state, "code": "test-code"}, allow_redirects=False)
        self.assertEqual(response.status, 403)
        self.assertEqual(len(self.server.client.joins), 0)
        self.assertEqual(len(self.server.client.revoked), 1)

    async def test_bad_csrf_does_not_join_or_grant_role(self):
        await self.verify()
        response = await self.browser.post("/signup/complete", data={"csrf": "forged"})
        self.assertEqual(response.status, 403)
        self.assertEqual(self.server.roster(), [])
        self.assertEqual(len(self.server.client.joins), 0)

    async def test_server_screening_must_finish_before_role_assignment(self):
        session = await self.verify()
        self.server.guild.member.pending = True
        response = await self.submit(session)
        self.assertEqual(response.status, 409)
        self.assertIn("accept the server rules", await response.text())
        self.assertEqual(self.server.guild.member.add_count, 0)
        self.assertEqual(self.server.roster()[0]["status"], "waiting_for_server_rules")
        self.server.guild.member.pending = False
        self.server.client.join_status = 204
        response = await self.submit(session)
        self.assertEqual(response.status, 200)
        self.assertEqual(self.server.roster()[0]["status"], "confirmed")
        self.assertEqual(len(self.server.roster()), 1)

    async def test_role_failure_is_saved_for_retry_without_false_confirmation(self):
        session = await self.verify()
        self.server.guild.member.role_failure = True
        response = await self.submit(session)
        self.assertEqual(response.status, 502)
        self.assertNotIn("REGISTRATION CONFIRMED", await response.text())
        self.assertEqual(self.server.roster()[0]["status"], "role_pending")
        self.server.guild.member.role_failure = False
        response = await self.submit(session)
        self.assertEqual(response.status, 200)
        self.assertEqual(len(self.server.roster()), 1)

    async def test_failed_join_does_not_grant_role(self):
        session = await self.verify()
        self.server.client.join_status = 403
        response = await self.submit(session)
        self.assertEqual(response.status, 502)
        self.assertEqual(self.server.guild.member.add_count, 0)
        self.assertEqual(self.server.roster()[0]["status"], "join_failed")

    async def test_duplicate_account_updates_single_entry(self):
        session = await self.verify(name="First name")
        self.assertEqual((await self.submit(session)).status, 200)
        self.assertEqual((await self.submit(session)).status, 200)
        self.assertEqual(self.server.guild.member.add_count, 1)
        session = await self.verify(name="Updated name", position="FLEX")
        self.assertEqual((await self.submit(session)).status, 200)
        self.assertEqual(len(self.server.roster()), 1)
        self.assertEqual(self.server.roster()[0]["name"], "Updated name")
        self.assertEqual(self.server.roster()[0]["position"], "FLEX")

    async def test_player_cannot_read_organizer_roster(self):
        await self.verify()
        response = await self.browser.get("/organizer")
        self.assertEqual(response.status, 403)
        body = await response.text()
        self.assertIn("@verified_player", body)
        self.assertIn('href="/organizer/login"', body)
        response = await self.browser.get("/organizer/roster.csv")
        self.assertEqual(response.status, 403)

    async def test_organizer_can_use_existing_verified_signup_session(self):
        self.server.admin_ids.add(self.server.client.user["id"])
        session = await self.verify()
        self.assertEqual((await self.submit(session)).status, 200)
        response = await self.browser.get("/organizer")
        self.assertEqual(response.status, 200)
        self.assertIn("Tournament roster", await response.text())
        response = await self.browser.get("/organizer/roster.csv")
        self.assertEqual(response.status, 200)
        self.assertIn("verified_player", await response.text())

    async def test_unauthorized_organizer_login_can_switch_accounts(self):
        self.server.client.scope = "identify"
        response = await self.browser.get("/organizer/login", allow_redirects=False)
        state = parse_qs(urlparse(response.headers["Location"]).query)["state"][0]
        response = await self.browser.get("/auth/discord/callback", params={"state": state, "code": "non-organizer-code"}, allow_redirects=False)
        self.assertEqual(response.status, 403)
        body = await response.text()
        self.assertIn("@verified_player", body)
        self.assertIn('href="/organizer/login"', body)
        self.assertNotIn("Tournament roster", body)
        self.assertEqual((await self.browser.get("/organizer/roster.csv")).status, 403)
        self.assertEqual(self.server.client.joins, [])

    async def test_roster_persists_across_server_instances(self):
        session = await self.verify()
        await self.submit(session)
        reopened = TournamentServer(None, 987654321, database=self.server.db_path, public_origin="https://signup.example.com", secure=False)
        reopened.initialize_database()
        self.assertEqual(reopened.roster()[0]["discord_id"], self.server.client.user["id"])
        self.assertEqual(reopened.sessions, {})

    async def test_closed_or_unconfigured_signup_does_not_start_oauth(self):
        self.server.client_secret = ""
        response = await self.browser.post("/signup/start", data={"name": "Player", "position": "WR", "discord_name": "player", "consent": "yes"}, allow_redirects=False)
        self.assertEqual(response.status, 503)
        self.assertNotIn("Location", response.headers)
        self.assertEqual(self.server.sessions, {})

    async def test_expired_session_is_rejected(self):
        session = await self.verify()
        session["expires"] = 0
        response = await self.submit(session)
        self.assertEqual(response.status, 401)
        self.assertEqual(len(self.server.client.joins), 0)

    async def test_authorized_organizer_can_export_safe_csv(self):
        session = await self.verify(name="=HYPERLINK(\"bad\")")
        await self.submit(session)
        self.server.client.user = {"id": "999999999999999999", "username": "organizer", "global_name": "Organizer"}
        self.server.client.scope = "identify"
        response = await self.browser.get("/organizer/login", allow_redirects=False)
        state = parse_qs(urlparse(response.headers["Location"]).query)["state"][0]
        response = await self.browser.get("/auth/discord/callback", params={"state": state, "code": "organizer-code"}, allow_redirects=False)
        self.assertEqual(response.status, 302)
        self.assertEqual(response.headers["Location"], "/organizer")
        response = await self.browser.get("/organizer/roster.csv")
        self.assertEqual(response.status, 200)
        csv = await response.text()
        self.assertIn("'=HYPERLINK", csv)
        self.assertIn("'123456789012345678", csv)
        self.assertNotIn("unit-test-user-token", csv)

    async def test_public_status_reveals_no_private_configuration(self):
        response = await self.browser.get("/tournament/status", headers={"Origin": "https://officialgfa.com"})
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://officialgfa.com")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        body = await response.json()
        self.assertEqual(set(body), {"ready", "registration_open", "date"})
        self.assertEqual(body["date"], "2026-10-24")

    async def test_only_supported_positions_can_complete_signup(self):
        for entered, expected in [("qb", "QB"), ("WR", "WR"), ("LINE", "LINE"), ("Flex", "FLEX")]:
            with self.subTest(position=entered):
                session = await self.verify(position=entered)
                self.assertEqual((await self.submit(session)).status, 200)
                self.assertEqual(self.server.roster()[0]["position"], expected)

    async def test_unsupported_positions_cannot_start_verification(self):
        for position in ["RB", "DB", "OL", "DL", "WR / DB", "anything"]:
            with self.subTest(position=position):
                response = await self.browser.post("/signup/start", data={"name": "Player", "position": position, "discord_name": "player", "consent": "yes"}, allow_redirects=False)
                self.assertEqual(response.status, 400)
                self.assertNotIn("Location", response.headers)
        self.assertEqual(self.server.sessions, {})
        self.assertEqual(self.server.roster(), [])

    async def test_old_pending_session_cannot_complete_with_unsupported_position(self):
        session = await self.verify()
        session["draft"]["position"] = "DB"
        self.assertEqual((await self.submit(session)).status, 400)
        self.assertEqual(self.server.client.joins, [])
        self.assertEqual(self.server.roster(), [])


if __name__ == "__main__":
    unittest.main()
