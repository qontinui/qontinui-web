/**
 * costRenderScan — finds a money figure rendered anywhere a lens page can
 * reach, outside the one component allowed to render one (plan
 * `2026-10-23-console-presentation-spaces` D3.1).
 *
 * `CostFigure` (`components/presentation/CostFigure.tsx`) is the ONLY place a
 * per-task cost may render: it carries "list-price equivalent, not your bill"
 * and renders a descriptor in presentation mode. This scanner is the guard that
 * makes "only" true — in the style of `components/console/consoleSurfaces.test.ts`:
 * the defect is an ABSENCE (a figure nobody routed through `CostFigure`), so it
 * is found by reading the source tree, not by walking the module graph.
 *
 * ## Scope — by directory, so later pages are covered automatically
 *
 * 1. Every `app/**\/layout.tsx` that renders `<PresentationLens>` roots a lens
 *    tree, and EVERY module under its directory is scanned (today the console
 *    and the twin). A page added under either is in scope the day it exists,
 *    whether or not anything links to it yet.
 * 2. Then, to a fixed point, every `app/` or `components/` MODULE a scanned
 *    module imports (static, re-export or dynamic `import()`, by `@/…` alias
 *    or a relative path) is scanned too — a component a lens page renders is
 *    part of the lens. Reachability is per module, not per directory: a lens
 *    page importing one constant from another route's `_lib/` brings that file
 *    in, not the route's money code beside it.
 *
 * `lib/`, `services/`, `hooks/` and the rest are data and logic layers, not
 * rendering, and are not followed; a figure formatted there and rendered as an
 * opaque string is the rendered-page layer's to catch
 * (`expectPresentationSafe`'s currency check in `src/test/presentation.tsx`).
 *
 * ## What counts as rendering money (four rules, on the parsed TSX)
 *
 * - **currency-format** — an `Intl` currency format: a `style: "currency"`
 *   option.
 * - **glued-symbol** — a currency symbol glued to a computed value: `` `$${x}` ``,
 *   `"$" + x`, or JSX text ending in `$` right before `{x}`.
 * - **literal-figure** — a currency figure written into text (`"$12"`,
 *   `"5 EUR"`), or the cost label itself (`"list-price equivalent"`), which
 *   belongs only beside a `CostFigure`'s figure.
 * - **money-value** — any VALUE whose name says money: an identifier, property
 *   or string key with a word part `cost`, `usd`, `price`, `spend`, `dollar`,
 *   `cents`, … (`run.cost_usd`, `totalCost`, `dataKey="cost_usd"`,
 *   `formatCostAmount(x)`). Inside a `<CostFigure …>` element's attributes it
 *   is allowed — that IS the sanctioned route. Declarations (a variable, a
 *   parameter, a destructured binding, an object key), types and import/export
 *   lists are not values and are not flagged; the READ that renders is.
 *
 * Known non-money compounds are listed in {@link NON_MONEY_COMPOUNDS}, each
 * with its reason. Add one only with a reason a reviewer can check.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { CURRENCY_FIGURE } from "./presentation";

/** The one module allowed to render a cost figure. */
export const COST_HOME = "components/presentation/CostFigure.tsx";

/** Word parts that make a name a money name. */
const MONEY_PARTS: ReadonlySet<string> = new Set([
  "cost",
  "costs",
  "usd",
  "eur",
  "gbp",
  "price",
  "prices",
  "pricing",
  "priced",
  "spend",
  "spending",
  "dollar",
  "dollars",
  "cents",
]);

/**
 * Word-part pairs that are NOT money even though one part is, with why. Matched
 * as adjacent parts (`domainCost` → `domain`, `cost`).
 */
export const NON_MONEY_COMPOUNDS: ReadonlyArray<{
  readonly parts: readonly [string, string];
  readonly reason: string;
}> = [
  {
    parts: ["domain", "cost"],
    reason:
      "autonomy-domain cost is effort — work units, wall clock, PRs, sessions, " +
      "operator touches, tokens (`app/(app)/overview/_lib/domainCost.ts` " +
      "COST_DIMENSIONS) — never money",
  },
];

const COST_LABEL_FRAGMENT = "list-price equivalent";
const CURRENCY_SYMBOL_AT_END = /[$€£¥₹]\s*$/;
const CURRENCY_SYMBOL_GLUE = /^[$€£¥₹]\s*$|^[$€£¥₹]\s|\s[$€£¥₹]\s*$/;

export type CostRule =
  | "currency-format"
  | "glued-symbol"
  | "literal-figure"
  | "money-value";

export interface CostRenderViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: CostRule;
  readonly detail: string;
}

/** `cost_usd` → [cost, usd]; `totalCostUSD` → [total, cost, usd]. */
export function wordParts(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether `name` names money (see the module doc). */
export function isMoneyName(name: string): boolean {
  const parts = wordParts(name);
  return parts.some(
    (part, i) =>
      MONEY_PARTS.has(part) &&
      !NON_MONEY_COMPOUNDS.some(
        ({ parts: [first, second] }) =>
          (part === second && parts[i - 1] === first) ||
          (part === first && parts[i + 1] === second)
      )
  );
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isLabeledStatement(parent)
  ) {
    return (parent as { name?: ts.Node }).name === node;
  }
  // `{ cost: c } = row` names a key and binds `c`; `{ costUsd } = row` binds.
  if (ts.isBindingElement(parent)) return true;
  return false;
}

function isReplacementString(node: ts.Node): boolean {
  // `.replace(re, "$1")` — a back-reference, not a dollar figure.
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments[1] === node &&
    ts.isPropertyAccessExpression(call.expression) &&
    /^replace(All)?$/.test(call.expression.name.text)
  );
}

function tagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  return node.tagName.getText();
}

/** Every violation in one module's source. */
export function scanSource(file: string, text: string): CostRenderViolation[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const out: CostRenderViolation[] = [];
  const flag = (node: ts.Node, rule: CostRule, detail: string) =>
    out.push({
      file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule,
      detail,
    });

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      return;
    }
    // The sanctioned route: anything handed to a CostFigure is its to render.
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === "CostFigure"
    ) {
      return;
    }
    if (ts.isJsxAttribute(node)) {
      if (node.initializer) visit(node.initializer);
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      /^["']?style["']?$/.test(node.name.getText(source)) &&
      ts.isStringLiteralLike(node.initializer) &&
      node.initializer.text === "currency"
    ) {
      flag(
        node,
        "currency-format",
        'an Intl currency format (style: "currency")'
      );
    }
    if (
      (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) &&
      CURRENCY_SYMBOL_AT_END.test(node.text)
    ) {
      flag(node, "glued-symbol", "a currency symbol glued to a template value");
    }
    if (ts.isJsxText(node) && CURRENCY_SYMBOL_AT_END.test(node.text)) {
      const siblings = (node.parent as ts.JsxElement | ts.JsxFragment).children;
      const next = siblings[siblings.indexOf(node) + 1];
      if (next && ts.isJsxExpression(next)) {
        flag(node, "glued-symbol", "a currency symbol glued to a JSX value");
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      [node.left, node.right].some(
        (side) =>
          ts.isStringLiteralLike(side) && CURRENCY_SYMBOL_GLUE.test(side.text)
      )
    ) {
      flag(node, "glued-symbol", "a currency symbol concatenated to a value");
    }
    if (
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const value = node.text;
      if (CURRENCY_FIGURE.test(value) && !isReplacementString(node)) {
        flag(
          node,
          "literal-figure",
          `a currency figure in text: ${JSON.stringify(value.trim().slice(0, 40))}`
        );
      }
      if (value.toLowerCase().includes(COST_LABEL_FRAGMENT)) {
        flag(node, "literal-figure", "the cost label outside CostFigure");
      }
      if (
        ts.isStringLiteralLike(node) &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) &&
        isMoneyName(value)
      ) {
        flag(node, "money-value", `a money key ${JSON.stringify(value)}`);
      }
    }
    if (
      ts.isIdentifier(node) &&
      isMoneyName(node.text) &&
      !isDeclarationName(node)
    ) {
      flag(node, "money-value", `a money value \`${node.text}\``);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

// ---------------------------------------------------------------------------
// The scope
// ---------------------------------------------------------------------------

/** `src/`, resolved from this file. */
export const SRC_DIR = join(__dirname, "..");

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Every non-test `.ts`/`.tsx` module under `dir` (relative to `src/`). */
function modulesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(SRC_DIR, dir))) {
    if (entry === "node_modules" || entry === ".next") continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(SRC_DIR, rel)).isDirectory()) modulesUnder(rel, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

/** Static imports and re-exports, then dynamic `import("…")` (`next/dynamic`). */
const IMPORT_SPECIFIERS = [
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

/**
 * The `src/`-relative MODULE an import names, when it is an `app/` or
 * `components/` module; `null` for anything else (packages, `lib/`, …).
 * `known` is every module there is, so resolution never touches the disk.
 */
function importedModule(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>
): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = specifier.slice(2);
  else if (specifier.startsWith(".")) {
    target = toPosix(
      relative(SRC_DIR, join(SRC_DIR, dirname(fromFile), specifier))
    );
  } else return null;
  if (!/^(app|components)\//.test(target)) return null;
  for (const candidate of [
    target,
    `${target}.tsx`,
    `${target}.ts`,
    `${target}/index.tsx`,
    `${target}/index.ts`,
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

export interface CostScanScope {
  /** Lens-tree roots: the directories of layouts rendering `<PresentationLens>`. */
  readonly lensRoots: readonly string[];
  /** Every module scanned: the lens trees' own, then what they import. Sorted. */
  readonly files: readonly string[];
}

function within(file: string, dirs: Iterable<string>): boolean {
  for (const dir of dirs) if (file.startsWith(`${dir}/`)) return true;
  return false;
}

const sources = new Map<string, string>();

/** A `src/`-relative module's text, read once per run. */
export function sourceOf(file: string): string {
  let text = sources.get(file);
  if (text === undefined) {
    text = readFileSync(join(SRC_DIR, file), "utf8");
    sources.set(file, text);
  }
  return text;
}

/** Discover the scope from the tree as it stands (see the module doc). */
export function discoverScope(): CostScanScope {
  const all = [...modulesUnder("app"), ...modulesUnder("components")];
  const lensRoots = all
    .filter((f) => /^app\/(.*\/)?layout\.tsx$/.test(f))
    .filter((f) => /<PresentationLens\b/.test(sourceOf(f)))
    .map((f) => toPosix(dirname(f)))
    .sort();
  const known = new Set(all);
  const scanned = new Set(all.filter((f) => within(f, lensRoots)));
  const queue = [...scanned];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const pattern of IMPORT_SPECIFIERS) {
      for (const match of sourceOf(file).matchAll(pattern)) {
        const target = importedModule(file, match[1], known);
        if (target && !scanned.has(target)) {
          scanned.add(target);
          queue.push(target);
        }
      }
    }
  }
  return { lensRoots, files: [...scanned].sort() };
}

/** Every violation in scope, outside {@link COST_HOME}. */
export function scanLensTrees(
  scope: CostScanScope = discoverScope()
): CostRenderViolation[] {
  return scope.files
    .filter((file) => file !== COST_HOME)
    .flatMap((file) => scanSource(file, sourceOf(file)));
}

/** One line per violation, for an assertion message a reader can act on. */
export function describeCostViolation(v: CostRenderViolation): string {
  return `${v.file}:${v.line} [${v.rule}] ${v.detail} — render it through <CostFigure>`;
}
