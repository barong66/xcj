"""
Category definitions for the AI video categorizer.

Each category is a slug -> display name mapping. Slugs are used as
stable identifiers in the database; display names are shown in the UI
and included in the AI prompt for clarity.
"""

from __future__ import annotations

from typing import Dict, FrozenSet, List, Optional, Set

CATEGORIES: Dict[str, str] = {
    # ── Appearance / Hair ─────────────────────────────────────
    "blonde": "Blonde",
    "brunette": "Brunette",
    "redhead": "Redhead",
    "curly-hair": "Curly Hair",
    "short-hair": "Short Hair",
    "long-hair": "Long Hair",

    # ── Body & Fitness ────────────────────────────────────────
    "fitness": "Fitness & Workout",
    "yoga": "Yoga",
    "bodybuilding": "Bodybuilding",
    "weight-loss": "Weight Loss",

    # ── Lifestyle ─────────────────────────────────────────────
    "lifestyle": "Lifestyle",
    "vlog": "Vlog",
    "daily-routine": "Daily Routine",
    "motivation": "Motivation",
    "self-care": "Self Care",

    # ── Beauty & Fashion ──────────────────────────────────────
    "fashion": "Fashion",
    "beauty": "Beauty & Makeup",
    "skincare": "Skincare",
    "hairstyle": "Hairstyle Tutorial",
    "nails": "Nail Art",
    "outfit": "Outfit / OOTD",

    # ── Dance & Performance ───────────────────────────────────
    "dance": "Dance",
    "choreography": "Choreography",
    "twerk": "Twerk",
    "pole-dance": "Pole Dance",

    # ── Entertainment ─────────────────────────────────────────
    "comedy": "Comedy & Humor",
    "prank": "Prank",
    "challenge": "Challenge",
    "reaction": "Reaction",
    "asmr": "ASMR",
    "cosplay": "Cosplay",

    # ── Music ─────────────────────────────────────────────────
    "music": "Music",
    "singing": "Singing",
    "dj": "DJ / Mixing",

    # ── Food & Cooking ────────────────────────────────────────
    "cooking": "Cooking & Recipes",
    "baking": "Baking",
    "food-review": "Food Review",

    # ── Travel & Nature ───────────────────────────────────────
    "travel": "Travel",
    "beach": "Beach & Pool",
    "nature": "Nature & Outdoors",
    "adventure": "Adventure",

    # ── Sports ────────────────────────────────────────────────
    "sports": "Sports",
    "swimming": "Swimming",
    "surfing": "Surfing",
    "martial-arts": "Martial Arts",

    # ── Tech & Gaming ─────────────────────────────────────────
    "gaming": "Gaming",
    "tech": "Tech & Gadgets",
    "streaming": "Streaming / Live",

    # ── Creative ──────────────────────────────────────────────
    "art": "Art & Drawing",
    "photography": "Photography",
    "diy": "DIY & Crafts",

    # ── Animals ───────────────────────────────────────────────
    "pets": "Pets & Animals",
    "dogs": "Dogs",
    "cats": "Cats",

    # ── Auto ──────────────────────────────────────────────────
    "cars": "Cars & Automotive",
    "motorcycle": "Motorcycle",

    # ── Education ─────────────────────────────────────────────
    "education": "Education",
    "language": "Language Learning",
    "science": "Science",
}

# Pre-computed frozenset of valid slugs for O(1) lookups
_VALID_SLUGS: FrozenSet[str] = frozenset(CATEGORIES.keys())


def get_category_prompt_list() -> str:
    """
    Build a formatted category list for inclusion in the AI prompt.

    Returns a string like:
        blonde — Blonde
        brunette — Brunette
        ...
    """
    lines = [f"{slug} — {name}" for slug, name in CATEGORIES.items()]
    return "\n".join(lines)


def validate_categories(
    slugs: List[str],
) -> List[str]:
    """
    Filter a list of category slugs, keeping only those that exist
    in the known category set.

    Args:
        slugs: List of category slug strings from the AI response.

    Returns:
        List of valid slugs (preserving original order, duplicates removed).
    """
    seen: Set[str] = set()
    valid: List[str] = []
    for slug in slugs:
        normalized = slug.strip().lower()
        if normalized in _VALID_SLUGS and normalized not in seen:
            seen.add(normalized)
            valid.append(normalized)
    return valid


def get_all_slugs() -> List[str]:
    """Return all category slugs as a sorted list."""
    return sorted(CATEGORIES.keys())


def get_display_name(slug: str) -> Optional[str]:
    """Return the display name for a slug, or None if unknown."""
    return CATEGORIES.get(slug)
