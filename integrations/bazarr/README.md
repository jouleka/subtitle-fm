# Subtitle.fm Bazarr provider

This directory contains the upstream-ready provider for SFM-42. It targets the
current Bazarr `master` provider API verified at commit `e54edd7` (2026-07-16).

## Upstream layout

1. Copy `subtitlefm.py` to
   `custom_libs/subliminal_patch/providers/subtitlefm.py` in Bazarr.
2. Apply `bazarr-wiring.patch` at the Bazarr repository root.
3. Copy/adapt the tests from
   `apps/worker/tests/test_bazarr_subtitlefm_provider.py` into Bazarr's
   `tests/subliminal_patch/` suite.
4. Run Bazarr's provider tests and frontend checks, then open the upstream PR.

The provider authenticates with the one-time key created at `/dashboard`, calls
the metered `/v1/subtitles` endpoint, prefers IMDb identity (including season and
episode), falls back to AniList for anime entries, converts ISO-639-2/B language
codes to Bazarr's terminology codes, and downloads the public published SRT.

HTTP `401`, `429`, and `503` responses map to Bazarr's authentication,
throttling, and service-unavailable exceptions respectively. The API key is
explicitly removed before following a subtitle artifact redirect.

The files in this repository can be tested locally without a Bazarr install:

```sh
apps/worker/.venv/bin/pytest -q apps/worker/tests/test_bazarr_subtitlefm_provider.py
```

Registry publication requires an upstream Bazarr pull request; it is not
performed by the Subtitle.fm application deployment.
