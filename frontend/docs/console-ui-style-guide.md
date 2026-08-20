# Console UI Style Guide

**Version:** 0.2.0 (Phase 1 — §3 filled in from the shipped primitives)
**Last Updated:** 2026-08-20
**Plan:** `2026-08-16-coord-console-ui-unification-pipeline-style.md`

The style of `/admin/coord/fleet` — the merge Pipeline tab — written down, so the
other 29 console routes can be moved onto it and the next operator surface can be
built on it instead of inventing a third shape.

Every code citation below was verified against `origin/main` at
`859d8286fe611408b929c89b5e95ebf5a39e9c50` — **with one declared exception:
[§3](#3-the-primitive-catalogue) describes
`src/components/console/`, which is NOT on `main` yet. That directory lands with
the Phase 1 PR, which is itself **stacked on qontinui-web#986** (still open —
it is what moved the row atoms out of `MergePipeline.tsx` in the first place).
So §3 describes code that exists and is tested, on a branch, behind an unlanded
dependency. It is marked as such at its use sites, and this note comes out when
both land.** Line numbers move; the symbol
names do not. When a citation drifts, fix the citation — do not fix the rule to
match whatever the code drifted into.

## Table of Contents

1. [Scope](#1-scope)
2. [The nine rules](#2-the-nine-rules)
3. [The primitive catalogue](#3-the-primitive-catalogue)
4. [The attention palette](#4-the-attention-palette)
5. [Density budget](#5-density-budget)
6. [Where each layer is enforced](#6-where-each-layer-is-enforced)

---

## 1. Scope

This guide governs **operator and monitoring surfaces in `qontinui-web`** — the
pages whose job is to let one person watch a fleet of machines and act on what
they see.

**In scope today:** every route under `src/app/(app)/admin/coord/` — **30
top-level routes plus 5 dynamic detail routes** (`[agent_id]`, `[slug]`, `[id]`,
`[name]`, `[version]`), i.e. 35 `page.tsx` files. "30 routes" below always means
the top-level set.

**In scope next, by construction:** `/admin/agent-claims`, `/admin/agent-sessions`,
and any operator surface added after them. The guide is named
`console-ui-style-guide.md` rather than `coord-console-style-guide.md` for exactly
this reason: narrowing the claim later is a rename, widening it later means every
citation already written points at the wrong scope.

**Explicitly NOT in scope:**

- the **automation builder** — the workflow canvas, node editors, state graphs and
  everything else under `@qontinui/workflow-ui`. Those are direct-manipulation
  authoring surfaces; their density and colour problems are different problems;
- **marketing / public surfaces** — the landing pages, pricing, docs shells. They
  optimise for a first-time reader, this guide optimises for the tenth read of the
  same page today;
- **forms and dialog hosts inside the console** (`/merge-settings`, `/onboarding`,
  `/automation-rules`, `/prompt-documents`) take **R9 (chrome) and R3 (palette)
  only**. R1/R2/R5 are about list surfaces and do not apply to a form.

The general house styling rules still apply underneath this guide, not instead of
it: `src/styles/components.css` for the CSS classes used in JSX, `src/config/theme.ts`
for programmatic values. This guide adds *composition* rules those two files cannot
express.

---

## 2. The nine rules

Nine rules, R1–R9. Each is stated, then shown as a ✅/❌ pair from code that is on
`main` today. The ✅ side is always `src/components/operations/MergePipeline.tsx`
(the Pipeline tab). The ❌ side is always **a real console file on `main`** — the
anti-patterns are not hypothetical. Most are near-universal (the fat-card record
shape and the duplicated page title are on all 18 Family-B routes), but the count
varies per rule, and each ❌ below names the file it came from. Where a rule has
**no** live violator at a given scale, the guide says so rather than
manufacturing one — see
[R7](#r7--secondary-material-collapses-but-its-signal-does-not).

> **Where this code lives after Phase 1.** The ✅ examples below are `origin/main`
> coordinates, and they are still exactly right about `origin/main`. They are no
> longer where you should COPY FROM: Phase 1 moved the mechanism each one
> demonstrates out of `MergePipeline.tsx` and into a primitive
> ([§3](#3-the-primitive-catalogue)), and `MergePipeline` now composes those
> primitives like any other page. The examples stay as the *derivation* of each
> rule — they show the code the rule was read off — and this table is the map from
> the rule to the thing to reach for:
>
> | Rule | Now lives in |
> |---|---|
> | R1 | `console/HealthStrip.tsx`, `console/StatCluster.tsx` |
> | R2, R4 | `console/RecordRow.tsx`, over `console/statusRow.tsx` |
> | R3 | `console/statusRow.tsx` + `console/attention.ts` |
> | R5 | `console/RecordDetail.tsx`, `console/RecordList.tsx` |
> | R6 | `console/FilterTabs.tsx` |
> | R7 | `console/CollapsiblePanel.tsx` |
> | (support) | `console/time.ts` — `relativeTime` / `absoluteTime` |
> | R8, R9 | no primitive — they are rules about what a PAGE does, not a component |
>
> Both the move and this note are unlanded (§3's caveat). The ✅ line numbers are
> re-pointed at `main` coordinates once Phase 1 lands; they are deliberately NOT
> re-pointed at branch coordinates now, because a citation to an unmerged line
> number is worse than a citation to a real one that has moved.

### R1 — Health strip first

Every list surface opens with **one derived traffic-light row**: a status dot, a
one-sentence headline, and a right-aligned cluster of mono count badges. The strip
is derived from data already on the page — **never a second fetch**. A viewer must
be able to answer "is this healthy?" without reading a single row.

✅ `src/components/operations/MergePipeline.tsx:430-495` — `HealthStrip`. The whole
signal in one 44px row, and the derivation is a `useMemo` over rows the page
already has:

```tsx
// MergePipeline.tsx:441-443
const health = useMemo(
  () => derivePipelineHealth(rows, Date.now(), economicsByRepo),
  [rows, economicsByRepo]
);
```

```tsx
// MergePipeline.tsx:456-465 — dot, headline, detail
<span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${LIGHT_CLASS[health.level]}`} aria-hidden />
<span className={`text-[13px] font-semibold ${HEADLINE_CLASS[health.level]}`}>
  {loaded ? health.headline : "Connecting…"}
</span>
```

```tsx
// MergePipeline.tsx:469-476 — the right-aligned mono count cluster
<span className="ml-auto flex items-center gap-2">
  <Badge variant="outline" className="font-mono text-[11px]">queue {health.queueDepth}</Badge>
  <Badge variant="outline" className="font-mono text-[11px]">in flight {health.inFlight}</Badge>
```

❌ `src/app/(app)/admin/coord/plans/page.tsx:116-127` — a page that opens with a
title and a total count and nothing else. `{plans.length}` is a *size*, not a
*health*: it does not tell you whether any plan needs you.

```tsx
// plans/page.tsx:116-127
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2 text-base">
      <FileText className="h-4 w-4" />
      Plans
      {data && <Badge variant="outline" className="ml-2">{plans.length}</Badge>}
    </CardTitle>
  </CardHeader>
```

### R2 — One record = one line

A record row is a **single horizontal flexbox** at `px-3 py-2`, `text-sm`,
`rounded-md border`, on `bg-card/30`. The slot order is fixed:

**identity badge (mono) → primary label (truncating, `flex-1`) → status badge →
reason (`hidden sm:inline`, truncating) → time → chevron**

Overflow is **truncation with a `title`**, never wrapping. Wrapping is what makes a
list unscannable: a wrapped row changes height, so the eye cannot use vertical
rhythm to skim.

✅ `src/components/operations/MergePipeline.tsx:812-878` — `PipelineRowDisplay`. All
six slots, one line:

```tsx
// MergePipeline.tsx:826-832
<button
  type="button"
  onClick={onToggle}
  className={`w-full flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-card/30 hover:bg-accent/60 transition-colors text-left ${rowAccentClass(row)} ${expanded ? "rounded-b-none bg-accent/60" : ""}`}
  aria-expanded={expanded}
>
```

```tsx
// MergePipeline.tsx:841-845 — the truncating label owns the flex
<span className="min-w-0 flex-1 truncate text-sm">
  <span className="text-foreground/90">{row.branch}</span>
  {row.baseBranch && <span className="text-muted-foreground"> → {row.baseBranch}</span>}
</span>
```

```tsx
// MergePipeline.tsx:859-871 — reason drops out below `sm`, truncates above it,
// and the full text always survives in a native title
<span
  className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[22ch] lg:max-w-[40ch]"
  title={row.status.reason}
  data-testid="row-reason"
>
```

❌ `src/components/admin/coord/PlanCard.tsx:44-48` — a `<Card>` per record, with
`p-4` padding and three stacked lines inside. ~96px per record against the
Pipeline row's ~34px.

```tsx
// PlanCard.tsx:44-52
<Card className="hover:bg-muted/50 transition-colors" data-testid="coord-plan-card">
  <CardContent className="p-4">
    <div className="flex items-start gap-2">
      <Link
        href={`/admin/coord/plans/${encodeURIComponent(plan.slug)}`}
        className="flex-1 min-w-0 space-y-1.5"
```

The `space-y-1.5` on the inner `<Link>` is the tell: it exists to separate the
three stacked lines (slug row, title, dates) that R2 says should be one.

### R3 — Colour encodes who must act

Three families only:

- **red** — someone must act *now*;
- **amber** — waiting on something else, and it will clear itself;
- **everything else** — a calm in-flight hue (yellow = work running, purple =
  testing, blue = landing, green = done, muted = inert).

A single audited table is the source of truth for which kind gets which family,
and a unit test asserts the palette map agrees with it — so severity and colour
can never drift apart. Full contract in [§4](#4-the-attention-palette).

✅ `src/components/operations/MergePipeline.tsx:96-99` — the families, named, once:

```ts
// MergePipeline.tsx:96-99
const AUTHOR_RED = "bg-red-500/15 text-red-200 border-red-500/35";
const WAITING_AMBER = "bg-amber-500/15 text-amber-200 border-amber-500/30";
const CI_YELLOW = "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
const INERT = "bg-muted text-muted-foreground border-border";
```

...and the rationale is in the file, not only here
(`MergePipeline.tsx:77-93`) — this is the comment every console component's module
doc should be able to point at:

> **color encodes who has to do something, not how alarming the word sounds.** […]
> a red badge on "CI hasn't finished" trained the eye to ignore red, while a failed
> check — the one state that genuinely needs a push — sat in amber next to it.

❌ `src/app/(app)/admin/coord/gates/_components/GatesTable.tsx:463-575` — a
nine-column table with **no attention encoding at all**. Verdict and flags are
text; nothing on the row tells the eye which of forty gates is the one waiting on
a human. Its only colour decisions are per-cell and ad hoc, and its detail
affordance is an Actions column:

```tsx
// GatesTable.tsx:463-474
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Gate</TableHead>
      <TableHead>Measures</TableHead>
      <TableHead>Progress</TableHead>
      <TableHead>Expected finish</TableHead>
      <TableHead>Verdict</TableHead>
      <TableHead>Age</TableHead>
      <TableHead>Last evaluated</TableHead>
      <TableHead>Flags</TableHead>
      <TableHead className="text-right">Actions</TableHead>
```

### R4 — Left-edge accent, not a coloured row

A row needing attention gets a **2px left border**. The row body stays neutral, so
forty rows remain readable when six are red. A fully-tinted row is legible in
isolation and illegible in a list of forty.

✅ `src/components/operations/MergePipeline.tsx:133-139` — `rowAccentClass`, the
entire mechanism:

```ts
// MergePipeline.tsx:132-139
/** Left-edge accent: red = the author must act, amber = waiting on others. */
function rowAccentClass(row: PipelineRow): string {
  if (row.status.attention === "author")
    return "border-l-2 border-l-red-500/80";
  if (row.status.attention === "waiting")
    return "border-l-2 border-l-amber-500/80";
  return "";
}
```

The badge (`STATUS_BADGE_CLASS`, `MergePipeline.tsx:101-130`) carries the
`bg-*/15` tint; the *row* carries only the edge.

❌ `src/components/admin/coord/PlanCard.tsx:44` — the card's only state affordance
is `hover:bg-muted/50`, i.e. a hover tint on the whole surface and no resting
attention signal whatsoever. There is no accent to be quiet about, because there
is no attention model to drive one.

### R5 — Detail expands in place

Clicking the row toggles a detail panel that renders **below the row it belongs
to**, sharing its border (`border-t-0 rounded-b-md`), with a fixed section order:

**plain-language why → what failed → action buttons/links → history → raw ids**

Raw internal identifiers appear **only** in that last line, in
`font-mono text-[10px] text-muted-foreground/60`. One row is open at a time.

This is the load-bearing rule for requirement (3) of the ask — *"per-record details
are reachable by clicking the individual record"* — and it is what buys R2 its
density: a row can be one line because the other twelve fields have somewhere to go.

✅ `src/components/operations/MergePipeline.tsx:647-777` — `RowDetail`. Note the
shared border, which is what makes the panel read as *this row's* detail rather
than as a floating card:

```tsx
// MergePipeline.tsx:659
<div className="border border-t-0 border-border rounded-b-md bg-card px-4 py-3 space-y-3 text-sm">
```

```tsx
// MergePipeline.tsx:660-665 — section 1: the why, in plain language, first
{row.status.reason && (
  <p className="text-[13px] text-foreground/85 m-0">{row.status.reason}</p>
)}
```

```tsx
// MergePipeline.tsx:758-759 — the last section, and the ONLY place internals show
{/* raw state for support/debugging — the ONLY place internals show */}
<p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
```

One-open-at-a-time is a single piece of state, hoisted to the list
(`MergePipeline.tsx:925`, consumed at `:1087`):

```tsx
// MergePipeline.tsx:925
const [expandedKey, setExpandedKey] = useState<string | null>(null);
```

❌ Two different failures, both live:

**❌ (a) — navigate away instead of expanding.** `PlanCard.tsx:50-53` wraps the
record in a `<Link>` to a detail route. Clicking costs a navigation, a fetch, and
your filter and scroll position — to read four more fields:

```tsx
// PlanCard.tsx:50-53
<Link
  href={`/admin/coord/plans/${encodeURIComponent(plan.slug)}`}
  className="flex-1 min-w-0 space-y-1.5"
  data-testid="coord-plan-card-link"
>
```

**❌ (b) — no detail at all.** `GatesTable.tsx:489-571` has no expandable row: the
`<TableRow>` is inert and every field the page knows is already competing for
horizontal space in nine columns. There is nowhere to put a tenth fact, so it does
not get shown.

```tsx
// GatesTable.tsx:489
<TableRow key={g.gate_id} data-testid="gates-table-row">
```

Detail **routes** survive only where the detail is a *workspace* — its own actions,
sub-navigation or version history (`/plans/[slug]`, `/agents/[agent_id]`,
`/questions/[id]`, `/memory/[name]`). What goes away is the whole-record `<Link>`:
the row expands, and the expanded panel carries an explicit **"Open full page ↗"**
action. Deep links keep working; what stops is being navigated away by accident.

### R6 — Filter tabs carry live counts

Ghost/secondary buttons with a **mono count suffix**, plus a right-aligned `w-56`
filter input. A count that has **not been fetched renders `–`, never `0`** —
absence is UNKNOWN, not zero. This is the same discipline as the fleet's
`silent-empty-is-unknown` policy, applied to a badge.

✅ `src/components/operations/MergePipeline.tsx:1004-1048` — the tab strip. The
unfetched-count rule and its full reasoning:

```tsx
// MergePipeline.tsx:1036-1038
{f.id === "merged" && mergedPrs === null
  ? (mergedCount ?? "–")
  : counts[f.id]}
```

```tsx
// MergePipeline.tsx:1042-1048 — the right-aligned filter input
<input
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  placeholder="filter: repo, branch, #number…"
  className="ml-auto w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs …"
```

The comment at `MergePipeline.tsx:1022-1035` is the rule stated in situ — *"until
then `counts.merged` is 0 for want of looking, not because nothing landed"* — and
it also records the honest case where the two numbers legitimately differ.

❌ `src/app/(app)/admin/coord/plans/page.tsx:116-128` — filters live *inside* a
`<CardContent>` below a title, with no per-subset counts at all. The page can tell
you it has 40 plans; it cannot tell you how many are in each state without you
clicking each filter and counting rows.

### R7 — Secondary material collapses, but its signal does not

Anything infrastructural goes into `<CollapsiblePanel>`, which keeps its `summary`
badges **visible while collapsed** and **unmounts its children when closed** — so a
closed panel costs zero polling, and a red state never hides behind a click.

When a panel is collapsed, check whether anything else depended on its polling side
effect. If so, hoist the fetch to the page.

✅ `src/components/operations/CollapsiblePanel.tsx:3-22` states the contract in its
own module doc, and the two properties are structural:

```tsx
// CollapsiblePanel.tsx:107-112 — summary rides in the header, inside the trigger
<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
  {title}
</h2>
{summary}
</CollapsibleTrigger>
```

```tsx
// CollapsiblePanel.tsx:119-121 — children live in CollapsibleContent, so a closed
// panel has no mounted pollers
<CollapsibleContent className={cn("mt-3", contentClassName)}>
  {children}
</CollapsibleContent>
```

✅ `src/app/(app)/admin/coord/fleet/page.tsx:281-310` is the pattern in use, and the
comment above it says why:

```tsx
// fleet/page.tsx:281-283
{/* Everything infrastructural, one click away. Children unmount while
    collapsed, so their pollers only run when an operator opens this. */}
<CollapsiblePanel
```

...with the alarm counts hoisted into `summary` so the red state survives the
collapse (`fleet/page.tsx:289-310`: `{unhealthy} unhealthy`,
`{admission.breach} refusing work`). The health hook itself is hoisted to the page
(`useFleetHealth`, `fleet/page.tsx:86`, called at `:222`) precisely so the collapse
cannot take the signal with it.

❌ `src/app/(app)/admin/coord/lands/page.tsx:337` — `<LandPrecisionPanel>` is
rendered **unconditionally**, and its own fetch polls every 30s
(`lands/page.tsx:184-189`; `POLL_INTERVAL_MS` at `:51`) for the whole life of the
page. It is section 3 of a three-section page — per-dimension predictor
precision/recall calibration
(`components/admin/coord/LandPrecisionPanel.tsx:3-15`) — i.e. exactly the
infrastructural material R7 says belongs behind a click. Every visitor to `/lands`
pays that poll whether or not they came to read a calibration table:

```tsx
// lands/page.tsx:331-337
{/* ---- 3. Calibration ---- */}
{precisionError && (
  <p className="text-sm text-destructive">
    Failed to load calibration: {precisionError}
  </p>
)}
<LandPrecisionPanel data={precision} loading={precisionLoading} />
```

**At RECORD scale, R7 has no live violator — and one near-miss worth recording so
nobody "fixes" it.** `LandCard.tsx`'s `<CrossRepoVerdictPanel>` looks like an
embedded per-record panel and is not one: it is gated on `crossRepoOpen`
(`LandCard.tsx:594-597`), toggled at `:485-491`, and its own comment at `:335-336`
records that it fetches **once on mount** and that *"the panel only mounts when the
operator expands it"*. That is R7 already satisfied, by a file that wrote down the
same rationale this rule gives. Leave it alone.

### R8 — No internal vocabulary on a primary surface

Status derivation (`proposal` → "Merge attempt", `dry-rebasing` → "Testing merge
compatibility") happens in a **pure, unit-tested module**, not inline in JSX. Raw
ids appear only in the expanded detail's last line (see R5).

Two reasons, and the second is the one that keeps mattering: a pure module can be
tested exhaustively over its kind union, and a derivation written inline in JSX
cannot be shared with the next surface without copying it.

✅ `src/components/operations/prPipeline.ts` — 1576 lines of derivation with zero
JSX, tested by `prPipeline.test.ts` (2084 lines). The status union is declared once
(`prPipeline.ts:29-65`), the kind→attention table is exported
(`prPipeline.ts:128`), and `MergePipeline.tsx` imports derived rows rather than
deriving them:

```ts
// MergePipeline.tsx:64-75
import {
  buildPipelineRows,
  derivePipelineHealth,
  matchesFilter,
  matchesQuery,
  …
} from "./prPipeline";
```

The label is what reaches the screen; the enum never does
(`StatusBadge`, `MergePipeline.tsx:194-220`, renders `label`, and puts `kind` in a
`data-status-kind` attribute for tests and the style gate — not in text).

❌ `GatesTable.tsx:463-473` surfaces coord's own column vocabulary directly —
"Measures", "Verdict", "Flags" are internal gate-engine terms, and the cells under
them render raw values. The nine-column table is a legitimate dense form (see D2
in the plan: Family C keeps its tables); what it must gain is a derivation module
between the API shape and the cell.

### R9 — Page chrome is one line, or absent

The console shell already renders the title bar and the nav crumb. A per-page
`<Card><CardHeader><CardTitle>` is a **duplicated title costing ~72px above the
fold** on every route.

The page body is `p-3 sm:p-6 space-y-4`, plus `overflow-x-auto` where wide panels
would otherwise strand action buttons off-screen. Vertical scroll comes from the
layout's `<main>`.

✅ `src/app/(app)/admin/coord/fleet/page.tsx:263-270` — no `<h1>`, no page-level
`<Card>`, and the reason for `overflow-x-auto` written down:

```tsx
// fleet/page.tsx:263-270
// `overflow-x-auto`: wide panels (the merge dependency graph, train rows)
// scroll instead of stranding action buttons off-screen. Vertical scroll
// comes from the coord layout's <main overflow-y-auto>.
<div
  className="p-3 sm:p-6 space-y-4 overflow-x-auto"
  data-testid="coord-fleet-page"
>
```

The shell that already supplies the title is
`src/app/(app)/admin/coord/layout.tsx:44-57`:

```tsx
// layout.tsx:47-53
<header className="flex items-center gap-2 flex-wrap px-3 sm:px-6 py-2 border-b border-border bg-card shrink-0">
  <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
  <h1 className="text-sm font-semibold whitespace-nowrap">
    Coord operator console
  </h1>
```

> **Do not touch that `<h1>` or its text.** Thirteen Playwright assertions across
> `admin.spec.ts`, `admin-coord-questions.spec.ts` and `admin-coord-spawn.spec.ts`
> match it by role and exact name. Deleting per-page `<CardTitle>`s does not touch
> it; deleting or renaming the layout's `h1` breaks all thirteen.

Also layout-mounted and present on every console page: `RedMainBanner`
(`layout.tsx:63`). Page-level `space-y` must not assume it is absent.

❌ `src/app/(app)/admin/coord/plans/page.tsx:115-128` — the page body is already
correct (`p-3 sm:p-6 space-y-4`), and then immediately wraps everything in a
`<Card>` whose `<CardTitle>` re-states the page name the shell has already
rendered:

```tsx
// plans/page.tsx:115-128
<div className="p-3 sm:p-6 space-y-4" data-testid="coord-plans-page">
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <FileText className="h-4 w-4" />
        Plans
        …
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
```

This exact shape is repeated across 18 Family-B routes.

---

## 3. The primitive catalogue

> **Filled in by Phase 1, 2026-08-20.** Everything below EXISTS and is unit-tested
> — but **on a branch**, not on `main`. `src/components/console/` lands with the
> Phase 1 PR, which is stacked on **qontinui-web#986** (still open). Read every
> row as "shipped in Phase 1, unlanded until #986 and Phase 1 both merge". The
> caveat comes out when they do; it is not removed earlier just because the code
> is written.

The primitives are the **executable half of this guide**. A prose rule is a
suggestion; `import { RecordRow } from "@/components/console"` is a fact visible in
a diff. §6.4's rule — *a new console page adds no new visual vocabulary* — is
enforceable only because there is something to compose instead.

They are **presentation only**. Nothing in `console/` fetches, polls, or knows a
route, and **no shipped module under `console/` has any runtime dependency on
`components/operations/`** — the only edge from shipped code is an
`import type` on `prPipeline`, which erases at build time. (`console/`'s TESTS
do import values from `operations/` and `admin/coord/` — that is
`attention.test.ts`, the cross-surface palette oracle described below, and it is
supposed to. Test files ship nothing.) That is what lets `/admin/coord/*`,
`/admin/agent-claims` and `/admin/agent-sessions` share them without sharing a
data model, and it is what makes R1's *"derived, never a second fetch"*
structurally true rather than a thing reviewers have to remember to check.

That property is **checked, not assumed** — see the note at the end of
[§3.1](#31-the-base-this-is-built-on--consolestatusrowtsx) for the single
harmless-looking import that falsified it, and what it cost to make it true.

### 3.1 The base this is built on — `console/statusRow.tsx`

> **This module is not on `main`.** It arrived on **qontinui-web#986** as
> `src/components/operations/statusRow.tsx`, and Phase 1 **moved it** to
> `src/components/console/statusRow.tsx` — unchanged apart from its module doc and
> its import paths. A re-export stays in `operations/index.ts` so no existing
> import breaks (D3). Until #986 and Phase 1 both land, every citation in this
> section is a citation to branch code. Line numbers are as of the Phase 1 branch.

Phase 1 did **not** start from a blank file, and it did not re-extract these atoms.
`qontinui-web#986` (plan `2026-08-05-coord-alerts-surface-and-fleet-style-ui`) had
already pulled the row primitives out of `MergePipeline.tsx` and generalised them
over a surface-agnostic `RowStatus` interface plus a per-surface `StatusPalette`.
Building a second `StatusBadge` beside it would have been exactly the
duplicate-helper defect this plan exists to remove, so the module **moved** into the
console layer and the composition primitives were built **around** its contract.

Its own module doc records why it exists, and the sentence generalises past this
one module:

> *"Two surfaces sharing one paragraph had already drifted; two surfaces sharing one
> implementation cannot."*

What `statusRow.tsx` provides (300 lines):

| Export | What it is |
|---|---|
| `RowStatus<K>` (`:67`) | The minimum a row's status must carry: `kind`, `label`, `reason?`, `attention`, `dwellEvidence?`. Both `prPipeline`'s `UnifiedStatus` and `alertStatus`'s `AlertStatus` are structurally assignable to it. |
| `AUTHOR_RED` / `WAITING_AMBER` / `CI_YELLOW` / `INERT` (`:82`, `:84`, `:86`, `:88`) | The three colour families plus inert, **exported** — so a second surface cannot pick its own red. |
| `STATUS_BADGE_CLASS` (`:96`), `AUTHOR_GLYPH_KINDS` (`:139`) | The merge pipeline's own kind→class table and `✕`-glyph set, beside the families they are built from. |
| `StatusPalette<K>` (`:170`) | Everything a surface supplies to render its own badges: `badgeClass`, `authorGlyphKinds`, `doneGlyphKinds?`, `unknownNote?`. One object, so each surface's agreement test has a single thing to audit. |
| `rowAccentClass(status)` (`:182`) | R4, over `Pick<RowStatus, "attention">`. |
| `StatusBadge({status, palette, className})` (`:197`) | R3 + the colourblind-safe glyph rule + the native-`title` "why". |
| `RowTime({at, verb, prefix, absent, className})` (`:265`) | The right-hand timestamp, with an **explicit** rendering for "this row has no time" rather than a blank or a fabricated one. |

It is deliberately **type-only** on `prPipeline`, so a surface using these
primitives does not bundle 1576 lines of merge-train derivation. **Keep that
property** — it is the difference between a shared primitive and a shared bundle.

**No shipped module under `console/` has any runtime dependency on
`components/operations/`**, and that took one deliberate move to be true.
`statusRow` used to import `relativeTime` from `@/components/operations/utils`
— which is not a neutral util bag but the 730-line merge-train **route
catalogue** (`OPERATIONS_API`, `GATES_LIST_API`, ~30 URL builders, the
poll-cadence constants, a runtime dependency on `@/services/api-config`). One
28-line pure formatter was dragging all of it into the base layer and falsifying
the barrel's own "nothing here knows a route". Phase 1 moved `relativeTime` into
`console/time.ts` and left a re-export in `operations/utils.ts`, so all **23**
existing importers are untouched (13 via `@/components/operations/utils`, 10 via
`./utils`). The lesson generalises: **check this property when adding a
primitive**, because the import that broke it looked completely harmless.

> **Later-wave debt, discovered while counting those 23.** Six more files
> declare their OWN `relativeTime` and import nothing, so the shim does not
> reach them and this move did not touch them:
> `admin/agent-claims/AgentClaimsDashboard.tsx`,
> `admin/agent-sessions/AgentSessionsDashboard.tsx`,
> `admin/coord/TreeCard.tsx`,
> `admin/prompt-injections/PromptInjectionsDashboard.tsx`,
> `execute/ScheduleListItem.tsx`, `sessions/LineageTimeline.tsx` — plus
> `operations/gatesPredicate.ts`'s `relativeAgo`, a same-shape copy under
> another name that discloses itself in its own comment. Three of them
> (`/admin/agent-claims`, `/admin/agent-sessions`, `TreeCard` on the coord
> console) are surfaces [§1](#1-scope) explicitly claims, so these are six
> live instances of the duplicate-helper defect this plan exists to remove.
> **Migrate each onto `console/time` as its wave reaches it**, and do not read
> "23 importers" as "every caller".

### 3.2 The console primitives

All exported from the `@/components/console` barrel, whose module doc carries the
same table. Every module doc cites its rule number and links this file.

| Component | Rule(s) | Props | Notes |
|---|---|---|---|
| `HealthStrip` | R1 | `{ level, headline, detail?, badges?, className?, "data-testid"? }` where `badges: { key, label, tone?, onClick?, title?, "data-testid"? }[]` and `tone: "default" \| "muted" \| "attention"` | Takes the **already-derived** verdict. It cannot fetch, so R1's "never a second fetch" is structural. A badge with an `onClick` becomes a real `<button>` wrapping the badge in `display:contents`. |
| `StatCluster` | R1 | `{ stats, className?, "data-testid"? }` where `stats: { key, label, value, tone?, title?, onClick?, "data-testid"? }[]` and `tone: "default" \| "success" \| "warning" \| "attention" \| "muted"` | The count-cluster form of the same opening, for a table page with no single traffic-light verdict. `value: null` renders `–`, never `0`. **No consumer yet** — `/gates` adopts it in Wave 4, which is where `SummaryCards`' testids get ported. |
| `RecordRow` | R2, R4 | `{ identity, label, status?, reason?, time?, accent?, expanded, onToggle, children?, rowKey?, className?, "data-testid"?, reasonTestId? }` | Slot ORDER is fixed by the primitive, not the caller. `status` and `time` are `ReactNode` slots so each surface renders its own `<StatusBadge palette={…}>` without the row knowing a kind union. `accent` is the string from `rowAccentClass(status)`. The whole line is one `<button>` — R5 has to be keyboard-reachable. `children` render below the row, only while expanded. |
| `RecordDetail` | R5 | `{ why?, problems?, actions?, history?, raw?, className?, "data-testid"? }` | Five slots in that order, each a bare fragment, so the panel's `space-y-3` spaces real content and an absent slot leaves no gap. Shares the row's border (`border-t-0 rounded-b-md`). Not a slide-over (D2). |
| `RecordList` | R2, R5 | `{ items, itemKey, renderRow, loaded?, skeletonRows?, empty?, className? }` &plus; a `RecordListExpansion` **union**: either neither of `{expandedKey, onExpandedKeyChange}` or **both** | The loading / empty / rows trichotomy is ONE decision, so it is one component. Unloaded renders skeletons, never an empty list. `empty` is the caller's, because an honest empty state names *which* question came back empty. One open at a time. Expansion state is internal unless hoisted, and the hoisting props are a UNION so supplying one without the other is a type error rather than a silently-ignored prop. |
| `FilterTabs` | R6 | `{ tabs, active, onChange, testIdPrefix?, query?, onQueryChange?, queryPlaceholder?, queryTestId?, className? }` where `tabs: { id, label, count?, attention?, testId? }[]` | **`count == null` → `–`; `count === 0` → `0`.** The rule lives in the primitive precisely because it is the clause a page author will not think to reproduce. A caller expresses "unknown" by passing `null`, which is what an unfetched value already is. |
| `CollapsiblePanel` | R7 | unchanged | **Moved** from `operations/CollapsiblePanel.tsx`; a re-export shim stays at the old path for its ~15 relative importers, plus one in `operations/index.ts` (D3). |
| `statusRow` atoms | R2, R3, R4 | see §3.1 | **Moved**, not re-extracted. |
| `time.ts` | supports R2 | `relativeTime(iso)`, `absoluteTime(iso)` | Moved out of `operations/utils.ts` so `console/` carries no runtime edge into the merge-train route catalogue. `operations/utils.ts` re-exports `relativeTime`, so its **23** importers are untouched — but six other files declare their own copy and are NOT among them (see §3.1). |
| `attention.ts` | R3 | `Attention`, `AttentionMap<K>`, `attentionOf(map, kind, floor?)`, `escalateAttention(a, b)`, `ATTENTION_RANK`, `paletteDisagreements(attentionByKind, palette, {perRowKinds?})` | Import-free by design: `Attention` is **declared here** and re-exported by `prPipeline.ts`, so the severity vocabulary sits in the base layer instead of inside the merge-train module. `attentionOf` floors an unrecognised kind at `"waiting"`, never `"none"` — see §4.2. |

**How the invariant got generalised.** `MergePipeline.test.tsx`'s two palette tests
and `alertStatus.test.ts`'s three each audit one surface. Neither can bind a surface
that does not exist yet, and 29 routes are about to adopt the pattern. So the
assertion became `paletteDisagreements()` and
`src/components/console/attention.test.ts` runs it over a **registry** of every
console palette — today the merge pipeline and alerts. Adding a surface means adding
one line to that registry. The per-surface tests stay: they are each surface's own
oracle, and they cover things the generic audit cannot (per-row escalation, UUID
hygiene).

The audit carries exactly one declared exemption, `perRowKinds`, for a kind whose
badge class is resolved per row rather than read off the static table — the alerts
surface's `unknown`, whose attention is severity-derived. Its static entry is a
FLOOR, not the thing that renders, so auditing that floor for amber would demand a
colour the surface deliberately does not paint.

**It exempts the amber clause and nothing else.** The inline carve-out it
generalises (`alertStatus.test.ts`, `attention === "waiting" && kind !== "unknown"`)
only ever skipped amber, so exempting red as well would have made the shared audit
strictly weaker than the check it replaced — a shared invariant that is looser than
the per-surface one it absorbed is a regression dressed as a refactor. Red ⇔ author,
"every kind has a class", and red ⇔ `✕` all still run on a per-row kind, and the
surface's own test still has to cover the per-row resolution.

**How the extraction was proved.** The three rules Phase 1 was held to:

1. **`MergePipeline` was refactored onto the primitives in the same PR.** If the
   Pipeline tab did not render identically afterwards, the extraction was wrong.
   `MergePipeline.test.tsx` (930 lines, 36 tests) is the oracle and passed
   **unmodified**, as did `prPipeline.test.ts` (127) and `alertStatus.test.ts` (45).
2. **The palette agreement test was ported** into `console/attention.test.ts`, over
   the registry described above.
3. **Every module doc cites its rule number and links this file.** A primitive whose
   doc does not say which rule it enforces is a primitive nobody will know when to
   reach for.

Three authored testids moved from `MergePipeline.tsx` into the primitives that now
own them — `pipeline-search` (`queryTestId`), `pipeline-filter-<id>`
(`testIdPrefix`) and `row-reason` (`reasonTestId`'s default). They render
identically; the oracle asserting all three unmodified is the evidence.

---

## 4. The attention palette

**The rule: colour encodes who must act, not how alarming the word sounds.**

This is the single most important semantic decision in the console, and it is the
one that is easiest to get backwards. The bug it exists to prevent already
happened: a red badge on *"CI hasn't finished"* trained the eye to ignore red,
while a failed check — the one state that genuinely needed a push — sat in amber
next to it. Both errors are invisible in code review, because each individual badge
looks reasonable on its own.

### 4.1 The three families

| Family | Means | Class (today) | May be used by |
|---|---|---|---|
| **red** | someone must act **now** | `bg-red-500/15 text-red-200 border-red-500/35` | a kind whose attention is `"author"` — and every one of them |
| **amber** | waiting on something else; it will clear itself | `bg-amber-500/15 text-amber-200 border-amber-500/30` | a kind whose attention is `"waiting"` — and every one of them |
| everything else | in flight or terminal; nobody is blocked | yellow / purple / blue / green / muted / dashed | a kind whose attention is `"none"` |

Defined once at `MergePipeline.tsx:96-99`. **On `main` those four constants are
module-private — they are not exported, so grepping for an import of them finds
nothing.** qontinui-web#986 moved them into a shared module and Phase 1 moved that module
into the console layer: they are now `console/statusRow.tsx:82-88`, **exported**
for cross-surface reuse (both unlanded — see the §3.1 caveat). Either way the rule is
the same: nothing else may mint a red or an amber.

Two glyph rules ride along, both for colourblind readers, both total rather than
hand-picked:

- **red ⇔ `✕`.** Every `"author"` kind carries the `✕` glyph and no other kind
  does (`AUTHOR_GLYPH_KINDS`, asserted at `MergePipeline.test.tsx:370-389`).
- **`?` for an amber row whose dwell clock does not exist** — "we cannot say how
  long this has been waiting", which is neither "this is fine" nor "this is
  broken" (`dwellEvidence`, `prPipeline.ts:70-93`).

### 4.2 The `ATTENTION_BY_KIND` audit-table contract

`ATTENTION_BY_KIND` (`src/components/operations/prPipeline.ts:128`) is a total
`Record<UnifiedStatusKind, Attention>` — every status kind the module can construct,
mapped to exactly one of `"author" | "waiting" | "none"`. It is the **single source
of truth for severity**, and the palette is keyed off the same table rather than
off a parallel judgement. Its own doc comment carries a one-line-per-kind audit of
*why* each kind lands where it does (`prPipeline.ts:95-127`), which is what makes a
review of a new kind possible at all.

The contract a new surface must honour, in three parts:

1. **The kind→attention table is authored and audited.** One row per kind, with a
   stated reason. Not derived, not inferred from the label.
2. **The palette is keyed off it.** A kind's badge class is chosen by looking up
   its attention, never by re-reading the kind name.
3. **A unit test asserts the two agree.** Not a convention — an assertion, so the
   next kind added cannot silently pick the wrong colour.

Both halves of (3) are already enforced on `main`:

```ts
// MergePipeline.test.tsx:354-368 — red iff author, amber iff waiting, in one loop
it("keys the badge palette off attention — red only for author-action", () => {
  for (const [kind, attention] of Object.entries(ATTENTION_BY_KIND)) {
    const cls = STATUS_BADGE_CLASS[kind as UnifiedStatusKind];
    expect(cls, `${kind} has no badge class`).toBeTruthy();
    expect(/\bbg-red-/.test(cls), `${kind} red?`).toBe(attention === "author");
    expect(/\bbg-amber-/.test(cls), `${kind} amber?`).toBe(attention === "waiting");
  }
});
```

```ts
// prPipeline.test.ts:1668-1673 — every constructed row's attention matches the table
expect(row.status.attention).toBe(ATTENTION_BY_KIND[row.status.kind]);
```

The exhaustiveness half lives at `prPipeline.test.ts:1538+`
(*"ATTENTION_BY_KIND — the color/attention contract"*), which also pins the three
cases the original bug got wrong (`prPipeline.test.ts:1678-1680`):
`checks-pending` → `none`, `awaiting-ci` → `none`, `checks-failing` → `author`.

**A console surface with statuses ships its own kind→attention table and its own
agreement test.** `console/statusRow.tsx:170` (`StatusPalette<K>`) exists to make
that one object per surface rather than four loose constants, and Phase 1's
`console/attention.ts` (`paletteDisagreements`) makes the agreement assertion
itself shared — see §3.2.

### 4.3 Known gap — the palette is not tokenised

The families above are **raw Tailwind literals in one component**.
`@qontinui/design-tokens` has `success` / `warning` / `error` / `info` and **no
attention layer at all**, so the console's most important semantic decision is
invisible to the token system, to `qontinui-runner`'s operator surfaces, and to the
style gate (which can only assert `tokenRef` against a declared token).

Phase 2 of the plan fixes this at the source: an additive `attention` layer in
`qontinui-design-tokens`, then `--color-attention-*` mappings in `globals.css`'s
`@theme inline` block (Tailwind v4 is CSS-first here — there is no
`tailwind.config.*`, and a CSS custom property alone mints no `bg-attention-*`
utility). Until then `console/attention.ts` carries the literals verbatim.

---

## 5. Density budget

The console is a monitoring surface. Its job is to put as much true signal in front
of one pair of eyes as the eyes can take, and every pixel spent on chrome is a
record the operator has to scroll for.

Three numbers. They are budgets, not aspirations — a PR that misses one is a PR
that needs a reason in its body.

| Budget | Value | Why |
|---|---|---|
| **Record row height** | **≤ 40px** | The Pipeline row is ~34px at `px-3 py-2` + `text-sm`. 40px is the ceiling including a left accent. A Family-B `<Card>` record at `p-4` with three stacked lines is ~96px — **2.8×**. |
| **Page chrome** | **≤ 1 line** | The shell already renders the title and nav (`layout.tsx:44-57`). A per-page `<CardHeader><CardTitle>` is ~72px of duplicated title above the fold (R9). |
| **Records visible at 1080p** | **≥ 15** | The countable version of the other two. Family B today fits ~7; the Pipeline tab fits ~20. |

Measure "records visible at 1080p" the boring way: a 1920×1080 viewport, the route
loaded with real data, count the record rows fully visible without scrolling.
Record it **before → after** in the PR body for every migrated route — it is the
operator's stated goal and it is countable.

Two things the density push is most likely to break, so they are required evidence
rather than optional checks: **clipping** and **contrast**. Run `/visual-audit` on
one migrated route per wave and show `no_overlap`, `text_fits_container`,
`no_clipping` and `contrast_meets_wcag` passing.

Density is not achieved by shrinking type. `text-sm` for the label, `text-xs` for
the reason and time, `text-[11px]` for badges, `text-[10px]` **only** for the raw-id
line in an expanded detail. Below that you have not made the page denser, you have
made it unreadable and moved the cost onto the reader.

---

## 6. Where each layer is enforced

"Style" here is four different kinds of thing with four different enforcement
mechanisms. Putting them all in one file would make three of them unenforceable —
so each has one home, and this table says plainly which ones actually gate a PR.

| Layer | Artefact | Enforced by | Gates a PR? |
|---|---|---|---|
| **Prose + rationale** — the pattern, when it applies, the anti-patterns | **this file** (`frontend/docs/console-ui-style-guide.md`) | Human review; cited from every console component's module doc | **No** — review only |
| **Executable** — the primitives every console page composes from | `frontend/src/components/console/` (+ `index.ts` barrel), built on `console/statusRow.tsx` | The type system + unit tests. **This is the real style guide**: a page either uses `<RecordRow>` or it doesn't | **Yes** — `tsc` + `vitest` |
| **Declarative atoms** — density and palette as CSS-property rules | `frontend/src/config/qontinui-web.styleguide.uibridge.json` (`rules[]`) | **Nothing. There is no evaluator for this file anywhere in the fleet.** | **No** |
| **CI-enforced atoms** — what actually bites | `frontend/tests/e2e/style-gate/specs/<id>.json` + `baselines/<id>.json`, per route in `routes.json` | The `Style Gate (shadow)` workflow (`.github/workflows/style-gate.yml`), running `vision-audit` pinned by `style-gate.lock` | **Yes, but indirectly** — the workflow is *not* a required check; coord's `ci-not-green` predicate is what holds the PR. See §6.2 |

### 6.1 The declarative layer has no evaluator — say so, do not imply otherwise

`qontinui-web.styleguide.uibridge.json` is a real, schema-valid record (6 tokens,
15 CSS-property rules conforming to the UI Bridge `StyleGuideConfig` type). It is
also read by **nothing**:

- `.github/workflows/style-gate.yml` runs `vision-audit analyze --analyzer all`
  (`:568`) and `vision-audit assert --assertions <spec>` (`:596`). It never reads
  the styleguide JSON.
- `vision-audit` has **no style-guide input at all** — zero matches for
  `styleguide|style_guide|StyleGuide` across `qontinui-schemas`.
- Nothing under `qontinui-web/` references the file: zero matches for
  `styleguide.uibridge` or `STYLE_GUIDE_FILE_EXTENSION` outside `node_modules`.

The file is discovered only by the UI Bridge SDK's **filename convention**
(`STYLE_GUIDE_FILE_EXTENSION` in `ui-bridge/packages/ui-bridge/src/specs/style-types.ts`),
by a consumer that does not run in this repo's CI. There is no import, so a rename
or a move would break it silently with no compile error.

Rules added there are **the declarative written-down contract and a human review
aid. They do not gate a PR. Do not present them as enforcement.** Teaching
`vision-audit` to evaluate a `StyleGuideConfig` is a real follow-up in
`qontinui-schemas` — it is not done, and this guide does not assume it.

### 6.2 What the CI layer actually does, and its one trap

The style gate is currently **shadow / report-only** (Stage A). In shadow it does
not block on gate findings or on a capture being unavailable. It **does** block on
`INFRA-ERROR`, in both modes:

> `INFRA-ERROR`: analyzer exit 1 on a PRESENT snapshot/frame, **or a missing spec**
> (a broken/unrunnable gate; fails in BOTH modes).
> — `style-gate.yml:621` (legend), `:627` (outcome)

**How a red gate actually holds a PR — not by branch protection.** The workflow's
own header says it plainly: *"It is NOT in the required-checks set, so it can never
block a merge"* (`style-gate.yml:32-34`). A reader who stops there concludes the
gate is decorative. It is not, because merges here go through coord's merge train,
not through a human clicking Merge: a non-required red check leaves the PR at
`mergeStateStatus: UNSTABLE`, and coord's **`ci-not-green` predicate** holds it
there. GitHub would accept a manual merge; coord will not propose one. So the gate
binds through the merge train, and promoting it to a required GitHub check is a
separate, deliberate decision this guide does not make. (Mechanism and a worked
example:
`qontinui-claude-config/knowledge-base/qontinui-specific/coord-merge-train.md:256-265`.)

**The trap:** `routes.json` is a deliberate three-route seed set whose own
`$comment` says it expands *"after burn-in once the capture+baseline loop is proven
stable in CI"*. Adding a route to it **without committing `specs/<id>.json` in the
same PR yields INFRA-ERROR, which fails the job even in shadow mode.** "The gate is
shadow, so this is safe" is false. The capture also runs `workers=1`, serially,
with a 60s per-test budget — so a 3 → 33 route change is a ~10× runtime change on a
suite with a documented cold-start flake, not an append.

Encode density and palette as the assertions the gate actually evaluates:
`ColorWithin` for the attention palette, `NoLayoutShiftSince` against a committed
baseline for density, plus `no_clipping` and `contrast_meets_wcag` — the two the
density push is most likely to break.

### 6.3 Testids: authored ones are frozen, derived specs are re-derived

Two different contracts, and only one of them can be frozen.

**Authored `data-testid`s are FROZEN.** Carry every one across onto the equivalent
new element. Three Playwright suites assert them behaviourally — `admin.spec.ts`,
`admin-coord-questions.spec.ts`, `admin-coord-spawn.spec.ts` — and they must stay
green **unmodified**. A red one means a testid was dropped, not that the spec is
stale.

**Derived Spec-CI page specs are NOT freezable.** The committed
`state-machine.derived.json` specs under `frontend/specs/pages/` assert
**derivation-generated positional ids** (`<container>-elem-<n>`) that appear nowhere
in `src/` — the deriver mints them from child ordinal position inside a container.
Collapsing three stacked lines into one row plus an expandable panel changes that
child count and order **by construction**. So every PR touching such a route
**re-derives that route's spec from a fresh authed UI-Bridge snapshot in the same
PR**, and cites the snapshot run in its body. That is the expected path, not an
exception.

The rule that survives unchanged is the important one: **a derived spec is never
hand-edited to match new markup.** A spec edited by hand is a spec that no longer
proves anything.

### 6.4 The rule that makes all of this hold

> **A new console page adds no new visual vocabulary.** It composes the primitives
> in [§3](#3-the-primitive-catalogue) — or it extends this guide, in the same PR
> that introduces the new pattern.

There is no third option. "I'll write it down afterwards" is how the console got
three incompatible families in the first place: one route with the right style, 18
fat-card lists, and six tables with no per-record detail at all. Each of those was
a reasonable local decision made without a written contract to compose against.

If a page genuinely needs something this guide does not cover, that is a real
finding and the guide is wrong — extend it, add the primitive, and cite the rule
number from the new component's module doc. What is not allowed is shipping the new
shape silently and leaving the next author to guess which of the two is the pattern.

---

## Related documents

- `frontend/docs/architecture-sidebar-navigation.md` — console navigation structure
- `frontend/docs/STATE_MANAGEMENT.md` — where server state lives (React Query is the
  single source of truth; a health strip derives from it, never re-fetches)
- `frontend/src/styles/components.css` — the CSS classes used in JSX
- `frontend/src/config/theme.ts` — programmatic values (`colors.*`, `spacing.*`)
- `qontinui-claude-config/knowledge-base/qontinui-specific/shared-frontend-packages.md`
  — the four-layer frontend package split
