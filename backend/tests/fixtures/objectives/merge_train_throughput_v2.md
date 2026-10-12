---
metric: "merge-train-throughput-2026-10"
unit: "composite (lands/day, open-PR counts, queue-wait hours, verdict age, deploy lag, host pressure, USD)"
direction: null
baseline: null
target: null
notes: "The starting point is the Baseline table, measured on 6 Oct 2026. This measure has no single baseline or direction: each of its 17 criteria has its own target and method, copied word for word from the checkpoint tables."
source_query: "manual: measured by the checkpoint session per 'How each metric is measured'"
checkpoints:
  - id: "checkpoint-1"
    due: "2026-10-08"
    label: "unblocked"
  - id: "checkpoint-2"
    due: "2026-10-13"
    label: "keeping up"
  - id: "checkpoint-3"
    due: "2026-10-27"
    label: "healthy"
criteria:
  - id: "1.1"
    checkpoint: "checkpoint-1"
    target: "ccfg `main` green"
    method: "M3 (latest `main` CI conclusion)"
  - id: "1.2"
    checkpoint: "checkpoint-1"
    target: "ccfg ≥ 10 lands / day"
    method: "M1 (lands, trailing 24 h)"
  - id: "1.3"
    checkpoint: "checkpoint-1"
    target: "qontinui-coord#2852 landed **and** coord deploys automatically: prod within 1 h of `main`, no manual deploys"
    method: "M2 (PR state), M7 (deploy lag), deploy history shows no hand-run deploy"
  - id: "1.4"
    checkpoint: "checkpoint-1"
    target: "GitHub budget fixes coord#2635 and coord#2922 landed"
    method: "M2"
  - id: "1.5"
    checkpoint: "checkpoint-1"
    target: "GitHub App budget never dry"
    method: "M6 (`remaining` > 0 at every sample; no `budget_exhausted` alert in the window)"
  - id: "1.6"
    checkpoint: "checkpoint-1"
    target: "PR verdict age p90 < 15 min"
    method: "M5"
  - id: "1.7"
    checkpoint: "checkpoint-1"
    target: "The 71 cancelled-then-recorded ccfg PRs re-dispatched"
    method: "finding topic `ci-runners`, `ccfg-redispatch-2026-10-06`; PR list `ccfg-reopen-prs.json` (session a96e1981 scratchpad). Each PR has a CI run started after 2026-10-06 (M4)"
  - id: "2.1"
    checkpoint: "checkpoint-2"
    target: "Per repo (coord, ccfg, web, runner): lands ≥ new PRs over the trailing 7 days; open counts trend down vs baseline"
    method: "M1 + M2"
  - id: "2.2"
    checkpoint: "checkpoint-2"
    target: "PR CI queue wait p90: ccfg < 1 h, coord < 30 min"
    method: "M4"
  - id: "2.3"
    checkpoint: "checkpoint-2"
    target: "merytshost memory PSI `full` p99 < 5%"
    method: "M8"
  - id: "2.4"
    checkpoint: "checkpoint-2"
    target: "Zero host-pressure CI timeouts"
    method: "M9"
  - id: "2.5"
    checkpoint: "checkpoint-2"
    target: "Zero OOM kills (since checkpoint 1)"
    method: "M8 (kernel log)"
  - id: "2.6"
    checkpoint: "checkpoint-2"
    target: "Paid CI $0"
    method: "M10"
  - id: "3.1"
    checkpoint: "checkpoint-3"
    target: "green-PR → landed p50 < 2 h, p90 < 12 h"
    method: "M1 (`coord_query_train_health` histograms)"
  - id: "3.2"
    checkpoint: "checkpoint-3"
    target: "Open PRs: coord < 150, ccfg < 80 (dead-author PRs adopted or closed)"
    method: "M2"
  - id: "3.3"
    checkpoint: "checkpoint-3"
    target: "Build admission ENFORCING on merytshost; lock-wait p90 < 15 min, max < 2 h"
    method: "M9"
  - id: "3.4"
    checkpoint: "checkpoint-3"
    target: "CPU-server purchase decided on the measured peak ccfg queue: buy only if peak PR CI queue wait > 1 h"
    method: "M4 (peak over the window), decision recorded as a `decision_record`"
last_reviewed: "2026-10-06"
report_topic: "merge-train-metrics"
structured_reporting_since: "2026-10-06T20:05:31Z"
results: []
---

# Merge-train throughput — October 2026

Operator request 2026-10-06: the merge train and its CI/host substrate fell behind (coord ~8–14 lands/day against
319 open PRs; qontinui-claude-config landed nothing for ~85 h). This document fixes the baseline, three dated
checkpoints, and HOW every number is measured.

A probe that cannot run, errors, or returns nothing is **UNKNOWN for that metric — never a pass and never zero**.

## Checkpoint 1 — by 2026-10-08 (unblocked)

| # | Target | Measured by |
|---|---|---|
| 1.1 | ccfg `main` green | M3 (latest `main` CI conclusion) |
| 1.2 | ccfg ≥ 10 lands / day | M1 (lands, trailing 24 h) |

## Reporting

Each checkpoint is measured by the session the matching coord `time_elapsed` gate spawns. It posts ONE coord
finding, topic `merge-train-metrics`, resource key `prompt_document:success_metric/merge-train-throughput-2026-10`.
