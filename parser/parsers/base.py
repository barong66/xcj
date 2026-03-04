from __future__ import annotations

import abc
import dataclasses
import logging
import re
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class ParsedVideo:
    """Platform-agnostic container for a single parsed video."""

    platform_id: str           # tweet ID / IG media ID
    original_url: str          # link back to the original post
    title: Optional[str]          # extracted or generated title
    description: Optional[str]    # full post text
    duration_sec: Optional[int]   # video duration in seconds
    width: Optional[int]
    height: Optional[int]
    published_at: Optional[datetime]

    # Temporary local file paths (cleaned up after upload)
    thumbnail_sm_path: Optional[str]  # small thumbnail for feed/low bandwidth
    thumbnail_lg_path: Optional[str]  # large HD thumbnail
    preview_path: Optional[str]       # local path to generated preview clip

    # Original thumbnail URL from platform (fallback)
    thumbnail_source_url: Optional[str] = None
    # Direct video URL (for preview generation)
    video_url: Optional[str] = None


# ─── Bio text cleaning ────────────────────────────────────────────

_CTA_PATTERNS = re.compile(
    r"(?:link\s*(?:in\s*)?(?:bio|below|here|⬇️|👇))"
    r"|(?:linktree|linktr\.ee|beacons\.ai|allmylinks|hoo\.be|solo\.to)"
    r"|(?:tap\s*(?:the\s*)?link)"
    r"|(?:👇\s*👇)"
    r"|(?:⬇️\s*⬇️)",
    re.IGNORECASE,
)


def clean_bio(text: str) -> str:
    """Strip URLs, @mentions, #hashtags, emails, and CTA spam from bio text."""
    if not text:
        return ""

    # Remove email addresses first (before URL/domain stripping).
    text = re.sub(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b", "", text)

    # Remove URLs.
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"www\.\S+", "", text)
    text = re.sub(
        r"\b\w+\.(?:com|net|org|io|co|me|link|bio|tv|app|xyz|gg|ly|ee)\b(?:/\S*)?",
        "", text,
    )

    # Remove @mentions.
    text = re.sub(r"@[\w.]+", "", text)

    # Remove #hashtags.
    text = re.sub(r"#\w+", "", text)

    # Remove CTA phrases.
    text = _CTA_PATTERNS.sub("", text)

    # Remove orphaned pointing/link emojis (specific sequences, not bare variation selectors).
    text = re.sub(r"(?:👇|⬇️|➡️|👆|⬆️|🔗|🔽)+", "", text)

    # Collapse whitespace, preserve intentional line breaks.
    lines = text.split("\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in lines]
    lines = [line for line in lines if line]
    return "\n".join(lines).strip()


def should_skip_video(
    *,
    width: Optional[int],
    height: Optional[int],
    duration_sec: Optional[int],
    platform_id: str = "",
) -> bool:
    """Return True if the video should be filtered out based on settings."""
    from parser.config.settings import settings

    # Duration filter
    if duration_sec is not None:
        if duration_sec < settings.min_video_duration_sec:
            logger.debug("Skipping %s: duration %ds < min %ds", platform_id, duration_sec, settings.min_video_duration_sec)
            return True
        if settings.max_video_duration_sec > 0 and duration_sec > settings.max_video_duration_sec:
            logger.debug("Skipping %s: duration %ds > max %ds", platform_id, duration_sec, settings.max_video_duration_sec)
            return True

    # Portrait-only filter
    if settings.only_portrait:
        w = width or 0
        h = height or 0
        if w > 0 and h > 0 and w >= h:
            logger.debug("Skipping %s: landscape (%dx%d) but only_portrait=true", platform_id, w, h)
            return True

    # Minimum resolution filter
    if settings.min_video_height > 0:
        h = height or 0
        if 0 < h < settings.min_video_height:
            logger.debug("Skipping %s: height %d < min %d", platform_id, h, settings.min_video_height)
            return True

    return False


class BaseParser(abc.ABC):
    """Interface every platform parser must implement."""

    @abc.abstractmethod
    async def parse_account(
        self, username: str, *, max_videos: Optional[int] = None,
    ) -> List[ParsedVideo]:
        """Fetch all recent videos for *username*.

        Args:
            max_videos: Per-account video limit.  ``None`` means use
                        the global default from settings.

        Returns a list of ``ParsedVideo`` objects with local thumbnails
        and preview clips already generated in a temp directory.  The
        caller is responsible for uploading them to S3 and cleaning up.
        """

    @abc.abstractmethod
    async def get_account_info(self, username: str) -> dict:
        """Return basic profile metadata.

        Expected keys: ``platform_id``, ``display_name``,
        ``avatar_url``, ``follower_count``.
        """

    @property
    @abc.abstractmethod
    def platform(self) -> str:
        """Short platform tag, e.g. ``'twitter'`` or ``'instagram'``."""
