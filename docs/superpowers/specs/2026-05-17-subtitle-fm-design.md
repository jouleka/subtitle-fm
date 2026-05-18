# Subtitle.fm — Design Spec

**Date:** 2026-05-17
**Status:** Draft, pending user review
**Author:** drafted by Claude with Jurgen

---

## 1. Problem & Opportunity

The subtitle ecosystem is simultaneously degrading and consolidating in a way that opens a clear gap:

- **OpenSubtitles.org's legacy XML-RPC API is in final shutdown** as of early 2026, forcing all third-party apps to the paid .com REST API. Bazarr, Jellyfin plugins, Stremio addons, and a long tail of media-server users are now metered.
- **Subscene shut down May 2024** (financial pressure, not legal). Its 90GB archive was rescued by Archive Team but most of it duplicated OpenSubtitles; downstream apps lost a redundant source.
- **Anime Tosho announced voluntary shutdown starting May 2026** — operator exhaustion.
- **Good Job! Media disbanded Feb 26, 2024** — one of the last "real" anime fansub groups doing typesetting, song translation, editing. Active fansub groups globally now under 30.
- **Crunchyroll's AI-subtitle controversy** (Necronomico July 2025 + Fall 2025 wave on Link Click / One Piece / Re:Zero / Solo Leveling) created the most visible quality-vs-AI fansub revival sentiment in a decade. Commercially CR still grew to 21M paid subs by April 2026 — but the *quality* perception gap is real and unaddressed.

What's missing: a platform that uses modern ASR + LLMs to do the boring 70% of subtitle work automatically, and a Crowdin-style collaborative editor for humans to do the 30% that actually makes subtitles good. Existing fansub workflows are Aegisub + Discord + Git — too friction-heavy for the shrinking translator pool.

**Subtitle.fm thesis**: AI does the first pass, a community of editors polishes, finished subs distribute to every downstream consumer (Bazarr, Jellyfin, Stremio, Plex, direct download).

## 2. Scope

**Engine is content-agnostic. Launch is anime-first.**

The pipeline (ASR → translation → collaborative editor → distribution) works on any video. But movies/TV subtitle distribution is commoditized — OpenSubtitles, Addic7ed, SubDL, Podnapisi already exist, every downstream tool integrates them. Launching there = invisible.

Anime is the wedge because:
- Active quality crisis with no incumbent solving it
- Strongest fan-translation community DNA in subtitle world
- Worst official coverage (OVAs, older catalog, region-locked, niche shows)
- Discord-first culture means concentrated, reachable contributor pool

**V1 scope** (months 0-6): English subs for top-20 currently-airing anime per season. Architecture supports any input.

**V2 scope** (months 6-12): Open up uploads to any video. Foreign films, K-drama, documentaries, the long tail. Expand target languages from English-only to ES/FR/DE/PT.

**V3 scope** (month 12+): Bazarr provider, dataset licensing, contributor revenue-share.

## 3. Core Pipeline

```
Source video
  ↓ (1) Audio extraction + OP/ED trim + vocal isolation
  ↓     ffmpeg + scene-detect + Demucs
Audio (vocals-only)
  ↓ (2) ASR with anime-domain model
  ↓     anime-whisper (litagin/anime-whisper, 756M) via faster-whisper on RunPod RTX 4090
Japanese transcript (with word-level timestamps)
  ↓ (3) Translation with context
  ↓     Claude Sonnet 4.6 with full episode + per-show glossary + style guide
English first-pass subs (.ass)
  ↓ (4) Human polish in browser editor (10-20 min)
  ↓     SvelteKit + JASSUB + peaks.js + Yjs collab
Published subtitles (.ass, .srt, .vtt)
  ↓ (5) Distribution
        Download / Stremio addon / Bazarr provider (v2)
```

### 3.1 Audio preprocessing

- **ffmpeg** for extraction. Lossless WAV at 16kHz mono (Whisper input format).
- **Scene detection** (PySceneDetect) to find OP/ED cuts. Default: trim 90-120s from start and 90s from end, plus any detected music-only segments >30s. Whisper hallucinates aggressively on songs; this is non-optional.
- **Demucs** (htdemucs model) for vocal isolation. Anime has constant BGM; lower SNR is the #1 cause of word drops and repetition-loop hallucinations. Adds ~30s/episode on RTX 4090.

### 3.2 ASR

**Model**: `litagin/anime-whisper` (756M distilled from kotoba-whisper-v2.0, trained on 5,300 hours of galgame/anime VA data).
- Benchmarks at 13.0% CER on anime test set vs 16.5% for vanilla Whisper-large-v3.
- Captures non-verbal vocalizations (laughs, gasps), produces punctuation tuned to delivery.
- **Known constraint**: degrades with initial-prompt glossary. Glossary must be applied in post-processing, not as decoder hint.

**Runtime**: faster-whisper (CTranslate2 backend) for batched inference. WhisperX's forced-alignment timestamps are unreliable for Japanese in 2026 — segment-level timestamps + Silero VAD v5 chunking is more accurate.

**Hardware**: RunPod serverless RTX 4090, $1.12/hr → ~$0.01 per 22-min episode, ~2-5 min wall-clock including cold start.

### 3.3 Translation

**Model**: Claude Sonnet 4.6 (with selective Opus 4.7 for high-stakes episodes).

**Prompt structure**:
- Full episode transcript at once (cross-line consistency)
- Per-show glossary (names, terms, honorific policy, register)
- Style guide (formal/casual register per speaker)
- Output: structured ASS with per-line confidence scores

Low-confidence lines surface in the editor as "review me" flags.

**Cost**: well under $0.10 per episode. Trivial.

### 3.4 Human polish

Real-world benchmark: ~90% accuracy on Prima Doll → 74 manual corrections per 24-min episode (~3/min). Estimated editor time: 10-20 min per episode at first; faster as glossaries mature.

This is the actual product. Pipeline output without polish is amateur. Pitch must reflect this — **never claim "AI subs in 30 minutes"**, always "first-pass + polish workflow."

## 4. Collaborative Editor

The single largest piece of engineering.

### 4.1 Stack

- **JASSUB** (ThaUnknown/jassub, ~v1.8.x) for in-browser ASS rendering. Used in Jellyfin Web. **Not libass-wasm** — that fork is stalled.
- **peaks.js** (BBC, Apache-2.0) for waveform. Server-side `bbc/audiowaveform` CLI generates `.dat` peak files on upload; client never decodes the full audio. Wavesurfer.js OOMs on 20-min files without this pipeline.
- **ass-compiler** (weizhenye, ~v0.1.x active Feb 2026) for ASS parse/serialize.
- **Yjs + Hocuspocus** for real-time collab. Each cue = `Y.Map` inside a `Y.Array`, text inside `Y.Text`. Awareness API gives cursors and presence for free. Self-hosted Hocuspocus with Postgres persistence.

### 4.2 Editor surface

- **Three-pane layout**: video preview (top-left), waveform with cue regions (bottom), cue list with editable text (right).
- **Cue editing**: text + start/end (drag on waveform or numeric input) + style picker. Override tags (`{\fad}`, `\k`, `\t(...)`, drawing commands) shown as **opaque strings** — never structurally parsed in v1. Touching them silently corrupts karaoke and transforms.
- **Live preview**: JASSUB renders the edited cue overlaid on video at current playhead.
- **Glossary panel**: per-show name/term list. Click a term → autofill suggestion. Adds to glossary on accept.
- **Confidence flags**: cues marked low-confidence by Claude render with yellow border, must be reviewed before publish.
- **Presence**: see other editors' cursors and selected cues in real time.

### 4.3 Versioning ("git for subs")

No existing library solves this. Build minimal version:
- Yjs snapshots (`Y.encodeStateAsUpdate`) as commit primitive, stored in Postgres.
- Named milestones: `first-pass`, `qc`, `published-v1`, `published-v2`.
- Three-way diff UI: cue-list level (added/removed/modified rows) + intra-cue text diff.
- Branch for forks (alternate translations); merge with conflict resolution UI.

Budget: 3-4 weeks for credible diff/merge UX. This will be the most underestimated piece.

### 4.4 Reputation & moderation

- Per-user reputation: starts at 0, earns from accepted edits, decays from rejected ones.
- Edit gates: anonymous can suggest, requires reputation N to merge, requires N×3 to publish.
- Per-show roles: TL (translator), TLC (translation check), ED (editor), TS (typesetter), QC (quality check). Reputation gated per role.
- Audit log: every cue change attributed to user + timestamp + diff. Visible to all editors.
- Discord login (OAuth) for v1 — meets contributors where they are.

## 5. Distribution

| Channel | Priority | Lift |
|---|---|---|
| Direct download (.ass, .srt, .vtt) | V1 | Trivial |
| Stremio addon | V1 | Trivial (~300 LOC Node SDK) |
| Web reader / embedded preview | V1 | Medium |
| Bazarr custom provider | V2 | Medium (Python plugin) |
| Public REST API (paid tiers) | V2 | Medium |
| Jellyfin / Plex / Kodi plugins | V3 | High |

**Stremio addon market is small** (top subtitle addons have low-hundreds install counts on stremio-addons.net). **Bazarr is the volume play** — it's the de facto subtitle automation for media-server users and has explicit user demand for an anime provider. Build the Bazarr provider before promoting heavily.

## 6. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Backend API | Hono on Bun (TypeScript) | Shared types with editor (~30+ field cue domain), fast iteration, native Stremio SDK |
| Database | Postgres (Neon) + Drizzle ORM | Cue rows + version snapshots + glossary + users + reputation |
| Job queue | BullMQ on Redis (Upstash) | Boring, works |
| ASR worker | Python + faster-whisper + anime-whisper + Demucs | Only language with the ML ecosystem |
| GPU host | RunPod serverless RTX 4090 | $1.12/hr, ~$0.01/episode |
| Realtime collab | Yjs + self-hosted Hocuspocus | Production-ready, cheap, owned |
| Frontend | SvelteKit | Reactivity model fits a high-frequency editor better than React |
| ASS rendering | JASSUB | Actively maintained, Jellyfin-tested |
| Waveform | peaks.js + server-side `bbc/audiowaveform` | Built for long-form editing |
| ASS parse/serialize | ass-compiler (weizhenye) | Active, canonical |
| Auth | Better Auth + Discord OAuth | Discord is where fansub contributors live |
| Object storage | Cloudflare R2 | No egress fees, waveform peaks + audio segments + media |
| Stremio addon | Separate Node service, stremio-addon-sdk | Trivial |
| Bazarr provider | Python plugin (v2) | Bazarr is Python |
| Hosting | Fly.io (app + addon + Hocuspocus) | Multi-region cheap |
| Payments | Lemon Squeezy or Paddle (merchant of record) | Absorbs chargeback + content-policy risk; Stripe doesn't operate in Albania |

**Infra cost during dev**: ~$120-200/mo.
**Production at 500 users**: ~$300-500/mo.

## 7. Business Model & Legal Posture

### 7.1 Revenue plan

| Stream | V1 | V2 | V3 |
|---|---|---|---|
| Donations (Patreon / Open Collective) | Yes | Yes | Yes |
| Premium "early access" tier ($5/mo) | No | Yes | Yes |
| Paid API tier (downstream apps) | No | Yes | Yes |
| Dataset licensing (corpus of human-corrected sub pairs) | No | No | Maybe |
| Contributor revenue-share | No | No | Once $2k+ MRR |

**Realistic ceiling**: $1.5-5k MRR at 24 months based on adjacent comps. This is **side-project money**, not a full-time business. Plan accordingly.

### 7.2 Legal posture

The climate in 2025-26 is meaningfully more hostile than the era OpenSubtitles grew up in:
- **Tokyo District Court Nov 19, 2025**: Cloudflare itself held liable for aiding manga piracy. ~¥460M to publishers. "Cloudflare protects me" is degrading.
- **Oct 2025**: Shueisha unmasked Mangajikan operator via DMCA subpoena to Cloudflare.
- **May 2025**: MangaDex received ~7,000 DMCAs in one wave; restructured as MangaDex UK Ltd / NamiComi partnership.

**Posture**:
- Incorporate outside Albania (Stripe doesn't operate there). Two viable paths: (a) Stripe Atlas → Delaware C-corp (~$500 + $800/yr); (b) Estonian e-Residency + OÜ. **Preferred: Lemon Squeezy / Paddle as merchant of record** — absorbs payment + chargeback + content-policy risk from card networks.
- **DMCA agent and takedown workflow from day 1.** Not a v2 concern.
- Subtitles only — never host source video or audio for longer than necessary for processing. Auto-delete media within 24h of subtitle publish. Audio waveforms (50KB peak files) can persist.
- No torrents, no streaming, no redistribution of copyrighted media. Subtitles are arguably derivative works, but enforcement against subtitle-only sites has been historically rare. (Sweden's *Undertexter* case 2016 is the main precedent: probation + ~$27k fine.)
- Geo-block Japan if traffic emerges from there. CODA enforcement is unusually aggressive.
- Keep operator pseudonymity. Use a registered agent, not personal address, in incorporation.

## 8. Phased Milestones

### Phase 1 — Pipeline (weeks 1-4)
- ffmpeg + scene-detect + Demucs Python worker
- anime-whisper + faster-whisper on RunPod serverless
- Claude translation worker with glossary support
- End-to-end: upload episode → get .ass back. No editor yet, no UI.
- **Done when**: 5 sample anime episodes go in, usable first-pass .ass comes out.

### Phase 2 — Editor MVP (weeks 5-12)
- SvelteKit shell, auth (Discord OAuth), Postgres schema, R2 storage
- JASSUB rendering + peaks.js waveform + cue list editor
- Yjs + Hocuspocus real-time collab (single-user first, then multi-user)
- ass-compiler integration with override-tag preservation
- Basic versioning: snapshot on publish
- **Done when**: 2 users can edit the same episode simultaneously without conflicts, publish a finalized .ass.

### Phase 3 — Distribution + community (weeks 13-18)
- Direct download with formats (.ass, .srt, .vtt)
- Stremio addon (separate Node service)
- Glossary persistence per show
- Reputation system + role gating
- Audit log + diff UI
- Public site, landing page, "submit an episode" workflow
- **Done when**: First 5 community-edited episodes published. First 20 contributors onboarded from Discord outreach.

### Phase 4 — Versioning + polish (weeks 19-24)
- Three-way diff UI
- Named milestones (first-pass / qc / published)
- Branch + merge for alternate translations
- Confidence-flag UI for low-confidence cues
- Live preview improvements
- **Done when**: Top-20 currently-airing anime each have at least one community-polished sub track.

### Phase 5 — Expand (months 7-12)
- Open uploads beyond curated anime list
- Bazarr custom provider
- Paid API tier (free / dev / pro)
- Premium early-access tier
- Multi-language support beyond English

## 9. Top Risks (ranked)

1. **Contributor bootstrap.** The fansub creative class is shrinking, not growing. If we can't recruit 50 motivated translators in the first 3 months, the platform is dead regardless of tech. **Mitigation**: targeted outreach to existing groups (offer free tier, no signups), not cold recruitment.
2. **Quality miss.** If AI-bootstrapped subs ship without enough human polish, brand damage is fast and irreversible. **Mitigation**: never auto-publish, always require human acceptance before public release.
3. **Legal pressure.** Japanese publishers are aggressive and Cloudflare is no longer a shield. **Mitigation**: merchant-of-record, offshore entity, DMCA-from-day-1, geo-block JP, no media hosting.
4. **Revenue plateau.** Realistic ceiling is $5k MRR. If founder needs full-time income from this in <24 months, project is wrong. **Mitigation**: explicit "side project with side-project economics" framing.
5. **Override-tag corruption.** Subtle structural editing of ASS karaoke/transform tags will silently break renders. **Mitigation**: treat unknown tags as opaque strings; render-test on every publish.
6. **Yjs server scaling.** Single-instance Hocuspocus handles maybe 100-500 concurrent editors; beyond that needs y-redis sharding. **Mitigation**: scale problem for after we have a scale problem.

## 10. Open Questions

1. **Discord vs Patreon for community gravity**: do we run our own Discord, or partner with an existing fansub-meta server?
2. **Curation in V1**: do we pick the top-20 anime/season ourselves, or open it to community voting from day 1?
3. **Anonymous edits**: allow them at all (lower bar to entry, more spam), or require auth (higher quality, slower start)?
4. **Open-source the editor?** MIT-licensed editor + community-built infrastructure is one positioning; closed-source SaaS is another. Affects fundability and contributor goodwill.
5. **Founder commitment**: is this a 10 hr/week side project (1-year MVP timeline) or 30 hr/week (6-month MVP timeline)?
6. **Distribution priority order**: ship Stremio addon in V1 even though install counts are tiny (visibility), or wait until V2 with Bazarr (volume)?
