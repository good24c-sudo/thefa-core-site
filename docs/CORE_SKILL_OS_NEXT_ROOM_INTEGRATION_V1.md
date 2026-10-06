# Core / Universal Skill OS / Multi-AI Next-Room Integration V1

Status: **PENDING_INTAKE / NEXT-ROOM INTEGRATION CONTRACT**

This document does not claim that `THE_FA_UNIVERSAL_SKILL_OS_V1` is complete.

Its purpose is to ensure that, once the ongoing Plus development is completed and verified, the next development room consumes it immediately without asking the representative to re-explain Factory, Local AI, Skill OS, or their relationship to AVA.

## 1. Current observation

At the time this handoff was prepared:

- P02 / room family 19 Core workstream: `THE_FA_CORE_V2`
- repository: `good24c-sudo/THE_FA_PRODUCTION`
- branch: `chatgpt/19v1-the-fa-core-v2-20260929`
- observed Core HEAD: `1e8cb3d50f009b4e4e5526124c6b77bd2d4fac25`
- observed writer: `P02:19_v1:CLAUDE_CODE:DESKTOP-0MRB113`
- observed fence: `3`
- Core blocker list: empty
- previous exact-head QA is stale because HEAD moved
- current exact-head central QA must be re-read fresh before any completion claim

The Universal Skill OS name/content was **not yet present in Fresh GitHub search or the installed ChatGPT Skill list at this observation point**.

Therefore:

> **Do not treat THE_FA_UNIVERSAL_SKILL_OS_V1 as completed until a fresh Plus terminal receipt / branch HEAD / exact-head QA proves completion.**

## 2. Required intake after Plus completes

The next room must perform this intake before continuing development:

1. Read THE FA Core exact workstream `THE_FA_CORE_V2`
2. Read Fresh GitHub repository / branch / HEAD for the Plus Skill OS result
3. Find the exact artifacts for:
   - `THE_FA_UNIVERSAL_SKILL_OS_V1`
   - Role Select
   - Multi-Role Composer
   - Capability Manifest
   - Asset Registry
   - Skill Candidate
   - Skill Stack Builder / equivalent composition logic
   - MCP / Skill bridge
   - BuildUp execution binding
4. Read the terminal receipt and exact-head QA
5. Confirm current writer / fence / owned paths
6. Confirm no duplicate Core / Router / Scheduler / Memory / Resource Governor was introduced
7. Only then promote the result from **PENDING_INTAKE** to a reusable Core capability

Do not infer completion from chat text, local files, old branch content, or a PASS on an earlier HEAD.

## 3. Architectural role of Universal Skill OS

Universal Skill OS is not a second Core.

Canonical relationship:

**AVA → Capability / Skill request → Universal Skill OS → Core authority / Resource selection → BuildUp execution → QA / Receipt → verified experience**

Universal Skill OS should provide the reusable capability layer for:

- skill discovery
- skill indexing
- role/capability matching
- safe skill composition
- conflict detection
- capability provenance
- versioning
- compatibility
- required permissions
- required resources
- estimated cost
- tests/evals
- success/failure evidence

It must consume existing Capability Manifest / Asset Registry / BuildUp infrastructure instead of duplicating them.

## 4. AVA integration

Read `AVA_START_HERE.md` and `docs/AVA_NORTH_STAR_V1.md` before product design.

Canonical rule:

> **Skills are abilities acquired/used by My AVA. They are not separate AVA identities.**

Examples:

- planning
- development
- design
- business analysis
- review
- browser operation
- document creation
- coding
- data analysis

These are capability modules of one persistent Digital Self.

Long-term evolution:

**AVA experience → verified skill/evidence → private learning → consented share → verified collective knowledge → AVA network collective intelligence**

Universal Skill OS is therefore a technical bridge between the current Core and future AVA evolution / Collective Intelligence.

## 5. Factory Droid

Factory Droid is an official **execution-resource candidate**, not authority.

Observed/local facts:

- CLI: `droid`
- observed version: `0.228.1`
- existing THE FA Factory worktrees/sessions exist
- prior THE FA code already recognizes `FACTORY_DROID` as an asset/writer-capable candidate
- Factory can be used for read-only analysis, isolated implementation, eval/test generation and independent review

Required policy:

**Core CURRENT → Fresh HEAD → writer/fence → owned paths → isolated worktree → Factory → tests → exact-head QA → receipt**

Default use:

- read-only independent analysis/review
- large-repository comparison
- test/eval generation
- independent owned-path implementation when Factory is the single writer

Do not:

- point Factory at arbitrary `C:\THE_FA_PRODUCTION` checkout
- let Factory invent CURRENT
- allow two writers on the same workstream
- use `--skip-permissions-unsafe`
- use Mission / unrestricted high-autonomy mode until a dedicated Sandbox/Fence adapter is verified

## 6. Current AI/CLI resource inventory

This is an observation snapshot, not permanent truth. Re-enumerate on every major next-room boot.

Detected CLI resources:

- Claude Code `2.1.274`
- Codex CLI `0.154.0`
- Factory Droid `0.228.1`
- Gemini CLI `0.59.0`
- Ollama `0.35.1`
- OpenCode `2.0.6`
- Aider `0.86.2`
- Goose `1.51.0`
- LM Studio CLI (`lms`)
- Antigravity IDE installed

Detected Ollama models:

- `thefa-qwen3-coder:16k`
- `qwen3-coder:30b`
- `qwen3:4b`
- `qwen2.5-coder:3b`
- `nomic-embed-text`

Detected LM Studio models:

- `apertus-v1.5-8b-text`
- `local/apertus-v1.5-8b-nothink`
- `text-embedding-nomic-embed-text-v1.5`

## 7. Local AI policy

Local AI is a low-cost execution resource, not authority.

Recommended routing roles:

- embeddings / indexing → Nomic embedding models
- fast classification / lightweight checks → small Qwen / Apertus
- code review / repo analysis → larger Qwen coder / Apertus where fit
- deterministic search/filtering → local tools before LLM when possible
- hard integration / final writer → current authorized strong writer only

Model availability and health must be read live.

Do not assume:
- installed = healthy
- healthy = suitable
- suitable = write-authorized

## 8. BuildUp resource model

The future resource registry should treat all of the following as schedulable resources:

- AI model
- subscription-authenticated AI CLI
- API provider
- Local AI model
- embedding model
- PC
- GPU
- Cloud runtime
- sandbox
- browser
- Skill
- MCP tool
- human reviewer
- AVA / AVA capability

Selection should consider:

- capability fit
- authority
- privacy
- latency
- cost
- quota/headroom
- local availability
- failure history
- QA requirements

## 9. Next-room boot sequence

When the next room begins:

1. Read `AVA_START_HERE.md`
2. Read `docs/AVA_NORTH_STAR_V1.md`
3. Read this document
4. Read exact Core workstream `THE_FA_CORE_V2`
5. Read Fresh GitHub across relevant branches, not main only
6. Detect whether Plus completed `THE_FA_UNIVERSAL_SKILL_OS_V1`
7. If complete, verify its result HEAD and terminal receipt
8. Re-enumerate installed Skills / Factory / CLI AI / Ollama / LM Studio models
9. Reconcile assets with Capability Manifest / Asset Registry
10. Resume the next bounded development slice

If Plus is still developing, do not compete for its workstream. Stay read-only or use a clearly independent workstream.

## 10. Protection

This document grants no mutation authority.

Still prohibited without representative approval:

- main direct mutation/merge
- Production
- Production DB
- DNS
- Secret / OAuth
- Billing
- ACL
- bulk delete

Fresh authority and exact-head QA remain mandatory.

## 11. Product North Star linkage

Universal Skill OS should ultimately help realize:

**Human → Digital Self (AVA) → Evolving AVA → Connected AVAs → Shared Resources & Verified Experience → Collective Digital Intelligence → THE FA World**

The Skill OS is the capability-growth layer inside that architecture, not the final product identity.
