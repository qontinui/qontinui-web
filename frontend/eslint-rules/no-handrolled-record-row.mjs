/**
 * ESLint rule: no-handrolled-record-row
 *
 * Phase 4.3 of plan `2026-08-16-coord-console-ui-unification-pipeline-style` —
 * "the one mechanical rule that stops Family B from growing back". Family B is
 * that plan's name for a record rendered as its own bordered, rounded, padded
 * card instead of as a line in a list: the shape that made the coord console
 * take a full screen to show five rows.
 *
 * ## It keys on the SILHOUETTE, not on `<Card>`
 *
 * The plan originally specified a rule forbidding shadcn's `<Card>` as a record
 * wrapper. Implementation found that insufficient and said so
 * (§Phase 4.3, "Defect found 2026-08-20"): the worst live instance,
 * `prompt-document-proposals/_components/ProposalCard.tsx`, was a raw `<div>`
 *
 *     class="space-y-3 rounded-lg border border-border bg-card px-4 py-3.5"
 *
 * that never mentioned `<Card>` at all, which is exactly why a `<Card>`-keyed
 * census missed it — and that route was authored AFTER the plan was written. So
 * this rule matches four class families on the same element:
 *
 *   1. a border          — `border`, `border-border`, `border-<colour>`
 *   2. a corner radius   — any `rounded-*`
 *   3. a card fill       — `bg-card`, including `bg-card/30`
 *   4. block padding ≥ `p-3` (0.75rem) — `p-N` or `py-N`, N ≥ 3
 *
 * plus `<Card>` itself, which carries the silhouette in its own definition and
 * so needs no className to be a Family-B wrapper.
 *
 * **Clause 4 is the calibration, and it is deliberately tight.** The console's
 * own `<RecordRow>` wears three of the four — `border border-border rounded-md
 * bg-card/30` — and is not a violation, because its padding is `py-2`. The
 * difference between a row and a card, measured, is that one block step. Every
 * status strip in the console sits at `py-2` or `py-2.5` and is likewise
 * untouched. Raising the threshold to `p-4` would let the historical
 * `ProposalCard` (`py-3.5`) back through; lowering it to `p-2` would flag the
 * primitive this rule tells people to adopt.
 *
 * ## "Record position" — and why `.map()` alone would have missed the defect
 *
 * A shape match is not enough: a summary panel, an error banner and a detail
 * block all legitimately wear a card. The element must also be in a RECORD
 * position, which is true when either:
 *
 *   (i)  it sits lexically inside a `.map()` callback — the in-file case; or
 *   (ii) it is the outermost element returned by a component whose name ends in
 *        `Card`, `Row` or `Item` — the extracted case.
 *
 * **(ii) is the one that does the work, and (i) could never have caught the
 * defect this rule exists for.** `ProposalCard`'s offending `<div>` lived in
 * `ProposalCard.tsx`'s own body; the `.map()` that rendered it was in
 * `ReviewFeed.tsx`, a different file and a different AST. A per-file lint rule
 * cannot see across that call boundary, so "inside a `.map()` callback" is
 * structurally never true for an extracted row component — which is to say, for
 * every row component worth extracting. The plan's own wording ("any element in
 * a `.map()` record position") describes only half the rule it asked for.
 *
 * ## What it does not claim
 *
 * A name-suffix heuristic is a heuristic. It cannot see a row component called
 * `ProposalEntry`, and it will not try to: the alternative — flagging every
 * carded element under the console and making authors opt out — trades a known
 * false-negative for an unknown false-positive rate across ~35 routes, which is
 * how a lint rule earns a blanket disable comment at the top of a file.
 *
 * Silence a genuine exception inline, with the reason:
 *   // eslint-disable-next-line @qontinui-web/no-handrolled-record-row -- why
 *
 * Cross-link: `frontend/docs/console-ui-style-guide.md` R2/R4/R5;
 * plan `2026-08-16-coord-console-ui-unification-pipeline-style` Phase 4.3.
 */

/** Any `rounded`, `rounded-md`, `rounded-b-md`, `rounded-lg`, … */
const ROUNDED = /(?:^|\s)rounded(?:-[a-z0-9-]+)?(?=\s|$)/;

/** `border`, `border-border`, `border-red-500/40`, … but not `border-t-0`. */
const BORDER = /(?:^|\s)border(?:-(?!0)[a-z0-9/[\]-]+)?(?=\s|$)/;

/** `bg-card`, `bg-card/30`. The console's card fill, opacity included. */
const CARD_FILL = /(?:^|\s)bg-card(?:\/\d+)?(?=\s|$)/;

/**
 * Block padding of at least 0.75rem: `p-3`, `p-3.5`, `p-4`, `p-6`, `py-3`, …
 *
 * `px-*` is excluded on purpose — horizontal padding is what makes a row
 * readable, not what makes it a card. `pt-`/`pb-` alone are excluded for the
 * same reason the plan says "block padding": a card pads both edges.
 */
const BLOCK_PADDING = /(?:^|\s)p(y)?-(\d+(?:\.\d+)?)(?=\s|$)/g;

function hasBlockPadding(classes) {
  BLOCK_PADDING.lastIndex = 0;
  let m;
  while ((m = BLOCK_PADDING.exec(classes)) !== null) {
    if (parseFloat(m[2]) >= 3) return true;
  }
  return false;
}

function wearsTheSilhouette(classes) {
  return (
    BORDER.test(classes) &&
    ROUNDED.test(classes) &&
    CARD_FILL.test(classes) &&
    hasBlockPadding(classes)
  );
}

/**
 * Every STATIC class string reachable from a `className` attribute value.
 *
 * Covers `className="…"`, `className={"…"}`, a template literal's quasis, and
 * the string arguments of any call (`cn(…)`, `clsx(…)`, `[…].join(" ")`).
 * Dynamic parts are unreadable to a linter and are simply not considered — a
 * silhouette assembled entirely at runtime is out of this rule's reach, and
 * saying so is better than guessing.
 */
function staticClassText(value) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    switch (node.type) {
      case "Literal":
        if (typeof node.value === "string") parts.push(node.value);
        break;
      case "JSXExpressionContainer":
        walk(node.expression);
        break;
      case "TemplateLiteral":
        for (const q of node.quasis) parts.push(q.value.cooked ?? "");
        for (const e of node.expressions) walk(e);
        break;
      case "CallExpression":
        for (const a of node.arguments) walk(a);
        break;
      case "ArrayExpression":
        for (const e of node.elements) walk(e);
        break;
      case "ConditionalExpression":
        walk(node.consequent);
        walk(node.alternate);
        break;
      case "LogicalExpression":
        walk(node.left);
        walk(node.right);
        break;
      case "ObjectExpression":
        // `cn({ "px-4 py-3": cond })` — the KEY carries the classes.
        for (const p of node.properties) {
          if (p.type === "Property" && p.key?.type === "Literal") {
            if (typeof p.key.value === "string") parts.push(p.key.value);
          }
        }
        break;
      default:
        break;
    }
  };
  walk(value);
  return parts.join(" ");
}

/** Component-name suffixes that declare "I render one record". */
const RECORD_COMPONENT_NAME = /(?:Card|Row|Item)$/;

/** `<Card>` carries the silhouette in its own definition. */
const CARD_COMPONENTS = new Set(["Card"]);

function isRecordComponentName(name) {
  return typeof name === "string" && RECORD_COMPONENT_NAME.test(name);
}

/** The declared name of the function this node sits in, if it has one. */
function enclosingComponentName(node) {
  let cur = node;
  while (cur) {
    if (
      cur.type === "FunctionDeclaration" ||
      cur.type === "FunctionExpression" ||
      cur.type === "ArrowFunctionExpression"
    ) {
      if (cur.id?.name) return cur.id.name;
      const parent = cur.parent;
      if (parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier") {
        return parent.id.name;
      }
      // An anonymous callback is not a component — keep climbing past it only
      // when it is NOT a `.map()` callback (that case is handled separately).
      return null;
    }
    cur = cur.parent;
  }
  return null;
}

/** True when `node` is (transitively) the returned root of `fnName`'s body. */
function isOutermostReturned(node) {
  // JSXElement -> ReturnStatement | ArrowFunctionExpression body |
  // ParenthesizedExpression are transparent in ESTree, so the parent chain is
  // the whole test.
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "ReturnStatement") return true;
  if (parent.type === "ArrowFunctionExpression" && parent.body === node) return true;
  return false;
}

/** True when `node` sits lexically inside a `.map(...)` callback. */
function insideMapCallback(node) {
  let cur = node.parent;
  while (cur) {
    if (
      (cur.type === "ArrowFunctionExpression" ||
        cur.type === "FunctionExpression") &&
      cur.parent?.type === "CallExpression" &&
      cur.parent.callee?.type === "MemberExpression" &&
      cur.parent.callee.property?.type === "Identifier" &&
      cur.parent.callee.property.name === "map"
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "A record in the coord console is a <RecordRow>, not a hand-rolled bordered/rounded/bg-card box with block padding.",
      recommended: false,
    },
    schema: [],
    messages: {
      handrolled:
        "This {{what}} is a record wrapper wearing the console's card silhouette by hand ({{why}}). Use <RecordRow>/<RecordDetail> from @/components/console — it carries R4's accent, R5's expand-in-place detail and R2's one-line contract. See docs/console-ui-style-guide.md.",
    },
  },

  create(context) {
    function inRecordPosition(opening) {
      const el = opening.parent; // JSXElement
      if (insideMapCallback(el)) return "map";
      if (isOutermostReturned(el) && isRecordComponentName(enclosingComponentName(el))) {
        return "component";
      }
      return null;
    }

    return {
      JSXOpeningElement(opening) {
        const elName = opening.name?.type === "JSXIdentifier" ? opening.name.name : null;
        if (!elName) return;

        const position = inRecordPosition(opening);
        if (!position) return;

        if (CARD_COMPONENTS.has(elName)) {
          context.report({
            node: opening,
            messageId: "handrolled",
            data: { what: `<${elName}>`, why: "shadcn <Card> is a card by definition" },
          });
          return;
        }

        const classAttr = opening.attributes.find(
          (a) => a.type === "JSXAttribute" && a.name?.name === "className"
        );
        if (!classAttr) return;

        const classes = staticClassText(classAttr.value);
        if (!wearsTheSilhouette(classes)) return;

        context.report({
          // The OPENING ELEMENT, not the `className` attribute that matched.
          //
          // The report location is what an `eslint-disable-next-line` has to
          // sit above, and the thing a reader disables is "this row", which
          // starts at `<div`. Reporting on the attribute puts the anchor one to
          // three lines lower — inside a multi-line opening tag — so the
          // natural placement of the comment silently does nothing and ESLint
          // reports BOTH an unused directive and the original error. Found the
          // hard way while adding this rule's own three disclosed exceptions.
          node: opening,
          messageId: "handrolled",
          data: {
            what: `<${elName}>`,
            why: "border + rounded + bg-card + block padding ≥ p-3",
          },
        });
      },
    };
  },
};

export default rule;
