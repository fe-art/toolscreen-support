import logging
import asyncio
import sqlite3
from pathlib import Path

import discord
from discord import app_commands
import yaml

import troubleshoot

log = logging.getLogger("toolscreen-bot")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

ROOT = Path(__file__).resolve().parent
config = yaml.safe_load(open(ROOT / "config.yaml", encoding="utf-8"))

BOT_TOKEN: str = config["bot_token"]
WATCHED: set[int] = set(config.get("watched_channel_ids", []))
TRIAGE_DELAY: int = config.get("triage_delay_seconds", 2)
TAG_BUG: str = config.get("bug_tag_name", "Bug").lower()
TAG_ONGOING: str = config.get("ongoing_tag_name", "Ongoing").lower()
DEV_ROLE_ID: int = config.get("dev_role_id", 0)

DEFAULT_TRIAGE = """\
Hey @MENTION, before filling this out, check <#1475303077342085121> — your issue might already be covered there!

If it's not, please fill in what you can:

OS: (e.g. Windows 10, Windows 11)
Toolscreen version:
Minecraft version:
Launcher + version: (e.g. MultiMC 0.7.0, Prism 8.0)
Java version: (run `java -version`)
GPU: (e.g. NVIDIA RTX 3060, AMD RX 6700 XT)
Display mode: Fullscreen / Windowed / Borderless
What happened: (steps to reproduce + what you expected vs what you got)
Full launcher log: (Edit Instance > Minecraft Log, not `latest.log`)

Optional: other mods installed, injector.log, screenshot/video, your config (`!config`)

Toolscreen requires fullscreen to work. If nothing shows up after install, try F11 first."""

DB = ROOT / "bot.db"
_conn = sqlite3.connect(DB)
_conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
_conn.commit()


def db_get(key: str, default: str | None = None) -> str | None:
    row = _conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def db_set(key: str, value: str):
    _conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))
    _conn.commit()



def find_tag(channel: discord.ForumChannel, name: str) -> discord.ForumTag | None:
    return next((t for t in channel.available_tags if t.name.lower() == name), None)


def has_tag(thread: discord.Thread, name: str) -> bool:
    return any(t.name.lower() == name for t in thread.applied_tags)


async def set_tag(thread: discord.Thread, tag: discord.ForumTag) -> bool:
    if tag.id in {t.id for t in thread.applied_tags}:
        return False
    tags = (list(thread.applied_tags) + [tag])[:5]
    try:
        await thread.edit(applied_tags=tags)
        return True
    except discord.HTTPException as e:
        log.error("Tag add failed on %s: %s", thread.id, e)
        return False


intents = discord.Intents.default()
intents.guilds = True
intents.guild_messages = True

client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)
troubleshoot.load_tree()
troubleshoot.setup(client, tree)


def _has_dev_role(interaction: discord.Interaction) -> bool:
    if not DEV_ROLE_ID or not interaction.guild:
        return False
    return any(r.id == DEV_ROLE_ID for r in interaction.user.roles)


@tree.command(name="bugform", description="Set the bug triage message")
@app_commands.describe(message="New message (use \\n for newlines)")
async def cmd_bugform(interaction: discord.Interaction, message: str):
    if not _has_dev_role(interaction):
        await interaction.response.send_message("Missing permissions.", ephemeral=True)
        return
    text = message.replace("\\n", "\n")
    db_set("triage_message", text)
    log.info("Triage updated by %s", interaction.user)
    await interaction.response.send_message(f"Updated.\n>>> {text[:500]}", ephemeral=True)


@tree.command(name="bugform-reset", description="Reset bug triage to default")
async def cmd_bugform_reset(interaction: discord.Interaction):
    if not _has_dev_role(interaction):
        await interaction.response.send_message("Missing permissions.", ephemeral=True)
        return
    db_set("triage_message", DEFAULT_TRIAGE)
    log.info("Triage reset by %s", interaction.user)
    await interaction.response.send_message("Reset to default.", ephemeral=True)


@client.event
async def on_ready():
    log.info("Online as %s", client.user)
    cmds = await tree.sync()
    log.info("Synced %d global commands", len(cmds))


@client.event
async def on_thread_create(thread: discord.Thread):
    if thread.parent_id not in WATCHED:
        return

    parent = thread.parent
    if not isinstance(parent, discord.ForumChannel):
        return

    ongoing = find_tag(parent, TAG_ONGOING)
    if ongoing:
        await set_tag(thread, ongoing)

    if not has_tag(thread, TAG_BUG):
        return

    await asyncio.sleep(TRIAGE_DELAY)
    msg = db_get("triage_message", DEFAULT_TRIAGE).replace("@MENTION", f"<@{thread.owner_id}>")
    try:
        await thread.send(msg)
    except discord.HTTPException as e:
        log.error("Triage send failed on %s: %s", thread.id, e)



if __name__ == "__main__":
    client.run(BOT_TOKEN, log_handler=None)
