"""Tests for clean_bio() — bio text sanitization."""

from parser.parsers.base import clean_bio


class TestCleanBio:
    """Core sanitization rules."""

    def test_empty_input(self):
        assert clean_bio("") == ""
        assert clean_bio(None) == ""

    def test_plain_text_unchanged(self):
        assert clean_bio("Just a girl who loves coffee ☕") == "Just a girl who loves coffee ☕"

    def test_preserves_emojis(self):
        assert clean_bio("dancer 💃 fitness 🏋️") == "dancer 💃 fitness 🏋️"

    def test_preserves_line_breaks(self):
        assert clean_bio("Line one\nLine two") == "Line one\nLine two"

    # --- URLs ---

    def test_removes_https_url(self):
        assert clean_bio("Check https://onlyfans.com/me out") == "Check out"

    def test_removes_http_url(self):
        assert clean_bio("Visit http://example.com please") == "Visit please"

    def test_removes_www_url(self):
        assert clean_bio("Go to www.example.com/page now") == "Go to now"

    def test_removes_bare_domain(self):
        assert clean_bio("Visit linktr.ee/model today") == "Visit today"

    def test_removes_common_domains(self):
        for domain in ["onlyfans.com", "fansly.com", "solo.to/xxx", "beacons.ai/model"]:
            result = clean_bio(f"Check {domain} out")
            assert "Check" in result
            assert domain.split("/")[0] not in result

    # --- @mentions ---

    def test_removes_at_mentions(self):
        assert clean_bio("Follow @bestfriend and @promo") == "Follow and"

    def test_removes_mention_with_dots(self):
        assert clean_bio("DM @user.name for info") == "DM for info"

    # --- #hashtags ---

    def test_removes_hashtags(self):
        assert clean_bio("I love #fitness #model life") == "I love life"

    # --- Emails ---

    def test_removes_email(self):
        assert clean_bio("Bookings: manager@agency.com here") == "Bookings: here"

    def test_email_before_domain_stripping(self):
        """Email should be fully removed, not partially mangled by domain regex."""
        result = clean_bio("Contact me@model.com for work")
        assert "@" not in result
        assert "me" not in result or result == "Contact for work"

    # --- CTA phrases ---

    def test_removes_link_in_bio(self):
        result = clean_bio("Hot stuff link in bio")
        assert "link" not in result.lower()

    def test_removes_linktree_mention(self):
        result = clean_bio("Check my linktree for more")
        assert "linktree" not in result.lower()

    def test_removes_tap_link(self):
        result = clean_bio("Tap the link for exclusive content")
        assert "tap" not in result.lower()

    # --- Pointing emojis ---

    def test_removes_pointing_emojis(self):
        result = clean_bio("Click here 👇👇👇")
        assert "👇" not in result

    def test_removes_arrow_emojis(self):
        result = clean_bio("See below ⬇️⬇️")
        assert "⬇️" not in result

    # --- Combined real-world examples ---

    def test_real_bio_promo_heavy(self):
        bio = "Hot model 🔥 @bestfriend DM for collab linktr.ee/model"
        assert clean_bio(bio) == "Hot model 🔥 DM for collab"

    def test_real_bio_with_hashtags(self):
        bio = "Hey! Check https://onlyfans.com/me #fitness #model"
        assert clean_bio(bio) == "Hey! Check"

    def test_real_bio_multiline(self):
        bio = "23yo 🇧🇷 dancer\nBookings: manager@model.com\n👇 link in bio 👇\nhttps://linktr.ee/hotmodel"
        result = clean_bio(bio)
        assert "23yo 🇧🇷 dancer" in result
        assert "Bookings:" in result
        assert "@" not in result
        assert "http" not in result
        assert "👇" not in result

    def test_real_bio_all_promo(self):
        """Bio that is 100% promotional should become empty."""
        bio = "@promo1 @promo2 https://link.com #ad #model"
        assert clean_bio(bio) == ""

    def test_real_bio_clean(self):
        """Clean bio should pass through unchanged."""
        bio = "Photographer based in LA. Love dogs and sunsets."
        assert clean_bio(bio) == bio

    # --- Whitespace handling ---

    def test_collapses_multiple_spaces(self):
        result = clean_bio("Hello   @removed   world")
        assert "  " not in result
        assert "Hello" in result
        assert "world" in result

    def test_removes_empty_lines(self):
        result = clean_bio("Keep this\n@removed\nAnd this")
        assert "\n\n" not in result
        lines = result.split("\n")
        assert all(line.strip() for line in lines)
