import os
from typing import Optional

import aiohttp
import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GFA_GUILD_ID", "0"))
DATA_URL = os.getenv("GFA_DATA_URL", "https://officialgfa.com/data.json")
CHAMPIONS_URL = os.getenv("GFA_CHAMPIONS_URL", "https://officialgfa.com/champions.json")
SITE_URL = "https://officialgfa.com"

SEASON_CHOICES = [app_commands.Choice(name=f"Season {season}", value=str(season)) for season in range(1, 5)]
SEASON_OR_CAREER_CHOICES = SEASON_CHOICES + [app_commands.Choice(name="Career · Seasons 1–4", value="all")]
CATEGORY_CHOICES = [
    app_commands.Choice(name="Passing", value="passing"),
    app_commands.Choice(name="Receiving", value="receiving"),
    app_commands.Choice(name="Rushing", value="rushing"),
    app_commands.Choice(name="Defense", value="defense"),
    app_commands.Choice(name="Blocking", value="blocking"),
]
VIEW_CHOICES = [
    app_commands.Choice(name="Overall", value="overall"),
    app_commands.Choice(name="AFC", value="afc"),
    app_commands.Choice(name="NFC", value="nfc"),
]

STAT_COLUMNS = {
    "passing": ["Games Played", "Comp %", "Completions", "Attempts", "Pass Yards", "Pass TDs", "Pass INTs"],
    "receiving": ["Games Played", "Receptions", "Rec Yards", "Rec TDs"],
    "rushing": ["Games Played", "Rush Yards", "Rush TDs"],
    "defense": ["Games Played", "Tackles", "Sacks", "INTs", "Safeties", "Other TDs"],
    "blocking": ["Games Played", "Blocks"],
}
PRIMARY_STAT = {"passing": "Pass Yards", "receiving": "Rec Yards", "rushing": "Rush Yards", "defense": "Sacks", "blocking": "Blocks"}

bot = commands.Bot(command_prefix="!", intents=discord.Intents.default())
cache: dict[str, object] = {}


async def get_json(url: str):
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=20) as response:
            response.raise_for_status()
            return await response.json()


async def data() -> dict:
    if "data" not in cache:
        cache["data"] = await get_json(DATA_URL)
    return cache["data"]


async def champions_data() -> list[dict]:
    if "champions" not in cache:
        cache["champions"] = await get_json(CHAMPIONS_URL)
    return cache["champions"]


def number(value) -> float:
    try:
        return float(str(value).replace(",", "").replace("—", "0") or 0)
    except (TypeError, ValueError):
        return 0


def stat_value(value, key: str = "") -> str:
    if value is None or value == "" or value == "—":
        return "—"
    if key == "Comp %":
        percentage = number(value)
        if 0 <= percentage <= 1.01:
            percentage *= 100
        return f"{percentage:.1f}%"
    if isinstance(value, str):
        value = value.replace(",", "")
    return f"{round(number(value)):,}"


def season_label(value: str) -> str:
    return "Career · Seasons 1–4" if value == "all" else f"Season {value}"


def clean_name(value: str) -> str:
    return " ".join(str(value).lower().replace("-", " ").split())


def logo_url(team: str, d: dict) -> Optional[str]:
    src = d.get("logos", {}).get(team)
    if not src:
        return None
    return src if str(src).startswith("http") else f"{SITE_URL}/{str(src).lstrip('/')}"


def embed(title: str, description: str = "", color: int = 0xD71920) -> discord.Embed:
    card = discord.Embed(title=title, description=description, color=color)
    card.set_footer(text="GFA · Gridiron Football Association")
    return card


def team_rows(d: dict, season: str) -> list[dict]:
    return d.get("standings", {}).get(str(season), [])


def player_rows(d: dict, season: str) -> list[dict]:
    return d.get("players", {}).get(str(season), [])


def find_team(d: dict, season: str, query: str) -> Optional[str]:
    query_key = clean_name(query)
    teams = [str(row.get("team", "")) for row in team_rows(d, season)]
    if query_key in {clean_name(team) for team in teams}:
        return next(team for team in teams if clean_name(team) == query_key)
    for team in teams:
        if query_key in clean_name(team) or clean_name(team) in query_key:
            return team
    return None


def roster_for_team(d: dict, season: str, team: str) -> list[dict]:
    if str(season) == "4":
        rosters = d.get("rosters4", {})
        roster_key = next((key for key in rosters if clean_name(key) in clean_name(team) or clean_name(team) in clean_name(key)), None)
        return [{"pos": pos, "name": name} for name, pos in rosters.get(roster_key, {}).items()] if roster_key else []
    return d.get("rosters", {}).get(str(season), {}).get(team, [])


def roster_lines(roster: list[dict]) -> str:
    return "\n".join(f"`{row.get('pos', '—'):>5}`  {row.get('name', '—')}" for row in roster)


def player_matches(d: dict, query: str) -> list[dict]:
    key = clean_name(query)
    rows = d.get("players", {}).get("all", [])
    exact = [row for row in rows if clean_name(row.get("Player Name", "")) == key]
    return exact or [row for row in rows if key in clean_name(row.get("Player Name", ""))]


async def team_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    d = await data()
    season = str(getattr(interaction.namespace, "season", "4"))
    if hasattr(season, "value"):
        season = season.value
    teams = [row.get("team", "") for row in team_rows(d, season)]
    query = clean_name(current)
    return [app_commands.Choice(name=team, value=team) for team in teams if not query or query in clean_name(team)][:25]


async def player_autocomplete(interaction: discord.Interaction, current: str) -> list[app_commands.Choice[str]]:
    d = await data()
    query = clean_name(current)
    names = []
    for row in d.get("players", {}).get("all", []):
        name = row.get("Player Name", "")
        if name and (not query or query in clean_name(name)) and name not in names:
            names.append(name)
    return [app_commands.Choice(name=name, value=name) for name in names[:25]]


@bot.event
async def on_ready():
    guild = discord.Object(id=GUILD_ID) if GUILD_ID else None
    try:
        if guild:
            bot.tree.copy_global_to(guild=guild)
            await bot.tree.sync(guild=guild)
            print(f"GFA commands synced to guild {GUILD_ID}")
        else:
            await bot.tree.sync()
            print("GFA global commands synced")
        print(f"Logged in as {bot.user}")
    except discord.Forbidden:
        print("GFA bot is online, but it cannot access GFA_GUILD_ID. Check that the bot is invited to that server.")


@bot.tree.command(name="standings", description="View GFA standings by season and conference")
@app_commands.choices(season=SEASON_CHOICES, view=VIEW_CHOICES)
async def standings(interaction: discord.Interaction, season: app_commands.Choice[str], view: app_commands.Choice[str]):
    d = await data()
    rows = team_rows(d, season.value)
    if view.value in {"afc", "nfc"}:
        rows = [row for row in rows if str(row.get("conf", "")).lower() == view.value]
    rows = sorted(rows, key=lambda row: number(row.get("w")) / (number(row.get("w")) + number(row.get("l")) or 1), reverse=True)
    card = embed(f"GFA {season_label(season.value)} Standings", f"{view.name} · {len(rows)} teams")
    for index, row in enumerate(rows, 1):
        card.add_field(name=f"{index:02d} · {row.get('team', 'Unknown')}", value=f"**{stat_value(row.get('w'))}–{stat_value(row.get('l'))}**  ·  PF {stat_value(row.get('pf'))}  ·  PA {stat_value(row.get('pa'))}  ·  PD {stat_value(row.get('pd'))}", inline=False)
    await interaction.response.send_message(embed=card)


@bot.tree.command(name="stats", description="View GFA leaders or a player's season stats")
@app_commands.describe(player="Optional: choose a player to view their full stat line")
@app_commands.choices(season=SEASON_OR_CAREER_CHOICES, category=CATEGORY_CHOICES)
@app_commands.autocomplete(player=player_autocomplete)
async def stats(interaction: discord.Interaction, season: app_commands.Choice[str], category: app_commands.Choice[str], player: Optional[str] = None):
    d = await data()
    rows = player_rows(d, season.value) if season.value != "all" else d.get("players", {}).get("all", [])
    columns = STAT_COLUMNS[category.value]
    primary = PRIMARY_STAT[category.value]
    card = embed(f"GFA {season_label(season.value)} {category.name}", f"Sorted by {primary}")
    if player:
        matches = player_matches(d, player)
        if season.value != "all":
            matches = [row for row in matches if row in rows]
        if not matches:
            return await interaction.response.send_message("That player has no recorded stats for this selection.", ephemeral=True)
        row = matches[0]
        card.title = f"{row.get('Player Name', player)} · {season_label(season.value)}"
        card.description = f"{row.get('Team', 'Team not recorded')} · {row.get('POS', 'Position not recorded')}"
        card.add_field(name="STAT LINE", value="\n".join(f"**{key}:** {stat_value(row.get(key), key)}" for key in columns), inline=False)
    else:
        rows = sorted(rows, key=lambda row: number(row.get(primary)), reverse=True)
        for index, row in enumerate(rows[:10], 1):
            card.add_field(name=f"{index:02d} · {row.get('Player Name', 'Unknown')}", value=f"{row.get('Team', 'Team not recorded')} · **{stat_value(row.get(primary), primary)} {primary.lower()}**", inline=False)
    await interaction.response.send_message(embed=card)


@bot.tree.command(name="roster", description="View the complete roster for a GFA team")
@app_commands.describe(team="Choose a team from the selected season")
@app_commands.choices(season=SEASON_CHOICES)
@app_commands.autocomplete(team=team_autocomplete)
async def roster(interaction: discord.Interaction, season: app_commands.Choice[str], team: str):
    d = await data()
    selected = find_team(d, season.value, team)
    if not selected:
        return await interaction.response.send_message("That team was not found in the selected season.", ephemeral=True)
    roster = roster_for_team(d, season.value, selected)
    if not roster:
        return await interaction.response.send_message("No roster is recorded for that team in this season.", ephemeral=True)
    card = embed(f"{selected} · {season_label(season.value)} Roster", f"{len(roster)} players recorded")
    card.description = roster_lines(roster)
    logo = logo_url(selected, d)
    if logo:
        card.set_thumbnail(url=logo)
    await interaction.response.send_message(embed=card)


@bot.tree.command(name="champions", description="Choose a season to view its champion and championship roster")
@app_commands.choices(season=SEASON_CHOICES)
async def champions(interaction: discord.Interaction, season: app_commands.Choice[str]):
    d = await data()
    rows = await champions_data()
    champion = next((row for row in rows if str(row.get("season")) == season.value), None)
    if not champion:
        return await interaction.response.send_message("No champion is recorded for that season yet.", ephemeral=True)
    roster = champion.get("roster", [])
    card = embed(f"{season_label(season.value)} Champion", champion.get("team", "Champion"), 0xC9A227)
    card.add_field(name="CHAMPIONSHIP ROSTER", value="\n".join(f"`{pos:>5}`  {name}" for pos, name in roster) or "Roster not recorded", inline=False)
    logo = logo_url(champion.get("team", ""), d)
    if logo:
        card.set_thumbnail(url=logo)
    await interaction.response.send_message(embed=card)


@bot.tree.command(name="player", description="Open a complete GFA player profile")
@app_commands.describe(player="Choose a player", season="Optional: filter the profile to one season")
@app_commands.choices(season=SEASON_OR_CAREER_CHOICES)
@app_commands.autocomplete(player=player_autocomplete)
async def player(interaction: discord.Interaction, player: str, season: Optional[app_commands.Choice[str]] = None):
    d = await data()
    matches = player_matches(d, player)
    if not matches:
        return await interaction.response.send_message("Player not found in the GFA archive.", ephemeral=True)
    selected = matches[0]
    season_value = season.value if season else "all"
    rows = player_rows(d, season_value) if season_value != "all" else d.get("players", {}).get("all", [])
    rows = [row for row in rows if clean_name(row.get("Player Name", "")) == clean_name(selected.get("Player Name", ""))]
    if not rows:
        return await interaction.response.send_message("That player has no stats for the selected season.", ephemeral=True)
    card = embed(f"{selected.get('Player Name', player)} · Player Profile", f"{season_label(season_value)}")
    for row in rows[:10]:
        keys = STAT_COLUMNS["passing"] + ["Rec Yards", "Rush Yards", "Tackles", "Sacks", "INTs", "Other TDs"]
        card.add_field(name=f"{row.get('Team', 'Team not recorded')} · {row.get('POS', '—')}", value="\n".join(f"**{key}:** {stat_value(row.get(key), key)}" for key in keys), inline=False)
    await interaction.response.send_message(embed=card)


@bot.tree.command(name="team", description="View a team's record, roster and season stats")
@app_commands.describe(team="Choose a team from the selected season")
@app_commands.choices(season=SEASON_CHOICES)
@app_commands.autocomplete(team=team_autocomplete)
async def team(interaction: discord.Interaction, season: app_commands.Choice[str], team: str):
    d = await data()
    selected = find_team(d, season.value, team)
    row = next((item for item in team_rows(d, season.value) if item.get("team") == selected), None)
    if not row:
        return await interaction.response.send_message("That team was not found in the selected season.", ephemeral=True)
    roster = roster_for_team(d, season.value, selected)
    team_players = [item for item in player_rows(d, season.value) if clean_name(item.get("Team", "")) in clean_name(selected) or clean_name(selected) in clean_name(item.get("Team", ""))]
    card = embed(f"{selected} · {season_label(season.value)}", "Team overview")
    card.add_field(name="RECORD", value=f"**{stat_value(row.get('w'))}–{stat_value(row.get('l'))}**\nPF {stat_value(row.get('pf'))} · PA {stat_value(row.get('pa'))} · PD {stat_value(row.get('pd'))}", inline=True)
    card.add_field(name="ROSTER", value=f"{len(roster)} players recorded", inline=True)
    leaders = sorted(team_players, key=lambda item: number(item.get("Pass Yards")) + number(item.get("Rec Yards")), reverse=True)[:3]
    card.add_field(name="TEAM LEADERS", value="\n".join(f"{item.get('Player Name')} · {stat_value(item.get('Pass Yards'))} pass yds / {stat_value(item.get('Rec Yards'))} rec yds" for item in leaders) or "No player stats recorded", inline=False)
    logo = logo_url(selected, d)
    if logo:
        card.set_thumbnail(url=logo)
    await interaction.response.send_message(embed=card)


@bot.tree.command(name="help", description="Show all GFA bot commands")
async def help_command(interaction: discord.Interaction):
    card = embed("GFA Official Bot", "Use the dropdown options inside each command—no memorizing categories or season numbers.")
    card.add_field(name="LEAGUE", value="`/standings` · `/champions` · `/team`", inline=False)
    card.add_field(name="PLAYERS", value="`/stats` · `/player` · `/roster`", inline=False)
    card.add_field(name="WEBSITE", value="[officialgfa.com](https://officialgfa.com)", inline=False)
    await interaction.response.send_message(embed=card)


if not TOKEN:
    raise RuntimeError("Set DISCORD_TOKEN before starting the bot.")

bot.run(TOKEN)
