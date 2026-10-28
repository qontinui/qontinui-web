# Console UI Style Guide

**Version:** 0.2.5 (Phase 1 — §3 filled in from the shipped primitives; §3.3
records the patterns the first post-guide page had to add; §3.4 records the
alerts page's retirement and the Dev Ops Conditions panel; §3.5 records the computers console; §3.6 the CI dashboard; §3.7 adds the
share primitives; §6.5 adds the presentation lens)
**Last Updated:** 2026-10-24
**Plan:** `2026-08-16-coord-console-ui-unification-pipeline-style.md`; §3.3 from
`2026-08-20-fleet-served-agent-skills.md` Phase 3; §3.4 from
`2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work` Phase 8;
§3.7 from `2026-08-27-operator-touch-read-and-surface` Phase C3; §6.5 from
`2026-10-23-console-presentation-spaces` Phase 1

The style of `/admin/coord/pipeline` — the merge Pipeline tab — written down, so
the other 29 console routes can be moved onto it and the next operator surface can
be built on it instead of inventing a third shape.

> **Route note.** That tab lived at `/admin/coord/fleet` when this guide was
> written, and every `fleet/page.tsx` citation below was verified there. Plan
> `2026-08-25-coord-console-intent-and-devops-sections` Phase 4 renamed it to
> `/admin/coord/pipeline` (308 from the old path in `next.config.mjs`) and moved
> the machine/CI/resource half onto `/admin/coord/devops`, so "fleet" now means
> Dev Ops and only Dev Ops. Line citations into that file are therefore against
> the PRE-rename page unless they say otherwise; where the example itself was
> changed by that phase, the text below says so rather than pointing at markup
> that no longer exists.

Citations below were verified against `origin/main` at
`859d8286fe611408b929c89b5e95ebf5a39e9c50`, **except in [§3](#3-the-primitive-catalogue)
and [R6](#r6--filter-tabs-carry-live-counts), which describe `origin/main` at
`51168755` + the `FilterChips` commit.** Line numbers move; the symbol names do not. When a
citation drifts, fix the citation — do not fix the rule to match whatever the
code drifted into.

> **The §3 exception is discharged (2026-08-24).** This header used to declare
> that [§3](#3-the-primitive-catalogue) described `src/components/console/`,
> which was "NOT on `main` yet" because the Phase 1 PR was stacked on the
> then-open qontinui-web#986 — and it said the note comes out when both land.
> **Both landed**: #986 as `8c9e864c` (the row atoms out of
> `MergePipeline.tsx`), Phase 1 as `51168755` + `49aa6c7b`. §3 now describes
> shipped, imported code.
>
> ⚠️ **Those landings also moved the code §2 cites**, twice — first the
> ~214-line extraction into `statusRow.tsx`, then Phase 1's refactor of
> `MergePipeline.tsx` onto the primitives. R6 is re-anchored; R1–R5 and R7–R9
> are known-stale. Which, and why they are flagged rather than fixed here:
> [§2](#2-the-nine-rules), the "Where this code lives after Phase 1" note.

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

**In scope today:** every route under `src/app/(app)/admin/coord/` — **33
top-level routes plus 5 dynamic detail routes** (`[agent_id]`, `[slug]`, `[id]`,
`[name]`, `[version]`), i.e. 38 `page.tsx` files (re-counted on disk 2026-08-25,
when `agent-commands` and `agent-skills` joined the migration census; the count
this replaced said 30/35 and was already one short of `agent-registry`, so
re-count rather than trusting this number either). "33 routes" below always means
the top-level set.

**In scope next, by construction:** `/admin/agent-claims`, `/sessions`,
and any operator surface added after them. (`/admin/agent-sessions` was named
here until `2026-08-26-sessions-console-consolidation` Phase 3 folded it, and
`/environments/sessions`, into `/sessions` behind 308s — the scope claim moved
with the surface, it did not shrink.) The guide is named
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
> | R6 | `console/FilterTabs.tsx`; `console/FilterChips.tsx` when the filter is multi-select |
> | R7 | `console/CollapsiblePanel.tsx` |
> | (support) | `console/time.ts` — `relativeTime` / `absoluteTime` |
> | R8, R9 | no primitive — they are rules about what a PAGE does, not a component |
>
> **The move landed** (`51168755`, `49aa6c7b`), so the sentence this paragraph
> used to carry — "both the move and this note are unlanded" — is no longer
> true, and the re-pointing it promised is now due. **R6's ✅/❌ pair has been
> re-anchored** (below), because a later commit extended R6 and its ❌ had come
> to point at code that no longer violates it. **R1–R5 and R7–R9 have not**:
> their line numbers still describe `859d8286`, which Phase 1 moved, and the
> mechanism each one demonstrates now lives in the primitive named in the table
> above rather than at the cited `MergePipeline.tsx` line at all. Re-pointing
> those is a rewrite of each ✅ block, not a line-number bump, and it belongs
> with the migration wave that moved them — it is called out here rather than
> left silent, because a reader who follows a citation into unrelated code
> learns to distrust every citation in the file.

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

❌ `PlanCard.tsx:44-48` — a `<Card>` per record, with `p-4` padding and three
stacked lines inside. ~96px per record against the Pipeline row's ~34px.

> **This file was DELETED in Phase 3 Wave 2**, once `/history` — its last
> renderer — moved onto `<PlanRow>`. The quote below is kept verbatim because
> it is the clearest small example of the shape this rule forbids; read it at
> `git show 3e69607c:frontend/src/components/admin/coord/PlanCard.tsx`. A live
> equivalent is still on `main` in whichever Family-B routes Waves 3-5 have not
> reached yet — re-run the census rather than trusting a name written here.

```tsx
// PlanCard.tsx:44-52 (deleted in Wave 2; read at 3e69607c)
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

#### Amber's contract is **self-clearing**, and that is the whole test

The families are not a severity ladder with three rungs. Read them as answers to
one question — *whose move is it?*

| family | whose move | the promise it makes |
|---|---|---|
| **red** | the operator's, **now** | nothing else will resolve this |
| **amber** | something else's — *or* nobody's, because we do not know | **it will clear itself**; you are watching, not acting |
| **calm** | nobody's **right now** | **nothing is waiting on you**; any ask is stated **in words**, not in the hue |

Read the calm row precisely: it is *not* "there is nothing to do". A calm row
may still owe somebody a decision — see [the third case](#the-third-case-a-real-decision-that-is-not-blocking-anyone)
below. What calm promises is only that nothing is blocked and nothing decays
while it waits, so the ask belongs in the detail where it can be *read*.

So before painting a row amber, name the thing that clears it. If you cannot,
**and you do know what the row's state is**, it is not amber. This has already
been got wrong once, and it was caught in review rather than by the palette
test — because that test only checks the hue matches the *declared* attention,
never that the declared attention is right:

- **Idle uncommitted work** (`treeStatus.ts`, the 24-72h stale-WIP band) was
  `waiting`. Nothing times out and no process commits your WIP for you — only a
  human does. It is **red**, which is also what `alertStatus.ts` had already
  concluded for the same condition (that module was deleted with the alerts
  page — [§3.4](#34-the-alerts-page-retired-and-the-dev-ops-conditions-panel--recorded-under-64)),
  and where the failure mode is lost work the tie breaks toward the louder
  signal.

#### The one exception: amber also covers **we do not know**

The clause above has a deliberate exception, and it is shipped in two places,
so do not "fix" it:

| site | value |
|---|---|
| `console/attention.ts` — `attentionOf(map, kind, floor = "waiting")` | an unrecognised kind floors at **amber**, never calm |
| `planStatus.ts` — `unknown: "waiting"`, painted `bg-amber-500/10` | a work-unit status this build has no label for |

(A third, `alertStatus.ts`'s `unknown: "waiting"` for an alert kind this build
had never seen, was deleted with the alerts page — §3.4. The Conditions panel
that replaced it keeps the same discipline without a kind table: every unknown
state it can reach is amber, never green.)

Nothing clears an unrecognised status except a human extending the vocabulary,
so read literally the name-the-clearer rule would condemn both. It does
not, because **an amber painted on ignorance is a statement about our
knowledge, not a promise about the row.** It says *we cannot tell you whose
move this is* — and the alternative, painting it calm, is the
`silent-empty-is-unknown` mistake with a badge attached: exactly the same
discipline that makes an unfetched count render `–` and never `0` (R6). Calm on
an unknown row asserts "nothing is wrong here", which is precisely what we do
not know.

The test is therefore two-part, and both halves must hold before amber is
wrong: **you cannot name what clears the row, *and* you actually know what the
row's state is.** `attention.ts` states the floor and its reasoning; a new
surface inherits it by passing its kind map through `attentionOf` rather than
indexing the map directly.

The second mis-fit is subtler, and the families genuinely do not cover it.

#### The third case: a real decision that is not blocking anyone

There is a state the three families do not obviously fit, and the instinct is to
reach for amber. **Do not.** It looks like this: something genuinely wants a
human decision, but nothing is stopped and nothing degrades while it waits.

The worked example is a **pre-answered policy gap** (`questionStatus.ts`,
`gap-handled`): coord applied the category default inline, so no agent is
blocked and no work is at risk — but accepting or dismissing the proposed clause
is still a real call somebody has to make. It is not red, because no one must
act *now* and nothing is lost if they do not. It is not amber, because nothing
clears it.

**Rule: it is CALM, and the ask goes in the row detail, in words.** That is
what the calm row of the table above means by "nobody's move *right now*" — the
move is genuinely the operator's, it is simply not owed today. The hue answers
"must a human act now?" and the honest answer is no; the detail answers "is
anything owed?" and says so explicitly — see `<GapRow>`'s
`coord-gap-review-owed` line. Putting the ask in the hue would spend amber's
credibility on something that is not waiting on anything, and amber only works
for as long as it means what it says.

This case is written down here rather than solved once in `questionStatus.ts`
because R3 governs 30+ routes: a vocabulary hole patched in one file gets
rediscovered — and refiled under amber — by the next surface that meets it.

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

❌ `PlanCard.tsx:44` (deleted in Wave 2; read at `3e69607c`) — the card's only
state affordance was `hover:bg-muted/50`, i.e. a hover tint on the whole surface
and no resting attention signal whatsoever. There was no accent to be quiet
about, because there was no attention model to drive one.

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

**❌ (a) — navigate away instead of expanding.** `PlanCard.tsx:50-53` wrapped the
record in a `<Link>` to a detail route. Clicking cost a navigation, a fetch, and
your filter and scroll position — to read four more fields. (Deleted in Wave 2;
read at `3e69607c`. `MemoryCard`, `PullDecisionCard`, `ReleaseCard`, `LandCard`
and `DeployCard` went the same way in the same wave, so this failure is now a
historical citation rather than a live one — which is the point.)

```tsx
// PlanCard.tsx:50-53 (deleted in Wave 2; read at 3e69607c)
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

> **"Not fetched" includes "fetched and FAILED", and the rule does not stop at
> the badge.** Read narrowly — as only the in-flight window — R6 leaves the
> larger hole open: a `catch` that swallows its error leaves the list at the
> `[]` its `useState` initializer put there, which is byte-identical to a
> successful empty read, and `loading` is already false by then. Every
> consumer downstream then states the absence as fact — the tab count, the
> health-strip level and headline, and the `empty=` copy, which is where the
> claim is actually made in words. `/admin/coord/questions` shipped exactly
> that: `fetchGaps` failing rendered a GREEN strip reading *"No agent is
> waiting on an answer"*. So a failed read needs its **own flag**, separate
> from the list, and every surface derived from that list has to consult it —
> `RecordList`'s `empty` slot included. `loading` cannot stand in for it.
>
> **Two arms, not one — and the failure arm goes FIRST.** A read that failed
> when coord has *never* answered is UNKNOWN: dash the counts. A read that
> failed after any successful one is STALE: those rows are real and still
> actionable, so they keep rendering and the detail line says they are old.
> Blanking them would discard a count the operator can act on. The order
> matters because a *first* load that errors leaves `loaded` false as well, so
> a `!loaded`-first deriver renders "Waiting for coord…" over a request that is
> never arriving.
>
> **Key UNKNOWN on `loaded`, never on the list being empty.** The obvious
> spelling — `readFailed && rows.length === 0` — cannot tell a list coord
> confirmed EMPTY from one that never arrived, so a single blipped poll on a
> genuinely-empty window flips the page to "unknown" and back on the next tick.
> It is also inconsistent with the stale arm: a retained count of 7 is kept and
> labelled old while a retained 0 would be thrown away, though both are equally
> fetched. The predicate is `console/readFailure.ts` `readIsUnknown`; import it
> rather than respelling it, because the strip and the `empty=` slot have to
> agree about the same read and two spellings drift invisibly.
>
> `/admin/coord/questions` — the route this rule was WRITTEN from — was the
> last holder of the older list-is-empty form, four times. It is **converted**:
> three per-list `loaded` flags, `readIsUnknown` at each of the four sites, and
> the gaps tab and gaps badge collapsed onto one predicate (they diverged only
> because each was keyed on its own rendered count, and *"did the gap read
> land?"* is one question for both).
>
> **And the conversion surfaced the arm the two-state reading hides: a STALE
> verdict is not a green verdict.** Dropping the count-keyed form moves a
> retained-and-then-failed read from UNKNOWN to STALE — correct for the
> *counts*, and a regression if the level rides along, because
> `/admin/coord/questions` would then paint the green all-clear off the last
> good read. The counts and the verdict are different claims: a count says what
> was measured, and STALE keeps it while UNKNOWN dashes it; **the dot says what
> is true NOW, and the last good read is not now.** So the two states are told
> apart everywhere except the level, where both alike disqualify green — the
> one place they must not be distinguished. A surface with a verdict needs the
> third state spelled out, and it reads as a measurement with a timestamp
> (*"Nothing was waiting at the last good read"*), never as an all-clear.
>
> **`empty=` needs the third state too — it is the easiest one to forget,
> because nothing about it looks wrong.** Adding STALE to the strip and
> stopping there leaves the list body rendering the plain empty copy, and that
> copy is present-tense and unqualified: coord answering *"none"* once and then
> going dark leaves *"No pending questions"* on screen for hours, under an
> amber strip, in calm muted type. The strip is not a substitute — `empty=` is
> where the absence claim is made **in words**, and it is the surface an
> operator scrolls to. Three arms, then, not two, and the stale one keeps the
> muted tone (nothing is wrong) while carrying the date (nothing is current).
>
> The tell that this arm is missing is a comment like *"`items` is `[]` either
> way; only the flag can tell the two apart"* sitting above a two-branch
> ternary. Once there are three states that sentence is false, and it is false
> in the direction that ships.
>
> **A 404 is an ANSWER, and belongs on the "not found" side.** `httpClient`
> throws on every non-2xx, so coord's 404 — the most definitive answer it
> gives — reaches the page through the same `catch` as a dead socket. A detail
> route that reads "there is an error" as "we could not read" therefore reports
> every mistyped slug, and every soft-deleted memory, as an outage: the
> inversion of this whole rule, and the more corrosive one, because it teaches
> an operator that the console cries wolf. Split them with
> `readFailure.ts` `isNotFoundError`.
>
> Worked examples: `agentLogHealth.tsx` and `plans/plansHealth.tsx` for the
> strips (`/agents/[agent_id]`, `/plans`, `/spawn`); `plans/[slug]`,
> `questions/[id]`, `memory/[name]` and `memory/[name]/version/[version]` for
> the 404 split. **What is pinned by test**: both derivers' arms
> (`agentLogHealth.test.tsx`, `plansHealth.test.tsx`), the predicates
> themselves (`console/readFailure.test.ts`), and the 404-vs-unreadable split
> end to end on `plans/[slug]` (`page.readFailure.test.tsx`). The other three
> detail routes carry the same wiring with no route-level test of their own —
> stated rather than implied, because "their tests pin every arm" is exactly
> the kind of unenforced claim this section exists to stop.
>
> **A route taken at "R9 only" is not thereby exempt from R6, and reading it
> that way has now cost three fixes.** `/admin/coord/prompt-injections` was
> classed R9-only by the §4 census correction because its table already
> satisfied D2/R5 and it has no severity to encode — both true, and both about
> LAYOUT. It shipped all three arms above anyway: a failed first read printing
> *"No prompt injections matching the current filters"* under its own *"Failed
> to load"* line, a count badge reading `0`, and a failed refetch presenting
> stale rows as current. `/plan-library`, migrated by the SAME PR (#1036),
> produced the right OUTPUT for both arms it can have — so the wave had the
> correct wording in front of it and applied it only where the migration
> happened to be large. The rule:
> **R6's failed-read arms are keyed on whether a surface READS, not on how much
> of the style guide its migration touched.** Fixed with a route-level test
> (`PromptInjectionsDashboard.test.tsx`) in the post-merge follow-up to #1036.
>
> **`/plan-library` is the right output and NOT yet the right derivation** —
> recorded so it is not cited as an exemplar wholesale. It has no count badge
> at all (its only `Badge` is the per-row status one), so the `–`-not-`0`
> clause does not arise there; and its unknown predicate is
> `items.length === 0 && !error`, the list-is-empty spelling this section
> forbids four paragraphs above. Same standing as `/admin/coord/questions`:
> correct today, not yet converted to `readIsUnknown`, and not an exemption.
>
> **A filter set is a list route's param, and the reset rule above applies to
> it.** That clause is written for a detail route's id; the list analogue is
> the filter set, and getting it wrong re-opens arm 1 on every filter change
> rather than only on first load. `/prompt-injections`' first cut carried a
> global `loaded` boolean, so a read that failed under NEW filters kept
> `unknown` false, took the stale arm, and rendered the PREVIOUS filters' rows
> beneath filter chrome that said otherwise — an answer to a different question
> presented as a stale answer to this one, which is worse than the defect being
> fixed, because the unfixed banner at least claimed nothing about the rows'
> provenance. Stamp the stored answer with the filter set that produced it and
> DERIVE the rows from whether that stamp still matches: a boolean cannot
> express the difference, and clearing rows in an effect only narrows the
> window. A list read also needs a **sequence guard** — an undebounced filter
> input issues overlapping reads, and a superseded rejection landing after a
> newer success paints "stale" over rows that are current, the same lie
> inverted.
>
> **The 404 split branches on evidence, not on a fixed predicate.**
> `isNotFoundError` recovers a status by parsing `httpClient.get`'s message
> string, which is the only place it survives for THAT client. A surface whose
> client already carries the status as a field — `prompt-injections-api.ts`
> raises a `PromptInjectionsApiError` with `.status` — must branch on the
> field. Reaching for the primitive there produces a split that silently never
> matches and sends every genuine absence down the outage arm, which is the
> inversion this clause exists to prevent. Import the predicate when the
> message is all you have; prefer the structured status when you have it.
>
> **Retaining a record across a param change defeats all of this.** Both arms
> live behind `record === null`, so a route that keeps the previous record when
> the next id 404s renders the OLD record under the NEW heading and reaches
> neither arm. Reset the record where the route param changes — not in the
> `catch`, which would blank a loaded page on a transient blip.

> **And "fetched and failed" is still not the last case: a read can SUCCEED and
> not carry the number.** `loaded` true, no error, count still `null` — a state
> the two clauses above both step over, because both are about a read that did
> not produce an answer, and this is a read that produced a *partial* one.
> Reached whenever a page guards its envelope (`if (typeof body.x ===
> "number")`, the correct way to treat an absent scalar as UNKNOWN) while
> flipping `loaded` on the response as a whole — a coord build that predates the
> field, or a partial degrade, lands there. `/admin/coord/notifications` shipped
> exactly that: `deriveNotificationsHealth` wrote `unreadCount ?? 0` and painted
> a GREEN strip headlined *"Nothing unread"* with the detail *"you have seen
> everything coord recorded"*, one element away from its own badge correctly
> reading `–`.
>
> The rule that covers all three: **`?? 0` on a value whose `null` means UNKNOWN
> is the bug, wherever it appears** — and a strip's `level`, `headline` and
> `detail` are consumers of that value exactly as much as the badge is. A badge
> that says `–` beside a headline that says "nothing" has not applied R6; it has
> applied it to the one element where the dash was easy. Derive every part of a
> strip from the same `null`, and scalars are **independent** — a missing
> `unread_count` does not make a `total` you were sent unknown.
>
> **And the strip is not the page.** One read feeds several surfaces — the
> strip, the `<RecordList empty=>` node, any "we looked for X" banner — and each
> is capable of the claim independently, so fixing the loudest one is not
> fixing the page. `/admin/coord/notifications` shipped exactly that twice: the
> post-merge audit of Wave 5 corrected the strip, and left the `empty=` slot
> still saying *"No notifications matching filters."* under a strip that said
> *"Could not read the feed"* — the same fabricated absence, made in **words**
> instead of a number — and a `?ref=` banner reading the page's shared `error`
> line, which mark-read also writes, so a rejected POST blamed a feed that had
> loaded fine.
>
> Three rules follow.
>
> **Import the predicate, do not re-spell it** (`console/readFailure.ts`
> `readIsUnknown`): two hand-rolled `failed && !loaded`s drift, and the drift is
> invisible because both spellings look right.
>
> **Give each surface the flag that answers ITS question.** "Has anything ever
> arrived" (`loaded`), "did the last read fail" (`readFailed`), "did paging
> fail" and "is anything wrong on this page at all" (`error`, which mutations
> write to as well) are four different questions, and a surface wired to the
> wrong one is confidently wrong rather than silent. **Count the consumers
> before declaring the sweep done** — on `/admin/coord/notifications` there
> were four, and the fourth was a tooltip spending a stale count in front of an
> irreversible mark-all.
>
> **Check the GRAIN of the flag, not just its truth.** A page-lifetime `loaded`
> is the right input for a strip whose scalars are filter-independent and the
> wrong one for a query-scoped list: a success under filter A otherwise
> licenses an empty-state claim about filter B, which no read has ever
> answered. `readIsUnknown`'s premise is that coord *confirmed this window
> empty* — so the confirmation has to be about the window being described.
>
> **A fourth rule, from auditing the sweep that produced the first three.** It
> re-spelled the predicate twice while fixing the consumers, in both directions
> the first three rules warn about — which is the evidence that "count the
> consumers" is not enough on its own.
>
> **Publish the verdict from the surface that owns it; do not let consumers
> re-derive it.** Importing a shared predicate still leaves each caller
> assembling its own ARGUMENTS, and that is where the next drift lives. On
> `/admin/coord/notifications` the strip is the surface that decides whether
> coord's scalars may be quoted — it is what dashes the badges — and the
> mark-all tooltip re-derived that as `!readFailed`: three of the four ways a
> count stops being quotable, missing `migrationPending`, so it promised
> *"Marks ALL 137 unread… cannot be undone"* under a strip rendering that same
> 137 as `–`. The fix is not a fifth spelling but a field on the derived object
> (`health.readIsCurrent`), with the deriver *branching* on it so its arms
> cannot drift from what it publishes. **A deriver that already knows something
> should return it.**
>
> **Name that field for the READ, not for what was counted** — it was
> `countsAreCurrent` first, and the rename is part of the rule rather than a
> tidy-up. The two questions are independent: a read can be perfectly current
> and still carry a `null` scalar — the FIRST read to answer without one is
> current, and `deriveNotificationsHealth` has an arm headlined *"The unread
> count did not come back"* that returns `readIsCurrent: true` for it. Note
> what that does NOT license: a read that used to carry the scalar and has
> STOPPED is a fact about the read, and is uncurrent. Raising the same flag for
> both makes the first arm unreachable and puts *"no longer"* in front of an
> operator who never had a good read. A field named for the counts invites
> `health.countsAreCurrent ? unreadCount! : …` at every consumer, and the type
> will not stop it — so the published verdict answers one question, and a
> consumer that wants a number asks BOTH: this flag, then the scalar itself.
>
> The same audit found the mirror-image error: a flag deliberately SPLIT for one
> surface's sake (`pagingFailed`, kept out of `readFailed` so a failed page
> would not stale the strip) and then folded straight back into one boolean at
> another (`error: readFailed || pagingFailed`). A failed *Load more* duly
> reported *"the feed above failed to load"* about a feed the strip was painting
> green, and withheld the only remedy that applied. **If two states were worth
> splitting, they are worth two sentences** — and rank them, because when both
> are true one is the bigger truth.
>
> Note what let this survive review, because it is NOT a loose assertion. The
> sweep wrote a test for exactly this state — *"does not send the operator to a
> Load more that just failed"* — and asserted `/could not be looked up/`, which
> at the time matched the head-failure arm and only that arm. The regex
> discriminated perfectly. **The test pinned the behaviour the code intended,
> and the intent was the bug**: folding the two failures into one boolean was a
> deliberate choice with a comment arguing for it, so no assertion about the
> sentence that choice produces could ever have caught it.
>
> **And "count the consumers" means every surface that READS the scalar, not
> every surface inside the route.** The same sweep counted four consumers of
> `unread_count` on `/admin/coord/notifications` and fixed all four; the fifth
> is `CoordNav`'s tab badge, which polls the same route at 60s, renders on
> EVERY console page, and is named in the page's own module doc ("the nav badge
> polls at 60s — it is a background hint"). It retained its count across a
> failed poll — correct, and half the rule — while rendering it unqualified,
> so the widest-reach number in the console was the one with no way to say it
> had stopped moving, and its `title` was `undefined` where the sibling alerts
> badge had carried one all along. Both nav badges then published `stale` and
> the shared renderer marked it — a visible `*`, the qualification appended to
> `title`, and the same words in `sr-only` text. (The alerts badge has since
> been deleted with the alerts page, §3.4; the notifications badge keeps all
> three channels.)
> **A route boundary is not a consumer boundary** — the poll is.
>
> **A FILE boundary is not one either — and that is where the sweep stopped
> next.** Having established that the poll is the unit, the fix swept the two
> badges its own hook file owned and shipped. `CoordNav` mounts a THIRD poller:
> `useFleetAlarmBadge`, five fleet counts on the `Dev Ops ▾` trigger, rendered
> on every console page from a sibling module. It retained its counts across a
> failed poll — with a docstring arguing the retain half, exactly as the
> notifications badge had — and rendered them in none of the four channels the
> two badges beside it had just been given. The sweep unit is *every value the
> component tree keeps across a failed read*, and each pass so far has drawn a
> boundary one level out from the last: route → poll → module.
>
> **Where silence IS the all-clear, the retained zero matters more, not less.**
> The `count > 0` gate above is a bug on a tab badge because a last-good `0`
> goes dark. On the fleet trigger, *rendering nothing* is the deliberate design
> — an all-clear fleet should look like an all-clear — so the same gate makes a
> retained, unverifiable all-clear indistinguishable from a fresh one, in a
> surface whose `unknown` count exists to stop precisely that class of
> false-safe. A cluster of counts cannot answer this with five `0*` pills
> without spending an alarm's worth of visual weight on the absence of alarms;
> one muted marker for the whole retained all-clear is the form that keeps a
> trigger scannable and still refuses to claim the all-clear is current.
>
> **And ask the delivery question of the ENVELOPE, not just of the transport.**
> `stale` means *the latest read did not replace this value*, so a 2xx whose
> body carried no list is a non-delivery exactly as a rejection is. Where the
> derived count collapses to zero without that list — and where zero renders as
> silence — reading the absence as data converts a degraded backend into a
> confident all-clear. Distinguish an ABSENT list from an EMPTY one: `[]` is a
> real answer and must replace what is on screen, which is why the predicate
> tests `Array.isArray`, never truthiness.
>
> **When a second module needs the bookkeeping, MOVE it — do not re-spell it.**
> `useRetainedValue` was private to `CoordNav`; the fleet hook is imported BY
> `CoordNav`, so leaving it there offered only an import cycle or a second
> spelling. It lives in `components/console` beside `readSequence`, which is
> the same argument that module makes one layer down.
>
> Three things that pass for done and are not, all found reviewing the fix
> above rather than the code it fixed:
>
> - **Do not signal a stale number by DIMMING it.** The first cut used
>   `opacity-60`, which makes the state you most need to read the hardest one
>   to read — 10px bold text at 60% — and is a lone non-text visual difference
>   besides. A visible glyph survives at any contrast and composes with the
>   `≥` this same badge already uses (`≥2*`).
> - **A `title` is not an accessible name.** The badge is a non-focusable
>   `<span>` with text content inside a link, so the link's name is computed
>   from that content and the tooltip is never reached; there is no hover for a
>   keyboard user either. Without an `sr-only` copy of the qualification, the
>   whole fix is a sighted-mouse-user feature and everyone else is left with the
>   unqualified claim. Test the accessible TEXT, not the attribute.
> - **`count > 0` as a render gate makes the qualification unreachable for a
>   retained ZERO** — the asymmetry this section names in its own words above
>   (*"a retained count of 7 is kept and labelled old while a retained 0 would
>   be thrown away"*). A last-good `0` then goes dark and renders nothing at
>   all, on every console page, which states the absence in the loudest medium
>   there is. Gate the exception on *"a read has delivered a count"*, not on the
>   flag alone: a zero that was NEVER read has no retained fact to qualify and
>   must stay silent. Watch what the new gate ADMITS, too: it let a retained
>   `critical` accent render in a red pill around a `0`, because until then a
>   zero could not render and the contradiction was unreachable.
>
> **Two independent reads want two independent verdicts.** Splitting them so one
>   failure cannot stale the other is only the first half; reporting the
>   currency of only ONE of them leaves the other making an unqualified claim,
>   which is the same defect one axis over. `useAlertsBadge` (deleted with the
>   alerts page, §3.4) read a count and a severity flag; a severity read that
>   failed — or has never landed — is not evidence that nothing is critical,
>   and rendering it as a calm badge is an established negative built out of an
>   unknown. Each axis carries its own `hasRead` / `stale` —
>   `useFleetAlarmBadge`'s health and samples axes are the live instance.
>
> **And derive staleness from SEQUENCES, not from a boolean set in a `catch`.**
>   On any poller whose replies can overtake each other, a flag set on failure
>   and cleared on success is wrong in both directions: a superseded rejection
>   re-stales a number that was just refreshed, and the obvious guard for THAT
>   (ignore anything but the newest request issued) discards a superseded but
>   SUCCESSFUL read, rendering nothing where a real number arrived. Track the
>   newest read that *finished* and the newest that *delivered a value*; stale
>   is `delivered < completed`. Note this is NOT the page-level generation
>   guard it looks like: there, a superseded reply answers a DIFFERENT question
>   (the previous filter) and must be discarded; here both reads ask the same
>   question, so discarding the older *answer* is pure information loss.
>
> And name the flag for what it CARRIES. *"The most recent poll failed"* was
> false in two states this same file produces — a 2xx carrying no scalar (the
> read landed and refreshed nothing) and, under `Promise.all`, a poll whose
> second read failed beside a first that succeeded. **`stale` means the most
> recent read did not REPLACE this number**, which is one fact the code
> actually holds, and it is symmetric: the scalar-less answer must SET the flag,
> not merely decline to clear it.
>
> The rule that would have: **when you split a flag, test that the two states
> produce two DIFFERENT outputs** — assert the discrimination itself, not each
> arm against the text it currently emits. A test per state passes happily while
> two states share one sentence; a test that the sentences differ does not. The
> same test's own body asserted the strip stays green one line below, so both
> halves of the contradiction were on screen in one assertion block, agreeing
> with the code and with each other about a page that was lying.

> **The slot is not always spelled `empty=`.** #1110 swept for that prop and
> so missed `/admin/coord/questions/[id]`, one directory down in the same
> feature, where the same slot is the trailing arm of a `question === null`
> ternary. It read *"Question {id} not found."* — the inbox's green all-clear
> in the singular, and a stronger claim: it tells the operator the record is
> GONE. `null` there covered two unrelated facts, "coord answered and holds no
> such row" and "coord did not answer", and only the second is unknown. So the
> thing to grep for is the **claim**, not the prop: any copy that says *none*,
> *no such*, *not found*, *empty* or *all clear* is a surface that has to
> consult the failure flag, whatever primitive renders it.
>
> **A surface that splits the failure into kinds must read the status FIELD,
> never the message.** Several do, because "coord answered 404" and "nothing
> answered" want different copy, and `httpClient` throws a plain `Error` — so
> the status is only available as text: `<METHOD> <url> failed: <status> -
> <body>`. That `<body>` is `await response.text()`, raw upstream prose the
> operations proxy fills with coord's own `resp.text`, and it can quote a whole
> inner failure. Every unanchored probe therefore reads a status the request
> never got. Four had grown independently — `/ failed: (404|405|501) /`,
> `/404/`, `/failed:\s*503\b/`, `/failed:\s*4(?:00|22)\b/` — and the loosest
> also matched the **URL**, so `DeployRow` read the digits `404` out of a hex
> deploy id and told the operator that row had no rollback proposal for as long
> as the id existed. `components/admin/coord/httpStatus.ts` is the one reader:
> anchored to the verb, first field, body out of the decision. It returns the
> **status only** — what the status MEANS stays a named predicate at the call
> site, because the surfaces legitimately disagree (`/questions/[id]` reads 404
> as "coord holds no such row"; `useSessionCompliance` reads it as "this build
> does not deploy the route"). `null` means "no status", and it must never fall
> into the calm arm.
>
> The direction of the failure is what makes this R6's business rather than a
> parsing nicety. `useSessionCompliance` writes `error: isRouteUnavailable(err)
> ? null : message(err)`: a misread does not mislabel the error, it **deletes**
> it, and the page renders the quiet "coord doesn't serve this yet" over a 500.
> That is the same false all-clear as the green strip, reached through the
> status probe instead of through the empty slot.

✅ `src/components/operations/MergePipeline.tsx:892-909` (re-anchored to
`51168755`; the rest of §2 is still `859d8286`) — the tab strip, now
composed from `<FilterTabs>` rather than hand-rolled. The **rule itself moved
into the primitive** (`console/FilterTabs.tsx:67-69`), so a caller expresses
"unknown" by passing `null` and cannot forget the dash:

```tsx
// MergePipeline.tsx:893-901 — `null` for the count nobody fetched
tabs={FILTERS.map((f) => ({
  id: f.id,
  label: f.label,
  count:
    f.id === "merged" && mergedPrs === null ? mergedCount : counts[f.id],
  attention: f.id === "attention" && counts[f.id] > 0,
}))}
```

The comment at `MergePipeline.tsx:876-891` is the rule stated in situ — *"until
then `counts.merged` would be 0 for want of looking, not because nothing
landed"* — and it also records the honest case where the two numbers legitimately
differ.

**Multi-select is the same strip.** Where more than one value can be on at once,
the primitive is `<FilterChips>` (§3.2) and the load-bearing clause is a
different one: **an empty selection is the unfiltered state, and it is not an
option.** A console filter's values are usually a server vocabulary — coord's
`severity`, its served `kind` list — so minting an `"any"` member invents a value
the API has never heard of, which every caller then has to remember to strip
before it reaches a query string. The `all` chip is a CLEAR action instead —
pressed while nothing is selected, and inert while it is, so it cannot fire a
refetch that changes no filter. This is not hypothetical bookkeeping:
`/operations/alerts` drops blank query values because an explicitly-empty
`?kind=` asks coord for the rows whose kind is the empty string — "no filter"
inverted into "match nothing".

❌ `src/app/(app)/admin/coord/memory/page.tsx:153-187` — the chip SHAPE is right
(and predates the primitive), but no chip carries a count, so the page can tell
you it holds 400 memories and not how many are `feedback`. R6's count clause is
what is missing, not its form; adopting `<FilterChips>` is the migration, and
supplying `count` is the fix.

> The ❌ this rule carried until 2026-08-24 was
> `plans/page.tsx:116-128` — filters inside a `<CardContent>` with no per-subset
> counts. `/plans` was migrated onto the primitives in `49aa6c7b`, so that
> citation now points at a fetch function and the violation is gone. Fixed
> rather than left: a guide whose ❌ points at compliant code teaches the reader
> to distrust the rule.

### R7 — Secondary material collapses, but its signal does not

Anything infrastructural goes into `<CollapsiblePanel>`, which keeps its `summary`
badges **visible while collapsed** and **unmounts its children when closed** — so a
closed panel costs zero polling, and a red state never hides behind a click.

When a panel is collapsed, check whether anything else depended on its polling side
effect. If so, hoist the fetch to the page.

✅ `src/components/console/CollapsiblePanel.tsx:3-22` states the contract in its
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

✅ The pattern in use was `fleet/page.tsx:281-310`, whose own comment said why:

```tsx
// fleet/page.tsx:281-283 — DELETED by 2026-08-25-…-devops-sections Phase 4
{/* Everything infrastructural, one click away. Children unmount while
    collapsed, so their pollers only run when an operator opens this. */}
<CollapsiblePanel
```

...with the alarm counts hoisted into `summary` so the red state survived the
collapse (`{unhealthy} unhealthy`, `{admission.breach} refusing work`), and the
health hook hoisted to the PAGE precisely so the collapse could not take the
signal with it.

**That drawer is gone, and the rule is what survived it.** Phase 4 deleted the
`System details` section — its contents had homes of their own — and the signal
did not go with it: the same five counts now ride the `Dev Ops ▾` nav trigger
(`CoordNav`'s `FleetAlarmBadges` / `useFleetAlarmBadge`), where they are visible
from every console route instead of from one, and the two page polls that existed
only to feed a collapsed header were deleted rather than moved. Read that as R7's
strongest form: when secondary material earns a destination, give it the
destination and put its signal where the reader already is. Hoisting a count onto
a collapsed header is the fallback for material that has nowhere else to live.

The live worked example of the hoist itself is now
`MergePipeline`'s `Merge internals` panel (`MergePipeline.tsx`), which keeps its
proposal count in `summary` while collapsed.

❌ `src/app/(app)/admin/coord/lands/page.tsx:337` — **FIXED in Phase 3 Wave 2**;
kept here because it is the clearest worked example this rule has, and because
the shape of the fix is the rule. As it stood, `<LandPrecisionPanel>` was
rendered **unconditionally**, and its own fetch polled every 30s
(`lands/page.tsx:184-189`; `POLL_INTERVAL_MS` at `:51`) for the whole life of the
page. It is section 3 of a three-section page — per-dimension predictor
precision/recall calibration
(`components/admin/coord/LandPrecisionPanel.tsx:3-15`) — i.e. exactly the
infrastructural material R7 says belongs behind a click. Every visitor to `/lands`
pays that poll whether or not they came to read a calibration table:

```tsx
// lands/page.tsx:331-337 — as it stood before Wave 2 (read at 3e69607c)
{/* ---- 3. Calibration ---- */}
{precisionError && (
  <p className="text-sm text-destructive">
    Failed to load calibration: {precisionError}
  </p>
)}
<LandPrecisionPanel data={precision} loading={precisionLoading} />
```

✅ What replaced it, and the part worth copying: the panel is a
`<CollapsiblePanel>`, and **the fetch moved INTO a child of that panel**
(`<LandPrecisionSection>`) rather than staying on the page. That is what makes
"a closed panel costs zero polling" true rather than aspirational — a poll left
in the page keeps running while the panel it belongs to is shut, and a comment
saying otherwise is the honesty defect, not the fix. The last value it saw stays
in the panel's `summary` badge, labelled as a snapshot, so collapsing hides the
table without hiding the signal.

One caveat recorded so it is not mistaken for laziness: the panel
`defaultOpen`s, because `specs/pages/coord-lands/` asserts
`coord-land-precision-table` (and three of its header cells) in a state with no
transitions, and `<CollapsiblePanel>` unmounts its children. The operator's
choice persists via `storageKey`, so the poll stops the moment they fold it
away.

**At RECORD scale, R7 has no live violator — and one near-miss worth recording so
nobody "fixes" it.** `LandRow.tsx`'s `<CrossRepoVerdictPanel>` looks like an
embedded per-record panel and is not one: it mounts only inside the row's
expanded `<RecordDetail>`, and its own comment records that it fetches **once on
mount** and unmounts on collapse. That is R7 already satisfied, by a file that
wrote down the same rationale this rule gives. Leave it alone.

*(It read the same way in `LandCard.tsx:594-597` before Wave 2, where the plan
first mis-filed it as a violator and then corrected itself. Wave 2 changed only
WHICH click opens it — the row's, like every other console record — not whether
it is lazy.)*

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

✅ `src/app/(app)/admin/coord/pipeline/page.tsx` — no `<h1>`, no page-level
`<Card>`, and the reason for `overflow-x-auto` written down:

```tsx
// pipeline/page.tsx
// `overflow-x-auto`: wide panels (the train rows, a row's dependency DAG)
// scroll instead of stranding action buttons off-screen. Vertical scroll
// comes from the coord layout's <main overflow-y-auto>.
<div
  className="p-3 sm:p-6 space-y-4 overflow-x-auto"
  data-testid="coord-pipeline-page"
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
`/admin/agent-claims` and `/sessions` share them without sharing a
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
| `RowStatus<K>` (`:67`) | The minimum a row's status must carry: `kind`, `label`, `reason?`, `attention`, `dwellEvidence?`. `prPipeline`'s `UnifiedStatus` is structurally assignable to it, as `alertStatus`'s `AlertStatus` was until that module was deleted (§3.4). |
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

> **That debt is PAID — and how it got paid is the reusable part.** Phase 1
> found six more files declaring their OWN `relativeTime` and importing nothing,
> so the `operations/utils.ts` shim never reached them, plus
> `operations/gatesPredicate.ts`'s `relativeAgo` — a same-shape copy under
> another name that disclosed itself in its own comment. All were left as
> later-wave debt. **No wave collected any of them**, because none of them sits
> on a `/admin/coord/*` route the Phase 3 census counted; they were collected by
> Phase 1's post-merge follow-up instead.
>
> **Publishing a primitive is not enough to retire its copies.** Four of those
> files were byte-identical to each other and still could not call
> `console/time`, because the primitive was missing the two things they needed:
> a **caller-chosen absent placeholder** (they render `—`; the console renders
> `never`) and an **injectable clock** (`gatesPredicate` names its absence, in
> its own comment, as the reason it kept a copy). Both are now optional
> parameters, so the five real duplicates —
> `admin/agent-claims/AgentClaimsDashboard.tsx`,
> `admin/agent-sessions/AgentSessionsDashboard.tsx`,
> `admin/prompt-injections/PromptInjectionsDashboard.tsx`,
> `sessions/LineageTimeline.tsx` and `gatesPredicate`'s `relativeAgo` — now
> delegate. When a copy will not adopt your primitive, **ask what the primitive
> is missing** before recording it as somebody else's debt.
>
> Two corrections to Phase 1's list of six. `admin/coord/TreeCard.tsx` no longer
> exists — Phase 3 deleted it. And **`execute/ScheduleListItem.tsx` was never a
> duplicate**: same name, different behaviour — it *rounds* where this one
> floors (`119s` → `2m`, not `1m`) and renders future stamps as `in 5m`. It
> stays where it is. A same-name helper is not automatically a copy; diff the
> bodies before folding one in.

### 3.2 The console primitives

All exported from the `@/components/console` barrel, whose module doc carries the
same table. Every module doc cites its rule number and links this file.

| Component | Rule(s) | Props | Notes |
|---|---|---|---|
| `HealthStrip` | R1 | `{ level, headline, detail?, badges?, className?, "data-testid"? }` where `badges: { key, label, tone?, onClick?, navigationOnly?, title?, "data-testid"? }[]` and `tone: "default" \| "muted" \| "waiting" \| "attention"` | Takes the **already-derived** verdict. It cannot fetch, so R1's "never a second fetch" is structural. A badge with an `onClick` becomes a real `<button>` wrapping the badge in `display:contents`. `navigationOnly` is the caller's CLAIM that the press only filters, jumps or opens a view, and marks that button `NAVIGATION_ONLY_PROPS` (§6.5); leave it unset for anything that writes. |
| `StatCluster` | R1 | `{ stats, className?, "data-testid"? }` where `stats: { key, label, value, tone?, title?, onClick?, navigationOnly?, "data-testid"? }[]` and `tone: "default" \| "success" \| "warning" \| "attention" \| "muted"` | The count-cluster form of the same opening, for a table page with no single traffic-light verdict. `value: null` renders `–`, never `0`. First adopted by `/gates` (Wave 4, where `SummaryCards`' testids were ported); also the Dev Ops Conditions panel's two breakdown rows (§3.4). Count its consumers with a grep, not from this cell. `navigationOnly` is the same claim as `HealthStrip`'s. |
| `RecordRow` | R2, R4 | `{ identity, label, status?, reason?, time?, accent?, expanded, onToggle, children?, rowKey?, className?, "data-testid"?, reasonTestId? }` | Slot ORDER is fixed by the primitive, not the caller. `status` and `time` are `ReactNode` slots so each surface renders its own `<StatusBadge palette={…}>` without the row knowing a kind union. `accent` is the string from `rowAccentClass(status)`. The whole line is one `<button>` — R5 has to be keyboard-reachable. `children` render below the row, only while expanded. |
| `RecordDetail` | R5 | `{ why?, problems?, actions?, history?, raw?, className?, "data-testid"? }` | Five slots in that order, each a bare fragment, so the panel's `space-y-3` spaces real content and an absent slot leaves no gap. Shares the row's border (`border-t-0 rounded-b-md`). Not a slide-over (D2). |
| `RecordList` | R2, R5 | `{ items, itemKey, renderRow, loaded?, skeletonRows?, empty?, className? }` &plus; a `RecordListExpansion` **union**: either neither of `{expandedKey, onExpandedKeyChange}` or **both** | The loading / empty / rows trichotomy is ONE decision, so it is one component. Unloaded renders skeletons, never an empty list. `empty` is the caller's, because an honest empty state names *which* question came back empty. One open at a time. Expansion state is internal unless hoisted, and the hoisting props are a UNION so supplying one without the other is a type error rather than a silently-ignored prop. |
| `FilterTabs` | R6 | `{ tabs, active, onChange, testIdPrefix?, query?, onQueryChange?, queryPlaceholder?, queryTestId?, className? }` where `tabs: { id, label, count?, attention?, testId? }[]` | **`count == null` → `–`; `count === 0` → `0`.** The rule lives in the primitive precisely because it is the clause a page author will not think to reproduce. A caller expresses "unknown" by passing `null`, which is what an unfetched value already is. |
| `FilterChips` | R6 | `{ label, options, selected, onToggle, onClear, allLabel?, maxVisible?, testIdPrefix?, title?, className? }` where `options: { value, label, count?, testId?, title? }[]` | The MULTI-select sibling. **`selected: []` is NO filter, not an option** — a synthetic `"any"` member would be a value the server vocabulary does not have, and every caller would have to strip it before the query string. The `all` chip is a clear action, pressed exactly when nothing is selected and **inert while it is** (`aria-disabled` with no handler, never the real `disabled` attribute, which would drop it out of the tab order on the one interaction it exists for and dim the page's default state) — a caller's `onClear` is a `setState([])`, so a no-op click would hand every selection-keyed `useCallback` a fresh array and refetch, discarding whatever the operator had paged into. Counts are a GROUP decision: a strip where no option carries one renders no count slot, and inside a strip where any does, R6's `–`-not-`0` reading is identical to `FilterTabs`'. `maxVisible` caps a SERVER vocabulary behind a `+N more` disclosure, with every selected option exempt: coord's alert corpus was 43 distinct live kinds on 2026-08-24 against the ~10 the alerts page was written for, and forty-three chips is §5's density budget spent on a control. Split from `FilterTabs` rather than widening `active` to `Id \| Id[]`, which would have given one component two different empty states. |
| `RefreshButton` | §6.4 (no numbered rule) | `{ onRefresh, label, title, className?, "data-testid"? }` where `onRefresh: () => Promise<unknown> \| void` | The icon-only "re-read now" control. **`label` and `title` are required, not defaulted**: `label` is the accessible name (an icon has none), and `title` names what the press does AND its effect — "returns to the first page", "also refreshes itself every 10 s" — without repeating the label, since it is announced as the description right after the name. **Busy belongs to the press**: the button is busy for exactly as long as the promise ITS click returned is out, so a page's poll — which usually calls the same fetch function — has no path to the state and cannot make it pulse every interval. Busy is `aria-busy` + `aria-disabled` with presses ignored, never the real `disabled` attribute (same reasoning as `FilterChips`' `all` chip: it would blur the button out from under the keyboard user who just pressed it). A rejected read ends busy too — the failure is the page's to render (R6). Added by plan `2026-09-09-coord-plans-page-controls-do-not-acknowledge-or-name-themselves` after 18 of 28 `/admin/coord/*` files rendering `RefreshCw` were found carrying no `aria-label`; adopted on `/plans` first, then `/spawn` (the sibling page sharing `derivePlansHealth` and the same fetch/poll-lock shape), 16 are still open. |
| `GlossaryTerm` | supports R8 | `{ id, children?, className?, "data-testid"? }` where `id: GlossaryTerm` (the generated union from `@qontinui/shared-types/glossary`) | R8 keeps INTERNAL vocabulary off a primary surface; the product's OWN vocabulary (gate, work unit, claim, merge train…) stays, and this is how it explains itself. The tooltip is `GLOSSARY[id].short` **byte for byte**, from the table generated out of the schemas `glossary/terms.toml` by the same generator as the Rust table coord and the runner serve — **compiled in, never fetched**, so a term explains itself when coord is unreachable. `id` is the union, so a misspelt id is a compile error; `GlossaryTerm.test.tsx` also scans every literal `id` in `src/`. The trigger is focusable (the definition is not hover-only) and carries its own `TooltipProvider`. Pass `children` when the surface's wording differs from the display name ("gates", a column header). First adopted (plan `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists` C3) on the `/admin/coord/*` column headers and empty states that use a roster term — `/gates` (Gate, Continuation, both empty states), `/work-units`, `/findings`, `/gate-clearance`, `/git-ops`, `/policies` (Tenant), `/prompt-documents`; count its consumers with a grep. **Wrap a word only where the glossary definition is what the column means**: `/members`' "Grant tier" (a role grant) and the design-policies "Policy" column (UX policy rows) were deliberately NOT wrapped, because `tier` and `policy` define other things. |
| `BackendErrorMessage` | supports R3, R8 | `{ error, className?, "data-testid"? }` where `error` is what the surface caught (a `BackendError` from `backendError(res)`, any `Error`) or the `BackendErrorReading` it kept in state | The one renderer for a backend refusal (plan `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists` D3). A body carrying the `Refusal` envelope (`body.refusal`) renders `Refusal::render()`'s sentence (mirrored in `lib/errors/refusal.ts`), a link for `open_page` (app paths and `https:` URLs only — never `http:` or a `javascript:` target) or a copyable command for `run_command`, its `detail` BESIDE the sentence, and each cited term through `GlossaryTerm`; it is stamped `data-refusal="structured"`. A cited term id this build's glossary does not define (a newer producer) is shown on the surface as the raw id, marked `data-glossary-unrecognised` and titled "Not in this version's glossary". Only an envelope at a STRUCTURAL position (`body.refusal`, `body.detail.refusal`, the body itself) gets the affordances: one relayed inside a string `detail` / `message` may echo caller input, so it renders its sentence only, with no link, copy button or terms, stamped `data-refusal="from-text"`. **Every other body renders exactly its pre-contract sentence**, stamped `data-refusal="unstructured"`, which is what lets a scenario count the refusals an operator still meets without a next action. Adopted on `/members`' five section-level read failures. |
| `NAVIGATION_ONLY_PROPS` / `NAVIGATION_ONLY_ATTRIBUTE` | supports the presentation lens (§6.5) | spread `{...NAVIGATION_ONLY_PROPS}` onto a control | The marker of a control whose press changes only what is DISPLAYED, so it stays live in presentation mode. `FilterTabs`, `FilterChips` and `RefreshButton` carry it on every control by construction; `HealthStrip` and `StatCluster` only where the caller says `navigationOnly`. It is a claim the code makes about its own control, and §6.5 says which controls may make it. |
| `CollapsiblePanel` | R7 | unchanged | **Moved** from `operations/CollapsiblePanel.tsx` (D3). Phase 1's re-export shim at the old path is **deleted**: its seven callers were repointed at this barrel in Phase 1's post-merge follow-up. The re-export in `operations/index.ts` stays — that is the barrel, not the shim. |
| `statusRow` atoms | R2, R3, R4 | see §3.1 | **Moved**, not re-extracted. |
| `time.ts` | supports R2 | `relativeTime(iso, { absent?, now? }?)`, `absoluteTime(iso)` | Moved out of `operations/utils.ts` so `console/` carries no runtime edge into the merge-train route catalogue. `operations/utils.ts` re-exports `relativeTime` as a binding, so the options parameter travels to its **23** importers and none of them changed. **`absent`** (default `"never"`) is rendered for a timestamp that is missing *or unparseable* — an unparseable one is not `"just now"`, which is reserved for a genuinely negative delta (clock skew). **`now`** (default `Date.now()`) makes a caller's test deterministic. Both exist because their absence was what kept five private copies alive; see §3.1. |
| `attention.ts` | R3 | `Attention`, `AttentionMap<K>`, `attentionOf(map, kind, floor?)`, `escalateAttention(a, b)`, `ATTENTION_RANK`, `paletteDisagreements(attentionByKind, palette, {perRowKinds?})` | Import-free by design: `Attention` is **declared here** and re-exported by `prPipeline.ts`, so the severity vocabulary sits in the base layer instead of inside the merge-train module. `attentionOf` floors an unrecognised kind at `"waiting"`, never `"none"` — see §4.2. |
| `ShareBar` / `ShareList` / `share.ts` | §6.4 (see [§3.7](#37-the-share-primitives--recorded-under-64)) | `ShareBar { numerator, denominator, title?, className?, "data-testid"? }`; `ShareList { items, total, empty?, unit?, className?, "data-testid"? }` where `items: { key, label, count, title?, detail?, detailTitle?, "data-testid"? }[]` and `count: number \| null`; `share(n, d)`, `shareOfFraction(f)`, `SHARE_UNKNOWN` | A part of a whole, as a glyph, and a ranked distribution of parts. `share()` is the console's ONE part-of-a-whole formatter — exact `100%`/`0%` only at the exact ends, `>`/`<` hedges between, and `–` for a share over nothing. |

**How the invariant got generalised.** `MergePipeline.test.tsx`'s two palette tests
and `alertStatus.test.ts`'s three (deleted with the alerts page, §3.4) each
audited one surface. Neither can bind a surface
that does not exist yet, and 29 routes were about to adopt the pattern. So the
assertion became `paletteDisagreements()` and
`src/components/console/attention.test.ts` runs it over a **registry** of every
console palette. That registry began as the two rows this sentence used to name —
the merge pipeline and alerts — and every Phase 3 wave added to it; **read the count
off `CONSOLE_PALETTES`, never off a number written here**, which is the mistake this
paragraph itself shipped and then carried through all five waves.

Adding a surface still means adding one row to that registry — but **forgetting is
no longer something that can ship silently.** The registry is checked against the
tree by the console's own suite, in both directions: every attention table the
console declares must be held by a row, and every registered row's table must still
be reachable by that check, since a discovery that quietly stops discovering agrees
with everything. Enrolment is
therefore derived from the tree rather than from whoever remembered, which is the
whole point — an audit you have to remember to enrol in is an audit with a hole, and
Waves 1 and 2 had already fallen through it: seven palettes were live and
unregistered at once, each audited only beside itself.

The per-surface tests stay: they are each surface's own oracle, and they cover
things the generic audit cannot (per-row escalation, UUID hygiene).

The audit carries exactly one declared exemption, `perRowKinds`, for a kind whose
badge class is resolved per row rather than read off the static table — the alerts
surface's `unknown`, whose attention was severity-derived. Its static entry was a
FLOOR, not the thing that rendered, so auditing that floor for amber would have
demanded a colour the surface deliberately did not paint.

> **No registered surface uses `perRowKinds` today.** The alerts surface was its
> only user, and it was deleted (§3.4), so its `CONSOLE_PALETTES` row went with
> it. The exemption stays in `paletteDisagreements` for the next surface whose
> attention is genuinely per-row; the rules below still bind whoever uses it.

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
   **unmodified**, as did `prPipeline.test.ts` (127) and `alertStatus.test.ts` (45;
   since deleted with the alerts page).
2. **The palette agreement test was ported** into `console/attention.test.ts`, over
   the registry described above.
3. **Every module doc cites its rule number and links this file.** A primitive whose
   doc does not say which rule it enforces is a primitive nobody will know when to
   reach for.

Three authored testids moved from `MergePipeline.tsx` into the primitives that now
own them — `pipeline-search` (`queryTestId`), `pipeline-filter-<id>`
(`testIdPrefix`) and `row-reason` (`reasonTestId`'s default). They render
identically; the oracle asserting all three unmodified is the evidence.

### 3.3 Patterns the agent text-unit console added — recorded under §6.4

`/admin/coord/agent-commands` and `/admin/coord/agent-skills` (plan
`2026-08-20-fleet-served-agent-skills.md`, Phase 3) are the first console pages
built after this guide. They compose the shapes §2 shows — health strip, one-line
rows, filter tabs with `–`-not-`0` counts, `p-3 sm:p-6 space-y-4` body, an
authored kind→attention table with an agreement test — by hand, out of
`_agent-text-units/_lib/unitRows.ts`.

> **They hand-roll shapes [§3.2](#32-the-console-primitives) now ships, and that
> is migration debt, not a design choice.** They were authored while §3 was still
> a stub, and Phase 1 (`51168755`) landed the primitives in parallel. Nothing here
> imports `@/components/console` yet; the health strip, the row and the filter
> strip should each become `<HealthStrip>`, `<RecordRow>`/`<RecordList>` and
> `<FilterTabs>`, and `ATTENTION_BY_KIND` should go through `attentionOf` and join
> `console/attention.test.ts`'s registry. Recorded rather than done in this PR —
> it is a migration of a landed surface, and it belongs with the wave that moves
> the rest of Family B.

They also introduce **two patterns this guide did not cover**, recorded here as
§6.4 requires rather than shipped silently. Neither has a primitive yet; both
belong in `components/console/` when a second surface needs them.

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **Layer switch** | `_agent-text-units/_components/UnitEditor.tsx` (`LayerSwitch`) | A segmented two-state control naming the STORED LAYER a write goes to, each segment carrying whether that layer holds a row (`stored` / `none`) and a lock glyph when the viewer may read but not write it. | R6's filter tabs *narrow a view*; this *changes the write target*. Rendering a destructive-scope selector as a filter tab would be the worst possible confusion, so it is deliberately a different control. |
| **File tab strip** | `_agent-text-units/_components/UnitFileTabs.tsx` | An editable path list over a `files` map: select, add, rename, delete, with the unit's entrypoint pinned (`validate_files` refuses a unit without it) and every path checked against the backend's own `validate_relative_path` while typing. | Nothing in the console edits a *set* of texts as one record. A command is the degenerate one-entry case of the same strip, so the two kinds stay one component. |

Two notes for whoever extracts them:

- **The layer switch's "stored / none" suffix is load-bearing, not decoration.** A
  blank editor at a layer with no row means *nothing is stored here*, never *the
  text is empty* — the runner's embedded copy is never uploaded, so qontinui-web
  cannot pre-fill it and must not imply it could. Same `silent-empty-is-unknown`
  discipline as R6's unfetched count.
- **This surface's `ATTENTION_BY_KIND` has three `"none"` kinds and one
  `"author"`,** and that asymmetry is the point: an account override and a fleet
  default are normal states, while an override byte-identical to the fleet default
  (`account-pinned`) silently stops fleet edits reaching that account and nothing
  but a human clears it. An authoring surface that painted its normal states red
  would re-create the exact bug [§4](#4-the-attention-palette) exists to prevent.

### 3.4 The alerts page retired, and the Dev Ops Conditions panel — recorded under §6.4

Plan `2026-09-18-notifications-are-agent-actions-and-alerts-are-agent-work`
Phase 8 deleted the console's one raw-condition list surface and replaced its
operator signal with a rollup. Recorded here because two things this guide used
as worked examples are gone, and because the replacement adds one composition
this guide did not show.

**What was deleted, and why it is not a style regression.**
`/admin/coord/alerts` (its page, `AlertRow.tsx`, `alertStatus.ts` and their
tests), the header's Alerts link and its `useAlertsBadge` count, the Alerts
sidebar tab, the `alerts` row of `CONSOLE_PALETTES`, and the stale-claim alerts
section of `/admin/agent-claims`. The reason is audience, not presentation:
`coord.alerts` held 27,604 open rows on 2026-09-18, nearly every one a piece of
operational work an agent can diagnose and fix
(`decision_record/operational-work-is-autonomous`), and a list sorted by
severity told the operator nothing about whether anyone was on them. The read
API (`/api/v1/operations/alerts`) stays — `RedMainBanner` and agent tooling
read it — and `next.config.mjs` 308s the old path to `/admin/coord/devops`.
The rules those files demonstrated (R3's ignorance floor, the per-row
`perRowKinds` exemption, the two-axis badge) are unchanged; their examples are
annotated where they are cited above.

**What replaced it: a Conditions panel on the Dev Ops Overview**
(`components/operations/FleetConditionsPanel.tsx`, derived by the pure
`fleetConditions.ts`). It answers *is anything degraded that no agent is
handling, and is anything waiting on me?* from coord's `conditions` block on
the fleet-health read the page already polls (R1: no second fetch). It
composes primitives only — a `<HealthStrip>` for the verdict and two
`<StatCluster>` rows (unclaimed conditions by owning agent domain; deliberate
settings in effect) — so it adds no visual vocabulary.

| Clause | Rule it applies |
|---|---|
| "Nothing unhandled" only on a MEASURED zero (`scrape_up` and `unclaimed == 0`) | R1 — the headline is the claim; it is the one sentence the panel must never say falsely |
| An absent `conditions` block → "Unknown — coord does not report conditions yet"; `scrape_up: false` → "Unknown — health query failed"; a `null` count → `–` | R6 — absence is not zero, at the strip and per count |
| Unknown states are amber; unclaimed conditions are amber; only "waiting on you N" borrows red | R3 — red means a human must act, and an operator question is the one thing on the panel only he can clear |
| Settings in effect never move the level | R3 — a drain or a kill switch is a deliberate operator setting reflected back, not a fault |
| Operator alerts with no open question come from coord's two EXACT counts, never a subtraction: `awaiting_operator_unasked` → "N operator alerts not yet asked" (never green); `awaiting_operator_answered_uncleared` → "N answered, waiting for coord to see them clear" (amber). A coord without them gets neutral wording naming no cause ("open beyond the questions waiting on you") and is never green. While any exists the headline is never "Nothing unhandled" | R3 — something needs the operator that the question queue does not show; and a subtraction cannot say which, because an answered alert that has not yet cleared is never re-asked |
| A failed LATEST read keeps the retained numbers, labelled, and forces amber | R6 — a retained verdict may not look like a re-confirmed one, in either direction |
| `scrape_up: false` names coord's `unavailable_reason` | R8's converse — the operator gets the one fact that says where to look |
| Domain and setting names are operator words; the wire kind is in the `title` | R8 |

**The one new composition: a second health strip on one page.** R1 says a list
surface opens with ONE strip. The Dev Ops Overview now carries two — the
page's own machine-liveness strip first, then the Conditions panel's — and that
is deliberate rather than drift: they answer independent questions over
independent fields of the same read ("are the machines there, and can they
reach coord?" versus "is anything wrong that no agent is handling?"), and
folding the conditions badges into the liveness strip is exactly how the page
came to render `machines 8` beside thousands of unresolved criticals (plan
`2026-08-31-devops-surface-renders-no-alert-signal`). The rule this records:
**a second strip is allowed when it answers a second question that the first
strip's verdict does not depend on, and it sits directly under the first.**
It is not licence for a strip per section.

### 3.5 The computers console — recorded under §6.4

`/admin/coord/computers` and its `[computerId]` drill-down (plan
`2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-has-no-resource-model`
Phase 5) compose `HealthStrip`, `RecordList`/`RecordRow`/`RecordDetail`,
`StatCluster`, `StatusBadge` and `RefreshButton`, and register three palettes
(the computer's verdict, its report freshness, a watched service's state) in
`CONSOLE_PALETTES`. Two things they needed are recorded here rather than shipped
silently.

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **The pressure sparkline is shared, not re-drawn** | `components/operations/PressureSparkline.tsx` | The Dev Ops strip's pinned-`[0,1]`, time-axis, gaps-not-lines sparkline, moved out of `FleetResourceStrip.tsx` (where it was private) and fed POINTS instead of a `HistorySeries`. Its default testids are the strip's frozen ones. | A second sparkline for the same lanes would be a second picture of one number that can disagree with the first. It lives in `operations/`, not `console/`, because it knows the resource-sample vocabulary (`RowTone`); `console/` stays presentation-only. |
| **A capacity-vs-usage table whose cells can refuse to answer** | `computers/_components/ComputerParts.tsx` (`LaneTable`) | A Family-C dense table (one row per lane) where every figure is one of four things: a value, `unknown` (never measured), `not supported` (the publisher says it cannot measure this axis — Windows load averages), or `unavailable`. A stale lane is dimmed, its freshness badge says `STALE`, and it carries a "last known" note — its figures are never presented as current. | R6 covers a count that was not fetched (`–`, not `0`). This is the per-FIELD version with two more states, and it is a correctness rule rather than a density one: a `0` or a blank in these cells is the confidently-wrong dashboard plan §3.5 exists to end. |

The freshness badge itself is not a new component: it is a `StatusBadge` over a
three-kind palette (`fresh` calm, `stale` and `unknown` on `UNKNOWN_AMBER` —
R3's ignorance floor), so it inherits the glyph and title rules for free.

### 3.6 The CI dashboard — recorded under §6.4

`/admin/coord/ci` (plan `2026-10-04-ci-dashboard-in-the-dev-ops-console`
Phase 4) composes `HealthStrip`, `CollapsiblePanel`, `RecordList`/`RecordRow`/
`RecordDetail`, `StatusBadge`, `RowTime` and `RefreshButton`, and registers two
palettes (a pool's verdict, a repo's) in `CONSOLE_PALETTES`. It adds no new
primitive. One thing is recorded rather than shipped silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **`LaneTable`'s per-field refusal, inline on a one-line row** | `ci/page.tsx` (`CellText`), readings from `ci/_lib/ciDashboardStatus.ts` (`cell`) | Every figure on a pool or repo row is a `CellReading`: a number only when coord's row `state` is `measured`, otherwise an amber `–` whose `title` carries the reason. A measured `null` is a `–` too — `null` is never `0`. Every figure has a `RowTime` freshness stamp beside it or on its row. | §3.5 records the per-field rule for a dense TABLE; here the same rule rides R2's single line. It stays local to the route until a second surface needs it — then it moves to `console/`, per §6.4. |

The strip's verdict has a fourth value the primitive does not: `deriveCiHealth`
returns `unknown` beside red/amber/green, and the page paints it amber
(`stripLevel`) while exposing the verdict as `data-ci-health` — so "we do not
know" and "waiting" look alike to the eye (R3's ignorance floor) and stay
distinct to a UI Bridge reader.

### 3.7 The share primitives — recorded under §6.4

Plan `2026-08-27-operator-touch-read-and-surface` Phase C3 built
`/admin/coord/operator-touches`, whose operator half answers a STRATEGIC
question — *"these four classes are 60% of my interruptions; which do I make
policy about?"* — and the console had nothing to draw that with. No primitive
in `components/console/` rendered a share, a percentage or a ranked
distribution; `RecordRow`'s slots are identity, label, status, reason and time;
and the only two percentage formatters on operator surfaces were a scalar
(`MergeOrchestrationSettings`' `fmtRate`) and a private helper
(`PlanCoveragePanel`'s `share()`). §6.4 allows compose or extend; this is the
extension, in the same PR as the page that needed it.

| Export | What it is |
|---|---|
| `share(n, d)` / `shareOfFraction(f)` (`console/share.ts`) | The ONE part-of-a-whole formatter. **Promoted, not rewritten**: it is `PlanCoveragePanel`'s `share()`, which now imports it. `100%` and `0%` only at the exact ends; `>99.9%` / `<0.1%` rather than a rounding that asserts full or no coverage; and `SHARE_UNKNOWN` (`–`) for a share over nothing — a zero/negative/unknown whole, or a part outside it. `0 of 0` used to compute to `100%`. |
| `ShareBar` | The glyph: a fixed-width track, a fill, and the `share()` text in mono. A known zero is an empty SOLID track; an unknown share is an empty DASHED track and `–` — the two must never look alike (R6's dash rule, applied to a bar). |
| `ShareList` | A ranked distribution: one line per class — label (truncating, `title` for the full text), optional `detail` from `sm` up, the count, the `ShareBar`. **It ranks itself** (count descending, stable on ties, an unknown count last), so ranking is a property of the primitive rather than a hope about its input. `unit` names the count (`30 placed`) where the heading does not; a `null` count reads `unknown` over the dashed track — never `0`. The detail truncates at 28ch, so it carries a hover of its own: `detailTitle`, defaulting to the detail's own text when that is a string — never the line's `title`, which may be a wire token naming the LABEL (R8; the operator-touch page's `title` is a `reason_code`). All three added by the spawns console (§3.8). |

Three rules, each held by the primitive rather than left to a caller:

- **The bar is neutral — never an attention hue.** A share is a measurement of
  the whole surface, the same kind of thing as a `HealthStrip` count badge, and
  says nothing about whose move a line is (R3). Painting the largest class red
  would spend the loudest signal in the console on "big". `share.test.tsx`
  asserts no red or amber class is emitted.
- **A `ShareList` line is not a button.** It is an aggregate, read and not acted
  on; a per-line action is what `RecordRow` + R5 are for. A surface that wants
  both — an aggregate and its records — renders a `ShareList` for the first and
  a `RecordList` for the second, and says which question each answers.
- **Labels are human words (R8).** The wire token belongs in the line's `title`
  or in a record's expanded detail, never as the label.

Density: a `ShareList` line is `px-3 py-1.5` + `text-sm` — inside §5's 40px
row budget with room to spare, because a ranked aggregate is read as one block.

### 3.8 The spawns console — recorded under §6.4

`/admin/coord/spawns` (plan
`2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
Phase 5) composes `HealthStrip`, `ShareList`, `FilterTabs`,
`RecordList`/`RecordRow`/`RecordDetail`, `StatusBadge`, `RowTime`,
`CollapsiblePanel` and `RefreshButton`, and registers one palette (a spawn
request's status) in `CONSOLE_PALETTES`. It extends one primitive — `ShareList`
gained `unit`, a `null` count and `detailTitle` (§3.7) — and records four
things rather than shipping them silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **A second surface's outcome vocabulary, reused by reference** | `spawns/_lib/spawnStatus.ts` (`SPAWN_ATTENTION_BY_KIND`, `SPAWN_KIND_CLASS`) | A spawn request ends the way a gate continuation does, so every shared kind's attention and class IS `gates/continuationStatus.ts`'s entry (`spawned` is not success, `work_completed` is the only success, an unreported outcome is the ignorance floor). The ledger-only words get their own rows: `queued`, `waiting_late`, `waiting_stuck` and `superseded`. | §4.2 audits each table on its own; nothing said two surfaces describing the same lifecycle must agree. `spawnStatus.test.ts` asserts the shared entries are identical, so the two pages cannot drift into painting one word two ways. |
| **A threshold is not portable when its counter's cadence differs** | `spawns/_lib/spawnStatus.ts` (`SPAWN_TARGET_MS`, `SPAWN_STUCK_MS`) | The gates page's `deferral_stuck` (24 deferrals) is a day of the runner's HOURLY stamps; the ledger's `deferrals` counts events that can arrive every 5 minutes, so the same 24 would be two hours. A waiting request is therefore judged by its AGE since the first attempt: calm under the plan's 10-minute target, amber past it, red past a day. The strip reads the same rows, so it is never calmer than a row beneath it: any red row turns it red, and the headline names what is red in the rows' own words ("1 spawn stuck for 3 d", "1 dispatch stalled"), taking coord's full-window figure wherever coord counts one, so a truncated list never makes the headline disagree with a badge. | R3 says what each hue promises, not how to borrow a threshold. Reusing the vocabulary (row above) does not license reusing a number whose unit is another producer's cadence. |
| **A count chart on a console page, built like `ThroughputPanel`, that says what it does not cover** | `spawns/_components/SpawnRateChart.tsx` | Two series inside a `CollapsiblePanel`, colours from `@/config/theme`, mirrored in an `sr-only` table, bucketed and labelled by UTC hour. Drawn from the window's request list, so it counts requests MADE in its span and when those started — a request made earlier that started inside the span is not on it, and the caption says so rather than calling the line a start rate. It starts at the first FULL hour the read covers — after the window's start, or after the oldest row loaded when the list was truncated — because the hour either falls in was only partly read; earlier hours are not drawn, never drawn as zeros. | `plans/ThroughputPanel.tsx` is the first chart on a console page and is not recorded here; this records the shape both now follow, so a third chart has something written to compose against. |
| **A fact the wire does not serve yet, stated once for the list** | `spawns/page.tsx` (`coord-spawns-reserve-note`), `spawns/_components/MachineStatusSection.tsx` (`coord-spawns-inflight-note`) | Each device's dispatch role IS served (`/fleet/dispatch-roles`) and rides on its line's label. Its current reserve and ceilings are not served until the plan's Phase 6: the `ShareList` says so ONCE above its lines, and each line's `title` repeats it for a reader hovering one device. The Machines list does the same for in flight against ceiling and the held reasons, which coord serves only on a door no console reads (`GET /coord/agent-fixer-arm-readiness`, device and agent tokens only): one note naming the door, and an UNKNOWN in each line's cell whose title repeats it. | Repeating "not served yet" on every line is chrome that cannot vary (served policy `ux-priorities` `repeated-chrome-must-earn-its-space-by-varying`), and rendering the slot as `0` would be R6's dash rule broken. |

Plan `2026-10-23-console-presentation-spaces` Phase 4 extended the page with two
sections — **Spawn paths** (`_components/SpawnPathMatrix.tsx` over
`_lib/spawnPathMatrix.ts`, the gate model `spawnPathGates.ts` and its per-source
gates `registryGates.ts`, `nextStepGates.ts`, `mergeSettingsGates.ts` and
`followupGates.ts`, `spawnPathCatalog.ts`, `spawnPathContract.ts`, read by
`useSpawnPathSwitches`) and **Machines**
(`_components/MachineStatusSection.tsx` over `_lib/machineStatus.ts`) — both plain
tables (the `FleetWorktreeSlotsSection` classes, horizontally scrollable at phone
width), and made the whole page a presentation lens surface (agentic activity),
registered in `PRESENTATION_READY_ROUTES` on the strength of
`page.presentation.test.tsx`. It adds no primitive and no palette (a switch's value
is drawn from `statusRow`'s constants directly: `INERT` for on and off alike,
`UNKNOWN_AMBER` for what could not be read or is stale, `AUTHOR_RED` for a write
coord did not read back as asked). Six more things are recorded:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **Rows from what the producer serves; a hand list only for what nothing serves, pinned** | `spawns/_lib/spawnPathMatrix.ts`, `spawnPathContract.test.ts` | A coord path's row exists because coord's agent registry serves it (a contract kind, a class switch, or any standing kind — so a kind newer than this build still gets a row, named by its token); a contract kind nothing served stays a row whose values are UNKNOWN; agent ROLE rows are counted and left to the agent registry page. The hand-kept list holds only the post-merge follow-up (it rides the gate-continuation kind) and the runner-local paths, and a served row of the same name replaces a hand row. The test pins the copied contract to the qontinui-schemas checkout beside the repository when one is present (skipped, never passed, when absent), and the hand list against the served names. | R6 covers a count nobody fetched. This is a ROW nobody served: a hand-kept list of paths would silently miss the next kind coord ships, which is the same lie as a missing count, one level up. |
| **Several switches per row, each with its own served value, never folded** | `spawns/_lib/spawnPathGates.ts` and its per-source gates, `_components/SpawnPathCells.tsx` (`GateChip`) | A path's line shows its primary switch in the five columns (switch, scope, enforced?, effective state, last spawned) and every other switch this console can read that governs it as a chip carrying that switch's own value — the class row, a fixer's merge-settings dial or knob (`auto_fix_pr`, `auto_fix_red_main`, `auto_fix_admission_stall`, the conjuncts coord names for exactly those paths), the next-step autonomy level with coord's own `effective_state` (and, when that is `unknown`, coord's own words for what it cannot see), the fleet flag coord reports. Opening the line (R5) lists each in full. No cell combines them: coord's authorization fold is coord's, and a browser copy is how the 2026-08-03 outage looked. | §3.5 and §3.6 show one value per field. A setting that several layers govern needs every layer visible, and the temptation to print one "effective" verdict is exactly the re-implementation served policy `production-and-cost` `agent-spawn-authorization` rules out. |
| **The value enforced, not the viewer's own** | `spawns/_lib/registryGates.ts` | A registry row's value is its served TENANT DEFAULT, because coord's spawn seam folds the defaults only ("Prefs do NOT bind enforcement", `spawn_authorization.rs`). The signed-in member's fold, which overlays their own preference, is shown beside it in operator mode as "Your preference", and never while presenting — otherwise a presenter's own preference would read as a path the system runs being off. A row each runner reads (the class switches) also says how many members recorded the opposite, since a runner follows the preference of the member it signs in as. | §3.5's field rule assumes one value per field. Here two served reads disagree by design, and only one of them is the value that acts. |
| **After a write, the read-back — and a disagreement is a contradiction** | `spawns/_lib/useSpawnPathSwitches.ts`, `spawnPathGates.ts` (`withWrite`) | A switch write goes through its existing door (`PUT /coord/agent-registry/:agent_name`, `PUT /coord/next-step-settings`, `PATCH /pr-merge/settings`) and records what was ASKED; the cell then shows the next READ — the tenant defaults re-read ticketed after the PUT resolved, coord's next-step answer, the dial hook's confirmed answer, the merge settings re-read after a knob write — and says "read back as asked", or, on `AUTHOR_RED`, that coord reads back otherwise. A refusal keeps coord's value and says so; a write coord could not confirm (`written: null`, a timeout) is UNKNOWN until the hook's re-read answers, which is then the read-back; a failed read-back is UNKNOWN. While presenting the value is coord's alone, with no note about the operator's request. | R5's detail and R6's counts are reads. A control that paints its own request as the new state is the `a-status-signal-must-observe-the-state-it-names` corollary for actions; this records the shape that obeys it. |
| **"Last spawned" only where a ledger field names the path, and only what the list measured** | `spawns/_lib/spawnPathLastSpawned.ts` | The ledger's `origin` names a path only for gate continuations, unit dispatches, stewards and the scheduler; every fixer shares `coord_dispatch`, and a post-merge follow-up is a gate continuation. Elsewhere the cell is UNKNOWN and says which field is missing; an undeployed or unreadable ledger is UNKNOWN with its own reason. The list holds the requests MADE in the window, so a start found is a lower bound ("started 3h ago or more recently") and "none" is said of the requests it holds ("no request in the last 7 days", "2 requests in the last 7 days, none started") — never "never", blank or 0. An origin that names only some of a path's starts (a steward started from a runner's own window is recorded as an operator terminal) proves a start but not an absence: its "none" is UNKNOWN. | R6's dash rule is about a count nobody fetched. Here the read answered and cannot attribute; saying "never" from an unattributable answer is the mis-attribution shape `unknown-must-not-render-as-a-default` names. |
| **A control a lens proof cannot read is the operator's** | `spawns/page.tsx` (`coord-spawns-window-presented`) | A closed Radix `Select` keeps its items in a detached `DocumentFragment`, so a presentation render containing one cannot be proven (the readiness recorder refuses output outside what the check read). The window picker is therefore inside `OperatorOnly`, and while presenting the window is stated as text — the operator picks it before presenting, and it stays picked. | §6.5 says a lens page renders only navigation-only controls; it does not say that a control which is navigation-only can still fail the proof by where it puts its DOM. |

While presenting, every section opens with its caption and one `Provenance` chip per
read (`SectionCaption`; the strip's chip sits under it); machines read as their
session alias in the Machines list, the per-device share list and every request
row (`useMachineAliaser`, through one `DeviceNaming`; the matrix names no machine);
no device id, coord reason, event reason, raw id, setting key or member preference
renders, and a sentence names "the coordination service" rather than coord; write
controls and the launcher link are unmounted, and where a switch's control would be,
a fixed sentence says it is changed by the operator in the console; the session-load
link is a `LensLink`; and the rate chart is held open.

### 3.9 The session-load console — recorded under §6.4

`/admin/coord/session-load` (plan
`2026-10-23-session-duration-by-work-type-and-per-device-session-load`
Phase 5) composes `HealthStrip`, `RecordList`/`RecordRow`/`RecordDetail`,
`StatusBadge`, `RowTime`, `FilterTabs`, `CollapsiblePanel` and
`RefreshButton`, and registers two palettes in `CONSOLE_PALETTES` (a
machine's load against its budget, and one run). It adds no primitive and
records three things rather than shipping them silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **A measuring surface paints nothing red** | `session-load/_lib/sessionLoadStatus.ts` (`MACHINE_ATTENTION_BY_KIND`, `RUN_ATTENTION_BY_KIND`) | The page measures load; admission and placement act on it. So no machine or run is the operator's move now: over budget is amber (it clears as runs end), and a silent machine, an unpublished budget and an inferred end are the ignorance floor (`UNKNOWN_AMBER`). The strip follows: amber at most. | R3 says what each hue promises; it does not say a whole surface may legitimately have no red. Writing it down stops the next measuring page reaching for red on "big". |
| **A sparkline in a row's time slot** | `session-load/_components/charts.tsx` (`Sparkline`, `StackedBar`) | Inline SVG, not Recharts: a responsive container inside a one-line R2 row has nothing to measure. Each carries its numbers in an accessible name (and a `data-points` count), series colours come from `@/config/theme` and are never a red or an amber, and an empty series says "no history" in words — never a flat line at zero. | The two console charts recorded in §3.8 are full-width panels. A row-sized glyph needed its own statement of what it may and may not imply. |
| **An extrapolation is labelled as one, and withheld on short history** | `sessionLoadStatus.ts` (`growthTrend`, `trendText`) | The crossing date is a least-squares line over the last 7 COMPLETE UTC days, and the sentence names the method and the dates. It is withheld, with the reason, when fewer than 7 complete days are recorded or any machine began recording inside the window (its arrival would read as growth). Days before recording began hold only backfilled runs and are not drawn — not drawn as zeros. | R6's dash rule covers a value nobody fetched; a projected value is a different claim, and its honesty is in saying how it was made. |

### 3.10 The UI Bridge dashboard — recorded under §6.4

`/admin/coord/ui-bridge` (plan `2026-10-23-console-presentation-spaces`
Phase 6) composes `HealthStrip`, `CollapsiblePanel`, `StatCluster`,
`ShareList`, `FilterTabs`, `RecordList`/`RecordRow`/`RecordDetail`,
`StatusBadge`, `RowTime`, `RefreshButton` and `BackendErrorMessage`, with the
presentation primitives over them (`Caption`, `Provenance`, `RedactedText`,
`MachineName`, `OperatorOnly`), and registers four palettes in
`CONSOLE_PALETTES` — an action's declared effect, a page-health result, an
occlusion verdict and an app's cross-registry presence, each in its own
`*Status.ts` module under `ui-bridge/_lib/`. It adds no primitive. Ten things
are recorded rather than shipped silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **Declared classes are calm; only the undeclared is amber** | `ui-bridge/_lib/componentEffectStatus.ts` | `read`, `write` and `destructive` render on `INERT` and differ in their words; an action that declares NO effect is `undeclared` on `UNKNOWN_AMBER`, counted on the strip, filterable, and never shown as a read (served policy `testing` `an-actions-safety-class-is-declared-not-re-derived`). Nothing the runner sends is dropped from that count: an entry in a component's `actions` that is not an action object counts as undeclared, and a component entry that is not an object, or whose `actions` is not an array, is unreadable — so every count is a floor (`≥N` on the strip) and the strip cannot say every action declares its effect. | R3 says colour encodes who must act. This records the consequence for a safety class: a declared `destructive` is a fact about the control, not an alarm, and painting it red would spend red on a word. The one thing nobody can act on without its author is the missing declaration — R3's ignorance floor. |
| **A panel-level UNKNOWN that names the producer's build** | `ui-bridge/_lib/relaySource.ts`, `_components/SourceUnknown.tsx` | A panel whose read did not answer renders the UNKNOWN badge on `UNKNOWN_AMBER` and ONE sentence: not carried by this runner's relay (naming the runner build read from its own `/health`, and whether any build carries the route yet), withheld by the project's egress switch (the runner's own sentence), or the relay's reason with the request id on a raw-id line (R5). Two reads failing alike say it once. | R6 covers a count (`–`); §3.5 and §3.6 cover a field. This is the panel-level form, and its sentence has to tell the reader what would change the answer — "rebuild this runner" for an old build, "not served by any build yet" for a route no allowlist carries. |
| **A list says whose entries it holds, in the producer's own words — and UNKNOWN when the producer is silent** | `ui-bridge/_lib/componentEffectStatus.ts` (`readWrapperDisclosure`, `wrapperDisclosureText`), `_components/ComponentActionsPanel.tsx` (`WrapperDisclosureLine`) | Over the relay the component list is the runner's own registry. The runner says so in `data.wrapperComponents` (`withheld`), and the panel prints that beside the counts with a provenance chip, so wrapper apps are never implied to have been asked. `included` is worded as the merge it is. An absent field (an older build) or any other value is UNKNOWN: amber, the chip's time UNKNOWN, the value it sent never quoted, and never worded as either answer. | R6 covers a count that was not fetched, and the panel-level UNKNOWN above covers a read that failed. This is a read that SUCCEEDED but whose statement of its own source is missing or unreadable: the figures stand, and the claim about where they came from does not. |
| **A reading no relay can serve yet is a standing UNKNOWN, and nothing is asked** | `ui-bridge/_lib/occlusionStatus.ts` (`OCCLUSION_NOT_RELAYED`), `ui-bridge/_lib/useUiBridgeDashboard.ts` (`occlusionReadOf`), `ui-bridge/_lib/relayReads.ts` (`isRelayed`), `_components/PageHealthPanel.tsx` | The occlusion row has no source the relay serves: page health's report carries no `occlusionDataObserved`, and the only route that does (`POST /ui-bridge/control/visibility`) is on no runner's allow-list. While the route's carriage is `never` the page does not ask for it. Once page health is run the row reads UNKNOWN — "the visibility sweep is not available over the relay yet", and that unknown is not clear — with its provenance (the sweep as source, the time UNKNOWN), and no answer from any runner, to any route, can turn it into a verdict; a page-health body that happens to carry the field is never read. The strip names it, so it stays amber after a run. | The panel-level UNKNOWN above describes a read that was asked and did not answer, and it names the runner's build. This row's read is not asked, so no build, 403 or timeout is involved and none can change it. Flipping the carriage to `dashboard` — in the same change as the runner's handler review, egress gate and allow-list entry (coord finding `99796499`, plan `2026-10-23-console-presentation-spaces` Phase 6 amendment 2026-10-24) — is what makes the page ask; `page.sweepRelayed.test.tsx` pins what it then does. |
| **On-demand reads behind navigation-only buttons** | `_components/LiveSnapshotPanel.tsx`, `_components/PageHealthPanel.tsx` | A read that drives the runner's live window (the snapshot and page health) runs only from its own outline `size="sm"` button, carrying `NAVIGATION_ONLY_PROPS`, and only for the runner it was asked for; until then the panel says it has not run and why. Switching runners ends the request (`ui-bridge/_lib/useOnDemandRequest.ts`): coming back to a runner shows its panels as not run, neither re-running the read (its query is `staleTime: 0`, so re-enabling it would) nor showing the earlier answer as this visit's. The occlusion sweep would be one of them, but no relay carries it, so it is not asked at all (the row above). | `RefreshButton` re-reads what a page already holds. These are first reads with a cost on the producer, so they are never fired implicitly — and they stay live in presentation mode because pressing one changes no setting, session, file or app state. The navigation-only mark is a claim, so the claim is stated exactly: page health always, and the snapshot when nothing is registered yet, make the runner re-read its window's elements, which rebuilds the webview's in-memory discovery cache from the live page; each button's `title` says that rather than "nothing changes". |
| **An occupancy heatmap** | `_components/PageHealthPanel.tsx` (`Heatmap`) | The runner's 20×20 `#`/`.` grid as 0.5 rem cells — `bg-foreground/50` where an element sits, `bg-card` where none does, 1 px `bg-border` gaps — `role="img"`, its label stating how many cells are filled. | No primitive draws a grid. It is neutral by construction — a measurement of the whole screen, never an attention hue — the same rule `ShareBar` holds. It moves to `console/` when a second surface needs it. |
| **A free-text field that only changes the view** | `_components/SpecGraphPanel.tsx` | The app-id field (the registries' ids as a `datalist`) carries `NAVIGATION_ONLY_PROPS` and sits inside `OperatorOnly`; the placeholder shows the app being displayed through `RedactedText`. | The marker is true — typing changes only what is shown — but the field's VALUE is free text that may name another client (D3.3), so while presenting the page shows the redacted name instead of the input. |
| **A reason that quotes the outside world is the operator's** | `ui-bridge/_lib/relaySource.ts` (`quotes`, `issueStatusWord`, `noRunnerReason`), `_components/SourceUnknown.tsx` (`withheldStatus`) | A failed read's cause QUOTES on every arm but one — a stale pairing's device id, the runner's own refusal (its `app-not-found` names the app id typed), a transport error's request path, a status detail the page has never seen; only the relay's "runner not connected" is explained in fixed sentences. A quoting reason, and the page's own sentence that quotes a typed id ("not a valid app id"), renders through `RedactedText` bound to NO repository: verbatim for the operator, always withheld while presenting in favour of `Reason · … · <status word>`, the UNKNOWN badge kept. While presenting, a no-runner reason is the target's fixed phrase, never the dispatch refusal's sentence, which names the runner the operator picked; and the web backend's own refusal (`BackendErrorMessage`) is `OperatorOnly`, as is a failed read's request id line (`SourceUnknown`): the relay mints it as a UUID, an internal identifier the lens never shows. | D3.3 is written for titles and names. Error text is where a device id or a client's name reaches a lens page without anyone deciding to show it, so the rule is applied there as an allow-list of the one fixed arm — a new or reworded failure fails closed. No repository can clear a quoting reason: what it quotes is not the subject's own text (a reason about the runner's own app can still name a device). |
| **A total over a source that did not answer is a floor** | `ui-bridge/_lib/appRegistryStatus.ts` (`appTotalOf`) | The app total across the web and runner registries is exact only when both answered; with one unread it is `≥N` — the spelling `ci/_lib/ciDashboardStatus.ts` uses for its refused-job floor — titled with the registry that was not read; a floor of zero, or neither registry answering, is `–`. The strip, the panel's counts and its collapsed summary read the same total. | R6 covers a count that was not fetched (`–`). This is a count that WAS fetched from one of its two sources: neither `0` nor the answered side's count is true of it, and while no relay carries the runner's own app list, it is a floor on every runner (and while presenting neither registry is read — the next row — so it is `–`). |
| **A read that is not partitioned by project is made only for staff, and never while presenting** | `ui-bridge/_lib/useUiBridgeDashboard.ts` (`webRegistryAccessOf`, `useFleetAppsRead`, `useRunnerAppListRead`, `appRegistryReadsOf`), `ui-bridge/_lib/appRegistryStatus.ts` (`RegistryRead`, `WEB_REGISTRY_NOT_IN_LENS`, `WEB_REGISTRY_STAFF_ONLY`, `RUNNER_APP_LIST_NOT_IN_LENS`) | The web's `GET /api/v1/fleet/apps` returns every row of `project.apps` to an active platform admin and refuses anyone else 403 (`require_admin`), and a runner on the shared database lists that same table from its own `GET /apps`. A menu entry cannot keep a viewer from the web read — any signed-in member can open the URL, and the leaf's `coordAdminOnly` (`coordNavModel.ts`) only decides who the menu offers the page to — so the page decides it in one place (`webRegistryAccessOf`): staff only (`is_superuser`, the population the route admits; anyone else would only be refused), and nobody while presenting. A viewer who is not staff reads the web half as a `not-read` UNKNOWN that says why. While presenting, neither query is active (the web read has no function, `skipToken`; the runner list's hook is handed no device), and Refresh re-reads only active queries — which is also what leaves unasked the runner list an operator-mode render already ran, cached with its function and watched by nothing. Each half is a `not-read` read the panel renders as UNKNOWN with its reason in plain words; a value already in the cache is not shown either. | D3.4 says a lens page fetches only the acting organisation's data; it does not say what a page shows for a read it declines. Hiding the panel would hide the reason, and showing an operator-mode value already read would be the same leak one step later, so the half reads UNKNOWN and says why. |

While presenting, every panel is held open (`CollapsiblePanel` `forceOpen`): a
collapsed section would hide its caption and figures from the audience. Each
panel's title is read from its caption entry, so the console header and the
presentation headline cannot name a section two ways. The strip's figures carry
their provenance too: while presenting, one `Provenance` chip per read behind
them — the component registry, the runner's health, and the two app registries
— sits on the line under the strip, beside the runner it reads.


### 3.11 The Dev Ops presentation layer — recorded under §6.4

`/admin/coord/devops` in presentation mode (plan
`2026-10-23-console-presentation-spaces` Phase 7) is rendered through the
presentation lens end to end — the same route and reads,
captions on, provenance on, density down, write controls unmounted, machines
aliased, free text redacted. It composes the lens's primitives
(`components/presentation/`: `Caption`, `Provenance`, `OperatorOnly`,
`RedactedText`, `MachineName` / `useMachineAliaser`) and the console's, and it
added two primitives to the lens — `HeadlineFigures` and `SectionCaption` —
recorded in the first two rows below; the lens itself is §6.5. The page renders
in presentation mode because it is registered in `PRESENTATION_READY_ROUTES`
(`presentationReadiness.ts`) on the strength of `page.presentation.test.tsx`,
the run-proven page test §6.5 describes. **Operator mode is unchanged**: every pattern below renders nothing,
or the original, outside presentation mode, so §5's budgets are still measured
on the operator console. Eight things are recorded rather than shipped
silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **A headline strip, in presentation mode only** | `presentation/HeadlineFigures.tsx`; the page's is `operations/DevOpsHeadlineStrip.tsx` over `operations/devOpsHeadline.ts` | A few figures an evaluator can say aloud ("2 of 3 machines healthy"), above the health strip, at screen-share size. Each is KNOWN — value, a detail line naming what the rest are, and its provenance — or UNKNOWN on `UNKNOWN_AMBER` with the reason, never `0`, a dash or a blank. Each figure decides alone, because its read can fail alone. The derivations are pure and tested without a DOM. | R1 says a page opens with its health strip; this sits above it only while presenting, so R1 still holds for the operator. The strip's mono badge cluster is built for the tenth read of the page today; an evaluator reads it once. |
| **A section caption with one provenance chip per read** | `presentation/SectionCaption.tsx` | A section opens with its registry caption and one `Provenance` chip per read its numbers come from, stated once for the section the way a column header serves a column — the machine list names six (runner inventory, coord fleet health, CI-runner mirror, disk telemetry, drain states, device status). | R9 keeps chrome off the operator surface, and R2 dates each record; neither says how a whole section states where its numbers came from. A chip per cell would be a dozen identical chips (served policy `ux-priorities` `repeated-chrome-must-earn-its-space-by-varying`). |
| **A read is dated only by its answers** | `useFleetHealth`, `useFleetDispatchRoles`, `useFleetDrain` (`asOfMs`, through `operations/servedAsOf.ts`), `FleetOverview`'s inventory as-of, `devOpsHeadline.ts` `latestInstant` | A body that states when it was true is dated by that (coord's `as_of` on fleet health, drain and dispatch roles, validated and never later than the answer's arrival; the CI mirror's `as_of`; fault-to-visibility's `computed_at`); a body with no timestamp is dated when the answer arrived; a body that dates its rows (disk telemetry's `observed_at`, device status's `updated_at`) is dated by its newest row. Each is stamped on an answer ONLY. A read that has not answered is dated UNKNOWN; so is one whose latest poll failed where its section shows nothing from it (drain, roles, the audit feed), while a section that keeps showing the last answer's rows, and says they are last-known, keeps that answer's date (fleet health, resource samples, worktree slots). A headline figure is UNKNOWN on a failed latest poll either way. A refresh loop's own clock is never an as-of: it ticks when the read fails. | R2's time slot dates one record. A section-level as-of is new, and the shape that made it necessary — an "updated 2 s ago" over a read that just failed — is the `silent-empty-is-unknown` failure in a time slot. |
| **Positions, not names, for what can name a machine** | `MachineCard` ("Runner 2", "Volume 1"), `FleetResourceStrip` ("instance 1", and the disk figure without its mount), `CiRunPanel` ("service 1"), `CiRunnerBadge` (routing labels and a count) | Machines read as their session alias everywhere (`MachineName` / `useMachineAliaser`, fed every identifier the row holds so one machine is one letter on every panel). What is not a machine but can name one — a runner's name, a lane instance's `<runner>/<repo>`, a volume's mount or label, a per-machine runner label — reads as its position or a count, or is left out where the figure beside it already says what the reader needs (a sample's disk mount beside its free-space figure). | D3.3 lists machine identities and free text; a mount point or a label someone typed is neither, and can carry a person's or a client's name. Over-redaction costs a position, never a fact. |
| **A failed read says it failed, in fixed words** | `operations/presentedFailure.ts` | For the operator, a panel shows its read's own failure text. In presentation mode the panel still says the read failed — the UNKNOWN floor holds — and the reason is replaced by fixed words, because `GET <url> failed …`, coord's error body and coord's own `reason` can carry a resource key or name a machine. Applied ONCE by whoever owns the read: the page for the reads it owns, a panel for its own. | R6's dash rule and R3's ignorance floor say what to render for an unmeasured value; neither says what to do with an error string nobody wrote for an outsider. |
| **One shell, one guard per hidden thing** | `DeviceDrainControl.tsx` | The drain block is the same shell in both modes. The lever and its consent dialog are inside `OperatorOnly`, and that is the only thing that unmounts them; the target line (coord hostname, device id) has its own guard; the presented state line carries no actor and no reason; the block's testid becomes `device-drain-status`. | A component that returns a separate presented branch early leaves its `OperatorOnly` unreachable: a guard no test can turn red. One guard per hidden thing is what makes "remove it and a test goes red" true for each. |
| **An allowlist, not a blocklist, for values shown verbatim** | `OperatorAuditPanel.tsx` (`PresentedAuditRow`), `operations/auditPresentation.ts` (`VERBATIM_BLAST_KEYS`, `auditScope`) | The presented audit feed says what happened and when in fixed words. A blast-radius value is shown as it is only when its key is vouched for as coord's fixed vocabulary, a time or a number; repositories, scopes (coord's `tenant` / `repo:<owner>/<name>`), devices, tenants and people each have a redacting arm, and a key added later without one is withheld. | D3's "a blocklist alone fails open", applied to a key list: a default arm that shows every value it does not recognise shows coord's `repo:` scope — a partner's repository — the first time a kill switch is pulled on one. |
| **Coord's vocabulary stays with the operator** | `presentedAuditActionLabel` (`auditPresentation.ts`), `presentedUnknownReason` (`runnerReportStatus.ts`), the audit feed's presented nil-operator cell (`OperatorAuditPanel.tsx`), the device-status tile's connection line (`DeviceStatusTile.tsx`), the roles lane table, the Conditions panel's labels and titles (`FleetConditionsPanel.tsx` over `fleetConditions.ts`), `faultToVisibilityBadge`'s `plainKinds`; guarded by the page test's `ENGINEERING_VOCABULARY` scan | While presenting, nothing the page shows — its text behind every disclosure, every `title`, every `aria-label` — is a coord token (`closed_by_role`), an action id or family (`pr_merge.kill_switch`, `fleet.*`), a variable, a table, a route or the transport a list updates over (`WS`): each is said in words, or not said. Where the console holds a closed table — an audit action's label and family, an unknown report's reason — a value the table does not know reads in fixed words ("A recorded change", "no report arrived for this machine"), never as itself. A role lane's state, a slowest fault kind, and a condition domain or setting kind the Conditions panel has no label for are coord's own closed vocabularies, which name no machine and no person: they read as coord's word with its underscores (and, for a domain or a setting kind, its hyphens) replaced by spaces ("closed by role"). The operator keeps every token, because to the operator it is a filter term and a fact. The resource strip's hover cards, which explain each figure's formula in coord's column names, are left as evidence one hover down, and the scan does not read them. | R8 keeps internal vocabulary off a primary surface; an evaluator reads every surface as primary, and `audience_profile/external-evaluator` names "internal status words shown without translation" as something it will not tolerate. |

### 3.12 The presentation tour — recorded under §6.4

`/admin/coord/tour` and the tour bar (plan
`2026-10-23-console-presentation-spaces` D5, Phase 8) walk the lens surfaces in
presentation mode. Each stop is the surface's own route (`LENS_SURFACES`, in
that order), opened with `?present=1&tour=1`: never embedded, re-rendered or
forked. The page composes the lens's primitives (`Caption`, with the new
`untitled` option recorded below) and the console's (`Badge` on `INERT`,
`buttonVariants`); the bar lives in the lens itself
(`components/presentation/tour/`), mounted once by `PresentationLens`. The page
renders in presentation mode because it is registered in
`PRESENTATION_READY_ROUTES` on the strength of `tour/page.presentation.test.tsx`,
the run-proven page test §6.5 describes. Nine things are recorded rather than
shipped silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **Chrome the lens owns, and the height that comes with it** | `presentation/PresentationLens.tsx`, `presentation/tour/TourBar.tsx`, both lens layouts' roots | The tour bar is mounted ONCE, by `PresentationLens`, above the layout and outside its `PresentationPage` gate: a withheld stop keeps its bar, and pressing the bar never unmounts it (the toggle's rule, §6.5). It takes a row, so the lens is a column (`flex h-full flex-col`: the bar, then the layout in the space left) and a lens layout's root fills it (`h-full`). A root fixed at `h-[calc(100vh-44px)]` under a bar would overflow the shell's `overflow-hidden` `<main>` and cut the bottom off every scroll area. In operator mode the bar renders nothing and the layout fills `<main>`. | R9 governs a page's own chrome. This is chrome of the lens, shared by two trees, so it can live in neither layout. |
| **A sequence whose reach is the readiness registry** | `presentation/tour/tourModel.ts` (`tourStops`, `tourView`, `tourHref`) | The tour keeps no list of its own. Its stops are `LENS_SURFACES`, titled from the caption registry, and a stop is reachable only where `lensLinkTarget` lets its page be presented. A stop that is not stays in its place on the page and in the strip, labelled "Not yet presentable", and is never linked; previous and next skip it. A page joins the tour by itself the day its phase registers it. | `LensLink` (§6.5) withholds ONE link. A sequence also has to keep the withheld member visible in its place, or its order and count would change silently in front of the audience. |
| **Position derived, never stored** | `tourView` | The current stop is the page on screen: the path, normalised, EXACTLY a stop's route. A page below a stop's route (a detail page) is "off the tour route", because readiness is exact and that page is withheld under any bar that called it the stop. The one thing remembered is the last presentable stop shown, as the way back from off the route. | A stored position can disagree with the page under it; a derived one cannot. Served policy `ux-priorities` `a-status-signal-must-observe-the-state-it-names`, applied to "you are here". |
| **A count that names its population** | `TourBar` (`TourPosition`), `TOUR_LABELS` in `captions/tourCaptions.ts` | "Stop k of N" counts the presentable stops. While any stop is not presentable the bar says how many more there are, beside the count ("Stop 2 of 3 · 2 more are not yet presentable"), because the strip under it shows all of them. The strip carries no numbers, so no stop has two. | Served policy `ux-priorities` `a-label-names-one-referent-and-a-quantity-names-its-unit`: a bare "of 3" above a strip of five reads either way. |
| **A control with nowhere to go is disabled, and says why** | `tour/TourStepControl.tsx` | With a target, previous and next are tour links, each declaring its arrow key (`aria-keyshortcuts`). Without one, each is a DISABLED button whose accessible name begins with its visible word and says why ("Previous: this is the first stop"). It is never a dead link, and it makes no UI Bridge registration. Next at the last stop leads back to the tour's start. | R6's dash rule covers a count nobody read. This is its control form: say there is nothing there, never imply a way on. |
| **Keys that never take one the page is using** | `tour/tourKeys.ts`, `tour/useTourKeys.ts` | ArrowLeft and ArrowRight follow the previous and next LINK on screen, so a key goes exactly where the control says. They act only when nothing handled the press first, no modifier is held, it is not a repeat or a composition, and focus is not in an editable control or a composite widget (the twin's tabs move on the arrows themselves). The window listener exists only while the bar renders. | No console surface bound a global key before. |
| **Tab-scoped state, never a preference** | `tour/tourStore.ts` | "On the tour" belongs to the tab: sessionStorage mirrored in memory, every access guarded. The `?tour=1` marker every tour link carries sets it, and End tour clears it and drops the marker from the URL. It never touches localStorage, and `?present=0` turns the bar off whatever it says. | It follows the pattern of the mode store's tab half (§6.5), in a store and a sessionStorage key of its own (`qontinui.presentation-tour`), for a second fact. The viewer-convenience half is deliberately not followed: a tour is never remembered for the next tab. |
| **Two calm states, told apart in words** | `tour/_components/TourStopList.tsx`, `tour/TourProgress.tsx` | "Ready to present" is `INERT`. "Not yet presentable" is `INERT` with the dashed edge `draft` uses: provisional, not wrong. Neither is anyone's move now, so neither is red or amber. The stop on screen takes the toggle's active treatment (`bg-primary`), and a key under the list explains each state that occurs. | R3 assigns hues by whose move it is; this records that a known, self-describing state the audience is shown takes no attention hue at all. |
| **A caption whose title is already on screen** | `Caption` `untitled`; `TourStart.tsx`, `TourStopList.tsx` | The start link's text is `tour.start`'s title, and each state badge's text is its caption's title, so their sentences render `untitled` beneath them: one entry, one title on screen. A stop that is not presentable shows its page caption `brief`, because why its content matters would describe content the tour does not show (the rule `PresentationPage`'s placeholder follows). | §6.5's captions always lead with their title. A control or a badge that IS the title would repeat it. |

Every tour control that does something is navigation-only, and says so twice.
On screen it is a link that keeps the presentation, or End tour, the one
enabled button, which carries `NAVIGATION_ONLY_PROPS` and changes only what the
tab shows. To the UI Bridge it registers where it renders with one custom
action declared `effect: "read"`: a link's action follows the anchor itself,
and End tour's does what pressing it does. A previous or next with nowhere to
go does nothing: it is a disabled button that makes no registration (the row
"A control with nowhere to go is disabled, and says why"). The bar does not
repeat a stop's one sentence: the stop page renders its own `<surface>.page`
caption, and that IS the stop's sentence.

### 3.13 The session-flow console — recorded under §6.4

`/admin/coord/overlord/flow` (plan
`2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote`
Phase 4) composes `HealthStrip`, `StatCluster`, `RecordList`/`RecordRow`/
`RecordDetail`, `RowTime`, `CollapsiblePanel` and `RefreshButton`. It declares
no attention table (its rows are not classified, so `RecordRow`'s `attention`
is ABSENT, not `"none"`), and records two things rather than shipping them
silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **Metric tiles are headed `StatCluster`s, not a tile component** | `overlord/flow/page.tsx` (`MetricTile`) | Each metric (time-to-close, nudge → progress, nudge → finished, latest UNKNOWN share) is an `h2` + one `<StatCluster>` + a one-line explanation, two per row from `sm` up. Every value is one of THREE things (`overlordFlowStatus.ts`): a measured number; coord's explicit `null`, rendered as the words `no data` with a `title` saying why nothing was measurable; or unknown (field absent, read failed), rendered as `–`. | R6 says an unfetched count is `–`. This page also receives a value coord ANSWERED as not measurable (a median over no closed session, a rate over no nudge), and rendering that as `–` would call an answer unknown, while `0` would claim a measurement. A bordered tile per metric would be a new card shape (§6.4); the cluster already is the console's count vocabulary. |
| **A categorical series palette, validated, in `config/theme.ts`** | `chartCategorical` (`config/theme.ts`), used by `overlord/flow/_components/VerdictHistogramChart.tsx` | The console's first multi-series stacked chart: one bar per triage pass, three verdicts on fixed categorical slots (a slot follows the verdict, never its rank), every other verdict folded into a neutral "other", UNKNOWN in muted grey, and the full per-pass breakdown in the tooltip and an `sr-only` table. Built like §3.8's count chart otherwise. | `colors.brand.*` fails as a categorical set on the console's dark surfaces (slate blue vs muted violet: ΔE 11.9 normal, 5.9 deutan), so a chart that needs more than one identity hue needs slots that pass. The slots are identity, never severity — they are not R3 families and must not be read as such. |

### 3.14 The coordination overview's presentation layer — recorded under §6.4

`/admin/coord/home` in presentation mode (plan
`2026-10-23-console-presentation-spaces` Phase 2; the page itself is plan
`2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
Phase 4) is rendered through the presentation lens over the page's read of coord's
project state, and the reads beside it (coord's machine roster and, until
coord serves `needs_me`, the Gates and Questions pages' queue reads;
`home/_lib/homeSupplements.ts`) — captions on, provenance on, controls off,
redaction on. It composes the lens's primitives (`Caption`, `SectionCaption`,
`Provenance`, `RedactedText` / `useRedactor`, `useMachineAliaser`,
`OperatorOnly`, `LensLink`) over the console's, and adds no primitive: the
console's `RefreshButton` gained an optional `ref`; `coordHomeStatus.ts` now
keeps coord's `subject.kind` on a degradation, exports `isWatcherSource`, and
exports two own-property predicates over its tables (`isKnownDecisionDomain`,
`isLabelledSource`) and its not-a-project-state sentence; the lens's
descriptor gained `notApplicable` (§6.5, "Redaction on"); and the page's
captions and its readiness entry are its own. The page renders in
presentation mode because it is
registered in `PRESENTATION_READY_ROUTES` (`presentationReadiness.ts`) on the
strength of `home/page.presentation.test.tsx`, the run-proven page test §6.5
describes, over fixtures that feed every free-text carrier the page can show
in every state its regions render — the decision kinds coord's `needs_me` work
(qontinui-coord#3053 and its successor) parses out of question text among them,
one with a client's name and one with none.
**Operator mode is unchanged**: every pattern below renders nothing, or the
original, outside presentation mode. Twelve things are recorded rather than
shipped silently:

| Pattern | Where | What it is | Why it is not an existing rule |
|---|---|---|---|
| **One provenance line for the page; a region's chip only for a different read** | `home/page.tsx`, `home/_components/HomeLens.tsx` (`PageProvenance`, `RegionCaption`), `home/_lib/homeLens.ts` (`regionSources`), `home/_lib/homeSupplements.ts` (`supplementSource`) | Every region renders coord's project state, so its source and time are said ONCE, on a provenance line under the page caption — "coord's project state", dated by the answer's `generated_at` (UNKNOWN on `UNKNOWN_AMBER` with nothing read) — rather than on each region. A region shows its title and ONE sentence (`Caption` `brief`); the page caption alone keeps its why-it-matters line. A region carries a chip of its own only for figures read from somewhere else, each with that read's source and time: the strip's machine figures and Degrading's machine line ("coord's machine health", dated by the roster's `as_of`) and, while coord serves no `needs_me` block, Needs you's two counts ("coord's open gates", "coord's pending questions") — on the strip too when its needs-you figure is theirs. A kept supplementary read names itself ", last read". After a failed refresh the kept-reading notice carries the page's chip, and the page line yields to it. The strip's caption sits just before the strip; every other region's caption opens its section. | §3.11 records a section caption with one chip per READ behind the section; here one read is behind six regions, and repeating it on each was chrome that could not vary (`repeated-chrome-must-earn-its-space-by-varying`) — while a figure from another read must still say so, or it would be dated by a read it did not come from. |
| **A section not built yet is left out of the presented page** | `HomeSections.tsx` (`CorrectSection`, `NeedsYouSection`, `DoesNotKnowSection`) | While presenting, Correct? renders nothing when no source measures it (`verification_metrics_door_absent`) or coord has not built the block; a `not_implemented` needs block shows only the counts that stand in for it, with no "not built yet" header or sentence; and does-not-know sources coord has not built are not listed — one line counts them ("2 further sources are not built yet, so this view does not show them."), so the header's "N of M sources not read" still adds up. The strip follows the sections (`coordHomeStatus.ts` `deriveHomeStrip`, `correctnessLeftOut` and `presenting`): its "Not read" line names neither a left-out Correct? nor an unbuilt needs block — nor does the sentence saying where the stand-in counts come from, which names only their source — it says "Correctness is not measured yet." in one plain line, and it speaks of the stand-in counts in the presented section's words ("coord's lists of open approvals and pending agent questions"), never naming the Gates or Questions page; it still floors at amber. A block coord could not read, or gave no reading of, still shows as UNKNOWN. The operator view keeps all of it, so the gap stays visible there. The shell's readiness gate is per page, so this is the page's own decision, per section. | `audience_profile/external-evaluator` "Is it real?" and its no-"ignore that panel" test: an unbuilt section shown to an evaluator is a promise, not a reading, while an unread one is evidence the instrument is real. |
| **A withheld repository is a stable alias** | `homeLens.ts` (`RepositoryAliases`, `repositoryAliasDescriptor`), `HomeSections.tsx` (`RepoGroupRow`, `OnTrackSection`) | A repository group whose name the scope does not clear reads "Repository A", "Repository B" — on its row and in its detail ("Work units that name Repository A.") — the way a machine is "Machine A". Letters go to withheld repositories only, in first-seen order, are never reissued, and follow the repository (not its position) across polls for as long as the region is mounted; the key lives in memory only. A cleared repository shows its name. | §6.5's machine aliases are session-wide and keyed by device id and hostname; a repository needs only to be told apart from the other withheld ones on this page, and its descriptor alone read "Repository" twice — one label for two referents. |
| **A kept reading names itself, led by the failure** | `HomeLens.tsx` (`KeptReadingNotice`), `homeLens.ts` (`PROJECT_STATE_KEPT_SOURCE`, `keptReadingText`) | After a failed refresh the page keeps the last answer (#1999's R6 stale arm). While presenting, a notice leads the page — the latest read failed, why (the next row), and what below comes from it is its last reading, not a current one — and carries the page's one chip, "coord's project state, last read", still dated by that answer, never by now; no region repeats it. It covers only what is a kept reading: a figure read beside the project state keeps its own chip, and the notice says that read is current, a last reading too (its chip then says ", last read"), or not read (`keptReadingText`). The strip keeps its own "at the last good read" headline, and its "Last failure" says the same why. | §6.5's "A kept reading" says where the dot goes for a panel and for a list of rows; this is the same rule for a whole page whose regions are one reading. |
| **A failed read says why in the page's own words, or withholds why** | `useProjectState.ts` (`presentableError`), `homeLens.ts` (`presentableProjectStateFailure`, `presentedHomeFailure`) | A failure is recorded in two registers in one state: its own words for the operator, and words that quote nothing. The second is decided from the failure's STRUCTURE, never its text — the 404/405/501 arm (the page's "does not serve the project-state door yet"), the `route_disabled` arm, coord's read deadline (its budget; not the loader coord names), the web proxy's own `coord_unreachable` and `coord_timeout` refusal envelopes (fixed words, never the refusal's rendered sentence with its discriminator token), and an answer that is no project state. Every other failure — a status the page does not explain, an unstructured body, a network error — reads "reason withheld in presentation mode". One decision serves the unread line, the strip's "Last failure" and the kept-reading notice. | §3.10's "a reason that quotes the outside world" is the same allow-list for a relay's reasons; here it is a single read's, and the arm a presentation meets before the door's coord half lands is one of the explained ones — "unknown, and here is why" is the evaluator's evidence that the instrument is real. |
| **Every free-text carrier, and what its descriptor is built from** | `HomeSections.tsx`; `homeLens.ts` (`needsDescriptor`, `degradationDescriptor`, `subjectDescriptor`, `namedUnitDescriptor`, `reasonDescriptor`, `TENANT_DESCRIPTOR`, `REPOSITORY_DESCRIPTOR`, `INITIATIVE_ITEM_DESCRIPTOR`, `INITIATIVE_KEYS_DESCRIPTOR`) | A question's or an approval's text, its recommendation, consequence and options, and the work unit it blocks; a degradation's headline and subject; a repository; a unit's title (or its slug); an initiative's items and the keys of items it does not list; coord's own reasons (an exclusion, why no initiative is live — an initiative coord could not parse reads one fixed sentence instead, "The current initiative's document could not be read as written, so its status and scope are not shown."); and the tenant's name — each renders through `RedactedText`, or `useRedactor` for a row's reason slot and a `title`, with a descriptor built from the item's own fixed fields: what it is, its area (a degradation's plane), the word its badge shows, its age — the referent's own, so the unit a decision blocks reads "Work unit · area unknown · blocked · age unknown", never the question's status word or asked-at age — and without a field its kind does not have (`notApplicable`): the tenant reads "Project", a withheld repository its alias ("Repository A", the row below), an initiative item "Initiative item · in scope", a reason "Reason · excluded · 2m ago". Only a degradation whose subject coord names as a repository, a repository group and a named unit are bound to a repository; everything else belongs to none — a service or alert key named like a first-party repository included — so it is a descriptor while presenting however harmless it reads. | §6.5's redaction bullet names a plan, PR, session or finding title; this page's carriers are its own, and each descriptor's fields are ones its row already shows. |
| **A value read against the page's own table shows only when the table names it** | `homeLens.ts` (`presentedDecisionDomains`, `presentedSourceLabel`, `presentedPlaneWords`, `presentedPlaneName`, `presentedPlaneLabel`), `HomeLens.tsx` (`usePlaneLabel`, `usePlaneWords`), `coordHomeStatus.ts` (`isKnownDecisionDomain`, `isLabelledSource`, `isKnownPlane`) | Needs-you's "By kind of decision" line shows coord's `needs_me.by_domain` keys through the page's label table. Coord's `needs_me` work (qontinui-coord#3053 and its successor) fills its own buckets (`operator_gate`, `unscanned`, `unclassified`), but every other key is the domain it parsed out of an escalation question's TEXT, which that work calls caller-controlled — a substring of a question the page withholds everywhere else. While presenting, a key shows only when the table names it; every other key is folded into ONE entry in fixed words, last, with their summed count ("kinds not named here 2"), so the questions stay counted and none of their words is on screen. A does-not-know source the table does not label reads "A source this view has no name for" rather than coord's identifier with its underscores spaced, its row and figures kept. A degradation's area the table does not name reads "area withheld" on its row, on its watcher line and in its descriptor; in a list of areas — the gap sentence and a watcher source's label — such areas are COUNTED rather than folded into one ("the reading for 1 area not named here could not be taken", "readings for 2 areas not named here could not be taken", "not every watcher is fresh (merge train, and 2 areas not named here)", "Watcher feeding runner and 1 area not named here"), so the sentence never says less is missing than is. Its `data-plane` is dropped while presenting, decided by the table rather than by the rendered words, so the operator keeps the key even of a plane coord names `withheld`; the operator keeps coord's key with its underscores spaced. All three are own-property checks, so a key spelled `constructor` is not one the table names. | §3.11 words a value a console table does not know in fixed words; this applies the rule to a COUNT keyed by caller text, where the folded entry has to keep the count true. |
| **A unit's repositories are bounded, or the unit is withheld** | `homeLens.ts` (`namedUnitRepos`) | Coord names a unit under each repository group it belongs to, but not its whole repository list. A unit's class is its own, so it sits in the same named list of every group it belongs to — named there unless that list was cut short. Its repositories are therefore the groups that name it plus, failing closed, every group whose list of the same kind was cut short (`omitted` above zero, or unknown) or not served. A unit under the unattributed group, or under a group whose repository is unknown, is withheld. A unit is linked only when its name and its slug both clear the scope, because its URL carries its slug and a slug can name a client under a title that does not. A unit that fails is not even handed to `LensLink`, whose plain-text arm would turn into an anchor carrying the slug the day the work-unit page is registered; the page tests pin that by asking for neither an anchor nor a `data-lens-link` (which `LensLink` puts on both of its arms, `"linked"` on the anchor), and by scanning every attribute for the slug. Coord groups units by their `metadata.repos`, which names repositories bare today, with no owner to vouch for them, so every unit title reads as its descriptor until an owner is served — the same answer the digital twin's plan list gives over the same field. | D3.3 says text that belongs to any repository off the first-party list is withheld; this is how a list that names a unit once per group is made to say every group the unit may span. |
| **A subject by what coord says it is** | `HomeLens.tsx` (`useSubjectText`), `coordHomeStatus.ts` (`DegradationView.subjectKind`) | A degradation subject coord names as a `device` reads as its session alias (`Machine A`, one letter however many rows name it); a `repo` reads as its name when the scope clears it; a `service` or an alert `key` reads as its descriptor. The parser now keeps coord's `subject.kind`, which it used to drop. | §3.11 aliases a machine from the identifiers a row holds; here the subject's declared kind decides which of three rules applies. |
| **Raw lines, raw-id titles and quoted errors stay with the operator** | `HomeSections.tsx` (each `RecordDetail` `raw`, `NotRead`, the strip's tenant, the gap sentence, the watcher lines, the source labels, the `RecordList` keys) | R8 puts raw ids on an expanded detail's last line; while presenting that line is not rendered at all (the slot stays empty, so no wrapper is left behind), and neither is a `title` holding a raw id or coord's own words: the tenant's UUID, coord's reason for an incomplete view, watcher names, a source's id. A block coord could not read still says so, and that coord reported an error, with the chain withheld; a source row with an error says the same instead of pointing at a last line that is not there. List rows are keyed while presenting by an alias of the operator's key (`homeLens.ts` `RowKeyAliases`, `HomeLens.tsx` `useRowKey`), so `data-row-key` carries no question, gate, device or source id and no repository's name — and not by position: the key is also what expansion compares, and a positional key would keep "row 2" open when a poll removes the row above it, silently showing another record's detail. The alias is of the WHOLE operator key, index suffix included, so a presented row opens, stays open and collapses exactly when the operator's would. | R8 decides what a primary surface shows; an evaluator reads every line, the last one included. §3.10's "a reason that quotes the outside world" covers a failed read's reason, not R8's raw line. |
| **Shapes, not words, for a tenant's typed values** | `homeLens.ts` (`presentedInitiativeStatus`, `presentedInitiativeDate`, `presentedPlanPhase`) | The initiative's frontmatter is typed by hand: while presenting, its status reads `live` or `not live` (the one distinction coord's alignment makes), a start or end date shows only as an ISO date and otherwise reads `withheld`, and the plan phase a decision blocks shows only as a number. A status or date coord serves as null, absent or blank reads `unknown` in both modes: `withheld` would say a value exists, and nothing was typed. | §3.11's allowlist governs which audit KEYS show their values; this is the same allowlist for values a tenant typed. |
| **The refresh declares its effect; answering is the operator's** | `HomeLens.tsx` (`HomeRefreshButton`), `console/RefreshButton.tsx` (`ref`) | The page's one control besides its disclosures is registered with the UI Bridge on the button itself (`coord-home.refresh`), its one custom action, `refresh`, declared `read`, so an automated walk sees what pressing it does; it stays live while presenting, navigation-only by construction. Answering a decision is a write on another page, so the "Answer it" link is `OperatorOnly`; every other link is a `LensLink`, and an ACTION whose page cannot be presented — a degradation's "Open pipeline ↗", the unserved line's "open Questions", the unread line's pointer at Questions and Gates — is left out while presenting rather than shown as link-shaped text that opens nothing (`useLinkOpens`, `LensLink`'s own decision; it returns by itself the day its page is registered). "Correct?" has no write control in either mode: one read-only row, whose toggle is a disclosure. | §6.5 says a lens page's UI Bridge registrations declare an effect; this page had none, and the refresh is the control an automated tour would press. |

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
| **amber** | waiting on something else and it will clear itself — **or** we do not know what this is | `bg-amber-500/15 text-amber-200 border-amber-500/30` | a kind whose attention is `"waiting"` — and every one of them |
| everything else | nobody is blocked **right now**: in flight, terminal, or owed-but-not-blocking | yellow / purple / blue / green / muted / dashed | a kind whose attention is `"none"` |

Three clauses in that table are load-bearing and each is spelled out in
[§2 R3](#r3--colour-encodes-who-must-act):

- **amber's "or we do not know"** — the ignorance floor (`attentionOf`'s
  `"waiting"` default, `planStatus`'s `unknown`). Amber on an
  unknown row is a statement about our knowledge, not a promise about the row.
- **"right now"** in the calm row — calm does **not** mean nothing is owed. A
  state that wants a real human decision while blocking nobody and decaying
  nothing is calm; `questionStatus`'s `gap-handled` is the worked example.
- **"owed-but-not-blocking"** — and when a calm kind *is* owed something, the
  ask is rendered **in words in the row detail**, never by borrowing amber.
  Borrowing amber for it spends the credibility of the one hue whose whole
  value is that it means what it says.

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

The contract a new surface must honour, in four parts:

1. **The kind→attention table is authored and audited.** One row per kind, with a
   stated reason. Not derived, not inferred from the label.
2. **The palette is keyed off it.** A kind's badge class is chosen by looking up
   its attention, never by re-reading the kind name.
3. **A unit test asserts the two agree.** Not a convention — an assertion, so the
   next kind added cannot silently pick the wrong colour.
4. **A calm kind that is nonetheless OWED something says so in words.** The
   audit table records that it is `"none"` and *why*; the row detail carries
   the ask. `questionStatus.ts`'s `gap-handled` is the worked example and
   `<GapRow>`'s `coord-gap-review-owed` line is where it is rendered. This part
   exists because (1)–(3) are all satisfiable by a kind that is silently
   under-served: `paletteDisagreements` proves the hue matches the declared
   attention, and can never prove the declared attention was the right one.
   That is the gap both Wave-1 mis-filings fell through.

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

**…and it enrols in the registry: add one row to `CONSOLE_PALETTES` in
`console/consoleSurfaces.ts`**, naming the module that DECLARES the table.
This is not optional politeness. `consoleSurfaces.test.ts` scans the console's
source for attention tables and asserts set-equality against that registry in
both directions, so a surface that skips the row fails CI, and a row pointing
at a module that was renamed fails too. The registry used to live inside
`attention.test.ts` and enrolment used to be manual — which is how seven
palettes across Waves 1 and 2 came to be audited only beside themselves.

**Nothing but `console/statusRow.tsx` may spell an R3 literal.** The same file
carries a second scan: within `components/console/`, `components/admin/coord/`,
`components/operations/` and `app/(app)/admin/coord/`, no module may contain a
string byte-equal to — or an *opacity-drifted near-miss of* — `AUTHOR_RED`,
`WAITING_AMBER` or `UNKNOWN_AMBER`. Import them. §4.1 always said this; the
scan is what makes it true, and it found ten violations the first time it ran,
one of them a genuine `/30`-against-`/35` drift. The near-miss half matters
most for the two ambers, which differ *only* in a background opacity while
saying different things — so a hand-spelled amber is a coin flip between two
claims, not mere duplication.

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
| **Lint** — the shapes that must not come back | `frontend/eslint-rules/no-fat-record-card.mjs` (+ its `.test.mjs` fixtures) | ESLint, via the local `@qontinui-web` plugin. Bans a bordered, padded card rendered **per record** under `admin/coord/**` — R2's opposite | **Yes** — `npm run lint --max-warnings 0` |

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

### 6.5 Presentation density — the presentation lens, recorded under §6.4

Plan `2026-10-23-console-presentation-spaces` lets the operator console double as
a live showcase for an external evaluator (`audience_profile/external-evaluator`).
It does so as a **lens**, never a fork: the same routes and the same data hooks,
rendered with captions on, provenance on, density down, controls off and redaction
on. The lens is an **authorized extension of this guide**: in presentation mode,
and only there, a lens page may depart from R1, R9 and §5 in the ways this section
lists. In operator mode every rule above holds unchanged. The pieces live in
`frontend/src/components/presentation/` (one barrel), composing `components/console/`.

**Entry, and where it applies.**

- The mode is per browser, never per tenant: `?present=1|0` on the URL wins, then
  the tab's last choice, then the viewer's remembered setting (localStorage, a
  convenience — a tab that opens presenting on it keeps presenting), then off.
  The `PresentationModeToggle` flips it; while presenting it is the
  "Presentation mode" chip. It lives in the lens layout's own chrome — the
  console's header, the digital twin's lens bar — OUTSIDE the page gate below,
  never in a page body, which its own press would unmount. A mode not yet
  resolved (a server or hydration render) counts as presenting, so every guard
  fails closed.
- A link to another lens page carries the presentation while presenting
  (`usePresentationHref`: `?present=1` on its URL), so one opened in a new tab —
  which starts with no tab choice of its own — still presents. The page check
  below fails a lens link that does not (`presentation-dropping-link`), so a page
  added later cannot forget it. A link whose destination may not be
  presentable goes through `LensLink` (its decision is `lensLinkTarget`, both in
  the presentation barrel): while presenting, a destination outside the lens
  trees, or a lens page not yet in `PRESENTATION_READY_ROUTES`, renders as plain
  text (`data-lens-link="unlinked"`) — never a click that leaves the lens or
  lands on "Shown in the operator view only" — and the link returns by itself
  the day its destination is registered.
- The tour (`/admin/coord/tour`, §3.12) walks the lens surfaces while
  presenting. Its bar is the lens's own chrome, mounted once by
  `PresentationLens` outside the page gate, and it renders only while
  presenting on the tour (`?tour=1`, then the tab's state). Operator mode and
  `?present=0` never show it. Because the bar takes a row, the lens owns the
  height: a lens layout's root fills the lens (`h-full`) instead of fixing its
  own.
- It applies on the lens trees (`LENS_TREES`: `/admin/coord`, `/digital-twin`) and
  to the app shell beside them (`PresentationShell`, in `app/(app)/layout.tsx`):
  while presenting, the sidebar names only the active project, aliases the runner,
  hides the account menu, search and project creation, and offers only entries
  inside a lens tree. Elsewhere there is no presentation mode at all.
- **A lens page is withheld until it is proven safe.** `PresentationPage`, around
  every lens layout's page body, renders the page in presentation mode only when
  its route is in `PRESENTATION_READY_ROUTES`; every other lens page renders its
  surface caption and "Shown in the operator view only" instead — over-withholding
  costs a placeholder, a page shown before it is safe costs a write control in
  front of a client. Register a page **in the same PR** as its page test (below).
  Whether that test proves the page is read from the **run**, not from its source
  (`src/test/readinessEvidence.ts`). The page check records, on the test that is
  running, which render it read; whether the route's own page component was
  mounted there under a presenting lens, rendering something and all of it inside
  the element the check read; whether check (b) read that render's own UI Bridge
  registry; and what it found. The registry's own test arms the requirement by a
  declaration on itself, made when its file is collected, so it holds wherever
  that file lives and a skip of that test (`it.skip`, a `describe.skip` around
  it) turns nothing off, and a run it armed (`npm run test`, so CI) fails unless
  that same run ran the proof, and in it a
  test that **finished passed** — not skipped at run time from wherever, not
  failed, not concurrent — holds a render whose last such check found no
  violation through that registry. A render whose last check found a violation,
  in any test of the proof however it ended, refuses the route: the run's own
  evidence outweighs a clean check elsewhere (a check polled with `waitFor`
  counts by its last attempt). A proof filtered out of that run is UNKNOWN,
  which fails it; a run the test did not arm (one that leaves it out by file, or
  a `-t` filter that skips it) claims nothing. The run's log names each route it
  proved and the test that proved it.
  Beyond its reach: a proof that writes the record itself, or mocks or edits the
  checker, its reporter, the registry's test (deleting its arming test
  included), `setup.ts` or the vitest config; a
  proof that mocks a module the page renders — a child component (a
  `DeviceDrainControl` stubbed to render nothing), a lens primitive — so the
  render is not production's, since only the page module itself is checked to
  be the real one (mock data sources only: the API client, the hooks that fetch,
  the router); and the state the proof checks the page in, which is the proof's
  to choose (a fixture that never loads data proves the empty page). The
  console's landing redirect (`/admin/coord`, one sentence) is registered from
  the start: a withheld page never mounts, so it would never redirect. Where it
  lands, the coordination overview (`/admin/coord/home`), is registered on its
  own proof (§3.14), so a presenting arrival lands on a presented page.

**Captions before data** (the departure from R1 and R9). `Caption` renders a page's
or a panel's `{ title, oneLiner, whyItMatters }` ahead of its data: in presentation
mode the title at screen-share size (`text-2xl` / `text-xl` / `text-lg` for levels
1–3), the one-liner at `text-base` and why it matters at `text-sm`, which is up to
three lines of chrome above R1's health strip. That is the point of the lens — an
evaluator does not share the vocabulary, and the caption is the translation — and
it is why it is confined to presentation mode: in operator mode a caption renders
nothing (or, `persistent`, the title and one-liner at the console's sizes, for a
page whose own heading is its caption; or, `untitled`, its sentences alone, beneath
the control or badge whose text is its title, §3.12). Copy lives in ONE registry composed of one
file per lens surface (`captions/`); product terms in it go through `GlossaryTerm`
via `term(...)`, never as plain text (the registry's test fails a glossary term's
name left plain, singular or plural — a synonym, such as "machine" for a device,
it cannot see); and every sentence is a claim about the product, so it is checked
against the code like any other claim. A withheld page's placeholder shows its
caption's title and one-liner only (`Caption brief`), never why its content
matters, since that content is off screen.

**Provenance beside every figure.** `Provenance` is the chip `source: … · as of …`
beside each number a lens page shows. An unknown source or time renders `UNKNOWN`
on R3's ignorance-floor amber (`UNKNOWN_AMBER`), never a blank. The age advances on
one shared 15-second tick; below a minute it says "under a minute ago" rather than a
seconds count the tick would leave behind; and a render with no client clock (server,
hydration) states the instant in UTC to the minute, so the HTML and the first client
render agree.

**A kept reading, and two reads of one thing.** R6's stale arm holds on a lens
surface too, in both modes. A reading kept after its latest read failed (react-query
keeps a query's data when a refetch fails) is named as the last read. The failure
leads, the reading is introduced as the last one read, it is never headed "Live", and
its own staleness is worded as of when it was read ("its data was 30s stale when
read"). An age that was not served is UNKNOWN, never "live": a missing
`staleness_seconds` means a live answer only on coord's DriftVerdict, and the admin
outbound door's envelope is not one. That door has no answer-level age. Each bucket
carries its own, and its drift class is its worst (first) bucket's. So the web backend
serves that bucket's age (`digital_twin.py` `_class_bucket_age`), and every sentence
that shows it names the bucket: "its worst bucket's data was 12s stale when read" in
the drawer, after "classified", and "worst bucket 12s stale when read" on the matrix
cell, whose title says the bucket is the one its drift class comes from. On the Twin
map the Staleness detail begins "the oldest of N answering readings", beside which
"worst" would read as "oldest". Coord orders the buckets by drift severity, then by
the share of budget left, never by age, so another bucket may be older. The map
therefore names the bucket by what makes it that one: "outbound's reading is dated
by the bucket its drift class comes from" (`digital-twin/_lib/status-presentation.ts`
`readingAge`, `datesWorstBucket`, `CLASS_BUCKET`). With no age served (no bucket
observed, or a backend that predates carrying it) all three read UNKNOWN with the
reason "no age was served for this reading". That reason is true whichever half
deploys first, and blames no one.

Where a kept reading's dot goes depends on what carries it:

- **A panel that states a verdict on one reading** draws the dot on the ignorance
  floor, because the dot says what is true now. The sub-space drawer's Status reads
  "Last answer: Live" on the amber ring.
- **A list of rows under a page notice** keeps R6's row arm instead. The Completeness
  matrix's and the Lifecycle view's cells keep their last answer's hue and label.
  `CoordUnreachableBanner` above them says they show the probe's last answer, not a
  current reading. In operator mode it says the cells "fall back to their last
  status". While presenting it says "the live statuses below are not a current
  reading". The drawer covers that notice, so it says so itself.
- **The Twin map** has a notice of its own above its cards, worded for the map
  (`TwinMapHeldNotice`), in both modes. Its live-probed part rows keep R6's row arm
  under it. Its probe figures, which draw no dot, keep the last answer's values. The
  notice names both as that answer, and only for the twins whose figures the answer
  decides (`digital-twin/_lib/twin-aspects.ts` `probeFedAspects`). Under coord's
  catalog those are the twins with a part it declares. A twin with none shows its
  probe figures as UNKNOWN because nothing in it is probed live, whatever coord
  answered or refused and whether or not the probe holds a reading, as the Lifecycle
  view says of a stage nothing probes. The catalog says that, not the answer, so the
  notice never calls those figures that answer. With the catalog unread, the
  manifest's `snapshot` rows and the rows the answer has a cell for are the
  live-probed ones (`resolve.ts`), so the answer decides every twin's figures, even
  that a twin has no live-probed part, and the notice names every twin. Under a
  catalog that declares no intent row it reads "the Observed, Coverage and Staleness
  figures of the environment twin and the process twin, and the statuses of the
  live-probed parts below, are its last answer, not a current reading", and a
  `Provenance` chip dates it. With no twin to name, nothing on the map is the
  probe's answer, and there is no notice. A probe holding no reading at all needs no
  notice there either: every probe figure of a twin with a live-probed part, and
  every live part, is then UNKNOWN with the reason.
  An answer in which coord refused every reading is an answer, but no observer was
  read in it. The other views replace themselves with the access notice; the map
  keeps its cards, and both its probe figures and its live parts say UNKNOWN, naming
  that refusal, in both modes (`digital-twin/_lib/probe-read.ts` `probeReadOf`). A
  part never reads "Restricted" then: that status's meaning is a refusal of one
  sub-space, the others unaffected, which is false of an answer that refused them
  all.
  The map's Staleness figure is worded as of the read ("15m stale when read"), since
  in operator mode no chip dates it.
- **A figure with no notice above it** keeps no reading. On the Twin map the Honesty
  figure (coord's twin self-check) and the UI Bridge app twin's Observed and Coverage
  figures (the runner's app registry and its model of its own interface) stand alone.
  Nothing on their card could name a kept answer as the last one, so a read whose
  latest attempt failed makes its figure UNKNOWN, dated by that attempt: "the
  runner's app registry could not be read (HTTP 503)". That holds even where
  react-query keeps an earlier answer beside the failure
  (`digital-twin/_lib/twin-aspects.ts` `runnerAnswer`,
  `digital-twin/_lib/twin-fidelity.ts` `readFidelity`). A read with no answer, no
  failure and none in flight is not worded as a failure: "no read of the runner's
  app registry has answered: this browser is offline". The UI Bridge tab reads the
  same runner reads the same way. Its App field's suggestions and its graph counts
  are the runner's only while their latest read answered
  (`digital-twin/_components/UiBridgePanel.tsx`). Its live snapshot is a capture,
  not a count, read only when Capture asks: never by a mount, a runner switch or a
  reconnect (`digital-twin/_hooks/useUiBridge.ts` `useRunnerSnapshot`). What the
  card says of it follows that read's own state, which react-query keeps for the
  runner across mounts, never a flag of the mount that asked, so it says the same
  after the operator leaves the tab and comes back. A capture carries the time it
  was taken and a failed attempt the time it failed, each on a `persistent`
  `Provenance` chip, and one kept after a re-capture failed stays under the failure,
  introduced as "As last captured, before that failure:".

Where one panel shows two reads of one thing, every line about a read says which read
it is about. It does so by name ("Coord's live probe's latest read failed", "This
drawer's own read of the live verdict failed") or by pointing back at the line before
it ("As last read, before that failure:"). A reading names its read as the source of
its own `Provenance` chip, and that chip dates it, `persistent` because nothing else
in the panel does. The sub-space drawer's Status is the page probe's answer, and its
Summary the drawer's own read (`digital-twin/_lib/drawer-status.ts`,
`drawer-reading.ts`). Every state of both reads that can occur, in both modes, is a
row of `SubspaceDetail.matrix.test.tsx`, including the outbound door's real answer,
with its worst bucket's age served and without. That file's docblock names the
combinations it leaves out because they cannot occur.

**Density down.** Presentation mode never adds a record row to a page: what it changes
is which of the page's own elements render, and how large a caption is. A headline
strip (`HeadlineFigures`, §3.11) is one such element: a page may render it only while
presenting, above its health strip, which departs from R1 the way a caption does. A
page does not grow a second presentation layout.

**Controls off.** Every control that writes renders inside `OperatorOnly` — not
hidden, unmounted, so its UI Bridge registration goes with it; a `placeholder` that
stands in must itself be navigation-only. What may stay live is a control marked
`NAVIGATION_ONLY_PROPS`, and the mark is a **claim**: only a control whose press
changes nothing but what this browser displays may make it — a filter, a refresh, a
link-like jump, a tab or view switch, a disclosure of read-only detail. Never a
control that writes, and never one that opens a menu or a dialog whose items can
write; a `combobox` (the UI kit's `Select`) is a choice, so it needs the claim on its
trigger and may make it only when every option is view-only. `FilterTabs`,
`FilterChips`, `RefreshButton`, the presentation toggle and the sidebar's navigation
entries carry the mark by construction; `HealthStrip` and `StatCluster` carry it only
where the caller passes `navigationOnly`.

The one exception is **the presenter's own safety controls** — a CLOSED list,
`PRESENTER_SAFETY_CONTROLS` in `components/console/presenterSafety.ts`, each control
carrying `presenterSafetyProps(<name>)`: Stop on the "AI co-pilot is active" banner,
Stop on the UI Bridge recording indicator, and the session-expiry dialog's two
buttons (continue, sign out). Each acts on THIS screen or THIS presenter's session,
and taking it away would leave the presenter unable to stop something happening in
front of the audience, so presentation mode keeps it, and the toggle's title says
so. Nothing else joins the list by a marker: `expectPresentationSafe` fails a marker
naming anything the list does not hold. A control that only belongs to the account
is not a safety control — the co-pilot banner's "Disable for this account" is inside
`OperatorOnly`, and so are the shell's beta banner and offline sync queue.

**Redaction on.**

- `RedactedText` / `useRedactor`: free text (a plan, PR, session or finding title;
  on the coordination overview also a question or an approval, a recommendation, a
  degradation's headline and subject, an initiative item, coord's own reasons and
  the tenant's name — §3.14)
  renders only when every repository it belongs to has a first-party owner and it
  holds none of the confidential terms; otherwise the descriptor
  `kind · area · status · age`, with `withheld` for a field that may name someone
  the scope cannot clear, and without a field the item's KIND does not have
  (`notApplicable` — a tenant's name has no area, status or age of its own;
  "unknown" would claim a value exists and was not read). An unknown scope
  withholds everything, and when a read failed or the project has no first-party
  owners the `PresentationModeToggle` says so beside itself, in fixed copy that
  never carries the failure's own wording. A value read against a console table rather than shown
  as text, unless it is one of the closed vocabularies §3.11 lets read spaced —
  on the coordination overview, a decision kind parsed out of a question's text
  (coord's `needs_me` work, qontinui-coord#3053 and its successor), or a source
  the page does not label — shows only when the table names it, and in fixed
  words otherwise (§3.11, §3.14). The two lists are
  tenant data, edited in operator mode on `/admin/coord/tenant-policy`.
- `MachineName` / `useMachineName` / `useMachineAliaser`: a machine renders as
  `Machine A`, `B`… — one letter per computer for the session, on every panel,
  however each panel identifies it (device id, hostname; on the coordination
  overview, a degradation subject coord names as a device — §3.14); two letters
  that turn out to be one machine merge to the earlier.
- `CostFigure` is the only component that renders a per-task cost, always beside
  "list-price equivalent, not your bill", and in presentation mode never — a
  descriptor instead. `costRenders.test.ts` (over `src/test/costRenderScan.ts`)
  scans every module under `src/` a lens page and its shell can load — a
  component wherever it lives, and the `lib/`, `hooks/`, `services/`, `stores/`
  and `data/` modules beside it (a type-only import loads no code and is not
  followed) — and fails on the shapes it knows: a money-named value, key or
  import (a destructured key and an aliased import included), an `Intl` currency
  format however `NumberFormat` is reached, a currency symbol or code glued to a
  value (in text, a string child, a template, a concatenation, or an element of
  its own, across any whitespace — `&nbsp;` and the other character references
  included — or `{" "}` spacer, and in every branch of a conditional or `&&`
  child), a currency code value beside one, a literal figure or the label — and
  any way of reaching a CURRENCY FORMATTER from anywhere under `src/`: an export
  (a function, a class or a value such as a `NumberFormat` instance) whose code
  formats a currency or glues a symbol, or reads one that does, under every name
  its module exports it by — through a barrel's `export *` or `export { … }
  from`, an export list, or as the default. Named, default and namespace imports
  of one (`ns.formatCurrency`, or the namespace handed on whole), re-exports, and
  a literal `import()` of its module all fail (`src/test/currencyFormatters.ts`).
  So a helper that formats a cost, or hands one to a page under a name that does
  not say money, fails in its own module, and the finding names the chain of
  loads from the lens page. What is past the scan is what is not in `src/`: a
  figure from the backend, a package or the composed build's cloud overlay. The
  rendered-page check below catches one that carries a symbol or a code; a bare
  number under a name that does not say money is caught by neither, which is why
  a cost field is always named as one (`cost_usd`).

**The test every presentation-ready page carries.** A presentation-mode render of the
real page with `renderInPresentationMode` and `expectPresentationSafe(view, {
captions, forbidden })` (`src/test/presentation.tsx`): no enabled control that is
not navigation-only, no link to a lens page without `?present=1`, no write or
undeclared UI Bridge registration, no cost, every
listed caption, no email address or UUID, and none of the `forbidden` strings — the
real hostnames, device ids and other parties' names the fixture holds. The check
also fails a view that is not on the screen when it runs — unmounted, cleaned up,
rendered detached, or rendering nothing but the helper's own sentinel (a wrapper
that drops its children, an `OperatorOnly` around the whole render) — because over
nothing every other check passes; and a UI Bridge registry the render does not
register with (`unread-registry`): a view assembled from two renders, or a render
that mounts a `UIBridgeProvider` of its own in its `wrapper` or in the page. Render
the page itself, with its fixture's data loaded; keep the view mounted until the
check has run; leave the provider to the helper; and keep what the page portals
(a dialog, a toast) inside the element the check reads — a page that renders any
of its output outside it is not proven. A `<title>` React hoists into the head is
such output: a page that renders one is read with `baseElement:
document.documentElement`.

---

## Related documents

- `frontend/docs/architecture-sidebar-navigation.md` — console navigation structure
- `frontend/docs/STATE_MANAGEMENT.md` — where server state lives (React Query is the
  single source of truth; a health strip derives from it, never re-fetches)
- `frontend/src/styles/components.css` — the CSS classes used in JSX
- `frontend/src/config/theme.ts` — programmatic values (`colors.*`, `spacing.*`)
- `qontinui-claude-config/knowledge-base/qontinui-specific/shared-frontend-packages.md`
  — the four-layer frontend package split
