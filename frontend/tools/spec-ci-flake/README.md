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

## Exit-code contract

Three codes are deliberate verdicts, and **2 and 3 mean different things** — a
caller that treats "non-zero" as one bucket loses the distinction this harness
exists to draw. A fourth, `1`, is not a verdict at all: it is what Node exits
on an uncaught throw, and it is reachable, so it is documented here rather than
left to surprise a caller.

| Code | Meaning |
|---|---|
| `0` | Analysis produced, with **at least one** report to analyze. |
| `1` | **Unexpected error — the harness itself failed**, not a measurement. Node's default exit for an uncaught throw; nothing catches or maps it. Reachable paths, all confirmed: `--dir <missing>` (`analyze.ts` throws `--dir not found`), an entry inside `--dir` that `statSync` cannot read, and on the `--gh` path the cache `rmSync`/`mkdirSync`, the `gh run list` subprocess (missing/unauthenticated `gh`, or its 60s timeout), and `JSON.parse` of that output. Distinguish it from `2`: `2` says *the window is empty*, `1` says *the harness never got to look*. |
| `2` | Usage error (bad/missing source flag), **or** no reports found **and** no run-level evidence that any run lost its artifact. This is "nothing to analyze, **cause unknown**". |
| `3` | **Zero reports, and artifact loss is measurably why** — at least one listed run produced no `spec-ci-report`. The analysis is still printed, because that loss is the most important thing this tool can say, but it is not a success: zero reports means zero flake signal. |

Two properties of `3` are deliberate and easy to get wrong:

- It fires on **`noArtifact > 0`, not on `noArtifact === listed`.** A run can
  produce an artifact that still yields no parseable report, so demanding
  *total* loss would route "0 reports, artifact loss measured" into `2`, whose
  contract is *cause unknown* — while the cause is right there in the run-level
  tally. The stderr line prints the exact `<noArtifact> of <completed>` split,
  so total and partial loss stay distinguishable. The denominator is
  **completed** runs, matching the text report: `noArtifact` excludes
  in-progress runs by construction, so dividing by the *listed* count would
  print a total loss as "39 of 40" the moment one run is still running —
  exactly the partial/total confusion this line exists to prevent.
- It is **unreachable on `--dir`.** A directory of files carries no run-level
  information, so `--dir` with no reports is `2` (cause unknown), never `3`.
  Reporting `0` artifact-less runs there would be a measurement claim the
  source cannot support.

## What it reports

- **VERDICT — true same-SHA flakes (read this FIRST).** Runs are grouped by the
  commit SHA they tested (`diagnostics.run.githubSha`). A SHA that produced
  **both a pass and a fail** is a genuine same-code flake (`trueFlakeShas`). A
  SHA that **only failed** (`failOnlyShas`) is almost always Spec CI correctly
  catching a real code change, not a flake. **This is the distinction that
  matters** — a raw fail rate conflates the two and is misleading on its own.
  The plan's reactivate criterion is literally `trueFlakeShas.length >= 3`.
- **Failing-spec breakdown** — across fail runs, which specs did NOT
  `full_match`, in how many fail runs, and their worst match rate. If the
  failing specs are the pages a PR changed, the "failure" is the gate working.
  (This is what disambiguated the 2026-05-30 false alarm: the fails were
  `forgot-password` / `login` / `reset-password` / `verify-email` — exactly the
  pages PR #342's auth refactor reshaped.)
- **Raw pass/fail split** across the sampled runs (NOT the flake rate — see VERDICT).
- **Boolean features ranked by separation** — `crawlSessionLost`,
  `any429onAuth`, `anyRefreshRotation`, `anyConcurrentRun`, `anyNotable5xx4xx`.
  Use only AFTER a true flake is confirmed, to attribute it.
- **Numeric features** (median | mean, pass vs fail) — notable count, server
  errors, refresh rotations, 429s, concurrency overlap, duration.
- **Notable-response concentration across fail runs** — whether the 5xx land
  on **one** route template (→ a specific endpoint/upstream regression) or
  **spread across many** (→ blanket backend pressure).
- **Runs that produced NO `spec-ci-report` artifact**, in their own section and
  never averaged into the flake statistics. These are runs in which nothing
  under test ever executed — typically a stall in an apt-dependent setup step
  (plan `2026-08-19-ci-apt-hang-unbounded-steps-misreported-as-test-failure`).
  They used to be dropped silently, which made this harness structurally blind
  to that whole failure class: the runs it would have to count are exactly the
  ones it discarded. On `--dir` the section reports **UNKNOWN**, not zero — a
  directory of files carries no run-level data, and reporting `0` there would
  be the same silent-empty-is-unknown defect.

## Reading the output → hypothesis

First settle **is this even a flake?** via the VERDICT. Only if `trueFlakeShas`
is non-empty does the hypothesis table below apply — otherwise you're looking
at real code changes (check the PR for each `failOnlyShas` SHA) and there's
nothing to "fix" in the gate.

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
