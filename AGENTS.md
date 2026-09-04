# AGENTS.md — PLUKA

**Repository instruction file for Claude Code / Codex / coding agents**  
**Project:** PLUKA  
**Status:** Root engineering instructions — V1  
**Last consolidated:** 2026-09-03

---

# 0. Purpose

This file defines how coding agents must work inside the PLUKA repository.

It is not a product specification.

It is the operational contract for implementing the specifications without:

- inventing product behavior;
- weakening privacy;
- copying prototype hacks;
- over-engineering the stack;
- silently changing business rules;
- replacing deterministic engines with AI;
- introducing a second source of truth.

The primary rule is:

> **Read the relevant specs first. Implement the smallest correct slice. Do not guess when the repository already contains a decision.**

---

# 1. Product in one paragraph

PLUKA is an operational preparation platform for trail and ultra-trail runners.

It is not a coaching or training platform.

It transforms official race information, the runner’s target, the route, preparation choices and race context into a personal operational system including:

- Plan;
- Nutrition;
- Preparation;
- Assistance;
- Conditions;
- race information and sources;
- personal outings;
- after-race review.

For organizers, PLUKA remains pre-race focused and provides:

- course data quality;
- participant activation;
- aggregated preparation insights;
- Race Intelligence;
- question insights;
- organizer Brief.

PLUKA does **not** replace:

- registration platforms;
- timing;
- live tracking;
- PC race tools;
- Nolio / Runna / Garmin / Strava;
- medical or safety decision systems.

---

# 2. Required reading before coding

Before modifying a domain, read the relevant documents.

## Always read first

```text
docs/00_PRODUCT_SPEC.md
docs/01_ARCHITECTURE.md
docs/02_DATA_MODEL.md
docs/03_PRIVACY_RLS.md
docs/04_ENTITLEMENTS.md
docs/05_ROUTES_AND_FLOWS.md
docs/06_DESIGN_SYSTEM.md
docs/ACCEPTANCE_CRITERIA.md
```

## Engine-specific documents

```text
docs/engines/PLAN_ENGINE.md
docs/engines/NUTRITION_ENGINE.md
docs/engines/SOURCES_EXTRACTION.md
docs/engines/WEATHER_CONDITIONS.md
docs/engines/RACE_INTELLIGENCE.md
```

## Prototype references

```text
reference/prototype/PLUKA.dc.html
reference/prototype/PLUKA Homepage.dc.html
reference/prototype/PLUKA Organisateurs.dc.html
reference/prototype/PLUKA Charte Graphique v2.dc.html
```

The prototype is a **visual and UX reference**.

It is **not** authoritative for:

- algorithms;
- privacy;
- entitlements;
- SQL;
- business thresholds;
- weather science;
- Race Intelligence calibration.

Never copy prototype implementation code directly into production.

---

# 3. Source-of-truth order

When documents appear to conflict, use this priority.

## Privacy conflicts

```text
03_PRIVACY_RLS.md
→ blocking
```

Never weaken privacy to satisfy another document.

## Product behavior

```text
00_PRODUCT_SPEC.md
```

## Engine behavior

Use the specific engine spec.

## Commercial access

```text
04_ENTITLEMENTS.md
```

## Navigation / flows

```text
05_ROUTES_AND_FLOWS.md
```

## Architecture boundaries

```text
01_ARCHITECTURE.md
```

## Persistence

```text
02_DATA_MODEL.md
supabase/migrations/*
```

## Visual language

```text
06_DESIGN_SYSTEM.md
```

## Acceptance

```text
ACCEPTANCE_CRITERIA.md
```

If two authoritative sources genuinely disagree:

> **STOP. Report the contradiction. Do not choose silently.**

---

# 4. Engineering philosophy

PLUKA V1 should be built as a **modular monolith**.

Prefer:

- simple boundaries;
- pure domain logic;
- explicit types;
- deterministic calculations;
- PostgreSQL as source of truth;
- asynchronous workers only where needed;
- server-authoritative mutations;
- strong tests.

Avoid:

- microservices;
- event streaming infrastructure;
- premature warehouses;
- ML infrastructure;
- generic rule engines;
- over-abstracted repositories;
- code generation frameworks;
- speculative future architecture.

The project must remain understandable by a small team.

---

# 5. Expected technical stack

Target architecture:

```text
TypeScript
Next.js 16 App Router
Turborepo
Supabase
PostgreSQL
PostGIS
pgvector
Supabase Auth
Supabase Storage
Supabase Queues / worker pattern
Vercel
Vitest
Playwright
pgTAP
```

AI is allowed only where explicitly specified.

Do not introduce an alternative major framework without explicit approval.

---

# 6. Suggested repository shape

Follow the existing repository if already bootstrapped.

Target direction:

```text
apps/
├── web/
├── organizer/
└── admin/

packages/
├── domain/
├── ui/
├── plan-engine/
├── nutrition-engine/
├── sources/
├── weather/
├── race-intelligence/
├── db/
└── shared/

supabase/
├── migrations/
├── tests/
└── seed.sql

docs/
reference/
```

Do not reorganize the repository purely for aesthetics.

A structure change must solve a real problem.

---

# 7. One task at a time

Each coding task should be narrow.

Preferred pattern:

```text
one feature slice
+
clear acceptance criteria
+
tests
+
review
```

Do not opportunistically rewrite adjacent domains.

Examples:

Good:

```text
Implement RacePlan input validation and its unit tests.
```

Bad:

```text
Refactor Plan, Nutrition, Weather, routes and UI architecture while here.
```

---

# 8. Before changing code

For each task:

1. identify the domain;
2. read the relevant specs;
3. inspect the existing implementation;
4. inspect tests;
5. identify the smallest correct change;
6. check whether a DB migration is required;
7. check Privacy/RLS impact;
8. check entitlement impact;
9. check downstream dependencies;
10. then code.

Do not start implementation from the prompt alone if the repository contains the relevant specifications.

---

# 9. Never invent product behavior

Do not invent:

- a new subscription tier;
- a new navigation tab;
- a new onboarding question;
- a new Race Intelligence score;
- a new weather threshold;
- an automatic recommendation;
- a hidden admin capability;
- a new participant data field;
- a sponsor placement;
- a new role;
- a new notification cadence;
- a new free feature;
- a new premium restriction.

If a needed rule is absent:

> **Expose the missing decision instead of embedding a guess.**

---

# 10. No silent spec corrections

Do not “improve” a specification because another implementation feels cleaner.

Examples of forbidden silent changes:

```text
Race Pass 2 linked outings
→ 3 because easier
```

```text
Conditions J-14
→ trend at J-21
```

```text
Nutrition proposal
→ auto-apply because convenient
```

```text
Organizer Included
→ PLUKA+ equivalent globally
```

```text
RaceFact update
→ overwrite row instead of versioning
```

Any intentional spec change must be made explicitly in documentation first.

---

# 11. Deterministic engines

The following engines are deterministic and must remain so:

```text
Plan
Nutrition
Condition interpretation
Race Intelligence core
```

They must not depend on:

- an LLM;
- hidden prompt output;
- random behavior;
- network access;
- current clock unless passed explicitly;
- mutable global state.

Pure functions should accept explicit inputs and return explicit outputs.

---

# 12. AI boundaries

AI is allowed for:

- source extraction;
- structured interpretation of unstructured documents;
- source-grounded Q&A;
- optional text formulation where explicitly approved.

AI is **not** allowed for:

- pacing;
- Plan calculation;
- Nutrition target calculation;
- weather interpolation;
- entitlement decisions;
- RLS decisions;
- Race Intelligence timing model;
- official publication;
- deciding organizer safety actions.

An AI result is never automatically authoritative.

---

# 13. Source extraction rule

The canonical chain is:

```text
SOURCE
→ SNAPSHOT
→ PARSE
→ CHUNKS
→ EXTRACTION
→ CANDIDATES
→ HUMAN REVIEW
→ RACE FACT VERSION
→ PUBLICATION
```

Never shortcut:

```text
LLM output
→ production fact
```

Every critical published fact must be traceable to evidence.

---

# 14. RaceFact immutability

Published `RaceFactVersion` rows are immutable.

A change creates:

```text
Version N+1
```

Never mutate:

```text
Version N
```

Never silently replace a fact when a new source arrives.

---

# 15. Plan engine rule

The runner chooses the target.

PLUKA builds the Plan around that target.

The Plan engine is not a physiological prediction model.

It must preserve:

- user overrides;
- locks;
- stops;
- version history;
- exact cutoff basis;
- deterministic recalculation.

Weather must never automatically change pacing.

---

# 16. Nutrition engine rule

The user defines targets.

The engine distributes and evaluates them.

It must never silently change:

- carbs target;
- hydration target;
- sodium target;
- caffeine total.

Weather can only produce:

```text
proposal
→ user confirmation
→ change
```

Never:

```text
weather
→ silent nutrition mutation
```

---

# 17. Conditions rule

Personalized Conditions are unavailable before J-14.

Strictly:

```text
0 <= days_to_start <= 14
```

Before J-14:

- no personalized forecast;
- no trend;
- no weather teaser.

Official organizer notices are independent and remain visible.

The weather provider must sit behind an adapter.

Never hardcode an unvalidated lapse-rate correction in UI or domain code.

---

# 18. Race Intelligence rule

Race Intelligence is:

- pre-race;
- aggregated;
- privacy-safe;
- explainable;
- beta until calibrated.

Never expose:

- individual ETA;
- individual performance signal;
- individual risk;
- Plan contents.

Never calculate:

```text
UTMB Index → race time
```

through an invented direct formula.

ITRA and UTMB remain separate providers.

No averaging them into a fake PLUKA score.

---

# 19. B2B privacy rule

The organizer may finance the participant experience.

That does not make the organizer owner of the participant preparation.

The organizer must never read:

```text
RacePlan
PlanWaypoint
PlanSegment
Nutrition
bags
Assistance
Outings
personal WeatherRun
personal Q&A
private post-race notes
```

This applies even to:

```text
organization owner
```

and even when access is:

```text
Organizer Included
```

---

# 20. B2B aggregation threshold

Minimum subgroup size:

```text
10 participants
```

Do not expose a subgroup below this threshold.

This applies to:

- wave breakdowns;
- Race Intelligence;
- question insights;
- other B2B aggregates.

Do not leak small groups through JSON metadata.

---

# 21. Entitlement rule

The client never decides access.

Canonical participant access states:

```text
FREE
RACE_PASS
PLUS
ORGANIZER_INCLUDED
```

Beta access is a separate temporary grant.

The server resolves capabilities.

Never trust:

```text
tier
premium
isPlus
isPaid
```

from the client.

---

# 22. Official information is never paywalled

Free users retain access to:

- course information;
- sources;
- mandatory equipment;
- official notices;
- official weather/safety decisions;
- initial Plan.

Premium is charged for advanced personalization and execution.

Never hide official safety information behind Race Pass.

---

# 23. Race Pass quota

Race Pass includes:

```text
2 linked preparation outings
```

Organizer Included follows the same V1 rule.

Deletion of an outing does not automatically restore consumed quota.

Use an idempotent usage ledger.

PLUKA+ is not constrained by this commercial quota.

---

# 24. Privacy vs entitlement

These are separate systems.

```text
Privacy / RLS
= may this actor access this data?
```

```text
Entitlements
= may this user use this product capability?
```

An entitlement can never override Privacy.

Check data access before showing an upgrade message.

Do not tell a user to buy Race Pass for an object that belongs to another user.

---

# 25. RLS rules

RLS is deny-by-default.

The `private` schema is server-only.

Never grant direct access to:

```text
private.*
```

for:

```text
anon
authenticated
```

Use `auth.uid()`.

Do not trust client-supplied `user_id`.

---

# 26. service_role rule

`service_role` bypasses RLS technically.

Therefore every server use case using it must still verify:

- user;
- ownership;
- organization membership;
- role;
- entitlement;
- scope;
- object state.

Never treat service_role as business authorization.

Never expose it to client code.

---

# 27. Server-authoritative writes

Complex mutations should pass through:

```text
Server Action
Route Handler
application use case
worker
```

rather than direct browser table writes.

This especially applies to:

- Plan versions;
- Nutrition generation;
- facts publication;
- entitlements;
- participant imports;
- Race Intelligence;
- Weather refresh;
- tokens;
- official notices.

---

# 28. Database migrations

All schema changes must use migrations.

Never manually patch production and leave Git behind.

Never rewrite an already-applied migration to represent a new requirement.

Create a new migration.

Every migration must:

- be reproducible;
- preserve existing data;
- include constraints;
- include indexes where needed;
- include RLS updates if relevant.

---

# 29. Local database requirement

Before merging a DB change:

```text
supabase db reset
```

must succeed from a clean state.

Then run:

- seeds;
- DB tests;
- RLS tests;
- affected integration tests.

---

# 30. Data model gaps

Some later engine specifications identify additions to the initial Data Model.

Before implementing those workflows, verify the schema supports:

## Nutrition

- stable keys;
- customization flags;
- locks;
- reproducible diff metadata.

## Conditions

- engine/config versions;
- provider config version;
- sampling version;
- completeness / failure metadata if adopted.

## Race Intelligence

- config version;
- calibration version;
- input hash;
- private run members;
- exposure denominators / coverage where required.

## Entitlements

- source;
- scope;
- organization origin;
- start/end/revocation;
- usage ledger.

Do not hide missing persistence in frontend JSON.

---

# 31. Worker jobs

Long-running tasks belong in workers.

Examples:

```text
source.ingest
source.extract
weather.refresh
race-intelligence.compute
brief.generate
participant-import.process
```

They must be:

- idempotent;
- observable;
- retry-safe;
- non-blocking for normal page rendering.

---

# 32. Idempotence

Each async operation must have a stable idempotence strategy.

A retry must never create:

- duplicate facts;
- duplicate entitlements;
- duplicate forecast runs logically identical;
- duplicate usage consumption;
- duplicate invitations;
- duplicate publication events.

---

# 33. Outbox

For domain changes with downstream effects, prefer transactional outbox.

Example:

```text
write domain state
+
write outbox event
+
commit
```

Then process downstream asynchronously.

Never publish downstream effects before the source transaction commits.

---

# 34. Time handling

Use real datetimes and timezone-aware values.

Store real instants in:

```text
timestamptz
```

Keep the IANA timezone where needed.

Do not build domain logic around string arithmetic such as:

```text
"17:20" + "02:30"
```

Elapsed time must not reset at midnight.

Multi-day ultras are a supported case.

---

# 35. No hidden Date.now()

Pure engine functions should receive time explicitly when needed.

This improves:

- determinism;
- testing;
- replay;
- debugging.

---

# 36. External providers

All providers must be behind interfaces.

Examples:

```text
WeatherProvider
AIExtractionProvider
EmailProvider
BillingProvider
```

Do not leak provider SDK objects into domain types.

The domain should remain replaceable.

---

# 37. Provider failure

A provider failure must degrade only the relevant feature.

Examples:

```text
Weather down
→ Plan still works
```

```text
AI extraction down
→ existing facts stay valid
```

```text
Race Intelligence worker failed
→ last valid snapshot remains visible if appropriate
```

Never fabricate fallback data.

---

# 38. No silent fallback values

If a provider field is missing:

```text
null
```

or explicit unavailable state.

Never invent:

- apparent temperature;
- precipitation;
- altitude;
- confidence;
- source;
- index;
- cutoff basis.

---

# 39. Routes

Canonical runner course navigation:

```text
Plan
Preparation
Assistance
Course
```

Nutrition is under Plan.

Conditions is under Plan.

Do not add a main:

```text
Nutrition
Weather
```

tab without explicit product decision.

Canonical organizer navigation:

```text
Accueil
Ma course
Analyse
Participants
```

---

# 40. No feature = new tab rule

A new feature does not automatically deserve:

- a route;
- a nav item;
- a dashboard card.

Reuse existing contexts first.

PLUKA must feel simpler than its internal architecture.

---

# 41. UI design system

Use:

```text
Archivo
Hanken Grotesk
Martian Mono
```

Canonical colors:

```text
Ardoise   #0E1A17
Forêt     #14342C
Lichen    #C6F24E
Aube      #FF6A3D
Glacier   #9AE0D6
Calcaire  #F2F0E9
Sable     #E4E1D6
Granit    #6F7A74
```

Standard radius:

```text
2–3 px
```

No generic SaaS visual drift.

---

# 42. UI anti-patterns

Do not introduce:

- rounded-2xl everywhere;
- large soft shadows;
- rainbow analytics;
- generic blue buttons;
- emoji business icons;
- floating cards for every row;
- glassmorphism;
- gradients unrelated to the charter;
- overly animated dashboards.

Prefer:

- bands;
- hairlines;
- edge-to-edge lists;
- restrained surfaces;
- strong typography;
- profile/elevation visual language.

---

# 43. CTA rule

One dominant Lichen CTA per primary decision area.

Do not make every action green.

Aube is not the generic primary action color.

Aube marks:

- next milestone;
- deadline;
- next action marker.

---

# 44. Accessibility

Production target:

```text
WCAG 2.2 AA
```

At minimum:

- keyboard accessible;
- visible focus;
- labels;
- semantic controls;
- 44×44px target size where applicable;
- color not used alone;
- accessible graph alternative;
- reduced motion support.

Do not defer accessibility to a later rewrite.

---

# 45. Mobile / desktop priority

Runner:

```text
mobile-first
```

Organizer:

```text
desktop-first, responsive
```

Do not shrink desktop tables into unusable mobile grids.

On organizer mobile, prioritize:

- conclusions;
- Brief;
- alerts.

---

# 46. UI states

Every meaningful async or conditional feature should consider:

```text
loading
empty
success
stale
error
unauthorized
not entitled
not yet available
```

Do not solve all non-happy paths with:

```text
spinner
```

or:

```text
404
```

---

# 47. Feature gates

Use feature flags for rollout.

Use entitlements for commercial authorization.

Never use one in place of the other.

Examples:

```text
weather_conditions
race_intelligence
race_intelligence_weather
community
```

Feature flag off:

```text
feature does not exist in this release
```

Entitlement denied:

```text
feature exists but this user lacks access
```

---

# 48. Demo data

Fixtures must be clearly separated from production data.

Use folders / namespaces such as:

```text
tests/fixtures/
reference/demo/
seed/demo/
```

Never place demo outputs inside the production business logic.

Any real-world race used in a demo must not imply partnership unless true.

---

# 49. No fake confidence

Do not add:

- “98% reliable”;
- confidence percentages;
- AI confidence rendered as certainty;
- scientific-looking scales;

unless the relevant spec defines and validates them.

Weather uses qualitative horizon labels.

Race Intelligence uses coverage, not a fake reliability score.

---

# 50. Testing requirements

At minimum, follow `docs/ACCEPTANCE_CRITERIA.md`.

Required test families include:

```text
PLAN-P01...
NUTRITION-N01...
SOURCES-S01...
WEATHER-W01...
RI-RI01...
ENTITLEMENTS-E01...
PRIVACY-P01...
```

Do not delete a specialized test suite because a higher-level E2E test exists.

---

# 51. Unit test rule

For pure logic:

- test the public behavior;
- test edge cases;
- test invariants;
- avoid snapshot-only testing for algorithms;
- use explicit expected values;
- add property-based tests where the spec calls for them.

---

# 52. Integration test rule

Test:

- repositories;
- transactions;
- queue boundaries;
- provider adapters with mocks;
- idempotence;
- outbox;
- schema mappings.

Do not mock the function under test.

---

# 53. RLS test rule

Every sensitive domain requires both:

```text
positive access test
negative access test
```

Always test:

- cross-user;
- cross-organization;
- owner vs viewer/editor/admin;
- private schema;
- token flow;
- Organizer Included privacy.

---

# 54. E2E test rule

Critical E2E flows include:

```text
Free onboarding → initial Plan
Race Pass upgrade → return to action
Nutrition
Assistance token
J-14 Conditions
Plan downstream recalculation
Race Pass outing quota
Organizer invitation
Organizer participant import
Source publication
Race Intelligence insufficient state
Organizer Brief token
```

Keep E2E focused on critical behavior, not every component.

---

# 55. Visual regression

Protect critical screens:

```text
Homepage runner
Homepage organizer
Runner Home
Plan desktop
Plan mobile
Nutrition
Conditions
Assistance mobile
Organizer Home
Analysis
Brief
```

Use visual tests to catch:

- radius drift;
- font drift;
- shadow drift;
- duplicate CTA;
- mobile regression.

---

# 56. Build quality

Before calling work complete:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

plus relevant:

```text
supabase db reset
pgTAP
Playwright
```

Use actual repository scripts if they differ.

Do not claim success without running the relevant command.

---

# 57. When a command fails

Report:

- exact failing command;
- relevant error;
- whether failure predates the change;
- what was attempted.

Do not hide failures behind:

```text
likely fine
```

Do not alter unrelated code merely to force green CI.

---

# 58. Existing failures

If the repository already has a failing unrelated test:

1. confirm it is unrelated;
2. document it;
3. do not silently delete or weaken the test;
4. avoid expanding the scope unless explicitly asked.

---

# 59. Code style

Prefer:

- explicit names;
- small pure helpers;
- narrow interfaces;
- discriminated unions;
- typed domain errors;
- exhaustive switches where useful.

Avoid:

- `any`;
- deep inheritance;
- generic catch-all services;
- boolean parameter explosions;
- magic strings scattered across apps.

---

# 60. Validation

Validate external input at boundaries.

Use schemas such as:

```text
Zod
```

for:

- route bodies;
- provider responses;
- AI structured outputs;
- imports;
- public tokens where applicable.

Do not revalidate pure internal types unnecessarily at every function hop.

---

# 61. Error handling

Use domain error codes where specs define them.

Do not expose raw database / provider errors to users.

UI messages should remain:

- calm;
- actionable;
- accurate.

Keep the technical details in logs.

---

# 62. Logs

Use structured logs.

Log technical identifiers:

- request id;
- run id;
- race id;
- job id;
- provider;
- error code.

Avoid:

- email;
- phone;
- token;
- Q&A content;
- Nutrition details;
- private notes.

---

# 63. Analytics

Analytics events must be minimal.

Allowed examples:

```text
plan_generated
conditions_opened
outing_created
org_participants_imported
org_analysis_opened
```

Do not send private preparation payloads to analytics.

---

# 64. Tokens

Private links:

```text
Assistant
Brief
Invitation
```

must use cryptographically secure random tokens.

Persist only:

```text
token_hash
```

Never plaintext.

Token routes must be:

- rate limited;
- noindex;
- protected against referrer leakage;
- excluded from raw analytics URLs.

---

# 65. Storage

Private by default.

Use signed URLs for:

- source files;
- participant exports;
- Race Packs;
- private GPX;
- generated private documents.

Do not make a bucket public simply because signed URL handling is inconvenient.

---

# 66. Source files

A source being official does not mean its snapshot file should automatically be publicly redistributable.

Expose the necessary citation / metadata.

Respect the source snapshot privacy rules.

---

# 67. Performance signals

ITRA / UTMB signals live in private storage/schema.

Do not expose them in:

- organizer participant list;
- analytics API;
- public payloads;
- runner UI;

unless a future approved feature explicitly requires it.

---

# 68. Weather provider choice

The provider is intentionally not hardcoded in the product specs.

Do not commit the product to a provider API shape.

Implement:

```text
WeatherProvider
```

adapter first.

Provider choice must consider:

- license;
- cost;
- coverage;
- altitude behavior;
- temporal resolution;
- precipitation;
- wind;
- redistribution rights.

---

# 69. Race Intelligence calibration

Do not mark Race Intelligence:

```text
production
```

until:

- config is calibrated;
- calibration version exists;
- backtests are documented;
- privacy review passes;
- product approves wording.

Until then:

```text
beta
```

or flag off.

---

# 70. No operational safety automation

PLUKA may inform.

PLUKA does not automatically decide:

- cold kit activation;
- route change;
- cancellation;
- medical intervention;
- race suspension.

Those decisions remain organizer responsibilities.

---

# 71. Code comments

Comments should explain:

- why;
- invariant;
- surprising constraint.

Do not comment obvious syntax.

Good:

```ts
// Official notices remain visible even when personalized Conditions are paywalled.
```

Bad:

```ts
// Set allowed to true.
```

---

# 72. Documentation updates

Update documentation when:

- behavior intentionally changes;
- a new invariant is introduced;
- a schema migration changes a documented model;
- a provider contract changes;
- a feature gate moves from beta to production.

Do not modify docs to make an accidental implementation look compliant.

---

# 73. Commit scope

Prefer atomic commits.

Examples:

```text
feat(plan): add locked waypoint constraint validation
test(plan): cover impossible fixed-time conflict
```

Do not mix:

- unrelated formatting;
- package upgrades;
- large refactors;
- feature work;

in one commit.

---

# 74. Dependency rule

Before adding a dependency, ask:

1. is it already available?
2. can a small helper solve it?
3. does it introduce a provider lock-in?
4. is it maintained?
5. does it affect bundle size?
6. does it affect licensing?

Do not add dependencies for trivial code.

---

# 75. Package upgrades

Do not upgrade major dependencies opportunistically during feature work.

Create a dedicated task.

---

# 76. Generated code

Generated code is allowed only when:

- expected;
- reviewed;
- reproducible;
- not treated as source-of-truth business logic.

Never generate migrations from an unreviewed inferred model and commit them blindly.

---

# 77. SQL quality

All important SQL should include:

- FK;
- constraints;
- indexes;
- timestamps;
- ownership / organization scope;
- RLS consideration.

Avoid storing everything in `jsonb` simply to avoid modeling.

Use JSONB only when:

- structure is genuinely flexible;
- safe schema is documented;
- it does not weaken privacy.

---

# 78. JSONB rule

Any JSONB exposed to organizer APIs must have a controlled safe schema.

Never serialize:

```text
worker memory dump
```

into public metadata.

---

# 79. Public DTO rule

Do not return database rows directly from sensitive server routes.

Construct explicit DTOs.

Especially for:

- participants;
- Race Intelligence;
- Brief;
- invitations;
- source review;
- Assistance tokens.

---

# 80. No `select *` habit

Avoid `select *` in sensitive repositories.

Select only required columns.

This reduces accidental data leakage during schema growth.

---

# 81. Organizer roles

Canonical B2B roles:

```text
owner
admin
editor
viewer
```

Do not rely on enum ordering to infer authority.

Use explicit role helpers.

---

# 82. Organization membership removal

Removing membership must revoke B2B access immediately.

Created organization data remains organization-owned.

Do not transfer it to the former member.

---

# 83. Admin access

PLUKA Admin access is powerful and must be auditable.

Do not create broad “impersonate user” tooling in V1.

If support needs a special operation, build the narrow use case.

---

# 84. Community scope

Community is light and secondary.

Do not turn V1 into a social network.

No:

- follower graph;
- DMs;
- stories;
- global engagement feed.

---

# 85. No training scope

Do not implement:

- training calendar;
- workout prescription;
- VO2 max;
- training load;
- readiness;
- coaching plans;
- HR analysis.

Even if technically easy.

That is outside PLUKA positioning.

---

# 86. No live scope

Do not implement:

- live GPS;
- runner tracking;
- PC race dashboard;
- race control incident management.

V1 remains pre-race / preparation centric.

---

# 87. UX simplicity test

Before adding visible complexity, ask:

> **Does the user need to understand this system detail to take the next useful action?**

If no:

hide the complexity behind:

- defaults;
- background jobs;
- progressive disclosure;
- a detail drawer.

---

# 88. Organizer simplicity test

The organizer should primarily experience:

```text
provide data
→ PLUKA analyzes
→ PLUKA surfaces conclusions
```

Do not expose:

- kernel settings;
- extraction prompt settings;
- weather sampling config;
- engine versions;

in the normal organizer UI.

Those belong in Admin / diagnostics.

---

# 89. Runner simplicity test

The runner should primarily experience:

```text
course
→ target
→ Plan
→ preparation
```

Do not expose database or algorithm concepts.

---

# 90. Acceptance criteria are executable intent

When implementing a feature, translate acceptance criteria into tests.

Do not merely add a checklist to the PR description.

If a behavior is critical enough to be specified and can be automated, automate it.

---

# 91. Required negative tests

For every privileged action, test at least one forbidden actor.

Examples:

```text
runner B cannot read runner A Plan
org B cannot mutate org A Race
viewer cannot import participants
Free cannot mutate premium Plan
expired token cannot access Assistant
```

---

# 92. Cross-scope tests

Always test scope boundaries:

```text
Race A vs Race B
Edition 2026 vs 2027
Org A vs Org B
User A vs User B
Outing linked vs personal
Race Pass scope vs global PLUS
```

---

# 93. Edge cases

Explicitly consider:

- no waypoints;
- missing source;
- missing weather field;
- multi-day;
- midnight;
- empty participant import;
- duplicate import;
- removed organizer member;
- expired entitlement;
- revoked token;
- plan changed after weather run;
- source changed after Plan confirmation.

---

# 94. Property-based invariants

Where appropriate:

Plan:

```text
elapsed monotonic
locks preserved
stops non-negative
```

Nutrition:

```text
totals reproducible
reserve excluded from consumption
```

Race Intelligence:

```text
no negative counts
aggregate probabilities bounded
same input → same output
```

---

# 95. Performance budgets

Do not optimize blindly.

Measure first.

But avoid obvious N+1 patterns in:

- participant list;
- waypoints;
- Race Intelligence;
- facts / sources;
- Plan loading.

Use indexes where domain queries depend on FK joins.

---

# 96. Caching

Cache only when:

- invalidation is understood;
- privacy scope is part of the key;
- stale data is acceptable.

Never cache private user payloads under a public key.

---

# 97. Stale data

If stale data is displayed, label its age when relevant.

Examples:

```text
Dernière analyse : 18:40
Mise à jour en cours
```

Do not silently display stale Weather as fresh.

---

# 98. Offline

If offline Race Pack is not fully implemented:

do not simulate it in production.

If implemented:

- snapshot clearly;
- show last sync;
- protect private cache;
- do not claim fresh Conditions offline.

---

# 99. Language

UI product language is French first for V1 unless localization work says otherwise.

Code identifiers remain English.

Avoid hardcoded UI strings scattered in business logic.

---

# 100. Product copy

Use wording aligned with the product.

Prefer:

```text
Plan
Préparation
Conditions
Assistance
À vérifier
Prévision PLUKA
Officielle
Validée PLUKA
```

Avoid introducing new synonyms for core concepts without reason.

---

# 101. Definition of Done per task

Before declaring a task complete:

```text
[ ] relevant specs read
[ ] existing code inspected
[ ] smallest correct slice implemented
[ ] no undocumented behavior invented
[ ] TypeScript clean
[ ] input validation present
[ ] server authorization checked
[ ] Privacy impact reviewed
[ ] entitlement impact reviewed
[ ] migration added if needed
[ ] tests added
[ ] negative tests added
[ ] async/idempotence considered
[ ] loading/empty/error states handled if UI
[ ] mobile/accessibility reviewed if UI
[ ] observability added where needed
[ ] relevant commands actually run
[ ] failures reported
[ ] docs updated only if intended behavior changed
```

---

# 102. Forbidden shortcuts

Never solve a task by:

- disabling RLS;
- using service_role in client;
- broadening organization access;
- hardcoding `isPremium = true`;
- replacing real provider data with demo fixtures in production;
- removing tests;
- weakening assertions;
- mutating immutable versions;
- silently deleting personalized data;
- auto-applying a Weather proposal;
- bypassing entitlement quotas;
- adding an unreviewed AI decision;
- hiding a conflict instead of surfacing it.

---

# 103. When uncertain

If uncertainty is about:

- product decision;
- privacy;
- official data;
- payment;
- safety;
- engine threshold;

do not guess.

Return a concise blocker such as:

```text
BLOCKER:
WEATHER_CONDITIONS.md does not define the production threshold for cold detection.
The implementation needs a calibrated ConditionDetectionConfig before enabling auto-detection.
```

Then continue only on unaffected parts.

---

# 104. Preferred agent response after work

When finishing a task, report:

1. what changed;
2. files changed;
3. tests run;
4. result;
5. remaining blocker / follow-up if any.

Keep it concise.

Example:

```text
Implemented Race Pass linked-outing quota with an idempotent usage ledger.

Changed:
- ...
- ...

Validated:
- pnpm test ...
- supabase db reset
- pgTAP ...

Remaining:
- none
```

Do not claim:

```text
fully production ready
```

unless the relevant acceptance gate is actually satisfied.

---

# 105. Final rule

PLUKA contains sophisticated internal systems.

The repository should not become sophisticated for its own sake.

Every implementation decision should preserve four properties:

> **Simple to use.**

> **Deterministic where it matters.**

> **Traceable where trust matters.**

> **Private by default.**

When in doubt:

> **choose the smallest implementation that fully respects the specs, tests and privacy boundaries.**

---

**End — PLUKA AGENTS.md**
