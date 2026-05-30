# Spec CI flake backfill harness (Phase 0)

Diffs flake-**PASS** vs flake-**FAIL** Spec CI runs of the *same* code to
attribute the ~40% flake (the 0-vs-166 same-origin-5xx whipsaw) to a root
cause with evidence. Read-only; it consumes the `diagnostics` block that
`tests/spec-ci/run-spec-ci.ts` now writes into every `spec-ci-report.json`.

Part of plan `2026-05-30-spec-ci-flake-stabilization.md`, **Phase 0**
(instrument first, fix nothing). Phase 1's remediation choice keys off what
this harness shows.

## Usage

Run from `frontend/` (the harness assumes that cwd, matching `run-spec-ci.ts`):

```bash
# Download the last 40 Spec CI runs' reports via gh, then analyze.
# Requires an authenticated gh (GH_TOKEN or `gh auth login`).
npx tsx tools/spec-ci-flake/analyze.ts --gh 40

# Or analyze reports already on disk (e.g. a previously-downloaded cache,
# or reports collected by hand).
npx tsx tools/spec-ci-flake/analyze.ts --dir ./.flake-cache

# Machine-readable:
npx tsx tools/spec-ci-flake/analyze.ts --gh 40 --json
```

Options: `--cache <path>` (where `--gh` stores downloads, default
`./.flake-cache`), `--json` (emit JSON instead of the text table).

## What it reports

- **Pass/fail split + flake rate** across the sampled runs.
- **Boolean features ranked by separation** — `crawlSessionLost`,
  `any429onAuth`, `anyRefreshRotation`, `anyConcurrentRun`, `anyNotable5xx4xx`.
  A feature true in most fails and few passes is a candidate root cause.
- **Numeric features** (median | mean, pass vs fail) — notable count, server
  errors, refresh rotations, 429s, concurrency overlap, duration.
- **Notable-response concentration across fail runs** — whether the 5xx land
  on **one** route template (→ a specific endpoint/upstream regression) or
  **spread across many** (→ blanket backend pressure). This is Phase 0's first
  must-answer question.

## Reading the output → hypothesis

| Signal | Points at |
|---|---|
| `crawlSessionLost` dominant in fails | **H1** — shared ci-bot auth-endpoint rate-limit / collision |
| `any429onAuth` / `anyRefreshRotation` elevated in fails | **H1** — token-rotation churn / auth contention |
| `anyConcurrentRun` elevated in fails | **H1/H2** — overlap with the one allowed concurrent run or a deploy window |
| Notable 5xx concentrated on one route | endpoint / upstream-dep regression (triage workstream, not flake) |
| Notable 5xx spread across many routes | **H2** — blanket backend pressure (deploy/rollback window) |

The `diagnostics` block also carries the GitHub run identity
(`run.githubRunId` / `run.githubRunAttempt`) and the `concurrencyAtStart`
snapshot, so a suspicious fail can be cross-referenced against the Actions
timeline and any in-flight `Deploy Web Backend` run.
