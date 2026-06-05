# Style-gate layout baselines (Phase 3)

Committed `<id>.json` files — one per route in `../routes.json` — each holding
that route's element bboxes at baseline time. They are the reference the
`no_layout_shift_since` assertion compares against.

## Shape

Each `<id>.json` is a serialized `BaselineEntry`
(`rust-vision-core/src/assertions/mod.rs:194-197`):

```json
{ "element_bboxes": { "<element-id>": { "x": 0, "y": 0, "w": 100, "h": 50 } } }
```

You do **not** hand-author these. They are produced by
`vision-audit baseline --snapshot <snap> --name <id> --baseline-dir <thisdir>`
(`vision_audit.rs:546-567`), which writes only the bboxes of positioned
elements (`BaselineEntry::from_snapshot`, mod.rs:200-210).

## Committed baselines (and why one route is excluded)

`build-workflows.json` and `library.json` are baselined and their specs include
`no_layout_shift_since`. They were generated from a real CI render
(`vision-audit baseline` on the captured snapshot) after **empirically verifying
layout determinism**: across two independent CI runs of the same code, every
common element's bbox was **0 px** different (well within the default 2 px
tolerance), and the only id churn was a download-size button whose id encodes a
changing number (`button-133-mb` ↔ `button-125-mb`) — harmless, since
`no_layout_shift_since` only compares elements present in BOTH run and baseline
and ignores added/removed ids (`eval_layout_shift`, mod.rs:767+).

**`co-pilot` is deliberately NOT baselined** (its spec stays `no_clipping`-only):
its UI-Bridge snapshot intermittently fails to capture (the relay-attach race
being tuned via `settleMs`), so a baseline would flake. Add its baseline once
co-pilot capture is proven stable across runs.

## Generating / refreshing baselines

From `frontend/`, after a capture run has populated
`tests/e2e/style-gate/.artifacts/snapshots/`:

```bash
# build/point at the bin via VISION_AUDIT_BIN (or --bin), then:
node tests/e2e/style-gate/refresh-baselines.mjs
```

The script runs `vision-audit baseline` once per route id, writing
`baselines/<id>.json`. It skips (loudly) any route whose snapshot artifact is
missing, and exits non-zero if any bin call fails. Commit the resulting
`<id>.json` files.

## Intentional vs. unintended layout change

See `../specs/README.md` ("Intentional vs. unintended layout change"). In short:
a PR that intends to move layout regenerates and commits the affected baseline(s)
in the same PR; an unintended shift = a baseline the author didn't touch drifting
→ `no_layout_shift_since` fails in CI.
