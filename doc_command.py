"""Data-driven /doc command that sends curated help snippets."""

import logging
from pathlib import Path
from typing import Optional

import discord
from discord import app_commands
import yaml

log = logging.getLogger("toolscreen-bot")

ROOT = Path(__file__).resolve().parent
DOCS_PATH = ROOT / "docs.yaml"

_topics: dict[str, dict] = {}


def load_docs():
    global _topics
    raw = yaml.safe_load(DOCS_PATH.read_text(encoding="utf-8")) or {}
    _topics = raw
    log.info("Loaded %d doc topics", len(_topics))


def setup(client: discord.Client, tree: app_commands.CommandTree):
    load_docs()

    @tree.command(name="doc", description="Send a documentation snippet on a topic")
    @app_commands.describe(
        topic="The topic to look up",
        mention="User to ping with the response",
    )
    async def cmd_doc(
        interaction: discord.Interaction,
        topic: str,
        mention: Optional[discord.Member] = None,
    ):
        entry = _topics.get(topic)
        if not entry:
            await interaction.response.send_message(
                f"Unknown topic `{topic}`.", ephemeral=True
            )
            return

        description = entry.get("summary", "").strip()
        video_url = entry.get("video_url")
        if video_url:
            description += f"\n\n**Video:** {video_url}"

        embed = discord.Embed(
            title=entry.get("title", topic),
            description=description,
            color=discord.Color.blue(),
        )

        content = mention.mention if mention else None
        await interaction.response.send_message(content=content, embed=embed)

    @cmd_doc.autocomplete("topic")
    async def topic_autocomplete(
        interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        current_lower = current.lower()
        results = []
        for key, entry in _topics.items():
            title = entry.get("title", key)
            if current_lower in key.lower() or current_lower in title.lower():
                results.append(app_commands.Choice(name=title, value=key))
            if len(results) >= 25:
                break
        return results
