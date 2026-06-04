# Style-gate assertion specs (Phase 2)

One `<id>.json` per route in `../routes.json` (`co-pilot`, `build-workflows`,
`library`). Each file is a declarative assertion suite the `vision-audit assert`
bin evaluates against that route's captured snapshot + frame.

## File format

The bin (`rust-vision-core/src/bin/vision_audit.rs`, `parse_assertions`, lines
455-468 on `qontinui-schemas@origin/main`) accepts **either** a bare JSON array
of assertion objects **or** a `{ "assertions": [ ... ] }` wrapper. We use the
wrapper here so the file self-documents.

Each assertion object is a **serde tagged enum**. The tag field is `type` and
variant names are `snake_case`, fixed by:

```rust
// rust-vision-core/src/assertions/mod.rs:22-24
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Assertion {
```

So an assertion is `{ "type": "<variant>", ...variant fields... }`. A wrong tag
field name or a wrong/unknown `type` makes the bin **exit 1 at parse time**
(`serde_json::from_value(arr)` → "invalid assertion in list"), so the shape must
match the serde exactly — that is the whole point of committing these.

## What is seeded, and why only this

The plan's 4 candidate page-wide seed assertions were `no_overlap`,
`no_clipping`, `contrast_meets_wcag`, `text_fits_container`. Checking each
variant's serde signature in `assertions/mod.rs`:

| assertion             | serde fields (mod.rs)                                   | page-wide? | seeded |
|-----------------------|--------------------------------------------------------|-----------|--------|
| `no_clipping`         | `region: Option<Region>` — `#[serde(default)]` (l.80-83)| **yes** — omit `region` → checks every parent/child pair in the snapshot | **YES** |
| `no_overlap`          | `elements: [String; 2]` (REQUIRED) (l.28-32)           | no — needs two specific element ids | omitted |
| `contrast_meets_wcag` | `element: String` (REQUIRED) + `level` default AA (l.93-97) | no — needs a specific element id | omitted |
| `text_fits_container` | `element: String` (REQUIRED) (l.42)                    | no — needs a specific element id | omitted |

Only **`no_clipping`** has no required element-reference field: its sole field
`region` is `Option<Region>` with `#[serde(default)]`, and the evaluator
(`eval_no_clipping`, mod.rs:822) iterates the **whole snapshot**, flagging any
child whose bbox extends past its positioned parent. With `region` omitted the
check is page-wide. The bin's own unit test deserializes the exact bare object
we ship (`{"type":"no_clipping"}`, vision_audit.rs:704-707), proving it parses.

The other three each carry a REQUIRED `element` / `elements` field that must name
an id present in the captured snapshot. We cannot run the authenticated capture
here (no creds), so guessing ids would produce assertions that fail with
"element '<id>' not found" rather than catching a real regression. They are
**deferred** until a real snapshot exists to read ids from (see expansion path).

### Explicitly excluded by the plan (not just deferred)

- `no_layout_shift_since` — needs a committed baseline (Phase 3); no baseline
  exists yet. Add per route once `baselines/<id>.json` is generated.
- `animation_settled` / the `dynamic` analyzer — not bin-evaluable: the bin
  skips `animation_settled` with a "evaluated runner-side" note
  (mod.rs:269-279) and rejects `--analyzer dynamic` (needs two frames,
  vision_audit.rs:285-288).
- `contains_text`, `aligned_horizontally`/`aligned_vertically`, `color_within`,
  `typography_consistent` — all need specific ids and/or expected values; add
  after burn-in.

## Tuning params / defaults

`no_clipping` takes no tuning params. When the deferred id-targeted assertions
are added, source their defaults from the serde:
- `contrast_meets_wcag` `level` defaults to **AA (4.5:1)** (`default_wcag_aa`,
  mod.rs:95/100-102; `WcagLevel::min_ratio` mod.rs:137-144) — omit `level` for
  AA, or set `"level": "aaa"` for 7.0:1.
- `color_within` `delta_e_max` defaults to **5.0** (`eval_color_within`,
  mod.rs:625).
- `no_overlap` / `aligned_*` / `no_layout_shift_since` `tolerance_px` default to
  **0 / 2 / 2** px respectively (mod.rs:345, 562, 793).

## Expansion path

1. Land Phases 2-4, let the capture + gate burn in across a few CI runs.
2. From a real captured `.artifacts/snapshots/<id>.json`, read stable element
   ids and add `contrast_meets_wcag` (key text), `text_fits_container`
   (headers/labels), `no_overlap` (toolbar/tab pairs) per route.
3. Generate baselines (`../refresh-baselines.mjs`, Phase 3), commit them, then
   add `no_layout_shift_since` (`{ "type": "no_layout_shift_since",
   "baseline": "<id>" }`) — the baseline name is the route id (the
   `--name <id>` passed to `vision-audit baseline`).

## Intentional vs. unintended layout change (once `no_layout_shift_since` lands)

`no_layout_shift_since` compares each element's current bbox to a **committed**
`baselines/<id>.json`. So:

- **Intended layout move** — when a PR deliberately changes a route's layout, the
  author regenerates the affected baseline(s) **in the same PR**: run a capture,
  then `node tests/e2e/style-gate/refresh-baselines.mjs`, and commit the updated
  `baselines/<id>.json`. The PR diff then shows *both* the route change *and* the
  baseline update — review sees them together.
- **Unintended shift** — a baseline the author did **not** touch starts drifting
  under an unrelated change → `no_layout_shift_since` fails in CI, surfacing the
  regression. The fix is to investigate the drift, not to blindly refresh the
  baseline.
