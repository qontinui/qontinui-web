/**
 * ESLint rule: no-fat-record-card
 *
 * Phase 4 step 3 of plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` — *"the one
 * mechanical rule that stops Family B from growing back"*.
 *
 * Phase 3 migrated 29 coord console routes off the fat record card (a bordered,
 * padded block per record) and onto `<RecordRow>` / `<RecordDetail>`: one
 * record, one line, click to expand. Nothing stopped route 30 from hand-rolling
 * a card again, and a prose rule in a style guide does not hold that — the
 * guide already said so and the cards were written anyway.
 *
 * ## Why this does not key on `<Card>`
 *
 * The step was originally specified as a `<Card>`-only rule. That was corrected
 * on 2026-08-20 by a defect found in the plan's own census:
 * `prompt-document-proposals/_components/ProposalCard.tsx:79` was a genuine fat
 * record card built from a raw `<div>` —
 * `"space-y-3 rounded-lg border border-border bg-card px-4 py-3.5"` — and never
 * mentioned `<Card>`. A `<Card>`-keyed rule would not have caught the one
 * instance that motivated writing it, and that route was authored *after* the
 * plan was written.
 *
 * So the rule keys on the **rendered shape**, not the component name:
 *
 *   - the element sits in a RECORD POSITION — inside a `.map()` callback or a
 *     `renderRow` / `renderItem` prop, i.e. it is emitted once per record;
 *   - AND it is a `<Card>` (whose own styling *is* the shape), or it carries at
 *     least two of {a border, a rounded corner, a `bg-card` surface} together
 *     with block padding of `p-3`/`py-3` or more.
 *
 * Both halves are required. A bordered box that renders once is a panel, not a
 * record; a record rendered as a bare `<div>` with no card chrome is already
 * the thing this rule wants.
 *
 * ## Scope
 *
 * Only files under `admin/coord/` — the operator console the style guide
 * governs (`frontend/docs/console-ui-style-guide.md`). The rest of the app has
 * cards for good reasons and is not migrating.
 *
 * ## Escape hatch
 *
 * A surface that genuinely needs a card per record (a gallery, a diff pair)
 * silences it at the site and says why:
 *
 *   {/* eslint-disable-next-line @qontinui-web/no-fat-record-card *\/}
 */

/** Files this rule governs. Forward- and back-slash paths both occur. */
const SCOPE = /[\\/]admin[\\/]coord[\\/]/;

/** Props whose callback renders one record — the `.map()` equivalents. */
const RENDER_PROPS = new Set(["renderRow", "renderItem", "renderCard"]);

/** Components whose own styling already IS the fat-card shape. */
const CARD_COMPONENTS = new Set(["Card"]);

/**
 * Host elements that can BE a record card — containers.
 *
 * A record card holds structure: a status, a label, a timestamp, usually an
 * action. A text element cannot, so a padded, bordered `<p>` in a list is a
 * different thing — almost always an empty state or a notice, which is
 * precisely what the first tree-wide run of this rule turned up
 * (`PromptDocumentList.tsx:261`, a per-band "nothing here yet" line inside a
 * `.map()` over BANDS rather than over records).
 */
const CONTAINER_ELEMENTS = new Set(["div", "li", "article", "section", "a"]);

/** `p-3` / `py-4` / `p-3.5` — block padding at or above the threshold. */
const BLOCK_PADDING = /^p[y]?-(\d+(?:\.\d+)?)$/;
const PADDING_THRESHOLD = 3;

/**
 * A token that ADDS a border.
 *
 * Two traps, both real:
 *   - `border-t-0` / `border-b-0` / `border-l-0` REMOVE a border. They must
 *     not count as chrome — `border-t-0 rounded-b-md p-3` is precisely the
 *     `<RecordDetail>` shape, so counting them would flag the migrated
 *     pattern this rule exists to protect.
 *   - `border-2`, `border-4`, `border-[1px]` are widths, and a card spelled
 *     with one is still a card. A `[a-z]`-only suffix would miss them.
 */
function isBorderToken(t) {
  if (t === "border") return true;
  if (!/^border(-|$)/.test(t)) return false;
  // A trailing `-0` on a side/axis utility is a REMOVER, not chrome.
  if (/-0$/.test(t)) return false;
  return true;
}
function isRoundedToken(t) {
  return t === "rounded" || t.startsWith("rounded-");
}
function isCardSurfaceToken(t) {
  return t === "bg-card" || t.startsWith("bg-card/");
}

/**
 * Every statically-readable class token in an expression.
 *
 * Handles the four spellings this codebase actually uses:
 *   - a plain string;
 *   - a template literal, contributing its static quasis, so
 *     `` className={`… ${accent}`} `` still counts what it spells literally;
 *   - `cn(…)` / `clsx(…)` / `classNames(…)`, contributing every literal
 *     argument. This one is load-bearing: there are 11 `cn(` className sites
 *     under `admin/coord/` today, and `cn("rounded-lg border bg-card p-4",
 *     accent)` is the most natural way to write the exact card this rule
 *     bans. Treating it as "fully dynamic" would have left the idiomatic
 *     spelling silently legal.
 *
 * A CONDITIONAL (`a ? x : y`, `cond && x`) contributes NOTHING, deliberately.
 * Its branches are alternatives, not a set: unioning them could combine the
 * chrome of one branch with the padding of another and report a card that no
 * render ever produces. A false positive in a rule with no autofix costs more
 * than the coverage, and the chrome half of a real card is written in the
 * static argument anyway.
 *
 * Anything else yields nothing and the element is left alone — the rule
 * reports what it can see and never guesses.
 */
const CLASS_JOINERS = new Set(["cn", "clsx", "classNames", "twMerge"]);

function tokensFromExpression(e, depth = 0) {
  if (!e || depth > 4) return [];
  if (e.type === "Literal" && typeof e.value === "string") {
    return e.value.split(/\s+/).filter(Boolean);
  }
  if (e.type === "TemplateLiteral") {
    return e.quasis
      .flatMap((q) => (q.value.cooked ?? "").split(/\s+/))
      .filter(Boolean);
  }
  if (
    e.type === "CallExpression" &&
    e.callee.type === "Identifier" &&
    CLASS_JOINERS.has(e.callee.name)
  ) {
    return e.arguments.flatMap((a) => tokensFromExpression(a, depth + 1));
  }
  return [];
}

function staticClassTokens(attr) {
  if (!attr || attr.type !== "JSXAttribute" || !attr.value) return [];
  const v = attr.value;
  if (v.type === "Literal" && typeof v.value === "string") {
    return v.value.split(/\s+/).filter(Boolean);
  }
  if (v.type === "JSXExpressionContainer") {
    return tokensFromExpression(v.expression);
  }
  return [];
}

function hasCardChrome(tokens) {
  // A DASHED border is the console's "provisional / nothing here" vocabulary —
  // the same one `draft` badges and the `?` verdict glyph use. It marks an
  // absence, and an absence is never a record. Excluding it costs nothing:
  // no card in the migrated corpus was dashed.
  if (tokens.includes("border-dashed")) return false;
  // An element that explicitly REMOVES one of its borders is continuing an
  // adjacent element rather than standing alone — which is exactly the
  // `<RecordDetail>` idiom (`border-t-0 rounded-b-md`, so the panel and the
  // row above it read as one object). A standalone card never needs this.
  // Without the exclusion the migrated pattern itself trips the 2-of-3 test,
  // because `rounded-b-md` + `bg-card` + `p-3` is already two chrome tokens
  // and block padding — i.e. the rule would flag the shape it exists to
  // protect.
  if (tokens.some((t) => /^border-[tblrxy]-0$/.test(t))) return false;
  const chrome =
    (tokens.some(isBorderToken) ? 1 : 0) +
    (tokens.some(isRoundedToken) ? 1 : 0) +
    (tokens.some(isCardSurfaceToken) ? 1 : 0);
  if (chrome < 2) return false;
  return tokens.some((t) => {
    const m = BLOCK_PADDING.exec(t);
    return m !== null && Number.parseFloat(m[1]) >= PADDING_THRESHOLD;
  });
}

/**
 * Is this element emitted once per record?
 *
 * True when an enclosing function is either the callback of a `.map(...)` or
 * the value of a `renderRow`-style JSX prop. Walking ancestors (rather than
 * matching a fixed shape) is what lets the check survive the wrappers real
 * pages use — a `.map()` whose callback has a block body, an early return, or
 * an intermediate helper element.
 *
 * **Known gaps, none of which occur in the console today:** `flatMap`,
 * `Array.from(xs, fn)`, and `.map(namedFn)` where the callback is a function
 * REFERENCE rather than an inline literal. Each would need its own arm and
 * none has a caller here; a rule that reports nothing on a shape nobody
 * writes is a smaller cost than one that mis-attributes a helper function to
 * every list that happens to call it.
 */
function inRecordPosition(node, sourceCode) {
  let fn = null;
  for (const ancestor of sourceCode.getAncestors(node).slice().reverse()) {
    if (
      ancestor.type === "ArrowFunctionExpression" ||
      ancestor.type === "FunctionExpression"
    ) {
      fn = ancestor;
      const parent = fn.parent;
      if (!parent) continue;
      // items.map((item) => <div .../>)
      if (
        parent.type === "CallExpression" &&
        parent.arguments.includes(fn) &&
        parent.callee.type === "MemberExpression" &&
        parent.callee.property?.type === "Identifier" &&
        parent.callee.property.name === "map"
      ) {
        return true;
      }
      // <RecordList renderRow={(item, ctx) => <div .../>} />
      if (
        parent.type === "JSXExpressionContainer" &&
        parent.parent?.type === "JSXAttribute" &&
        parent.parent.name?.type === "JSXIdentifier" &&
        RENDER_PROPS.has(parent.parent.name.name)
      ) {
        return true;
      }
    }
  }
  return false;
}

function elementName(openingElement) {
  const n = openingElement.name;
  if (n.type === "JSXIdentifier") return n.name;
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow a bordered, padded card per record in the coord console — compose <RecordRow>/<RecordDetail> instead (one record, one line).",
    },
    schema: [],
    messages: {
      fatCard:
        "Fat record card in the coord console: <{{name}}> renders one bordered, padded block per record. Compose `<RecordRow>` / `<RecordDetail>` from `@/components/console` instead — one record, one line, click to expand (console-ui-style-guide.md R2/R5). If this surface genuinely needs a card per record, disable this rule at the site and say why.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!SCOPE.test(filename)) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    return {
      JSXOpeningElement(node) {
        const name = elementName(node);
        if (!name) return;

        const isCard = CARD_COMPONENTS.has(name);
        if (!isCard) {
          // Only a CONTAINER host element can hand-roll the shape. A custom
          // component is its own module's problem and would be flagged there
          // instead; a text element is a notice or an empty state.
          if (!CONTAINER_ELEMENTS.has(name)) return;
          const className = node.attributes.find(
            (a) =>
              a.type === "JSXAttribute" &&
              a.name?.type === "JSXIdentifier" &&
              a.name.name === "className"
          );
          if (!hasCardChrome(staticClassTokens(className))) return;
        }

        if (!inRecordPosition(node, sourceCode)) return;

        context.report({ node, messageId: "fatCard", data: { name } });
      },
    };
  },
};

export default rule;
