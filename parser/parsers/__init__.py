"""Platform parser registry and factory."""
from __future__ import annotations

from typing import Dict, Type

from parser.parsers.base import BaseParser, ParsedVideo
from parser.parsers.instagram import InstagramParser
from parser.parsers.twitter import TwitterParser

_REGISTRY: Dict[str, Type[BaseParser]] = {
    "twitter": TwitterParser,
    "instagram": InstagramParser,
}


def get_parser(platform: str) -> BaseParser:
    """Return a parser instance for *platform*.

    Raises ``ValueError`` if the platform is not supported.
    """
    cls = _REGISTRY.get(platform)
    if cls is None:
        supported = ", ".join(sorted(_REGISTRY))
        raise ValueError(
            f"No parser for platform '{platform}'. Supported: {supported}"
        )
    return cls()


__all__ = [
    "BaseParser",
    "ParsedVideo",
    "InstagramParser",
    "TwitterParser",
    "get_parser",
]
