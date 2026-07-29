# Style-gate (CI style-gating — capture half)

A **runner-less** CI gate that renders qontinui-web routes headlessly and, per
route, captures:

- a **UI-Bridge element snapshot** (`{ elements: [...] }` JSON), and
- a **deterministic PNG screenshot**.

A later phase feeds each snapshot+frame pair to the `vision-audit` analyzer bin
(`qontinui-schemas/rust-vision-core`) to gate visual/layout/typography/contrast
regressions. **This directory is the capture half only** (Phase 1).

## Files

| File | Purpose |
| --- | --- |
| `routes.json` | Committed manifest of gated routes (`id`, `path`, `public`, `settleMs`). Single source of truth — expand by appending objects, no code change. |
| `style-capture.spec.ts` | One Playwright `test()` per authed route: navigate → settle → fetch snapshot → screenshot. |
| `.artifacts/` | **gitignored** per-run output (see below). |

> **All seed routes are authenticated.** Public/unauthenticated routes need a
> relay-independent snapshot path (a Playwright in-page UI-Bridge SDK eval, not
> the relay proxy) — **deferred**; the relay snapshot route requires an
> authenticated user+session (see [Relay prerequisite](#relay-prerequisite-important)).
> The `public` field is retained in the schema for that future path.

Phases 2/3 add assertion specs + committed baselines here; Phase 4 adds the CI
workflow that runs the capture and feeds `.artifacts/` to the analyzer.

## Artifact output paths

Written by `style-capture.spec.ts`, keyed by each route's `id` slug:

```
tests/e2e/style-gate/.artifacts/snapshots/<id>.json   # /control/snapshot body, NORMALIZED
tests/e2e/style-gate/.artifacts/frames/<id>.png       # 1280x800 viewport screenshot
```

Seed route ids (all authed): `co-pilot`, `build-workflows`, `library`.

The snapshot body keeps the relay's `/control/snapshot` envelope (one of the
shapes `parse_snapshot` accepts — `{elements:[...]}` / `{data:{elements:[...]}}`
/ `{data:[...]}`) but each element is **normalized** for the analyzer before
write (see `normalize.ts` + `normalizeSnapshotForAnalyzer` in the spec):

- **bbox** — the SDK's `{x,y,width,height}` floats → the Rust `Region`
  `{x,y,w,h}`: a **signed** `i32` origin and an **unsigned** `u32` extent.
  `getBoundingClientRect()` legitimately reports negative x/y for anything
  scrolled or positioned off the top/left of the viewport, and that true
  coordinate is emitted verbatim — clamping it to 0 reported every off-screen
  element as flush against the viewport edge and fabricated overlaps against
  whatever really lives at the origin. A negative width/height is meaningless,
  so `w`/`h` are still floored at 0.
- **analyzer visual/interactivity fields** — `interactable` (from
  category/actions/tag/role), `fg_color`/`bg_color` (parsed from
  `state.computedStyles.color`/`backgroundColor`), `font_size_px`/
  `line_height_px` (parsed from computed px), `font_family` (if the SDK ever
  exposes it), `text`/`role` (visible text / a11y role). Absent fields are
  OMITTED so the Rust `Element` serde defaults apply.

All other SDK fields pass through (the Rust `Element` has no
`deny_unknown_fields`).

## Project

A single Playwright project (in `frontend/playwright.config.ts`) runs the spec:

- **`style-gate`** — authed: `dependencies: ["setup"]` + `storageState`. Renders
  the routes with `public === false` (i.e. all of them today). Pins a fixed
  `1280x800` viewport for reproducible frames.

There is **no** public companion project — public routes can't be captured via
the relay (the listener needs an authenticated user+session), so a public-route
capture path is deferred to a later phase (see below).

## Run locally

```bash
# Against an already-running dev server (mint auth state once via the setup project):
SKIP_WEB_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3001 \
  npx playwright test --project=style-gate          # authed routes
```

Auth env (for the `setup` project that mints `storageState`):
`PLAYWRIGHT_TEST_USERNAME` / `PLAYWRIGHT_TEST_PASSWORD` (Cognito). Without
`SKIP_WEB_SERVER`, Playwright starts `npm run dev` on port 3001 itself.

## Relay prerequisite (important)

`/control/snapshot` is a **browser-required** UI-Bridge route — it returns
`503 NO_BROWSER_CONNECTED` unless the in-page `CommandRelayListener` is attached
for the tab. That listener mounts only when **all** of:

1. the env gate — dev (`NODE_ENV=development`, the `npm run dev` webServer) **or**
   a prod build with `NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1`,
2. the per-user co-pilot preference (`users.preferences.ui_bridge_co_pilot_enabled`),
3. per-session consent (`sessionStorage["qontinui_copilot_session_consent"] = "granted"`),

are true.

- **(3)** is **seeded by the spec** via an init script (`test.beforeEach`).
- **(2)** is **enabled by the spec** in `test.beforeAll`: it PUTs
  `{ "ui_bridge_co_pilot_enabled": true }` to `/api/v1/users/me/preferences`
  through the authed `request` context (replaying the exact method + body of
  `persistPreference` in `src/hooks/useCoPilotPreference.ts`), then reads it
  back. If that mutation fails it throws immediately with an actionable message
  (a silent miss would otherwise surface only as downstream 503s).
- **(1)** is the **CI environment's responsibility**: run the capture against a
  dev server (the default `npm run dev` webServer satisfies it) or a prod build
  with `NEXT_PUBLIC_UI_BRIDGE_REMOTE_COMMANDS=1`.

If the relay still never attaches within the settle budget, the spec **fails
loudly** with an actionable message rather than writing an empty snapshot.

Why authed-only: the relay listener's `commandRelayRegistrationMetadata`
returns `null` without a resolved `{userId, sessionId}` (from the access
token), so the listener never mounts on an unauthenticated tab — a public route
would always 503. Capturing public routes therefore requires a
relay-independent path (a Playwright in-page UI-Bridge SDK eval), deferred to a
later phase.

## CI workflow & the `STYLE_GATE_ENFORCE` flag (Phase 4)

The CI gate is `.github/workflows/style-gate.yml`. It reads the pinned
`qontinui-schemas` SHA from `style-gate.lock` (repo root), builds the
`vision-audit` analyzer at that SHA, runs the capture above, then runs the
analyzer per route in **both** of its gating modes and writes a table to the job
summary with one row per route and a labeled cell for each pass
(`| Route | analyze | assert |`):

- **`analyze`** — the broad, **day-one** signal. Runs all 5 page-wide analyzers
  (layout, elements, typography, color) with **no element ids and no specs
  needed** — it works the moment a snapshot+frame exist. Invoked as
  `analyze --snapshot <id>.json --frame <id>.png --analyzer all --fail-on critical`,
  so it exits `2` iff a finding is at/above CRITICAL (and `0` otherwise — without
  `--fail-on` the bin always exits `0`, so the flag is what produces a gate
  signal at all).
- **`assert`** — the committed invariant specs (Phase 2). Precise but **thin on
  day one**: most DSL assertions (`no_overlap`, `contrast_meets_wcag`,
  `text_fits_container`) need specific element ids that aren't known until real
  snapshots exist, so the seed specs can only assert page-wide `no_clipping`.
  This pass expands as specs + baselines grow.

Each cell shows `PASS` / `GATE-FINDINGS` / `INFRA-ERROR` with the bin's
human-readable summary inlined (the machine-readable JSON goes to stdout, the
human summary to stderr; the table surfaces the latter). Both passes fold into
the same shadow/enforce exit logic below.

Analyzer exit-code contract (identical for both modes): `0` = ok / passed,
`2` = gate finding (analyze: a finding at/above `--fail-on`; assert: an
assertion failed), `1` = infra (usage/IO/parse) error.

Rollout is two-stage (mirrors the alembic-fork gate — a check goes blocking
**only** via branch protection, never by a workflow quietly turning red):

- **Stage A — SHADOW (default, now):** report-only. The job EXITS 0 even when
  routes report gate findings (exit 2). NOT in required checks → never blocks
  merge.
- **Stage B — ENFORCE (later):** after a burn-in (≥ ~2 weeks / ≥ ~30 runs with
  zero flake-attributable false gate-2s), set the repo variable
  **`STYLE_GATE_ENFORCE=1`** (or pass `enforce=1` to a `workflow_dispatch` run)
  AND add the job to branch protection. With enforce on, the job FAILS if ANY
  route reports a gate finding. There is no second workflow — the same file
  serves both stages.

An analyzer INFRA error FAILS the job in **both** modes — a broken gate must
always be visible. A missing snapshot/frame is INFRA for **both** passes of that
route (the capture hiccupped); a missing spec is INFRA for the **assert** pass
only — the `analyze` pass still runs (it needs no spec) and is reported
normally.

Bumping the analyzer is a deliberate, reviewable change to `style-gate.lock`
(its own PR); the SHA is never hardcoded in the workflow.

## Authenticated capture (how the gate sees the real app, not /login)

The gated routes are authed `(app)` surfaces. CI auth uses the same proven
same-origin recipe as Spec CI (`tests/spec-ci/run-spec-ci.ts`):

1. `auth.setup.ts` mints a ci-bot Cognito id token and seeds it as the
   `access_token` cookie (also satisfies the Next `middleware.ts` soft-gate and
   backs `/users/me`).
2. `style-capture.spec.ts`'s `beforeEach` seeds, on every navigation,
   `localStorage.is_authenticated="true"` **and a future `localStorage.token_expiry`**
   — so the client `AuthProvider` (`contexts/auth-context.tsx`) skips the
   `refreshAccessToken()` branch (there is no refresh cookie in CI) and goes
   straight to a cookie-backed `getCurrentUser()`.

Without the future `token_expiry`, the AuthProvider treats the token as expired,
tries to refresh, fails, and the `(app)` route guard bounces every route to
`/login` — which is what the gate captured before this was fixed.

Each capture also writes a per-route auth diagnostic to
`.artifacts/diagnostics/<id>.json` (`finalUrl`, `looksLikeLogin`,
`usersMeStatus` — no token/PII) so a future login-bounce regression is visible
in the uploaded artifacts without eyeballing frames.
