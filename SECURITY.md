# Security policy

## Supported versions

Only the latest commit on `main` receives security fixes. Subtitle.fm is early-stage software and
has not received an independent security audit.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, private media, databases, private
infrastructure, or exploit details in a public issue.

Use GitHub's **Security > Report a vulnerability** form for this repository. If private
vulnerability reporting is unavailable, contact the maintainer through a private channel listed on
their GitHub profile. Include the affected commit, impact, required preconditions, and a minimal
reproduction that contains no copyrighted or private media.

## Security boundaries

- `.env` files, OAuth secrets, API keys, database URLs, R2 credentials, backups, and runtime logs
  must never be committed.
- Keep the shipped Content Security Policy and HTTPS-only source-media validation enabled in public
  deployments.
- The collaboration server accepts short-lived signed tickets; never expose Better Auth session
  tokens to browser JavaScript or replace tickets with long-lived credentials.
- Webhook endpoints require HMAC signatures and bounded request bodies. Use distinct, randomly
  generated production secrets.
- The worker treats media as untrusted input and blocks private, loopback, link-local, and metadata
  destinations. Run it without cloud permissions beyond the required object-storage scope.
- AI-generated subtitles require human review. Operators are responsible for authorization to
  process and distribute media and subtitle text.
