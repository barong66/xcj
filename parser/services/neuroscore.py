"""NeuroScore API client for frame quality scoring.

Submit frame image URLs for scoring, poll for results, and return ranked scores.
Gracefully degrades when the API is unavailable or unconfigured.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

import httpx

from parser.config.settings import settings

logger = logging.getLogger(__name__)


@dataclass
class FrameScore:
    """Score result for a single frame URL."""
    url: str
    score: float


class NeuroScoreError(Exception):
    """Raised when NeuroScore API returns an error."""


class NeuroScoreClient:
    """Synchronous client for the NeuroScore Score API.

    Called via run_in_executor() since the parser uses this pattern
    for all blocking I/O.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None,
        poll_interval: Optional[int] = None,
        max_retries: Optional[int] = None,
    ):
        self.api_key = api_key or settings.neuroscore_api_key
        self.api_url = (api_url or settings.neuroscore_api_url).rstrip("/")
        self.poll_interval = poll_interval or settings.neuroscore_poll_interval_sec
        self.max_retries = max_retries or settings.neuroscore_max_poll_retries

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict:
        return {
            "X-Api-Key": self.api_key,
            "Content-Type": "application/json",
        }

    def submit_score_task(self, urls: List[str]) -> str:
        """Submit URLs for scoring. Returns task_id."""
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{self.api_url}/task/ns/score",
                headers=self._headers(),
                json={
                    "payload": {
                        "urls": urls,
                        "predict_categories": False,
                    }
                },
            )
            if resp.status_code not in (200, 202):
                raise NeuroScoreError(
                    f"Submit failed: HTTP {resp.status_code} - {resp.text[:200]}"
                )
            data = resp.json()
            task_id = data.get("data", {}).get("id") or data.get("task_id")
            if not task_id:
                raise NeuroScoreError(f"No task_id in response: {data}")
            return task_id

    def poll_task(self, task_id: str) -> Dict:
        """Poll until task completes. Returns the response data."""
        for attempt in range(self.max_retries):
            with httpx.Client(timeout=30) as client:
                resp = client.get(
                    f"{self.api_url}/task/{task_id}",
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    raise NeuroScoreError(
                        f"Poll failed: HTTP {resp.status_code} - {resp.text[:200]}"
                    )
                data = resp.json().get("data", {})
                status = data.get("status", "")

                if status == "completed":
                    return data.get("response", {})
                elif status in ("failed", "error"):
                    raise NeuroScoreError(
                        f"Task {task_id} failed: {data.get('error_msg', data)}"
                    )

                logger.debug(
                    "NeuroScore task %s: status=%s (attempt %d/%d)",
                    task_id, status, attempt + 1, self.max_retries,
                )
            time.sleep(self.poll_interval)

        raise NeuroScoreError(
            f"Task {task_id} timed out after {self.max_retries} polls"
        )

    def score_urls(self, urls: List[str]) -> List[FrameScore]:
        """Submit URLs, poll for results, return scores sorted descending."""
        if not urls:
            return []

        task_id = self.submit_score_task(urls)
        logger.info("NeuroScore task submitted: %s (%d URLs)", task_id, len(urls))

        response = self.poll_task(task_id)

        scores = self._parse_scores(response, urls)
        scores.sort(key=lambda fs: fs.score, reverse=True)

        logger.info(
            "NeuroScore results: best=%.3f worst=%.3f (%d frames)",
            scores[0].score if scores else 0,
            scores[-1].score if scores else 0,
            len(scores),
        )
        return scores

    def _parse_scores(self, response: Dict, urls: List[str]) -> List[FrameScore]:
        """Extract per-URL scores from the API response.

        Handles both list and dict response formats defensively.
        """
        scores = []

        results = response if isinstance(response, list) else response.get("results", [])

        if isinstance(results, list):
            for item in results:
                url = item.get("url", "")
                score = item.get("score") or item.get("ns_score") or 0.0
                if url and isinstance(score, (int, float)):
                    scores.append(FrameScore(url=url, score=float(score)))

        if len(scores) < len(urls):
            logger.warning(
                "NeuroScore returned %d scores for %d URLs",
                len(scores), len(urls),
            )

        return scores
