# Backfill NeuroScore Scores Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `python -m parser backfill-scores` command that scores all existing unscored frames via the NeuroScore API and marks the best frame per video as selected.

**Architecture:** New `parser/tasks/backfill.py` module contains the core logic. New DB helpers in `db.py` query unscored videos and bulk-update scores. `__main__.py` wires the subcommand. Reuses the existing `NeuroScoreClient` — no new API code needed.

**Tech Stack:** Python asyncio, asyncpg, httpx, existing `parser/services/neuroscore.py`

---

## Chunk 1: DB helpers + backfill task

### Task 1: DB helpers

**Files:**
- Modify: `parser/storage/db.py`
- Test: `parser/tests/test_backfill_db.py`

- [ ] **Step 1: Write failing tests**

Create `parser/tests/test_backfill_db.py`:

```python
"""Tests for backfill-related DB helpers (mock asyncpg pool)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import parser.storage.db as db_module


@pytest.fixture
def mock_pool():
    pool = MagicMock()
    pool._closed = False
    return pool


@pytest.mark.asyncio
async def test_get_unscored_video_ids_returns_ids(mock_pool):
    mock_pool.fetch = AsyncMock(return_value=[
        {"video_id": 1}, {"video_id": 2},
    ])
    with patch.object(db_module, "_pool", mock_pool):
        result = await db_module.get_unscored_video_ids()
    assert result == [1, 2]
    sql = mock_pool.fetch.call_args[0][0]
    assert "score IS NULL" in sql


@pytest.mark.asyncio
async def test_get_unscored_video_ids_with_limit(mock_pool):
    mock_pool.fetch = AsyncMock(return_value=[{"video_id": 5}])
    with patch.object(db_module, "_pool", mock_pool):
        await db_module.get_unscored_video_ids(limit=10)
    sql, limit = mock_pool.fetch.call_args[0]
    assert "LIMIT" in sql
    assert limit == 10


@pytest.mark.asyncio
async def test_get_frames_for_scoring(mock_pool):
    mock_pool.fetch = AsyncMock(return_value=[
        {"id": 10, "image_url": "https://r2/a.jpg"},
        {"id": 11, "image_url": "https://r2/b.jpg"},
    ])
    with patch.object(db_module, "_pool", mock_pool):
        result = await db_module.get_frames_for_scoring(42)
    assert len(result) == 2
    assert result[0]["id"] == 10


@pytest.mark.asyncio
async def test_update_frame_scores(mock_pool):
    mock_pool.executemany = AsyncMock()
    with patch.object(db_module, "_pool", mock_pool):
        await db_module.update_frame_scores({10: 8.5, 11: 6.2})
    mock_pool.executemany.assert_called_once()
    sql, rows = mock_pool.executemany.call_args[0]
    assert "score" in sql
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_select_best_frame(mock_pool):
    mock_pool.execute = AsyncMock()
    with patch.object(db_module, "_pool", mock_pool):
        await db_module.select_best_frame(video_id=1, frame_id=10)
    sql = mock_pool.execute.call_args[0][0]
    assert "is_selected" in sql
    assert "video_id" in sql
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /path/to/xcj && python3 -m pytest parser/tests/test_backfill_db.py -v
```
Expected: 5 failures (`AttributeError: module has no attribute 'get_unscored_video_ids'`)

- [ ] **Step 3: Add the four DB helpers to `parser/storage/db.py`**

Append after `get_video_frames()` (around line 518):

```python
async def get_unscored_video_ids(limit: int = 0) -> list[int]:
    """Return IDs of videos that have at least one unscored frame.

    Args:
        limit: Max videos to return (0 = all).
    """
    pool = await get_pool()
    if limit > 0:
        rows = await pool.fetch(
            """
            SELECT DISTINCT video_id
            FROM video_frames
            WHERE score IS NULL
            ORDER BY video_id
            LIMIT $1
            """,
            limit,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT DISTINCT video_id
            FROM video_frames
            WHERE score IS NULL
            ORDER BY video_id
            """,
        )
    return [r["video_id"] for r in rows]


async def get_frames_for_scoring(video_id: int) -> list[asyncpg.Record]:
    """Return (id, image_url) for all frames of a video."""
    pool = await get_pool()
    return await pool.fetch(
        "SELECT id, image_url FROM video_frames WHERE video_id = $1 ORDER BY frame_index",
        video_id,
    )


async def update_frame_scores(frame_scores: dict[int, float]) -> None:
    """Bulk-update score column for the given frame IDs."""
    pool = await get_pool()
    await pool.executemany(
        "UPDATE video_frames SET score = $2 WHERE id = $1",
        list(frame_scores.items()),
    )


async def select_best_frame(video_id: int, frame_id: int) -> None:
    """Set is_selected=true for frame_id, false for all other frames of the video."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE video_frames SET is_selected = (id = $1) WHERE video_id = $2",
        frame_id, video_id,
    )
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
python3 -m pytest parser/tests/test_backfill_db.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add parser/storage/db.py parser/tests/test_backfill_db.py
git commit -m "feat(db): add get_unscored_video_ids, get_frames_for_scoring, update_frame_scores, select_best_frame"
```

---

### Task 2: Backfill task module

**Files:**
- Create: `parser/tasks/backfill.py`
- Test: `parser/tests/test_backfill_task.py`

- [ ] **Step 1: Write failing tests**

Create `parser/tests/test_backfill_task.py`:

```python
"""Tests for backfill_scores task logic."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from parser.services.neuroscore import FrameScore


@pytest.mark.asyncio
async def test_backfill_scores_dry_run():
    """In dry-run mode, DB write functions are never called."""
    with (
        patch("parser.tasks.backfill.db") as mock_db,
        patch("parser.tasks.backfill.NeuroScoreClient") as MockClient,
    ):
        mock_db.get_unscored_video_ids = AsyncMock(return_value=[1])
        mock_db.get_frames_for_scoring = AsyncMock(return_value=[
            {"id": 10, "image_url": "https://r2/a.jpg"},
        ])
        mock_db.update_frame_scores = AsyncMock()
        mock_db.select_best_frame = AsyncMock()

        client = MagicMock()
        client.is_configured = True
        client.score_urls = MagicMock(return_value=[
            FrameScore(url="https://r2/a.jpg", score=7.5),
        ])
        MockClient.return_value = client

        from parser.tasks.backfill import backfill_scores
        count = await backfill_scores(dry_run=True)

    assert count == 1
    mock_db.update_frame_scores.assert_not_called()
    mock_db.select_best_frame.assert_not_called()


@pytest.mark.asyncio
async def test_backfill_scores_writes_to_db():
    """Normal run updates scores and selects best frame."""
    with (
        patch("parser.tasks.backfill.db") as mock_db,
        patch("parser.tasks.backfill.NeuroScoreClient") as MockClient,
    ):
        mock_db.get_unscored_video_ids = AsyncMock(return_value=[1])
        mock_db.get_frames_for_scoring = AsyncMock(return_value=[
            {"id": 10, "image_url": "https://r2/a.jpg"},
            {"id": 11, "image_url": "https://r2/b.jpg"},
        ])
        mock_db.update_frame_scores = AsyncMock()
        mock_db.select_best_frame = AsyncMock()

        client = MagicMock()
        client.is_configured = True
        client.score_urls = MagicMock(return_value=[
            FrameScore(url="https://r2/a.jpg", score=8.0),
            FrameScore(url="https://r2/b.jpg", score=5.0),
        ])
        MockClient.return_value = client

        from parser.tasks.backfill import backfill_scores
        count = await backfill_scores(dry_run=False)

    assert count == 1
    mock_db.update_frame_scores.assert_called_once_with({10: 8.0, 11: 5.0})
    mock_db.select_best_frame.assert_called_once_with(video_id=1, frame_id=10)


@pytest.mark.asyncio
async def test_backfill_scores_skips_on_api_error():
    """If NeuroScore raises, the video is skipped (not crashed)."""
    with (
        patch("parser.tasks.backfill.db") as mock_db,
        patch("parser.tasks.backfill.NeuroScoreClient") as MockClient,
    ):
        mock_db.get_unscored_video_ids = AsyncMock(return_value=[1, 2])
        mock_db.get_frames_for_scoring = AsyncMock(return_value=[
            {"id": 10, "image_url": "https://r2/a.jpg"},
        ])
        mock_db.update_frame_scores = AsyncMock()
        mock_db.select_best_frame = AsyncMock()

        client = MagicMock()
        client.is_configured = True
        client.score_urls = MagicMock(side_effect=Exception("API down"))
        MockClient.return_value = client

        from parser.tasks.backfill import backfill_scores
        count = await backfill_scores(dry_run=False)

    assert count == 0
    mock_db.update_frame_scores.assert_not_called()


@pytest.mark.asyncio
async def test_backfill_scores_not_configured():
    """Raises RuntimeError when NeuroScore is not configured."""
    with patch("parser.tasks.backfill.NeuroScoreClient") as MockClient:
        client = MagicMock()
        client.is_configured = False
        MockClient.return_value = client

        from parser.tasks.backfill import backfill_scores
        with pytest.raises(RuntimeError, match="NEUROSCORE_API_KEY"):
            await backfill_scores()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python3 -m pytest parser/tests/test_backfill_task.py -v
```
Expected: 4 failures (`ModuleNotFoundError: No module named 'parser.tasks.backfill'`)

- [ ] **Step 3: Create `parser/tasks/backfill.py`**

```python
"""Backfill NeuroScore scores for existing unscored video frames.

Queries all videos with unscored frames, submits each video's frame URLs
to NeuroScore, writes scores back to the DB, and marks the best frame
as selected.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from parser.services.neuroscore import NeuroScoreClient
from parser.storage import db

logger = logging.getLogger(__name__)


async def backfill_scores(
    limit: int = 0,
    dry_run: bool = False,
) -> int:
    """Score all unscored frames and mark best frame per video.

    Args:
        limit: Max videos to process (0 = all).
        dry_run: If True, log results but do not write to DB.

    Returns:
        Number of videos successfully scored.

    Raises:
        RuntimeError: If NEUROSCORE_API_KEY is not configured.
    """
    client = NeuroScoreClient()
    if not client.is_configured:
        raise RuntimeError("NEUROSCORE_API_KEY is not set — cannot score frames")

    video_ids = await db.get_unscored_video_ids(limit=limit)
    total = len(video_ids)
    logger.info("Backfill: %d video(s) with unscored frames", total)

    scored = 0
    for i, video_id in enumerate(video_ids, 1):
        frames = await db.get_frames_for_scoring(video_id)
        if not frames:
            continue

        urls = [f["image_url"] for f in frames]
        url_to_frame_id = {f["image_url"]: f["id"] for f in frames}

        try:
            loop = asyncio.get_running_loop()
            results = await loop.run_in_executor(None, client.score_urls, urls)
        except Exception as exc:
            logger.warning("Video %d: NeuroScore failed — skipping (%s)", video_id, exc)
            continue

        frame_scores = {
            url_to_frame_id[fs.url]: fs.score
            for fs in results
            if fs.url in url_to_frame_id
        }

        # Best frame = highest score; fall back to first frame if no scores returned
        if results:
            best_url = results[0].url  # score_urls returns sorted descending
            best_frame_id = url_to_frame_id.get(best_url, frames[0]["id"])
        else:
            best_frame_id = frames[0]["id"]

        logger.info(
            "[%d/%d] Video %d: scored %d frame(s), best frame_id=%d%s",
            i, total, video_id, len(frame_scores), best_frame_id,
            " [DRY RUN]" if dry_run else "",
        )

        if not dry_run:
            if frame_scores:
                await db.update_frame_scores(frame_scores)
            await db.select_best_frame(video_id=video_id, frame_id=best_frame_id)

        scored += 1

    logger.info("Backfill complete: %d/%d video(s) scored", scored, total)
    return scored
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
python3 -m pytest parser/tests/test_backfill_task.py -v
```
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add parser/tasks/backfill.py parser/tests/test_backfill_task.py
git commit -m "feat(backfill): add backfill_scores task — score existing frames via NeuroScore"
```

---

## Chunk 2: CLI wiring

### Task 3: Wire `backfill-scores` subcommand into `__main__.py`

**Files:**
- Modify: `parser/__main__.py`
- Test: (manual — run `python -m parser backfill-scores --help`)

- [ ] **Step 1: Add `cmd_backfill_scores` async function**

In `parser/__main__.py`, add after `cmd_categorize()` (around line 87):

```python
async def cmd_backfill_scores(limit: int, dry_run: bool) -> None:
    """Score existing unscored frames via NeuroScore API."""
    from parser.storage import db
    from parser.tasks.backfill import backfill_scores

    try:
        count = await backfill_scores(limit=limit, dry_run=dry_run)
        suffix = " [DRY RUN]" if dry_run else ""
        print(f"Done. {count} video(s) scored{suffix}.")
    finally:
        await db.close_pool()
```

- [ ] **Step 2: Add subcommand to `build_parser()`**

In `build_parser()`, after the `categorize` subcommand (around line 161):

```python
# backfill-scores
p_backfill = sub.add_parser(
    "backfill-scores",
    help="Score existing unscored frames via NeuroScore API",
)
p_backfill.add_argument(
    "--limit", type=int, default=0,
    help="Max videos to process (default: 0 = all)",
)
p_backfill.add_argument(
    "--dry-run", action="store_true",
    help="Log results without writing to DB",
)
```

- [ ] **Step 3: Add dispatch in `main()`**

In `main()`, after the `categorize` branch:

```python
elif args.command == "backfill-scores":
    asyncio.run(cmd_backfill_scores(args.limit, args.dry_run))
```

- [ ] **Step 4: Smoke test the CLI**

```bash
python3 -m parser backfill-scores --help
```
Expected output includes `--limit` and `--dry-run` flags.

- [ ] **Step 5: Run full test suite**

```bash
python3 -m pytest parser/tests/ -v
```
Expected: all tests pass (including new ones)

- [ ] **Step 6: Commit**

```bash
git add parser/__main__.py
git commit -m "feat(cli): add backfill-scores subcommand"
```

---

## Running on Server

After merging and deploying:

```bash
# Test on 5 videos first (dry run)
ssh traforama@37.27.189.122 "docker exec traforama-parser-worker python -m parser backfill-scores --limit 5 --dry-run"

# Run full backfill (1182 videos — ~2 min per video max = up to 40h worst case)
# Run full backfill in background (nohup inside container)
ssh traforama@37.27.189.122 "docker exec -d traforama-parser-worker bash -c 'nohup python -m parser backfill-scores > /tmp/backfill.log 2>&1'"

# Monitor progress
ssh traforama@37.27.189.122 "docker exec traforama-parser-worker tail -f /tmp/backfill.log"
```
