import asyncio
import copy
import csv
import hashlib
import io
import json
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import aiohttp
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auction import AuctionError, AuctionStore, SEED, apply_action, fresh_state, parse_board, reconcile_board
from tournament import TournamentServer, AUCTION_SESSION_TTL
from test_tournament import FakeDiscordHTTP

HOST = {"host": True}


class AuctionRulesTests(unittest.TestCase):
    def setUp(self):
        self.seed = json.loads(SEED.read_text())
        self.state = fresh_state(self.seed)

    def do(self, kind, actor=HOST, **kwargs):
        return apply_action(self.state, {"type": kind, "revision": self.state["revision"], **kwargs}, actor)

    def open_lot(self):
        self.do("start")
        self.do("nominate", playerId=self.state["players"][0]["id"], amount=10)

    def test_custom_bid_can_jump_by_any_multiple_of_ten(self):
        self.open_lot()
        self.do("bid", {"captainId": self.state["captains"][1]["id"]}, amount=370, lotId=self.state["lot"]["id"])
        self.assertEqual(self.state["lot"]["amount"], 370)
        self.assertEqual(self.state["lot"]["bids"], {
            self.state["captains"][0]["id"]: 10, self.state["captains"][1]["id"]: 370})
        self.do("bid", {"captainId": self.state["captains"][2]["id"]}, amount=400, lotId=self.state["lot"]["id"])
        self.do("bid", {"captainId": self.state["captains"][1]["id"]}, amount=450, lotId=self.state["lot"]["id"])
        self.assertEqual(self.state["lot"]["bids"][self.state["captains"][1]["id"]], 450)
        self.assertEqual(self.state["lot"]["bids"][self.state["captains"][2]["id"]], 400)

    def test_invalid_amounts_and_over_budget_rejected(self):
        self.open_lot()
        for amount in [True, 0, -10, 175, "200", 900, 10]:
            with self.subTest(amount=amount), self.assertRaises(AuctionError):
                self.do("bid", {"captainId": self.state["captains"][1]["id"]}, amount=amount, lotId=self.state["lot"]["id"])

    def test_only_current_captain_can_nominate(self):
        self.do("start")
        with self.assertRaises(AuctionError):
            self.do("nominate", {"captainId": self.state["captains"][1]["id"]}, playerId=self.state["players"][0]["id"], amount=10)
        self.do("nominate", {"captainId": self.state["captains"][0]["id"]}, playerId=self.state["players"][0]["id"], amount=10)

    def test_nomination_requires_explicit_starting_amount(self):
        self.do("start")
        for amount in (None, "", 0, 15):
            with self.subTest(amount=amount), self.assertRaises(AuctionError):
                self.do("nominate", playerId=self.state["players"][0]["id"], amount=amount)

    def test_nomination_order_wraps_to_first_and_repeats_forward(self):
        self.do("start")
        observed = []
        for i in range(14):
            observed.append(self.state["captains"][self.state["turn"]]["name"])
            self.do("nominate", playerId=self.state["players"][i]["id"], amount=10)
            self.do("sold", lotId=self.state["lot"]["id"])
        expected = [c["name"] for c in self.seed["captains"]]
        self.assertEqual(observed, expected + expected[:2])

    def test_captain_cannot_spoof_bidder_or_sell(self):
        self.open_lot()
        actual = self.state["captains"][1]["id"]
        self.do("bid", {"captainId": actual}, captainId=self.state["captains"][3]["id"], amount=50, lotId=self.state["lot"]["id"])
        self.assertEqual(self.state["lot"]["leaderId"], actual)
        with self.assertRaises(AuctionError):
            self.do("sold", {"captainId": actual}, lotId=self.state["lot"]["id"])

    def test_late_bid_and_stale_sale_are_rejected(self):
        self.open_lot()
        stale = {"type": "sold", "revision": self.state["revision"], "lotId": self.state["lot"]["id"]}
        self.do("bid", captainId=self.state["captains"][1]["id"], amount=20, lotId=self.state["lot"]["id"])
        with self.assertRaises(AuctionError):
            apply_action(self.state, stale, HOST)
        self.do("sold", lotId=self.state["lot"]["id"])
        self.do("nominate", playerId=self.state["players"][1]["id"], amount=10)
        with self.assertRaises(AuctionError):
            self.do("bid", captainId=self.state["captains"][1]["id"], amount=40, lotId=stale["lotId"])

    def test_new_bid_resets_calls_and_sale_updates_team(self):
        self.open_lot()
        self.do("call")
        self.do("call")
        winning = self.state["captains"][1]
        budget = winning["budget"]
        self.do("bid", captainId=winning["id"], amount=100, lotId=self.state["lot"]["id"])
        self.assertEqual(self.state["lot"]["call"], 0)
        self.do("sold", lotId=self.state["lot"]["id"])
        self.assertEqual(winning["budget"], budget-100)
        self.assertEqual(len(winning["roster"]), 1)
        self.assertEqual(self.state["players"][0]["status"], "sold")
        self.assertEqual(self.state["turn"], 1)

    def test_paused_and_full_roster_cannot_bid(self):
        self.open_lot()
        self.do("pause")
        with self.assertRaises(AuctionError):
            self.do("bid", captainId=self.state["captains"][1]["id"], amount=20, lotId=self.state["lot"]["id"])
        self.do("pause")
        self.state["captains"][1]["roster"] = [{}] * 6
        with self.assertRaises(AuctionError):
            self.do("bid", captainId=self.state["captains"][1]["id"], amount=20, lotId=self.state["lot"]["id"])

    def test_sheet_add_remove_and_position_change_during_auction(self):
        self.open_lot()
        seed = copy.deepcopy(self.seed)
        removed = seed["players"].pop(1)
        seed["players"][2]["position"] = "FLEX"
        seed["players"].append({"id": "new-player", "name": "A new player", "position": "WR"})
        reconcile_board(self.state, seed)
        self.assertEqual(next(p for p in self.state["players"] if p["id"] == removed["id"])["status"], "removed")
        self.assertEqual(next(p for p in self.state["players"] if p["id"] == "new-player")["status"], "available")
        self.assertEqual(next(p for p in self.state["players"] if p["id"] == seed["players"][2]["id"])["position"], "FLEX")

    def test_removed_active_player_cancels_bidding(self):
        self.open_lot()
        seed = copy.deepcopy(self.seed)
        seed["players"].pop(0)
        reconcile_board(self.state, seed)
        self.assertIsNone(self.state["lot"])
        self.assertEqual(self.state["phase"], "nominating")
        self.assertEqual(self.state["captains"][0]["budget"], self.seed["captains"][0]["budget"])

    def test_sheet_sync_preserves_sale_budget_and_turn_identity(self):
        self.open_lot()
        self.do("sold", lotId=self.state["lot"]["id"])
        turn_id = self.state["captains"][self.state["turn"]]["id"]
        seed = copy.deepcopy(self.seed)
        seed["captains"].reverse()
        seed["captains"][-1]["budget"] = 900
        seed["players"].pop(0)
        reconcile_board(self.state, seed)
        self.assertEqual(self.state["captains"][self.state["turn"]]["id"], turn_id)
        winner = next(c for c in self.state["captains"] if c["id"] == self.seed["captains"][0]["id"])
        self.assertEqual(winner["budget"], self.seed["captains"][0]["budget"]-10)
        self.assertEqual(len(winner["roster"]), 1)
        self.assertEqual(next(p for p in self.state["players"] if p["id"] == self.seed["players"][0]["id"])["status"], "sold")
        self.do("undo")
        self.assertEqual(self.state["captains"][self.state["turn"]]["id"], self.seed["captains"][0]["id"])
        self.assertEqual(next(p for p in self.state["players"] if p["id"] == self.seed["players"][0]["id"])["status"], "removed")

    def test_sheet_cannot_drop_a_captain_with_completed_picks(self):
        self.open_lot()
        self.do("sold", lotId=self.state["lot"]["id"])
        seed = copy.deepcopy(self.seed)
        seed["captains"][0] = {"id":"replacement", "name":"Replacement", "budget":800}
        with self.assertRaises(AuctionError):
            reconcile_board(self.state, seed)

    def test_parser_reads_extra_rows_rejects_duplicates_and_captains_in_pool(self):
        rows = [[""] * 28 for _ in range(50)]
        rows[4][0] = "Captain"
        for i, c in enumerate(self.seed["captains"]):
            rows[4][2+i*2],rows[11][2+i*2] = c["name"],str(c["budget"])
        for col,pos in [(2,"WR"),(10,"LINE"),(18,"FLEX")]:
            rows[19][col] = pos
        rows[20][2], rows[45][10] = "Player A", "Extra row"
        def read():
            out=io.StringIO();csv.writer(out).writerows(rows);return parse_board(out.getvalue())
        self.assertEqual(len(read()["players"]), 2)
        rows[21][18] = "Player A"
        with self.assertRaises(AuctionError):read()
        rows[21][18] = self.seed["captains"][0]["name"]
        with self.assertRaises(AuctionError):read()

    def test_store_serializes_competing_bids_and_keeps_claims_on_reorder(self):
        with tempfile.TemporaryDirectory() as folder:
            store=AuctionStore(Path(folder)/"auction.sqlite",self.seed);store.initialize()
            s=store.state();store.mutate({"type":"start","revision":s["revision"]},HOST)
            s=store.mutate({"type":"nominate","playerId":s["players"][0]["id"],"amount":10},HOST)
            def bid(i):
                try:store.mutate({"type":"bid","lotId":s["lot"]["id"],"amount":400,"captainId":s["captains"][i]["id"]},HOST);return True
                except AuctionError:return False
            with ThreadPoolExecutor(max_workers=2) as executor:
                self.assertEqual(sum(executor.map(bid,[1,2])),1)
            user={"id":"123","username":"first"};store.request_captain(user,s["captains"][0]["id"]);store.approve("123")
            seed=copy.deepcopy(self.seed);seed["captains"].reverse();store.sync_seed(seed)
            self.assertTrue(store.claim(user)["approved"])
            self.assertEqual(store.claim(user)["captain_id"],s["captains"][0]["id"])
            revision=store.state()["revision"];store.sync_seed(seed)
            self.assertEqual(store.state()["revision"],revision)
            self.assertEqual(AuctionStore(store.path,self.seed).state(),store.state())

    def test_private_links_persist_and_replacement_revokes_old_sessions(self):
        with tempfile.TemporaryDirectory() as folder:
            store=AuctionStore(Path(folder)/'auction.sqlite',self.seed);store.initialize()
            links=store.links();self.assertEqual(len(links),12)
            self.assertEqual(len({l['token'] for l in links}),12)
            raw=store.redeem(links[0]['token'])
            self.assertEqual(store.access_session(raw)['captainId'],links[0]['captainId'])
            reopened=AuctionStore(store.path,self.seed);reopened.initialize()
            self.assertEqual(reopened.links(),links)
            self.assertIsNotNone(reopened.access_session(raw))
            reopened.rotate_link(links[0]['captainId'])
            self.assertIsNone(reopened.access_session(raw))
            with self.assertRaises(AuctionError):reopened.redeem(links[0]['token'])
            self.assertEqual(len(reopened.links()),12)

    def test_reset_restores_budgets_and_pool_preserves_links_and_can_be_undone(self):
        with tempfile.TemporaryDirectory() as folder:
            store=AuctionStore(Path(folder)/'auction.sqlite',self.seed);store.initialize()
            links=store.links();raw=store.redeem(links[0]['token']);s=store.state()
            store.mutate({'type':'start','revision':s['revision']},HOST)
            s=store.mutate({'type':'nominate','playerId':s['players'][0]['id'],'amount':100},HOST)
            s=store.mutate({'type':'sold','lotId':s['lot']['id'],'revision':s['revision']},HOST)
            before=copy.deepcopy(s)
            for action in [{'type':'reset','revision':s['revision']},{'type':'reset','revision':0,'confirmation':'RESET'}]:
                with self.assertRaises(AuctionError):store.mutate(action,HOST)
            s=store.mutate({'type':'reset','revision':s['revision'],'confirmation':'RESET'},HOST)
            self.assertEqual(s['phase'],'setup');self.assertEqual(s['turn'],0);self.assertEqual(s['round'],1)
            self.assertEqual(s['sales'],[]);self.assertIsNone(s['lot'])
            self.assertTrue(all(c['budget']==c['startingBudget'] and not c['roster'] for c in s['captains']))
            self.assertTrue(all(p['status']=='available' for p in s['players']))
            self.assertEqual(store.links(),links);self.assertIsNotNone(store.access_session(raw))
            self.assertTrue(store.has_reset_backup())
            restored=store.restore_reset(s['revision'])
            for key in ['sales','captains','players','turn','phase']:self.assertEqual(restored[key],before[key])
            self.assertFalse(store.has_reset_backup())


class AuctionAPITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.t=TournamentServer(None,1,database=Path(self.temp.name)/"test.sqlite",public_origin="https://signup.example.com",secure=False)
        self.t.initialize_database();self.t.admin_ids={"host"}
        self.app=self.t.make_app();self.a=self.t.auction
        self.browser=TestClient(TestServer(self.app),cookie_jar=aiohttp.CookieJar(unsafe=True))
        await self.browser.start_server()

    async def asyncTearDown(self):
        await self.browser.close();self.temp.cleanup()

    def login(self,uid):
        self.t.sessions[hashlib.sha256(uid.encode()).hexdigest()]={"user":{"id":uid,"username":uid},"csrf":"test-csrf","expires":time.time()+3600}
        self.browser.session.cookie_jar.update_cookies({self.t.cookie_name:uid})

    async def post(self,payload,csrf="test-csrf",origin="https://signup.example.com"):
        return await self.browser.post("/auction/api/action",json=payload,headers={"X-CSRF-Token":csrf,"Origin":origin})

    async def test_public_state_exposes_only_game_data_and_anonymous_cannot_mutate(self):
        response=await self.browser.get("/auction/api/state");state=await response.json()
        self.assertNotIn("csrf",state);self.assertNotIn("discord_id",json.dumps(state))
        response=await self.post({"type":"start","revision":0});self.assertEqual(response.status,401)
        self.assertEqual(self.a.store.state()["phase"],"setup")

    async def test_csrf_origin_and_pending_captain_checks(self):
        self.login("player")
        for csrf,origin in [("wrong","https://signup.example.com"),("test-csrf","https://bad.example")]:
            response=await self.post({"type":"claim","captainId":"captain-1"},csrf,origin);self.assertEqual(response.status,403)
        cap=self.a.store.state()["captains"][0]["id"]
        response=await self.post({"type":"claim","captainId":cap});self.assertEqual(response.status,200)
        response=await self.post({"type":"start","revision":0});self.assertEqual(response.status,403)
        self.assertEqual((await (await self.browser.get('/auction/api/me')).json())["role"],"pending")

    async def test_host_approval_and_read_only_websocket(self):
        self.login("player");cap=self.a.store.state()["captains"][0]["id"]
        await self.post({"type":"claim","captainId":cap})
        self.login("host");response=await self.post({"type":"approve","discordId":"player"});self.assertEqual(response.status,200)
        ws=await self.browser.ws_connect('/auction/live',headers={"Origin":"https://signup.example.com"})
        self.assertEqual((await ws.receive_json())["phase"],"setup")
        await ws.send_json({"type":"start","revision":0})
        await self.post({"type":"start","revision":0})
        self.assertEqual((await ws.receive_json())["phase"],"nominating")
        self.login("player");self.assertEqual((await (await self.browser.get('/auction/api/me')).json())["role"],"captain")
        await ws.close()

    async def test_discord_login_identify_only_and_eight_hour_session(self):
        self.t.client_id="id";self.t.client_secret="secret";self.t.client=FakeDiscordHTTP();self.t.client.scope="identify"
        response=await self.browser.get('/auction/login?view=host',allow_redirects=False)
        params=parse_qs(urlparse(response.headers['Location']).query)
        self.assertEqual(params['scope'],['identify'])
        response=await self.browser.get('/auth/discord/callback',params={"state":params['state'][0],"code":"code"},allow_redirects=False)
        self.assertEqual(response.headers['Location'],'/auction/host')
        session=next(iter(self.t.sessions.values()))
        self.assertGreater(session['expires']-time.time(),AUCTION_SESSION_TTL-5)
        self.assertNotIn('access_token',session);self.assertEqual(self.t.client.joins,[])
        self.assertEqual(len(self.t.client.revoked),1)

    async def test_invalid_sync_retains_last_valid_state(self):
        class BadHTTP:
            def get(self,*args,**kwargs):raise OSError('offline')
        self.t.client=BadHTTP();before=self.a.store.state()
        with self.assertRaises(AuctionError):await self.a.sync_board()
        self.assertEqual(self.a.store.state(),before)
        self.assertIsNotNone(self.a.sync_status['error'])

    async def test_export_host_only_and_assets_have_csp(self):
        response=await self.browser.get('/auction/export.csv');self.assertEqual(response.status,401)
        for path in ['/auction/captain','/auction/host','/auction/stream','/auction/assets/app.js','/auction/assets/style.css']:
            response=await self.browser.get(path);self.assertEqual(response.status,200)
            self.assertIn("script-src 'self'",response.headers['Content-Security-Policy'])

    async def enter_link(self,index=0):
        link=self.a.store.links()[index]
        response=await self.browser.post('/auction/api/enter',json={'key':link['token']},headers={'Origin':self.t.public_origin})
        self.assertEqual(response.status,200)
        self.assertTrue(response.cookies[self.a.access_cookie]['httponly'])
        self.assertEqual(response.cookies[self.a.access_cookie]['samesite'],'Lax')
        return await (await self.browser.get('/auction/api/me')).json()

    async def test_link_entry_assigns_one_captain_without_discord_and_keeps_host_controls_private(self):
        me=await self.enter_link(1);self.assertEqual(me['role'],'captain');self.assertEqual(me['access'],'private-link')
        self.assertEqual(me['captainId'],self.a.store.links()[1]['captainId'])
        self.assertNotIn('captainLinks',me);self.assertEqual(self.t.sessions,{})
        state=self.a.store.state()
        for kind in ['start','reset','rotate_link','approve','restore_reset','sync']:
            response=await self.post({'type':kind,'revision':state['revision'],'confirmation':'RESET','captainId':me['captainId']},csrf=me['csrf'])
            self.assertEqual(response.status,403,kind)
        self.assertEqual(self.a.store.state(),state)

    async def test_links_only_appear_in_host_me_and_bad_links_origins_are_rejected(self):
        links=self.a.store.links()
        for path in ['/auction/api/state','/auction/api/me']:
            text=await (await self.browser.get(path)).text()
            self.assertTrue(all(l['token'] not in text for l in links))
        for origin,key in [('https://bad.example',links[0]['token']),(self.t.public_origin,'invalid')]:
            response=await self.browser.post('/auction/api/enter',json={'key':key},headers={'Origin':origin})
            self.assertIn(response.status,[401,403])
        self.login('host');me=await (await self.browser.get('/auction/api/me')).json()
        self.assertEqual(len(me['captainLinks']),12)
        self.assertTrue(all('#key=' in l['url'] for l in me['captainLinks']))

    async def test_link_bid_is_bound_to_its_qb_and_resets_every_call(self):
        self.a.store.mutate({'type':'start','revision':0},HOST)
        s=self.a.store.state();s=self.a.store.mutate({'type':'nominate','playerId':s['players'][0]['id'],'amount':10},HOST)
        me=await self.enter_link(1)
        for count in range(1,4):
            self.a.store.mutate({'type':'call','revision':self.a.store.state()['revision']},HOST)
        response=await self.post({'type':'bid','lotId':s['lot']['id'],'captainId':s['captains'][4]['id'],'amount':100},csrf=me['csrf'])
        self.assertEqual(response.status,200);s=await response.json()
        self.assertEqual(s['lot']['leaderId'],me['captainId']);self.assertEqual(s['lot']['call'],0)
        response=await self.post({'type':'bid','lotId':s['lot']['id'],'amount':110},csrf='wrong')
        self.assertEqual(response.status,403)
        self.a.store.mutate({'type':'call','revision':s['revision']},HOST)
        self.assertEqual(self.a.store.state()['lot']['call'],1)

    async def test_presence_wakes_only_authenticated_captain_and_sleeps_after_last_connection(self):
        viewer=await self.browser.ws_connect('/auction/live',headers={'Origin':self.t.public_origin})
        initial=await viewer.receive_json();self.assertTrue(all(not p['online'] for p in initial['presence'].values()))
        me=await self.enter_link(0);cap=me['captainId']
        first=await self.browser.ws_connect('/auction/live',headers={'Origin':self.t.public_origin})
        self.assertTrue((await first.receive_json())['presence'][cap]['online'])
        self.assertTrue((await viewer.receive_json())['presence'][cap]['online'])
        second=await self.browser.ws_connect('/auction/live',headers={'Origin':self.t.public_origin})
        self.assertTrue((await second.receive_json())['presence'][cap]['online'])
        await first.close();await second.close()
        final=await (await self.browser.get('/auction/api/state')).json()
        self.assertFalse(final['presence'][cap]['online'])
        self.assertIsNotNone(final['presence'][cap]['lastSeen'])
        await viewer.close()

    async def test_host_can_replace_private_link_but_old_cookie_loses_access(self):
        link=self.a.store.links()[0];await self.enter_link(0)
        self.login('host');response=await self.post({'type':'rotate_link','captainId':link['captainId']})
        self.assertEqual(response.status,200)
        self.browser.session.cookie_jar.clear()
        response=await self.browser.post('/auction/api/enter',json={'key':link['token']},headers={'Origin':self.t.public_origin})
        self.assertEqual(response.status,401)

    async def test_replacing_link_disconnects_its_live_socket_and_removes_presence(self):
        me=await self.enter_link(0);cap=me['captainId']
        ws=await self.browser.ws_connect('/auction/live',headers={'Origin':self.t.public_origin})
        self.assertTrue((await ws.receive_json())['presence'][cap]['online'])
        self.login('host')
        replacing=asyncio.create_task(self.post({'type':'rotate_link','captainId':cap}))
        await ws.receive(timeout=3)
        await ws.close()
        self.assertEqual((await replacing).status,200)
        state=await (await self.browser.get('/auction/api/state')).json()
        self.assertFalse(state['presence'][cap]['online'])


if __name__=='__main__':unittest.main()
