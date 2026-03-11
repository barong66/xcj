"""Tests for NeuroScore client."""
from unittest.mock import MagicMock, patch

import pytest

from parser.services.neuroscore import FrameScore, NeuroScoreClient, NeuroScoreError


class TestIsConfigured:
    def test_with_key(self):
        client = NeuroScoreClient(api_key="test-uuid-key")
        assert client.is_configured is True

    def test_without_key(self):
        client = NeuroScoreClient(api_key="")
        assert client.is_configured is False

    @patch("parser.services.neuroscore.settings")
    def test_from_settings_none(self, mock_settings):
        mock_settings.neuroscore_api_key = None
        mock_settings.neuroscore_api_url = "https://api.test.com"
        mock_settings.neuroscore_poll_interval_sec = 1
        mock_settings.neuroscore_max_poll_retries = 3
        client = NeuroScoreClient()
        assert client.is_configured is False


class TestSubmitScoreTask:
    @patch("parser.services.neuroscore.httpx.Client")
    def test_success(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.status_code = 202
        mock_resp.json.return_value = {"data": {"id": "abc-123"}}
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com")
        task_id = client.submit_score_task(["https://example.com/img1.jpg"])
        assert task_id == "abc-123"

        # Verify correct request
        call_args = mock_client.post.call_args
        assert "/task/ns/score" in call_args[0][0]
        assert call_args[1]["json"]["payload"]["urls"] == ["https://example.com/img1.jpg"]

    @patch("parser.services.neuroscore.httpx.Client")
    def test_http_error(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com")
        with pytest.raises(NeuroScoreError, match="HTTP 500"):
            client.submit_score_task(["url1"])

    @patch("parser.services.neuroscore.httpx.Client")
    def test_no_task_id_in_response(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": {}}
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com")
        with pytest.raises(NeuroScoreError, match="No task_id"):
            client.submit_score_task(["url1"])


class TestPollTask:
    @patch("parser.services.neuroscore.time.sleep")
    @patch("parser.services.neuroscore.httpx.Client")
    def test_completed(self, mock_client_cls, mock_sleep):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {
                "status": "completed",
                "response": [{"url": "u1", "score": 0.8}],
            }
        }
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com", max_retries=5, poll_interval=0)
        result = client.poll_task("task-123")
        assert result == [{"url": "u1", "score": 0.8}]
        mock_sleep.assert_not_called()

    @patch("parser.services.neuroscore.time.sleep")
    @patch("parser.services.neuroscore.httpx.Client")
    def test_timeout(self, mock_client_cls, mock_sleep):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"data": {"status": "new"}}
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com", max_retries=2, poll_interval=0)
        with pytest.raises(NeuroScoreError, match="timed out"):
            client.poll_task("task-123")

    @patch("parser.services.neuroscore.time.sleep")
    @patch("parser.services.neuroscore.httpx.Client")
    def test_failed_task(self, mock_client_cls, mock_sleep):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {"status": "error", "error_msg": "bad image"}
        }
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com", max_retries=5, poll_interval=0)
        with pytest.raises(NeuroScoreError, match="failed"):
            client.poll_task("task-123")


class TestParseScores:
    def test_list_format(self):
        client = NeuroScoreClient(api_key="test-key")
        response = [
            {"url": "https://example.com/f1.jpg", "score": 0.85},
            {"url": "https://example.com/f2.jpg", "score": 0.72},
        ]
        scores = client._parse_scores(response, ["u1", "u2"])
        assert len(scores) == 2
        assert scores[0].url == "https://example.com/f1.jpg"
        assert scores[0].score == 0.85

    def test_dict_with_results_key(self):
        client = NeuroScoreClient(api_key="test-key")
        response = {
            "results": [
                {"url": "https://example.com/f1.jpg", "ns_score": 0.9},
            ]
        }
        scores = client._parse_scores(response, ["u1"])
        assert len(scores) == 1
        assert scores[0].score == 0.9

    def test_empty_response(self):
        client = NeuroScoreClient(api_key="test-key")
        scores = client._parse_scores({}, ["u1", "u2"])
        assert len(scores) == 0

    def test_partial_results(self):
        client = NeuroScoreClient(api_key="test-key")
        response = [{"url": "u1", "score": 0.5}]
        scores = client._parse_scores(response, ["u1", "u2", "u3"])
        assert len(scores) == 1


class TestScoreUrls:
    def test_empty_list(self):
        client = NeuroScoreClient(api_key="test-key")
        result = client.score_urls([])
        assert result == []

    @patch("parser.services.neuroscore.httpx.Client")
    def test_full_flow(self, mock_client_cls):
        # Setup: submit returns task_id, poll returns completed with scores
        submit_resp = MagicMock()
        submit_resp.status_code = 202
        submit_resp.json.return_value = {"data": {"id": "task-456"}}

        poll_resp = MagicMock()
        poll_resp.status_code = 200
        poll_resp.json.return_value = {
            "data": {
                "status": "completed",
                "response": [
                    {"url": "https://cdn.example.com/f0.jpg", "score": 0.6},
                    {"url": "https://cdn.example.com/f1.jpg", "score": 0.9},
                    {"url": "https://cdn.example.com/f2.jpg", "score": 0.3},
                ],
            }
        }

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = submit_resp
        mock_client.get.return_value = poll_resp
        mock_client_cls.return_value = mock_client

        client = NeuroScoreClient(api_key="test-key", api_url="https://api.test.com", poll_interval=0)
        scores = client.score_urls([
            "https://cdn.example.com/f0.jpg",
            "https://cdn.example.com/f1.jpg",
            "https://cdn.example.com/f2.jpg",
        ])

        # Should be sorted descending by score
        assert len(scores) == 3
        assert scores[0].url == "https://cdn.example.com/f1.jpg"
        assert scores[0].score == 0.9
        assert scores[1].score == 0.6
        assert scores[2].score == 0.3
