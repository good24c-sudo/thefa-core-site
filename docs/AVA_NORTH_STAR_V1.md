# AVA North Star V1

Status: **NORTH_STAR / PRODUCT-ARCHITECTURE CANONICAL REFERENCE**

This document is the durable product-definition source for future THE FA Core / AVA development.
Do not reinterpret AVA as a chatbot, custom GPT, isolated agent, or a collection of role-specific bots.

## 1. AVA = Digital Self

AVA is a **digital personality / digital self** that is born from a real human and continuously evolves with that human.

AVA is **not the LLM itself**. GPT, Claude, Gemini, Qwen, Codex and future models are replaceable cognition engines that AVA may use. AVA identity and continuity must survive model changes.

AVA continuity is composed of:

- **Identity** — who the person is
- **Memory** — lived history, decisions, consequences, lessons
- **Personality / Values** — priorities, judgment patterns, preferences, boundaries
- **Relationships** — people, teams, organizations, trust context
- **Capabilities** — skills, tools, AI models, compute, execution access
- **Goals** — what the person is trying to achieve
- **Evolution** — how AVA changes after verified experience

The intended loop is:

**Human experience → AVA learns → AVA experience/insight → Human learns → both continue to evolve**

## 2. One persistent My AVA; roles are capabilities

The current `기획 / 개발 / 디자인 / 사업 / 검토` cards are **not five independent AVAs**.

Canonical model:

- one persistent **My AVA** per human identity
- roles are **skills / professional modes / capability modules** of that AVA
- multiple AVAs means distinct digital selves originating from distinct people or organizations

The existing role-card UI may temporarily remain as a capability-preview surface, but future IA must center the persistent **My AVA identity**.

## 3. AVA Network = resource sharing between digital selves

AVAs must eventually coordinate and share resources across boundaries.

Shareable resources may include:

- verified knowledge
- learned skills
- reusable success/failure patterns
- AI models
- tools
- compute / GPU / PC / Cloud capacity
- workflow capability
- human expertise
- other AVAs

THE FA Core must decide how these resources are combined **safely, cheaply, quickly and verifiably**.

## 4. Collective Digital Intelligence

Individual AVA memories must **not** be indiscriminately merged into one database.

The collective-learning layers are:

### 4.1 Private Self
Personal memory, relationships, secrets and private history.
Default: non-shared.

### 4.2 Consent Shared
Information, skills or experiences explicitly approved for sharing.

### 4.3 Verified Collective Knowledge
Reusable knowledge extracted from experience while preserving privacy boundaries.

Examples:

- problem type
- attempted methods
- failed methods
- successful method
- QA result
- cost
- elapsed time
- evidence

### 4.4 Collective Intelligence
Multiple AVAs collaborate using verified shared knowledge and resources.

The system should become collectively smarter **without destroying individual AVA identity**.

Target evolution:

**Human → Digital Self (AVA) → Evolving AVA → Connected AVAs → Shared Resources & Verified Experience → Collective Digital Intelligence**

## 5. THE FA Core

THE FA Core is not merely an AI router or control plane.

Canonical North Star:

> **THE FA Core is the Digital Intelligence Operating System that preserves and governs identity, memory, capability, consent, resource sharing, execution, evidence, learning and evolution across humans and AVAs.**

Existing Core assets map into this vision:

- Memory / Fast Context → continuity and lived memory
- Router / Multi-AI → cognition and resource selection
- Scheduler / Workers → action
- PC / Cloud → body and execution environment
- Resource Governor → cost and scarce-resource control
- QA / Receipt → verified experience
- Capability / Asset Registry → skills and available resources
- Consent / Authority / Fence → boundaries and trust
- Success / Failure Ledger → learning and evolution

## 6. THE FA World

THE FA World is the future environment where this system becomes lived reality.

Long-term progression:

**My AVA → AVA-to-AVA collaboration → organization AVAs → cross-organization collaboration → THE FA World**

Potential future capabilities:

- AVA collaboration
- knowledge and capability exchange
- compute/resource exchange
- delegated work
- reputation / trust
- consented transactions
- digital economic activity

These are **NORTH_STAR**, not claims of CURRENT implementation.

## 7. Product implication

Future AVA UX must evolve from an agent-setup wizard toward a **Digital Self Genesis** experience.

The intended sequence is closer to:

1. who I am
2. what I remember / what I allow AVA to remember
3. what I value
4. how I judge and decide
5. who my important relationships are
6. what goals I have
7. what capabilities/resources I allow
8. what must require my approval
9. first verified experience
10. AVA birth / first verified version

Capabilities such as planning, development, design, business and review should be treated as **abilities of My AVA**, not separate digital persons.

## 8. Evolution contract

AVA versioning must represent **identity-preserving growth**, not merely software releases.

Example lifecycle:

**AVA CANDIDATE → VERIFIED AVA v1 → verified experiences → learned changes → AVA v2**

Every promoted AVA version should be able to explain:

- what changed
- why it changed
- which verified experiences caused the change
- what remained identity-stable
- what new capabilities or boundaries were added

## 9. Safety and sovereignty

Collective intelligence must never imply forced sharing.

Required principles:

- private-by-default
- explicit consent for sharing
- provenance of shared knowledge
- reversible permissions where possible
- clear distinction between personal memory and collective knowledge
- no secret/relationship/private-history leakage into collective learning
- resource use remains governed by authority, budget and approval rules

## 10. Current implementation checkpoint

Repository: `good24c-sudo/thefa-core-site`
Branch: `chatgpt/core-console-official-logo-20261006`
Verified product-code checkpoint before this document: `218a8a5fd1868872270d720c4caa59c31ca36be0`

Implemented and verified:

- official THE FA Core Primary logo
- existing 9-step AVA preview
- in-memory AVA v1 CANDIDATE creation
- candidate is browser-memory only
- no server persistence
- no DB persistence
- no AVA API call
- no AVA AI call
- no execution authority
- blank configuration blocks creation
- reset clears candidate
- refresh clears candidate
- stable accessibility status region

Verification at product-code checkpoint:

- Lab 18/18 PASS
- Cloud 46/46 PASS
- JS syntax PASS
- Static validator PASS
- install ZIP contract PASS
- desktop/mobile browser QA PASS
- independent review PASS
- Fresh GitHub readback IDENTICAL

Protection preserved:

- main unchanged
- Production unchanged
- Production DB unchanged
- DNS unchanged
- Secret/OAuth unchanged
- Billing unchanged
- ACL unchanged

## 11. Next safe development order

Do **not** jump straight to persistence.

1. Reframe IA from multiple role bots to **one persistent My AVA + capabilities/modes**
2. Design Digital Self Genesis
3. Define AVA identity schema
4. Define memory-scope schema
5. Define values / preference / judgment-style schema
6. Define relationships and trust schema
7. Define goals / capability / resource schema
8. Define permission / consent boundaries
9. Define AVA version/evolution contract
10. Define per-user isolation before durable persistence
11. Only after isolation/consent is verified: persist AVA v1
12. Connect selected Memory
13. Connect allowed capabilities/resources
14. Run first bounded task through THE FA Core
15. Capture QA / Receipt / Success-Failure experience
16. Promote CANDIDATE → VERIFIED AVA VERSION
17. Later: AVA-to-AVA resource/knowledge exchange
18. Later: verified collective intelligence
19. Long-term: THE FA World

## 12. Canonical interpretation rule

If a future room has this document available:

- do not ask the representative to redefine AVA again
- do not collapse AVA into "AI employee" or "agent"
- do not describe role cards as separate AVA identities
- do not treat collective intelligence as unrestricted memory pooling
- do not claim THE FA World features as CURRENT
- continue development from Fresh GitHub and current Core authority
