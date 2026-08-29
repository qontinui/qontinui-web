/**
 * RuleTester suite for `no-handrolled-record-row`.
 *
 * Locks the two halves of the rule independently, because each one on its own
 * is a rule the plan explicitly rejected:
 *
 *   - **shape without position** would flag every summary panel, error banner
 *     and detail block in the console — 17 of the 20 elements under
 *     `admin/coord/**` that wear the silhouette are exactly those, and none is
 *     a record;
 *   - **position without shape** would flag every already-migrated row, since
 *     `<RecordRow>` is itself rendered from a record position.
 *
 * The `valid` block is therefore where most of the value is: a rule that fires
 * on the console's own primitives, or on a panel, gets a blanket disable
 * comment within a week and stops being a rule at all.
 *
 * Fixtures carry BOTH spellings the plan asks for — `<Card>` and a raw `<div>`
 * — and the raw-div fixture is the historical `ProposalCard` className verbatim,
 * so the rule is pinned against the defect it was written for rather than
 * against a paraphrase of it.
 *
 * Cross-link: plan `2026-08-16-coord-console-ui-unification-pipeline-style`
 * Phase 4.3; `frontend/docs/console-ui-style-guide.md` R2/R4/R5.
 */

import { RuleTester } from "eslint";
import rule from "./no-handrolled-record-row.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** The exact className `ProposalCard` shipped with before Wave 5 migrated it. */
const HISTORICAL_PROPOSAL_CARD =
  "space-y-3 rounded-lg border border-border bg-card px-4 py-3.5";

/** `<RecordRow>`'s own button className — three clauses, and `py-2`. */
const RECORD_ROW_BUTTON =
  "w-full flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-card/30 hover:bg-accent/60 transition-colors text-left";

ruleTester.run("no-handrolled-record-row", rule, {
  valid: [
    // ---- Already migrated: the whole point of the rule -------------------
    { code: "function ProposalCard() { return <RecordRow expanded={e} />; }" },
    { code: "const AlertRow = () => <RecordRow accent={a}>{detail}</RecordRow>;" },
    { code: "rows.map((r) => <RecordRow key={r.id} label={r.name} />)" },

    // ---- Shape, but NOT a record position --------------------------------
    // Every one of these exists under admin/coord today. A rule that flags
    // them is a rule that gets disabled.
    {
      code: `function CaptureHealthPanel() { return <div className="rounded-lg border border-border bg-card p-4">{body}</div>; }`,
    },
    {
      code: `function CoordPlanDetailPage() { return <div className="rounded-lg border border-border bg-card/30 px-4 py-3 space-y-1.5">{meta}</div>; }`,
    },
    {
      // An error banner inside a page component, not a record.
      code: `function CoordAgentRegistryPage() { return <div className="rounded-lg border border-red-500/40 bg-card/30 px-4 py-3 space-y-2">{err}</div>; }`,
    },
    {
      // Named "…Banner", rendered four times statically — not a record.
      code: `function ClaimBanner() { return <div className="rounded-lg border bg-card/30 px-4 py-3 space-y-2">{phase}</div>; }`,
    },

    // ---- Record position, but NOT the shape ------------------------------
    {
      // The primitive itself. Three of four clauses; `py-2` is the difference
      // between a row and a card, and it is the whole calibration.
      code: `function RecordRow() { return <button className="${RECORD_ROW_BUTTON}">{label}</button>; }`,
    },
    {
      // A status strip in a record position: `py-2.5` is below the threshold.
      code: `function AgentRow() { return <div className="flex items-center gap-3 rounded-lg border bg-card/30 px-4 py-2.5">{x}</div>; }`,
    },
    {
      // Padding lives on a CHILD, so the mapped <li> is not itself a card.
      // This is `LandedWriteFeed`'s real shape and it must stay valid.
      code: `writes.map((w) => <li key={w.id} className="rounded-lg border border-border bg-card"><div className="px-3 py-2.5">{w.label}</div></li>)`,
    },
    {
      // No card fill — an amber notice is not a record card.
      code: `function NoticeRow() { return <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">{n}</div>; }`,
    },
    {
      // No radius.
      code: `function PlainRow() { return <div className="border border-border bg-card px-4 py-3">{n}</div>; }`,
    },
    {
      // Horizontal padding only — `px-6` is not block padding.
      code: `function WideRow() { return <div className="rounded-lg border border-border bg-card px-6">{n}</div>; }`,
    },

    // ---- Not the outermost returned element ------------------------------
    {
      // A carded block INSIDE a row's detail is not the row wrapper.
      code: `function ProposalRow() { return <RecordRow><div className="rounded-lg border border-border bg-card p-4">{why}</div></RecordRow>; }`,
    },

    // ---- Name does not declare a record ----------------------------------
    {
      code: `function SessionComplianceEnforcementPanel() { return <div className="space-y-4 rounded-lg border border-border bg-card p-4">{s}</div>; }`,
    },

    // ---- Unreadable className: out of reach, and silent about it ----------
    {
      code: `function MysteryRow() { return <div className={styles.card}>{n}</div>; }`,
    },
    {
      code: `function MysteryCard() { return <div className={buildClasses(state)}>{n}</div>; }`,
    },

    // ---- <Card> outside a record position --------------------------------
    { code: `function StatsPanel() { return <Card>{body}</Card>; }` },
  ],

  invalid: [
    // ---- The defect this rule exists for, verbatim -----------------------
    {
      code: `function ProposalCard() { return <div className="${HISTORICAL_PROPOSAL_CARD}">{blocks}</div>; }`,
      errors: [{ messageId: "handrolled" }],
    },
    {
      // Arrow component, same shape.
      code: `const ProposalCard = () => <div className="${HISTORICAL_PROPOSAL_CARD}">{blocks}</div>;`,
      errors: [{ messageId: "handrolled" }],
    },

    // ---- The three that exist on main today ------------------------------
    {
      code: `function RuleRow() { return <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">{r}</div>; }`,
      errors: [{ messageId: "handrolled" }],
    },
    {
      code: `function DocumentRow() { return <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">{d}</div>; }`,
      errors: [{ messageId: "handrolled" }],
    },
    {
      code: `function ClauseRow() { return <div className="group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3">{c}</div>; }`,
      errors: [{ messageId: "handrolled" }],
    },

    // ---- WHERE the error is reported, which is not cosmetic --------------
    {
      // The report anchors on the OPENING ELEMENT, not on the `className`
      // attribute that matched. It is what an `eslint-disable-next-line` has
      // to sit above, and the thing a reader disables is "this row", which
      // starts at `<div`. Reporting on the attribute puts the anchor inside a
      // multi-line opening tag, so the natural placement of the comment
      // silently does nothing and ESLint reports BOTH an unused directive and
      // the original error — which is exactly what happened when this rule's
      // own three disclosed exceptions were first written.
      code: [
        "function DocumentRow() {",
        "  return (",
        '    <div className="rounded-lg border border-border bg-card px-3 py-3" data-testid="x">',
        "      {d}",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
      errors: [{ messageId: "handrolled", line: 3, column: 5 }],
    },
    {
      // The multi-line spelling, where attribute-anchoring diverges from
      // element-anchoring by two lines. This is the shape both real
      // `/prompt-documents` rows use.
      code: [
        "function ClauseRow() {",
        "  return (",
        "    <div",
        '      className="rounded-lg border border-border bg-card px-3 py-3"',
        '      data-testid="y"',
        "    >",
        "      {c}",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
      errors: [{ messageId: "handrolled", line: 3, column: 5 }],
    },

    // ---- The `<Card>` spelling the plan originally specified -------------
    {
      code: `function PlanItem() { return <Card>{body}</Card>; }`,
      errors: [{ messageId: "handrolled" }],
    },
    {
      code: `items.map((i) => <Card key={i.id}>{i.label}</Card>)`,
      errors: [{ messageId: "handrolled" }],
    },

    // ---- The in-file `.map()` case ---------------------------------------
    {
      code: `rows.map((r) => <div key={r.id} className="rounded-lg border border-border bg-card p-4">{r.label}</div>)`,
      errors: [{ messageId: "handrolled" }],
    },

    // ---- Composed classNames the rule can still read ---------------------
    {
      code: `function AlertItem() { return <div className={cn("rounded-lg border border-border bg-card px-4 py-3", extra)}>{a}</div>; }`,
      errors: [{ messageId: "handrolled" }],
    },
    {
      code:
        "function GateRow() { return <div className={`rounded-lg border border-border bg-card px-4 py-3 ${accent}`}>{g}</div>; }",
      errors: [{ messageId: "handrolled" }],
    },
    {
      // `p-4` (both axes) counts as block padding.
      code: `function TreeItem() { return <div className="rounded-md border border-border bg-card p-4">{t}</div>; }`,
      errors: [{ messageId: "handrolled" }],
    },
  ],
});
