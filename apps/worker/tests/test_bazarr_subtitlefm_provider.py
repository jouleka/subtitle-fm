"""Contract tests for the upstream-ready Bazarr provider (SFM-42)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

PROVIDER_PATH = Path(__file__).parents[3] / "integrations" / "bazarr" / "subtitlefm.py"


class Language:
    def __init__(self, alpha3: str):
        if len(alpha3) != 3:
            raise ValueError(alpha3)
        self.alpha3 = alpha3

    def __hash__(self) -> int:
        return hash(self.alpha3)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Language) and self.alpha3 == other.alpha3


class Episode:
    def __init__(
        self,
        *,
        series_imdb_id: str | None = None,
        anilist_id: int | None = None,
        season: int = 1,
        episode: int = 1,
    ):
        self.series_imdb_id = series_imdb_id
        self.anilist_id = anilist_id
        self.season = season
        self.episode = episode


class Movie:
    def __init__(self, *, imdb_id: str | None = None, anilist_id: int | None = None):
        self.imdb_id = imdb_id
        self.anilist_id = anilist_id


class Subtitle:
    def __init__(self, language: Language, page_link: str | None = None):
        self.language = language
        self.page_link = page_link
        self.content: bytes | None = None


class Provider:
    pass


class ConfigurationError(Exception):
    pass


class AuthenticationError(Exception):
    pass


class ServiceUnavailable(Exception):
    pass


class APIThrottled(Exception):
    pass


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        json_data: Any = None,
        content: bytes = b"",
        headers: dict[str, str] | None = None,
    ):
        self.status_code = status_code
        self._json_data = json_data
        self.content = content
        self.headers = headers or {}

    def json(self) -> Any:
        return self._json_data

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses: list[FakeResponse]):
        self.responses = list(responses)
        self.headers: dict[str, Any] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.closed = False

    def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.calls.append((url, kwargs))
        return self.responses.pop(0)

    def close(self) -> None:
        self.closed = True


def _module(name: str, **attrs: Any) -> ModuleType:
    module = ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    return module


@pytest.fixture
def provider_module(monkeypatch: pytest.MonkeyPatch):
    modules = {
        "requests": _module("requests", Session=lambda: FakeSession([])),
        "subliminal": _module("subliminal"),
        "subliminal.exceptions": _module(
            "subliminal.exceptions",
            AuthenticationError=AuthenticationError,
            ConfigurationError=ConfigurationError,
            ServiceUnavailable=ServiceUnavailable,
        ),
        "subliminal.video": _module("subliminal.video", Episode=Episode, Movie=Movie),
        "subliminal_patch": _module("subliminal_patch"),
        "subliminal_patch.exceptions": _module(
            "subliminal_patch.exceptions", APIThrottled=APIThrottled
        ),
        "subliminal_patch.providers": _module(
            "subliminal_patch.providers", Provider=Provider
        ),
        "subliminal_patch.subtitle": _module(
            "subliminal_patch.subtitle", Subtitle=Subtitle
        ),
        "subzero": _module("subzero"),
        "subzero.language": _module("subzero.language", Language=Language),
    }
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)

    spec = importlib.util.spec_from_file_location("subtitlefm_provider_test", PROVIDER_PATH)
    assert spec and spec.loader
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def _provider(provider_module: Any, monkeypatch: pytest.MonkeyPatch, responses: list[FakeResponse]):
    session = FakeSession(responses)
    monkeypatch.setattr(provider_module, "Session", lambda: session)
    provider = provider_module.SubtitleFmProvider(
        api_key="sfm_test_secret", api_url="https://api.example.test/"
    )
    provider.initialize()
    return provider, session


def test_requires_an_api_key(provider_module: Any):
    with pytest.raises(ConfigurationError):
        provider_module.SubtitleFmProvider(api_key="")


def test_episode_lookup_prefers_imdb_and_returns_exact_matches(
    provider_module: Any, monkeypatch: pytest.MonkeyPatch
):
    provider, session = _provider(
        provider_module,
        monkeypatch,
        [
            FakeResponse(
                json_data={
                    "subtitles": [
                        {
                            "id": "sfm-episode",
                            "url": "https://api.example.test/episodes/1/subtitle.srt",
                            "lang": "eng",
                        }
                    ]
                }
            )
        ],
    )
    video = Episode(series_imdb_id="tt123", anilist_id=99, season=2, episode=4)
    subtitles = provider.list_subtitles(video, {Language("eng")})

    assert session.headers["Authorization"] == "Bearer sfm_test_secret"
    assert session.calls[0][0].endswith("/v1/subtitles/series/tt123%3A2%3A4")
    assert len(subtitles) == 1
    assert subtitles[0].get_matches(video) == {
        "series",
        "series_imdb_id",
        "season",
        "episode",
    }


def test_anilist_fallback_and_bibliographic_language_conversion(
    provider_module: Any, monkeypatch: pytest.MonkeyPatch
):
    provider, session = _provider(
        provider_module,
        monkeypatch,
        [
            FakeResponse(
                json_data={
                    "subtitles": [
                        {"id": "sfm-fr", "url": "/episodes/2/subtitle.srt", "lang": "fre"}
                    ]
                }
            )
        ],
    )
    video = Episode(anilist_id=21, episode=7)
    subtitles = provider.list_subtitles(video, {Language("fra")})

    assert session.calls[0][0].endswith("/v1/subtitles/series/anilist%3A21%3A7")
    assert subtitles[0].language.alpha3 == "fra"
    assert subtitles[0].get_matches(video) == {"series", "season", "episode"}


def test_filters_out_languages_bazarr_did_not_request(
    provider_module: Any, monkeypatch: pytest.MonkeyPatch
):
    provider, _ = _provider(
        provider_module,
        monkeypatch,
        [
            FakeResponse(
                json_data={
                    "subtitles": [
                        {"id": "sfm-es", "url": "/episodes/3/subtitle.srt", "lang": "spa"}
                    ]
                }
            )
        ],
    )
    assert provider.list_subtitles(
        Movie(imdb_id="tt456"), {Language("eng")}
    ) == []


@pytest.mark.parametrize(
    "status,headers,error",
    [
        (401, {}, AuthenticationError),
        (429, {"Retry-After": "60"}, APIThrottled),
        (503, {}, ServiceUnavailable),
    ],
)
def test_maps_api_failures_to_bazarr_provider_errors(
    provider_module: Any,
    monkeypatch: pytest.MonkeyPatch,
    status: int,
    headers: dict[str, str],
    error: type[Exception],
):
    provider, _ = _provider(
        provider_module,
        monkeypatch,
        [FakeResponse(status_code=status, headers=headers)],
    )
    with pytest.raises(error):
        provider.list_subtitles(Movie(imdb_id="tt456"), {Language("eng")})


def test_download_removes_api_key_before_following_artifact_redirect(
    provider_module: Any, monkeypatch: pytest.MonkeyPatch
):
    provider, session = _provider(
        provider_module,
        monkeypatch,
        [FakeResponse(content=b"1\n00:00:00,000 --> 00:00:01,000\nHello\n")],
    )
    subtitle = provider_module.SubtitleFmSubtitle(
        Language("eng"),
        "sfm-1",
        "/episodes/1/subtitle.srt",
        Movie(imdb_id="tt456"),
        "imdb",
    )
    provider.download_subtitle(subtitle)

    assert subtitle.content.startswith(b"1\n")
    assert session.calls[0][0] == "https://api.example.test/episodes/1/subtitle.srt"
    assert session.calls[0][1]["headers"] == {"Authorization": None}
    assert session.calls[0][1]["allow_redirects"] is True
