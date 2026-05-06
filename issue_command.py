"""Data-driven /issue command for helpers to send troubleshooting replies."""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import discord
from discord import app_commands
import yaml

log = logging.getLogger("toolscreen-bot")

ROOT = Path(__file__).resolve().parent
REPLIES_PATH = ROOT / "quick_replies.yaml"


@dataclass
class Issue:
    id: str
    title: str
    reply: str


_issues: list[Issue] = []


def load_issues():
    global _issues
    raw = yaml.safe_load(REPLIES_PATH.read_text(encoding="utf-8")) or {}
    _issues = []
    for entry in raw.get("rules", []):
        if not entry.get("listed", True):
            continue
        _issues.append(Issue(
            id=entry["id"],
            title=entry.get("title", entry["id"]),
            reply=entry["reply"].strip(),
        ))
    log.info("Loaded %d issues for /issue command", len(_issues))


def setup(client: discord.Client, tree: app_commands.CommandTree):
    load_issues()

    @tree.command(name="issue", description="Send a troubleshooting reply")
    @app_commands.describe(
        topic="The issue to look up",
        mention="User to ping with the response",
    )
    async def cmd_issue(
        interaction: discord.Interaction,
        topic: str,
        mention: Optional[discord.Member] = None,
    ):
        entry = next((i for i in _issues if i.id == topic), None)
        if not entry:
            await interaction.response.send_message(
                f"Unknown issue `{topic}`.", ephemeral=True
            )
            return

        text = entry.reply
        if mention:
            text = f"{mention.mention}\n{text}"
        await interaction.response.send_message(text)

    @cmd_issue.autocomplete("topic")
    async def topic_autocomplete(
        interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        current_lower = current.lower()
        results = []
        for issue in _issues:
            if current_lower in issue.id.lower() or current_lower in issue.title.lower():
                results.append(app_commands.Choice(name=issue.title, value=issue.id))
            if len(results) >= 25:
                break
        return results
