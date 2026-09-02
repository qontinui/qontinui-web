/**
 * RuleTester suite for `no-fat-record-card`.
 *
 * Locks the two halves of the predicate — record POSITION and card SHAPE —
 * and, per the plan's 2026-08-20 correction, that BOTH spellings are caught:
 * the `<Card>` component and the raw `<div>` that never mentions it. The div
 * fixture below is `ProposalCard.tsx:79`'s actual class string, the instance
 * that proved a `<Card>`-keyed rule insufficient.
 *
 * Cross-link:
 * `plans/2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 4
 * step 3.
 */

import { RuleTester } from "eslint";
import rule from "./no-fat-record-card.mjs";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** In scope: the rule only governs the coord console. */
const IN = "src/app/(app)/admin/coord/things/page.tsx";
/** Out of scope: the rest of the app keeps its cards. */
const OUT = "src/app/(app)/projects/page.tsx";

const FAT_DIV_CLASS = "space-y-3 rounded-lg border border-border bg-card px-4 py-3.5";

ruleTester.run("no-fat-record-card", rule, {
  valid: [
    // --- out of scope -------------------------------------------------------
    {
      filename: OUT,
      code: `const a = items.map((i) => <div className="${FAT_DIV_CLASS}" />);`,
    },
    { filename: OUT, code: "const a = items.map((i) => <Card />);" },

    // --- right shape, WRONG position: a panel, not a record -----------------
    // Rendered once, so it is a container. R2 is about the per-record line.
    {
      filename: IN,
      code: `const a = <div className="${FAT_DIV_CLASS}" />;`,
    },
    { filename: IN, code: "const a = <Card><CardHeader /></Card>;" },
    {
      filename: IN,
      code: `function Panel() { return <div className="${FAT_DIV_CLASS}" />; }`,
    },

    // --- right position, WRONG shape: already migrated ----------------------
    { filename: IN, code: "const a = items.map((i) => <RecordRow key={i.id} />);" },
    {
      filename: IN,
      code: "const a = <RecordList renderRow={(i, ctx) => <RecordRow expanded={ctx.expanded} />} />;",
    },
    // A bare row div with no card chrome is the thing we want.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="flex items-center gap-3 px-3 py-2" />);',
    },
    // Chrome but no block padding — a divider row, not a card.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="rounded-md border border-border" />);',
    },
    // Block padding but only ONE chrome token.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="rounded-lg p-4" />);',
    },
    // Padding below the threshold: `py-2` is the migrated row's own padding,
    // and flagging it would flag the thing the plan asked for.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="rounded-md border bg-card py-2" />);',
    },
    // HORIZONTAL padding only — `px-4` is not block padding.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="rounded-lg border bg-card px-4" />);',
    },
    // A className the rule cannot statically read: report nothing, guess
    // nothing.
    {
      filename: IN,
      code: "const a = items.map((i) => <div className={cardClass} />);",
    },
    // A custom component is its own module's problem — flagging it here would
    // report the same card twice, at the use site and at its definition.
    {
      filename: IN,
      code: "const a = items.map((i) => <ProposalCard proposal={i} />);",
    },
    // `.filter()` is not `.map()`: not a per-record emission.
    {
      filename: IN,
      code: `const a = items.filter((i) => <div className="${FAT_DIV_CLASS}" />);`,
    },

    // --- the two exclusions the first tree-wide run earned ------------------
    // A TEXT element cannot be a record card. This is
    // `PromptDocumentList.tsx:261` verbatim — a per-band empty state inside a
    // `.map()` over bands, which the rule's first draft reported.
    {
      filename: IN,
      code: 'const a = bands.map((b) => <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm" />);',
    },
    // ...and it stays valid on shape alone, with no dashed border.
    {
      filename: IN,
      code: `const a = bands.map((b) => <p className="${FAT_DIV_CLASS}" />);`,
    },
    // A DASHED border is the "nothing here yet" vocabulary, not a record
    // surface — even on a container.
    {
      filename: IN,
      code: 'const a = bands.map((b) => <div className="rounded-lg border border-dashed border-border p-4 text-center" />);',
    },

    // --- a border REMOVER means "continues the element above" --------------
    // `border-t-0 rounded-b-md bg-card p-3` is the `<RecordDetail>` shape, and
    // it ALREADY clears the 2-of-3 chrome test on `rounded-b-md` + `bg-card`
    // alone. Without the remover exclusion the rule would flag the migrated
    // pattern it exists to protect — caught by this fixture, not in review.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="border-t-0 rounded-b-md bg-card p-3" />);',
    },
    // The same shape written through `cn`, since that is how detail panels
    // that take an accent are actually spelled.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className={cn("border border-t-0 rounded-b-md bg-card px-3 py-3", accent)} />);',
    },

    // A conditional contributes nothing: its branches are alternatives, and
    // unioning them could invent a card from one branch's chrome and the
    // other's padding.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className={cn(i.open ? "rounded-lg border bg-card" : "px-2", i.pad ? "p-4" : "")} />);',
    },
  ],

  invalid: [
    // --- spelling 1: the shadcn <Card> --------------------------------------
    {
      filename: IN,
      code: "const a = items.map((i) => <Card key={i.id}><CardContent /></Card>);",
      errors: [{ messageId: "fatCard", data: { name: "Card" } }],
    },
    // --- spelling 2: the raw <div> that never mentions Card -----------------
    // The instance a `<Card>`-only rule would have missed.
    {
      filename: IN,
      code: `const a = items.map((i) => <div className="${FAT_DIV_CLASS}" />);`,
      errors: [{ messageId: "fatCard", data: { name: "div" } }],
    },
    // A block body with an early return still reaches the record position.
    {
      filename: IN,
      code: `const a = items.map((i) => {
        if (!i) return null;
        return <div className="${FAT_DIV_CLASS}" />;
      });`,
      errors: [{ messageId: "fatCard" }],
    },
    // Inside a `renderRow` prop — the shape the console's own list primitive
    // takes, which is exactly where a regression would land.
    {
      filename: IN,
      code: `const a = <RecordList renderRow={(i) => <div className="${FAT_DIV_CLASS}" />} />;`,
      errors: [{ messageId: "fatCard" }],
    },
    // A template literal contributes its static half.
    {
      filename: IN,
      code:
        "const a = items.map((i) => <div className={`rounded-lg border bg-card p-4 ${accent}`} />);",
      errors: [{ messageId: "fatCard" }],
    },
    // Nested one level down inside the callback: still one per record.
    {
      filename: IN,
      code: `const a = items.map((i) => (
        <li key={i.id}>
          <div className="${FAT_DIV_CLASS}" />
        </li>
      ));`,
      errors: [{ messageId: "fatCard" }],
    },
    // The container list beyond `div` — an `<li>` or `<article>` carrying the
    // shape is the same card with different markup.
    {
      filename: IN,
      code: `const a = items.map((i) => <li className="${FAT_DIV_CLASS}" />);`,
      errors: [{ messageId: "fatCard", data: { name: "li" } }],
    },
    {
      filename: IN,
      code: `const a = items.map((i) => <article className="${FAT_DIV_CLASS}" />);`,
      errors: [{ messageId: "fatCard", data: { name: "article" } }],
    },

    // --- the three shapes the pre-PR review found the rule was blind to ----
    // `cn(...)` is the idiomatic className spelling here (11 sites under
    // admin/coord/), and the most natural way to write the banned card.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className={cn("rounded-lg border bg-card p-4", accent)} />);',
      errors: [{ messageId: "fatCard" }],
    },
    // ...including when the literal is not the first argument.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className={clsx(accent, "rounded-lg border bg-card p-4")} />);',
      errors: [{ messageId: "fatCard" }],
    },
    // A numeric border WIDTH is still a border. `border-2` has no letter after
    // the dash, which an `[a-z]`-only suffix test would have missed.
    {
      filename: IN,
      code: 'const a = items.map((i) => <div className="border-2 rounded-lg p-4" />);',
      errors: [{ messageId: "fatCard" }],
    },
  ],
});
