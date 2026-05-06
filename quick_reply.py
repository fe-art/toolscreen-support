"""Pattern-matched quick replies for #help.
Also runs OCR on image attachments to catch screenshots.
"""

import asyncio
import io
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import discord
import yaml

log = logging.getLogger("toolscreen-bot")
ROOT = Path(__file__).resolve().parent

COOLDOWN_SECONDS = 600

try:
    from PIL import Image
    import pytesseract
    _ocr_available = True
except ImportError:
    _ocr_available = False


@dataclass
class Rule:
    id: str
    patterns: list[str]
    reply: str
    max_length: int = 0


_rules: list[Rule] = []
_help_channel_id: int = 0
_cooldown: dict[tuple[int, str], float] = {}


def setup(config: dict) -> None:
    global _help_channel_id
    _help_channel_id = int(config.get("help_channel_id", 0))

    path = ROOT / "quick_replies.yaml"
    if not path.exists():
        log.warning("quick_replies.yaml not found – quick replies disabled")
        return

    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    skipped = 0
    for entry in data.get("rules", []):
        if entry.get("disabled"):
            skipped += 1
            continue
        _rules.append(Rule(
            id=entry["id"],
            patterns=[p.lower() for p in entry["patterns"]],
            reply=entry["reply"].strip().format_map(config),
            max_length=entry.get("max_length", 0),
        ))
    log.info("Loaded %d quick-reply rules (%d disabled)  ocr=%s", len(_rules), skipped, _ocr_available)


async def match(message: discord.Message) -> Rule | None:
    if not _rules:
        return None
    if message.channel.id != _help_channel_id:
        return None
    if message.author.bot:
        return None
    if message.reference is not None:
        return None

    text = message.content.lower()

    if _ocr_available:
        ocr_text = await _ocr_attachments(message)
        if ocr_text:
            text = f"{text} {ocr_text}"

    now = time.monotonic()
    _evict_cooldowns(now)
    for rule in _rules:
        if rule.max_length and len(message.content) > rule.max_length:
            continue
        if any(p in text for p in rule.patterns):
            key = (message.author.id, rule.id)
            if now - _cooldown.get(key, 0) < COOLDOWN_SECONDS:
                continue
            _cooldown[key] = now
            return rule
    return None


def _evict_cooldowns(now: float) -> None:
    stale = [k for k, t in _cooldown.items() if now - t > COOLDOWN_SECONDS]
    for k in stale:
        del _cooldown[k]


_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
_MAX_IMAGE_BYTES = 8 * 1024 * 1024


async def _ocr_attachments(message: discord.Message) -> str:
    images = [
        a for a in message.attachments
        if a.content_type and a.content_type in _IMAGE_TYPES
        and a.size <= _MAX_IMAGE_BYTES
    ]
    if not images:
        return ""

    parts: list[str] = []
    for attachment in images[:2]:
        try:
            data = await attachment.read()
            text = await asyncio.to_thread(_run_ocr, data)
            if text:
                log.info("OCR %s: %s", attachment.filename, text[:120])
                parts.append(text)
            else:
                log.info("OCR %s: empty result", attachment.filename)
        except Exception:
            log.warning("OCR failed for %s", attachment.filename, exc_info=True)
    return " ".join(parts).lower()


def _run_ocr(data: bytes) -> str:
    img = Image.open(io.BytesIO(data))
    return pytesseract.image_to_string(img, timeout=5).strip()
