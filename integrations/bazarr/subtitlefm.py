"""Subtitle.fm provider for Bazarr's bundled Subliminal implementation.

Upstream target: custom_libs/subliminal_patch/providers/subtitlefm.py
"""

from __future__ import absolute_import

import logging
from urllib.parse import quote, urljoin

from requests import Session
from subliminal.exceptions import AuthenticationError, ConfigurationError, ServiceUnavailable
from subliminal.video import Episode, Movie
from subliminal_patch.exceptions import APIThrottled
from subliminal_patch.providers import Provider
from subliminal_patch.subtitle import Subtitle
from subzero.language import Language

logger = logging.getLogger(__name__)

_DEFAULT_API_URL = "https://api.subtitle.fm"
_BIBLIOGRAPHIC_TO_TERMINOLOGIC = {
    "alb": "sqi", "arm": "hye", "baq": "eus", "bur": "mya", "chi": "zho",
    "cze": "ces", "dut": "nld", "fre": "fra", "geo": "kat", "ger": "deu",
    "gre": "ell", "ice": "isl", "mac": "mkd", "mao": "mri", "may": "msa",
    "per": "fas", "rum": "ron", "slo": "slk", "tib": "bod", "wel": "cym",
}


def _language_from_api(code):
    normalized = _BIBLIOGRAPHIC_TO_TERMINOLOGIC.get(str(code).lower(), str(code).lower())
    try:
        return Language(normalized)
    except ValueError:
        logger.warning("Subtitle.fm returned unsupported language code %r", code)
        return None


class SubtitleFmSubtitle(Subtitle):
    provider_name = "subtitlefm"
    hash_verifiable = False
    hearing_impaired_verifiable = False

    def __init__(self, language, identifier, download_url, video, matched_by):
        super(SubtitleFmSubtitle, self).__init__(language, page_link=download_url)
        self._id = identifier
        self.download_url = download_url
        self.video = video
        self.matched_by = matched_by
        self.release_info = "Subtitle.fm community release"

    @property
    def id(self):
        return self._id

    def get_matches(self, video):
        if isinstance(video, Episode):
            matches = {"series", "season", "episode"}
            if self.matched_by == "imdb":
                matches.add("series_imdb_id")
            return matches
        matches = {"title"}
        if self.matched_by == "imdb":
            matches.add("imdb_id")
        return matches


class SubtitleFmProvider(Provider):
    provider_name = "subtitlefm"
    video_types = (Episode, Movie)

    # Subtitle.fm stores an ISO language on every published episode. This list
    # mirrors Bazarr's broadly supported provider set and can grow independently
    # of the API/database schema.
    languages = {Language(code) for code in [
        "ara", "aze", "ben", "bos", "bul", "cat", "ces", "dan", "deu", "ell",
        "eng", "eus", "fas", "fin", "fra", "glg", "heb", "hrv", "hun", "hye",
        "ind", "ita", "jpn", "kor", "mkd", "msa", "nld", "nor", "pol", "por",
        "ron", "rus", "slk", "slv", "spa", "sqi", "srp", "swe", "tha", "tur",
        "ukr", "vie", "zho",
    ]}

    def __init__(self, api_key, api_url=_DEFAULT_API_URL):
        if not api_key:
            raise ConfigurationError("Missing Subtitle.fm API key")
        self.api_key = api_key
        self.api_url = (api_url or _DEFAULT_API_URL).rstrip("/")
        self.session = None

    def initialize(self):
        self.session = Session()
        self.session.headers.update({
            "Authorization": "Bearer %s" % self.api_key,
            "Accept": "application/json",
            "User-Agent": "Bazarr Subtitle.fm provider",
        })

    def terminate(self):
        if self.session is not None:
            self.session.close()

    @staticmethod
    def _lookup_identity(video):
        if isinstance(video, Episode):
            if video.series_imdb_id:
                return "series", "%s:%s:%s" % (
                    video.series_imdb_id,
                    video.season,
                    video.episode,
                ), "imdb"
            if video.anilist_id:
                return "series", "anilist:%s:%s" % (video.anilist_id, video.episode), "anilist"
        elif isinstance(video, Movie):
            if video.imdb_id:
                return "movie", video.imdb_id, "imdb"
            if video.anilist_id:
                return "movie", "anilist:%s" % video.anilist_id, "anilist"
        return None

    def list_subtitles(self, video, languages):
        identity = self._lookup_identity(video)
        if identity is None:
            logger.debug("Subtitle.fm lookup skipped: no IMDb or AniList id for %r", video)
            return []

        media_type, external_id, matched_by = identity
        url = "%s/v1/subtitles/%s/%s" % (
            self.api_url,
            media_type,
            quote(str(external_id), safe=""),
        )
        response = self.session.get(url, timeout=15)
        if response.status_code == 401:
            raise AuthenticationError("Subtitle.fm API key is invalid or revoked")
        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After", "unknown")
            raise APIThrottled("Subtitle.fm rate limit reached; retry after %s seconds" % retry_after)
        if response.status_code == 503:
            raise ServiceUnavailable("Subtitle.fm API is temporarily unavailable")
        response.raise_for_status()

        try:
            items = response.json().get("subtitles", [])
        except (AttributeError, ValueError) as error:
            raise ServiceUnavailable("Subtitle.fm returned an invalid response") from error

        requested = {language.alpha3 for language in languages}
        subtitles = []
        for item in items:
            language = _language_from_api(item.get("lang"))
            if language is None or language.alpha3 not in requested:
                continue
            identifier = item.get("id")
            download_url = item.get("url")
            if not identifier or not download_url:
                continue
            subtitles.append(
                SubtitleFmSubtitle(language, identifier, download_url, video, matched_by)
            )
        return subtitles

    def download_subtitle(self, subtitle):
        # The published artifact is public and redirects to a short-lived object
        # URL. Explicitly remove the API Authorization header before following it.
        response = self.session.get(
            urljoin(self.api_url + "/", subtitle.download_url),
            headers={"Authorization": None},
            allow_redirects=True,
            timeout=30,
        )
        response.raise_for_status()
        subtitle.content = response.content
