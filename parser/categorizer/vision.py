"""
AI video categorizer using Claude Vision API.

Analyzes video thumbnails to extract categories, country, description,
and a suggested title.
"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import anthropic
import httpx

from parser.categorizer.categories import get_category_prompt_list, validate_categories

logger = logging.getLogger(__name__)

# Supported image media types for Claude Vision
_SUPPORTED_MEDIA_TYPES = frozenset({
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
})


@dataclass(frozen=True)
class CategoryResult:
    """A single category with confidence score."""
    slug: str
    confidence: float


@dataclass(frozen=True)
class CategorizationResult:
    """Full result from the AI categorizer."""
    categories: List[CategoryResult] = field(default_factory=list)
    country: Optional[str] = None
    description: Optional[str] = None
    title: Optional[str] = None
    raw_response: Dict[str, Any] = field(default_factory=dict)


class VisionCategorizer:
    """
    Categorizes video content by analyzing thumbnails with Claude Vision.

    Usage:
        categorizer = VisionCategorizer(api_key="sk-ant-...")
        result = await categorizer.categorize_url("https://example.com/thumb.jpg")
        # or
        result = await categorizer.categorize_bytes(image_bytes, "image/jpeg")
    """

    MODEL = "claude-sonnet-4-20250514"
    MAX_TOKENS = 1024

    def __init__(self, api_key: str) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._http = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Traforama-Categorizer/1.0"},
        )
        self._category_list = get_category_prompt_list()

    async def close(self) -> None:
        """Close underlying HTTP clients."""
        await self._http.aclose()
        await self._client.close()

    # ── Public API ────────────────────────────────────────────

    async def categorize_url(self, image_url: str) -> CategorizationResult:
        """
        Download an image from URL and categorize it.

        Args:
            image_url: HTTPS URL of the video thumbnail.

        Returns:
            CategorizationResult with categories, country, etc.
        """
        image_data, media_type = await self._download_image(image_url)
        return await self._run_categorization(image_data, media_type)

    async def categorize_bytes(
        self,
        image_data: bytes,
        media_type: str = "image/jpeg",
    ) -> CategorizationResult:
        """
        Categorize an image from raw bytes.

        Args:
            image_data: Raw image bytes.
            media_type: MIME type of the image.

        Returns:
            CategorizationResult with categories, country, etc.
        """
        if media_type not in _SUPPORTED_MEDIA_TYPES:
            raise ValueError(
                f"Unsupported media type '{media_type}'. "
                f"Supported: {', '.join(sorted(_SUPPORTED_MEDIA_TYPES))}"
            )
        return await self._run_categorization(image_data, media_type)

    # ── Internal ──────────────────────────────────────────────

    async def _download_image(self, url: str) -> Tuple[bytes, str]:
        """Download image and detect media type."""
        response = await self._http.get(url)
        response.raise_for_status()

        content_type = response.headers.get("content-type", "image/jpeg")
        # Strip charset or extra params: "image/jpeg; charset=utf-8" -> "image/jpeg"
        media_type = content_type.split(";")[0].strip().lower()

        if media_type not in _SUPPORTED_MEDIA_TYPES:
            # Fall back to jpeg for unknown types
            media_type = "image/jpeg"

        return response.content, media_type

    def _build_prompt(self) -> str:
        """Build the system + user prompt for categorization."""
        return f"""\
Analyze this video thumbnail image. Based on the visual content, categorize the video.

Return a JSON object (and nothing else) with these fields:

1. "categories": an array of objects, each with:
   - "slug": one of the category slugs from the list below
   - "confidence": a float between 0.0 and 1.0 indicating how confident you are

   Pick between 1 and 5 categories. Order by confidence descending.
   Only include categories with confidence >= 0.3.

2. "country": ISO 3166-1 alpha-2 country code (e.g. "US", "BR", "JP") if you can
   identify the country from visual cues (text, flags, landmarks, etc.).
   Set to null if unsure.

3. "description": a brief 1-2 sentence description of what the video appears
   to be about based on the thumbnail.

4. "title": a short catchy title (max 80 characters) suitable for a video
   listing page.

Available categories:
{self._category_list}

Important:
- Only use slugs from the list above.
- Return ONLY valid JSON, no markdown fences, no commentary.
- If the thumbnail is unclear or mostly text, do your best with what is visible."""

    async def _run_categorization(
        self,
        image_data: bytes,
        media_type: str,
    ) -> CategorizationResult:
        """Send image to Claude Vision and parse the response."""
        b64_data = base64.standard_b64encode(image_data).decode("ascii")

        try:
            message = await self._client.messages.create(
                model=self.MODEL,
                max_tokens=self.MAX_TOKENS,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": b64_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": self._build_prompt(),
                            },
                        ],
                    }
                ],
            )
        except anthropic.APIError as exc:
            logger.error("Claude API error: %s", exc)
            raise

        # Extract text content from response
        raw_text = ""
        for block in message.content:
            if block.type == "text":
                raw_text = block.text
                break

        return self._parse_response(raw_text)

    def _parse_response(self, raw_text: str) -> CategorizationResult:
        """Parse and validate the JSON response from Claude."""
        # Strip markdown fences if present
        text = raw_text.strip()
        if text.startswith("```"):
            # Remove opening fence (```json or ```)
            first_newline = text.index("\n")
            text = text[first_newline + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            logger.warning("Failed to parse AI response as JSON: %s", raw_text[:200])
            return CategorizationResult(raw_response={"error": "json_parse_error", "raw": raw_text})

        # Validate categories
        raw_categories = data.get("categories", [])
        validated_slugs = validate_categories(
            [c.get("slug", "") for c in raw_categories if isinstance(c, dict)]
        )

        # Build confidence map from raw data
        confidence_map: Dict[str, float] = {}
        for cat in raw_categories:
            if isinstance(cat, dict):
                slug = cat.get("slug", "").strip().lower()
                conf = cat.get("confidence", 0.5)
                try:
                    confidence_map[slug] = float(conf)
                except (TypeError, ValueError):
                    confidence_map[slug] = 0.5

        category_results = [
            CategoryResult(
                slug=slug,
                confidence=min(1.0, max(0.0, confidence_map.get(slug, 0.5))),
            )
            for slug in validated_slugs
        ]

        # Validate country code
        country = data.get("country")
        if isinstance(country, str) and len(country) == 2 and country.isalpha():
            country = country.upper()
        else:
            country = None

        description = data.get("description")
        if not isinstance(description, str):
            description = None

        title = data.get("title")
        if not isinstance(title, str):
            title = None
        elif len(title) > 200:
            title = title[:200]

        return CategorizationResult(
            categories=category_results,
            country=country,
            description=description,
            title=title,
            raw_response=data,
        )
