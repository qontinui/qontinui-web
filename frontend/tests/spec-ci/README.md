# Spec CI

Playwright-driven, in-browser executor that runs every IR spec under
`frontend/specs/pages/<id>/state-machine.derived.json` against the running app,
walks each spec's state machine, and writes a deterministic
`spec-ci-report.json`. Spec CI is the **on-PR merge gate**
(`.github/workflows/spec-ci.yml`); the Playwright E2E suite
(`.github/workflows/e2e-tests.yml`) is now nightly/on-push only.

Entry point: `run-spec-ci.ts`. Run locally with:

```bash
npx tsx tests/spec-ci/run-spec-ci.ts \
  --base-url http://localhost:3001 \
  --api-base https://api.qontinui.io \
  --include-write \
  --output spec-ci-report.json
```

## The gate

`run-spec-ci.ts` fails (exit 1) iff any of:

- a spec errored,
- `minMatchRate < 0.8`,
- `transitionPassRate < 0.999`,
- **any spec produced a critical browser console error** (the run-level
  console-error invariant, below),
- **any spec produced a same-origin HTTP-5xx** (the server-error invariant,
  `server-error-policy.ts`),
- an API-contract assertion failed (`apiAssertionPassRate < 0.999`), **or**
- **the spec-less route crawl (C8) surfaced a NEW finding** on any un-spec'd
  route — a critical console error, a same-origin HTTP-5xx, or a hard
  page-health failure — after the per-route baseline waivers
  (`crawl-baseline.ts`) are subtracted (see below).

## Console-error invariant

Spec CI enforces a **default-on, corpus-wide** console-error check: while each
spec navigates (`goto`) and walks its transitions, a `page.on("console")` +
`page.on("pageerror")` listener captures critical browser errors and attributes
them to the executing spec. Any critical hit fails the gate. This is attached to
**every** page the harness drives — both the shared authenticated page and the
per-spec unauthenticated pages (login / invalid-creds / password-reset). New
specs are covered the day they land, with no author action.

This replaced (and strictly subsumes) the old
`tests/e2e/ui-bridge-graph-editor.spec.ts` `@smoke` "no console errors" test:
it checks all specs, not one page, and — because `page.on` attaches at page
creation — it catches **pre-hydration** errors (chunk-load failures, top-level
module throws) that the SDK's in-page hook structurally cannot see.

### What counts as "critical"

Policy lives in `console-policy.ts` (`classifyConsole`) — reviewable + diffable
in isolation:

- **Always critical:** any `page.on("pageerror")` event (uncaught exception /
  unhandled rejection bubbled to the page).
- **`console.error`:** critical if its text matches **neither** the benign
  denylist (`net::ERR_`, `Failed to load resource`, `favicon`, `hydration`,
  `Warning:`, browser-emitted `WebSocket connection … failed`) **nor** the
  network-noise denylist below. (The `Uncaught`/
  `TypeError`/`ReferenceError` set is the documented high-severity subset but
  is no longer the gate condition — any non-denylisted `console.error` gates,
  so a plain `console.error("X failed")` is caught. Expected per-page errors
  are waived via `metadata.expectedConsoleErrors`, below.)
- **`warn`/`log`/`info`/`debug`:** never gate (the flaky-red minefield) and are
  not recorded.
- **Environmental network-fetch rejections** (`Failed to fetch`, `Load failed`,
  `NetworkError…`, `AbortError`) are dropped at **all** levels, including
  `pageerror`. Spec CI runs the prod build proxying to a remote staging API
  while rapidly navigating between specs, which aborts in-flight background
  fetches; these are harness artifacts, not code defects. Real chunk-load
  failures (`ChunkLoadError` / `Loading chunk … failed`) and logic errors do
  not match these patterns and still gate.

### Waiving a known error (per spec)

If a spec legitimately exercises an error path (e.g. an invalid-login spec that
surfaces an inline error the app also `console.error`s), declare the expected
errors in that spec's IR `metadata` so the waiver is **in the spec, reviewable,
and scoped to that spec**:

```jsonc
{
  "id": "invalid-login",
  "metadata": {
    "expectedConsoleErrors": ["Invalid credentials", "AuthError: .*"]
  },
  "states": [ ... ]
}
```

Each entry is a substring/regex matched against the captured error text;
matching errors are dropped before the gate. Default (field absent) =
"must be console-clean." A spec can never silently waive the invariant — the
waiver is in the diff.

No qontinui-schemas change is needed for this field: the harness reads the raw
spec JSON (not a typed `IRDocument`), the same way `requiresUnauthenticated`
reads `metadata.requiresUnauthenticated`.

## Spec-less route crawl (C8) — GATING

After the spec corpus runs, the harness walks **every navigable app route that
has no IR spec** (discovered from the Next `app/` tree by `route-manifest.ts`;
~200 routes) and applies the SAME run-level invariants the spec'd pages get:
critical console errors (C3), same-origin HTTP-5xx (C4), and basic page-health
(navigation success). This lane is **gating**: a NEW finding on any crawled
route reds the gate, attributed to that route (`summary` exposes
`crawl.gatingFindings` / `crawl.passRate`; the per-route breakdown carries
`unwaivedConsoleErrors` / `unwaivedServerErrors` / `healthFail`).

Robustness — what does NOT gate:

- A legitimate **404 / redirect / data-unavailable** render (`goto` resolves
  with a 200/30x — only a navigation **throw**, e.g. a timeout, is a
  `healthFail`).
- **Dynamic `[param]` routes** are skipped (they would need per-route fixtures
  + auth-aware nav). The few that matter (`demo-detail`, the admin agent-detail)
  have explicit IR specs with sentinel ids and ride the spec lane instead.
- Anything matching the **benign denylists** in `console-policy.ts` (favicon /
  hydration / network-abort noise).

The crawl reuses the shared **authed** page (ci-bot, superuser), so it covers
the authed lane. The unauth lane is exercised by `requiresUnauthenticated`
specs, not the crawl.

### Waiving a pre-existing crawl finding (baseline)

Crawled routes have no spec file, so their waivers live in a single
source-controlled registry, `crawl-baseline.ts`:

- `GLOBAL_SERVER_WAIVERS` — same-origin-5xx **URL classes** that are
  CI-environment-unavoidable on any route (`/coord-api/*` — no coord process in
  CI; `/api/vga/*` — Next server routes hitting a private-subnet RDS). These
  mirror the two classes the spec waivers already documented.
- `PER_ROUTE_WAIVERS` — keyed by the exact route path, listing the SPECIFIC
  console-text / 5xx-URL patterns expected on that route (+ optional
  `allowNavFail`), each with a mandatory `class` (`ci-env` | `real-bug` |
  `benign`) and an honest `note`. A `real-bug` waiver is a deliberate
  tech-debt deferral: the finding is real and tracked, but the gating PR's job
  is the mechanism + green baseline, not fixing every route.

Rules: never a blanket "ignore all crawl findings"; every waiver is a specific
route + specific pattern (or a specific backend URL class). A genuinely benign
NEW noise class is fixed in `console-policy.ts`'s denylist, NOT here.
