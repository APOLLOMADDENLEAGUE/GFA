import os
import aiohttp
import discord
from dotenv import load_dotenv
from discord.ext import commands

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GFA_GUILD_ID", "0"))
DATA_URL = os.getenv("GFA_DATA_URL", "https://officialgfa.com/data.json")
CHAMPIONS_URL = os.getenv("GFA_CHAMPIONS_URL", "https://officialgfa.com/champions.json")
bot = commands.Bot(command_prefix="!", intents=discord.Intents.default())
cache = {}

async def get_json(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=20) as response:
            response.raise_for_status()
            return await response.json()

async def data():
    if not cache.get("data"):
        cache["data"] = await get_json(DATA_URL)
    return cache["data"]

def number(value):
    try:
        return float(str(value).replace(",", "").replace("—", "0") or 0)
    except ValueError:
        return 0

@bot.event
async def on_ready():
    guild = discord.Object(id=GUILD_ID) if GUILD_ID else None
    if guild:
        bot.tree.copy_global_to(guild=guild)
        await bot.tree.sync(guild=guild)
    else:
        await bot.tree.sync()
    print(f"Logged in as {bot.user}")

@bot.tree.command(name="standings", description="Show GFA standings")
async def standings(interaction: discord.Interaction, season: int):
    rows = (await data()).get("standings", {}).get(str(season), [])
    if not rows:
        return await interaction.response.send_message("That season was not found.", ephemeral=True)
    lines = [f"**{i}. {r['team']} — {r['w']}-{r['l']} | PF {r['pf']} | PA {r['pa']} | PD {r['pd']}**" for i, r in enumerate(rows, 1)]
    await interaction.response.send_message(f"**GFA SEASON {season} STANDINGS**\n" + "\n".join(lines[:25]))

@bot.tree.command(name="stats", description="Show GFA statistical leaders")
async def stats(interaction: discord.Interaction, season: str, category: str):
    d = await data()
    rows = d.get("players", {}).get(str(season).replace("Season ", ""), [])
    fields = {"passing": "Pass Yards", "receiving": "Rec Yards", "rushing": "Rush Yards", "defense": "Sacks", "blocking": "Blocks"}
    field = fields.get(category.lower())
    if not field:
        return await interaction.response.send_message("Use passing, receiving, rushing, defense, or blocking.", ephemeral=True)
    rows = sorted(rows, key=lambda p: number(p.get(field)), reverse=True)
    lines = [f"**{i}. {p['Player Name']} — {p.get(field, '—')} {field.lower()}**" for i, p in enumerate(rows[:10], 1)]
    await interaction.response.send_message(f"**GFA {season.upper()} {category.upper()} LEADERS**\n" + "\n".join(lines))

@bot.tree.command(name="roster", description="Show a GFA team roster")
async def roster(interaction: discord.Interaction, season: int, team: str):
    d = await data()
    if season == 4:
        lookup = next((k for k in d.get("rosters4", {}) if k.lower() in team.lower() or team.lower() in k.lower()), None)
        players = [{"name": n, "pos": p} for n, p in d.get("rosters4", {}).get(lookup, {}).items()] if lookup else []
    else:
        rosters = d.get("rosters", {}).get(str(season), {})
        lookup = next((k for k in rosters if k.lower() == team.lower()), team)
        players = rosters.get(lookup, [])
    if not players:
        return await interaction.response.send_message("That roster was not found.", ephemeral=True)
    text = "\n".join(f"**{p.get('pos', '')}** — {p.get('name', '')}" for p in players)
    await interaction.response.send_message(f"**GFA SEASON {season} — {lookup}**\n{text}")

@bot.tree.command(name="player", description="Look up a GFA player")
async def player(interaction: discord.Interaction, name: str):
    rows = (await data()).get("players", {}).get("all", [])
    p = next((x for x in rows if x.get("Player Name", "").lower() == name.lower()), None)
    if not p:
        return await interaction.response.send_message("Player not found.", ephemeral=True)
    await interaction.response.send_message(f"**{p['Player Name']}** ({p.get('POS', '—')})\nGames: {p.get('Games Played', '—')}\nPass yards: {p.get('Pass Yards', '—')}\nRec yards: {p.get('Rec Yards', '—')}\nRush yards: {p.get('Rush Yards', '—')}\nSacks: {p.get('Sacks', '—')} | INTs: {p.get('INTs', '—')}")

@bot.tree.command(name="champions", description="Show GFA champions")
async def champions(interaction: discord.Interaction):
    rows = await get_json(CHAMPIONS_URL)
    lines = [f"**Season {r.get('season')}: {r.get('team', 'Champion')}**" for r in rows] if isinstance(rows, list) else ["Champion archive is available on the website."]
    await interaction.response.send_message("\n".join(lines[:20]))

if not TOKEN:
    raise RuntimeError("Set DISCORD_TOKEN before starting the bot.")
bot.run(TOKEN)
