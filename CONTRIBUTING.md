# Contributing

Thanks for helping improve Subtitle.fm.

## Before opening a pull request

1. Open an issue for substantial product, schema, protocol, or deployment changes.
2. Fork the repository and create a focused branch from `main`.
3. Keep credentials and real user/media data out of code, fixtures, logs, screenshots, and commits.
4. Add or update tests for behavior changes.
5. Run the validation commands documented in the README.

Use Conventional Commit-style subjects when practical, for example `fix(api): authenticate upload
presigning`. Keep generated migrations in the same pull request as their schema change and explain
deployment or data-migration implications.

## Development expectations

- Preserve authentication, authorization, signed-webhook, CSP, and SSRF defenses.
- Avoid logging tokens, signed URLs, OAuth payloads, subtitle text, or private media locations.
- Keep API and queue contracts backward-compatible or document the migration clearly.
- Do not add generated media, model weights, databases, cache directories, or local environment
  files to Git.
- Confirm that new dependencies have a compatible license and no unresolved production advisory.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
