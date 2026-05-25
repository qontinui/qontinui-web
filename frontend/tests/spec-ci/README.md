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
- `transitionPassRate < 0.999`, **or**
- **any spec produced a critical browser console error** (the run-level
  console-error invariant, below).

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
in isolation. v1 semantics (exact equivalence with the retired smoke test, then
broader on the `pageerror` axis):

- **Always critical:** any `page.on("pageerror")` event (uncaught exception /
  unhandled rejection bubbled to the page).
- **`console.error`:** critical only if its text does **not** match the benign
  denylist (`net::ERR_`, `Failed to load resource`, `favicon`, `hydration`,
  `Warning:`) **and** does match the critical set (`Uncaught`, `TypeError`,
  `ReferenceError`).
- **`warn`/`log`/`info`/`debug`:** never gate (the flaky-red minefield) and are
  not recorded.

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
