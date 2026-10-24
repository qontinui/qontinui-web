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
 * 2. The layouts ABOVE each lens root — the authenticated app shell, whose
 *    sidebar renders beside every lens page — are scanned as modules (their
 *    directories are not: `(app)` holds every page of the app).
 * 3. Then, to a fixed point, every `app/` or `components/` MODULE a scanned
 *    module imports (static, re-export or dynamic `import()`, by `@/…` alias
 *    or a relative path) is scanned too — a component a lens page renders is
 *    part of the lens. Reachability is per module, not per directory: a lens
 *    page importing one constant from another route's `_lib/` brings that file
 *    in, not the route's money code beside it.
 *
 * `lib/`, `services/`, `hooks/`, `data/` and the rest are data and logic
 * layers, not rendering, and are not scanned whole. What a lens page CAN
 * import from them and render is a formatter, so every exported function
 * anywhere under `src/` is classified by what its body does
 * (`currencyFormatters.ts`): one that formats a currency or glues a currency
 * symbol to a value — or reads one that does — is a currency formatter, and
 * importing it into a scanned module is a violation under any local name. A
 * figure computed there and rendered as an opaque string is left to the
 * rendered-page layer (`expectPresentationSafe`'s currency check in
 * `src/test/presentation.tsx`).
 *
 * ## What counts as rendering money (four rules, on the parsed TSX)
 *
 * - **currency-format** — an `Intl` currency format: a `style: "currency"`
 *   option, however it is spelled (`as const`, a computed `["style"]` key, a
 *   shorthand `style` bound to `"currency"`), a `currency` option, or
 *   number-format options the scan cannot read (an identifier, a spread, a
 *   non-literal `style`) — it cannot rule out a currency it cannot see. The
 *   formatter is `Intl.NumberFormat` however it is reached (`window.Intl…`,
 *   `globalThis.Intl…`, a destructured or aliased `NumberFormat`) or
 *   `toLocaleString`.
 * - **glued-symbol** — a currency symbol or ISO code glued to a computed value,
 *   on either side: `` `$${x}` ``, `` `${x} USD` ``, `"$" + x`, `x + " USD"`,
 *   JSX text ending in `$` before `{x}` or an element, JSX text starting with
 *   `USD` after one, a lone `{"$"}` child, an element holding nothing but a
 *   currency symbol or code beside a value (`<span>$</span>{x}`,
 *   `{x}<small>USD</small>`), or a currency CODE value (`currency`,
 *   `currencyCode`) written into a template. A plain string child (`{"}"}`)
 *   is text, not a computed value.
 * - **literal-figure** — a currency figure written into text (`"$12"`,
 *   `"5 EUR"`), or the cost label itself (`"list-price equivalent"`), which
 *   belongs only beside a `CostFigure`'s figure.
 * - **money-value** — any VALUE whose name says money: an identifier, property
 *   or string key with a word part `money`, `cost`, `usd`, `price`, `spend`,
 *   `dollar`, `cents`, … (`run.cost_usd`, `totalCost`, `dataKey="cost_usd"`,
 *   `formatMoney(x)`). Inside the attributes of a `<CostFigure …>` the file
 *   IMPORTS from the presentation package it is allowed — that IS the
 *   sanctioned route; a `CostFigure` the file declares itself, or imports from
 *   anywhere else, is not, and declaring one is flagged. The unlabelled
 *   formatter `formatCostAmount` is flagged wherever it is imported or
 *   re-exported, under any name — and so is any import or re-export whose
 *   IMPORTED name is a money name (`formatUsd as fmt`), any default import
 *   from a money-named module (`import fmt from "@/lib/formatUsd"`), and any
 *   import of a currency formatter (above), except from the presentation
 *   package's own `CostFigure` module. Declarations (a variable, a parameter,
 *   the name a destructuring BINDS, an object key), types and type-only
 *   imports are not values and are not flagged; the READ that renders is —
 *   the key a destructuring reads (`{ cost_usd: c } = row`) included. A
 *   display-text value (`label: "Costs"`) names the concept, not a figure.
 *
 * Known non-money compounds are listed in {@link NON_MONEY_COMPOUNDS}, each
 * with its reason. Add one only with a reason a reviewer can check.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import ts from "typescript";
import {
  discoverCurrencyFormatters,
  resolveSrcModule,
  type CurrencyFormatters,
} from "./currencyFormatters";
import { CURRENCY_FIGURE } from "./presentation";

/** The one module allowed to render a cost figure. */
export const COST_HOME = "components/presentation/CostFigure.tsx";

/** Word parts that make a name a money name. */
const MONEY_PARTS: ReadonlySet<string> = new Set([
  "money",
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

/** The ISO 4217 codes the rendered-page check knows (`CURRENCY_FIGURE`). */
const CURRENCY_CODES = "USD|EUR|GBP|JPY|CHF|CAD|AUD|INR|CNY";
/** A currency symbol, or an ISO code standing as a word. */
const CURRENCY_TOKEN = `(?:[$€£¥₹¢]|\\b(?:${CURRENCY_CODES})\\b)`;
/** Text whose LAST thing is a currency token — glued to what follows it. */
const CURRENCY_AT_END = new RegExp(`${CURRENCY_TOKEN}\\s*$`);
/** Text whose FIRST thing is a currency token — glued to what precedes it. */
const CURRENCY_AT_START = new RegExp(`^\\s*${CURRENCY_TOKEN}`);
/** Text that is nothing but a currency token. */
const CURRENCY_ONLY = new RegExp(`^\\s*${CURRENCY_TOKEN}\\s*$`);

/** The module a sanctioned `CostFigure` is imported from. */
const COST_FIGURE_MODULES: ReadonlySet<string> = new Set([
  "@/components/presentation",
  "@/components/presentation/CostFigure",
]);

/** The unlabelled formatter `CostFigure` renders through; nothing else may. */
const COST_FORMATTER = "formatCostAmount";

/**
 * Properties and attributes whose string value is DISPLAY TEXT — a label
 * naming a page or a column ("Costs"), not a key a figure is read by. A
 * money-named key there names the concept; it renders no figure.
 */
const DISPLAY_TEXT_KEYS: ReadonlySet<string> = new Set([
  "label",
  "title",
  "description",
  "heading",
  "aria-label",
  "placeholder",
]);

/** Whether a string literal is the value of a display-text property or attribute. */
function isDisplayText(node: ts.Node, source: ts.SourceFile): boolean {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const key = propertyKey(parent, source);
    return key !== null && DISPLAY_TEXT_KEYS.has(key);
  }
  if (ts.isJsxAttribute(parent)) {
    return DISPLAY_TEXT_KEYS.has(parent.name.getText(source));
  }
  return false;
}

/** A name that holds a currency CODE (not a money amount). */
function isCurrencyCodeName(name: string): boolean {
  const parts = wordParts(name);
  return parts.length > 0 && parts[0] === "currency";
}

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
  // `{ cost: c } = row` READS the key `cost` and binds `c`, so only the bound
  // name is a declaration; `{ costUsd } = row` binds `costUsd` (its later
  // read is flagged where it renders).
  if (ts.isBindingElement(parent)) return parent.name === node;
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

/**
 * A computed value among JSX children: an element, or an expression that is
 * not a plain string (`{"}"}` beside a regex's `$` anchor is text, not a
 * figure). An element holding nothing but a currency symbol is the symbol,
 * not a value.
 */
function isJsxValue(sibling: ts.Node | undefined): boolean {
  if (sibling === undefined || ts.isJsxText(sibling)) return false;
  if (ts.isJsxElement(sibling)) return !isCurrencyOnlyElement(sibling);
  if (!ts.isJsxExpression(sibling)) return true;
  if (!sibling.expression) return false;
  const value = unwrapExpression(sibling.expression);
  return !(
    ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
  );
}

/** `<span>$</span>`, `<small> USD </small>` — an element that is only a currency token. */
function isCurrencyOnlyElement(node: ts.JsxElement): boolean {
  const children = node.children.filter(
    (child) => !(ts.isJsxText(child) && child.text.trim() === "")
  );
  const only = children.length === 1 ? children[0] : undefined;
  return (
    only !== undefined && ts.isJsxText(only) && CURRENCY_ONLY.test(only.text)
  );
}

/** `x`, `(x)`, `x as const`, `x satisfies T`, `x!` — down to `x`. */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** A property's key as text: `style`, `"style"`, `["style"]`; else `null`. */
function propertyKey(
  property: ts.ObjectLiteralElementLike,
  source: ts.SourceFile
): string | null {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (!ts.isPropertyAssignment(property)) return null;
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const inner = unwrapExpression(name.expression);
    return ts.isStringLiteralLike(inner) ? inner.text : null;
  }
  return ts.isNumericLiteral(name) ? name.text : name.getText(source);
}

/** `Intl`, `window.Intl`, `globalThis.Intl`, `self.Intl` — any read of `Intl`. */
function isIntl(node: ts.Expression): boolean {
  const value = unwrapExpression(node);
  return (
    (ts.isIdentifier(value) && value.text === "Intl") ||
    (ts.isPropertyAccessExpression(value) && value.name.text === "Intl")
  );
}

/**
 * The local names a module binds to `Intl.NumberFormat`:
 * `const { NumberFormat } = Intl`, `const { NumberFormat: NF } = Intl`,
 * `const NF = Intl.NumberFormat` (and `window.Intl…`). A formatter reached
 * through one is a formatter all the same.
 */
function numberFormatAliases(source: ts.SourceFile): Set<string> {
  const names = new Set<string>(["NumberFormat"]);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrapExpression(node.initializer);
      if (ts.isObjectBindingPattern(node.name) && isIntl(init)) {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (
            ts.isIdentifier(key) &&
            key.text === "NumberFormat" &&
            ts.isIdentifier(element.name)
          ) {
            names.add(element.name.text);
          }
        }
      } else if (
        ts.isIdentifier(node.name) &&
        ts.isPropertyAccessExpression(init) &&
        init.name.text === "NumberFormat" &&
        isIntl(init.expression)
      ) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * The options argument of a number formatter — `new Intl.NumberFormat(l, o)`,
 * `Intl.NumberFormat(l, o)`, `new window.Intl.NumberFormat(l, o)`, an aliased
 * `new NF(l, o)`, `x.toLocaleString(l, o)` — or `undefined` when `node` is not
 * such a call. `null` when it is one with no options.
 */
function numberFormatOptions(
  node: ts.Node,
  aliases: ReadonlySet<string>
): ts.Expression | null | undefined {
  if (!ts.isNewExpression(node) && !ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  const isNumberFormat =
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "NumberFormat" &&
      isIntl(callee.expression)) ||
    (ts.isIdentifier(callee) && aliases.has(callee.text));
  const isToLocaleString =
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "toLocaleString";
  if (!isNumberFormat && !isToLocaleString) return undefined;
  return node.arguments?.[1] ?? null;
}

/**
 * Every `CostFigure` the file may hand a cost to: the local names it imports
 * `CostFigure` under from the presentation package. A `CostFigure` declared
 * here, or imported from anywhere else, is not the sanctioned one.
 */
function sanctionedCostFigureNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const from = statement.moduleSpecifier;
    if (!ts.isStringLiteral(from) || !COST_FIGURE_MODULES.has(from.text)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === "CostFigure") names.add(element.name.text);
    }
  }
  return names;
}

/** What a scan of one module may know about the rest of `src/`. */
export interface ScanContext {
  /** Every exported currency formatter under `src/` (`currencyFormatters.ts`). */
  readonly formatters: CurrencyFormatters;
  /** Every module there is, `src/`-relative, for resolving an import. */
  readonly modules: ReadonlySet<string>;
}

const NO_CONTEXT: ScanContext = { formatters: new Map(), modules: new Set() };

/** A module specifier's last path segment: `@/lib/formatUsd` → `formatUsd`. */
function specifierName(specifier: string): string {
  const last = specifier.split("/").filter(Boolean).pop() ?? "";
  return last.replace(/\.(tsx?|jsx?)$/, "");
}

/** Every violation in one module's source. */
export function scanSource(
  file: string,
  text: string,
  context: ScanContext = NO_CONTEXT
): CostRenderViolation[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const formatAliases = numberFormatAliases(source);
  const out: CostRenderViolation[] = [];
  const flag = (node: ts.Node, rule: CostRule, detail: string) =>
    out.push({
      file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule,
      detail,
    });
  const costFigures = sanctionedCostFigureNames(source);

  const checkModuleSpecifiers = (
    node: ts.ImportDeclaration | ts.ExportDeclaration
  ) => {
    const specifier =
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : null;
    const resolved =
      specifier === null
        ? null
        : resolveSrcModule(file, specifier, context.modules);
    // `CostFigure`'s own module is where money-named names are SUPPOSED to
    // come from (`CostFigure`, its label); its raw formatter is not.
    const sanctioned =
      specifier !== null &&
      (COST_FIGURE_MODULES.has(specifier) || resolved === COST_HOME);
    const typeOnly = ts.isImportDeclaration(node)
      ? (node.importClause?.isTypeOnly ?? false)
      : node.isTypeOnly;
    const clause = ts.isImportDeclaration(node) ? node.importClause : null;
    const elements =
      clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : ts.isExportDeclaration(node) &&
            node.exportClause &&
            ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements
          : [];
    for (const element of elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === COST_FORMATTER) {
        flag(
          element,
          "money-value",
          `the unlabelled cost formatter \`${COST_FORMATTER}\`, under any name`
        );
        continue;
      }
      // A re-export with no module names a LOCAL binding; its read is the
      // one that renders. A type is not a value.
      if (specifier === null || typeOnly || element.isTypeOnly) continue;
      if (
        resolved !== null &&
        context.formatters.get(resolved)?.has(imported)
      ) {
        flag(
          element,
          "money-value",
          `the currency formatter \`${imported}\` (${resolved}), under any name`
        );
      } else if (!sanctioned && isMoneyName(imported)) {
        flag(
          element,
          "money-value",
          `a money-named binding \`${imported}\`, under any name`
        );
      }
    }
    // A default import is named by its module: `import fmt from "…/formatUsd"`.
    if (
      clause?.name &&
      !typeOnly &&
      specifier !== null &&
      !sanctioned &&
      isMoneyName(specifierName(specifier))
    ) {
      flag(
        clause.name,
        "money-value",
        `the default export of a money-named module \`${specifier}\``
      );
    }
  };

  const checkFormatOptions = (node: ts.Node) => {
    const options = numberFormatOptions(node, formatAliases);
    if (options === undefined || options === null) return;
    const literal = unwrapExpression(options);
    if (!ts.isObjectLiteralExpression(literal)) {
      flag(
        options,
        "currency-format",
        "number-format options the scan cannot read, so it cannot rule out a currency"
      );
      return;
    }
    for (const property of literal.properties) {
      if (ts.isSpreadAssignment(property)) {
        flag(
          property,
          "currency-format",
          "spread number-format options the scan cannot read"
        );
        continue;
      }
      const key = propertyKey(property, source);
      if (key === "currency" || key === "currencyDisplay") {
        flag(property, "currency-format", `a \`${key}\` number-format option`);
      } else if (key === "style") {
        const value = ts.isPropertyAssignment(property)
          ? unwrapExpression(property.initializer)
          : null;
        if (value === null || !ts.isStringLiteralLike(value)) {
          flag(
            property,
            "currency-format",
            "a number-format `style` the scan cannot read"
          );
        }
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      checkModuleSpecifiers(node);
      return;
    }
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      return;
    }
    // A component of the sanctioned NAME declared here is not the sanctioned
    // component: whatever it renders, renders unlabelled.
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === "CostFigure"
    ) {
      flag(
        node.name,
        "money-value",
        "a CostFigure declared outside CostFigure.tsx"
      );
    }
    // The sanctioned route: anything handed to the IMPORTED CostFigure is its
    // to render.
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      costFigures.has(tagName(node))
    ) {
      return;
    }
    if (ts.isJsxAttribute(node)) {
      if (node.initializer) visit(node.initializer);
      return;
    }
    if (
      ts.isPropertyAssignment(node) &&
      propertyKey(node, source) === "style"
    ) {
      const value = unwrapExpression(node.initializer);
      if (ts.isStringLiteralLike(value) && value.text === "currency") {
        flag(
          node,
          "currency-format",
          'an Intl currency format (style: "currency")'
        );
      }
    }
    if (
      ts.isShorthandPropertyAssignment(node) &&
      node.name.text === "style" &&
      /\bstyle\s*(?::[^=]+)?=\s*["'`]currency["'`]/.test(text)
    ) {
      flag(node, "currency-format", 'a `style` bound to "currency"');
    }
    checkFormatOptions(node);
    if (
      (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) &&
      CURRENCY_AT_END.test(node.text)
    ) {
      flag(
        node,
        "glued-symbol",
        "a currency symbol or code glued to a template value"
      );
    }
    if (
      (ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) &&
      CURRENCY_AT_START.test(node.text)
    ) {
      flag(
        node,
        "glued-symbol",
        "a currency symbol or code glued after a template value"
      );
    }
    if (ts.isTemplateSpan(node)) {
      const value = unwrapExpression(node.expression);
      const name = ts.isIdentifier(value)
        ? value.text
        : ts.isPropertyAccessExpression(value)
          ? value.name.text
          : null;
      if (name !== null && isCurrencyCodeName(name)) {
        flag(
          node,
          "glued-symbol",
          `a currency code \`${name}\` written into text`
        );
      }
    }
    if (ts.isJsxText(node)) {
      const siblings = (node.parent as ts.JsxElement | ts.JsxFragment).children;
      const at = siblings.indexOf(node);
      const isValue = isJsxValue;
      if (CURRENCY_AT_END.test(node.text) && isValue(siblings[at + 1])) {
        flag(
          node,
          "glued-symbol",
          "a currency symbol or code glued to a JSX value"
        );
      }
      if (CURRENCY_AT_START.test(node.text) && isValue(siblings[at - 1])) {
        flag(
          node,
          "glued-symbol",
          "a currency symbol or code glued after a JSX value"
        );
      }
    }
    if (ts.isJsxElement(node) && isCurrencyOnlyElement(node)) {
      // `<span>$</span>{x}` and `{x}<small>USD</small>`: the symbol in its own
      // element is glued to the value beside it as surely as JSX text is.
      const parent = node.parent;
      if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
        const siblings = parent.children.filter(
          (child) => !(ts.isJsxText(child) && child.text.trim() === "")
        );
        const at = siblings.indexOf(node);
        if (isJsxValue(siblings[at - 1]) || isJsxValue(siblings[at + 1])) {
          flag(
            node,
            "glued-symbol",
            "a currency symbol or code in its own element, beside a JSX value"
          );
        }
      }
    }
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      !ts.isJsxAttribute(node.parent)
    ) {
      const value = unwrapExpression(node.expression);
      if (
        (ts.isStringLiteralLike(value) ||
          ts.isNoSubstitutionTemplateLiteral(value)) &&
        CURRENCY_ONLY.test(value.text)
      ) {
        flag(node, "glued-symbol", "a currency symbol or code as a JSX child");
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      [node.left, node.right].some(
        (side) =>
          ts.isStringLiteralLike(side) &&
          (side === node.left
            ? CURRENCY_AT_END.test(side.text)
            : CURRENCY_AT_START.test(side.text))
      )
    ) {
      flag(
        node,
        "glued-symbol",
        "a currency symbol or code concatenated to a value"
      );
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
        isMoneyName(value) &&
        !isDisplayText(node, source)
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
  const target = resolveSrcModule(fromFile, specifier, known);
  return target !== null && /^(app|components)\//.test(target) ? target : null;
}

export interface CostScanScope {
  /** Lens-tree roots: the directories of layouts rendering `<PresentationLens>`. */
  readonly lensRoots: readonly string[];
  /**
   * The layouts ABOVE the lens roots — the app shell that renders around every
   * lens page (its sidebar is on screen beside the page). Each is scanned as a
   * module, and what it imports is followed, but its directory is not: the
   * `(app)` directory holds every page of the app.
   */
  readonly shellLayouts: readonly string[];
  /** Every module scanned: the lens trees' own, then what they import. Sorted. */
  readonly files: readonly string[];
  /** What each scan knows of the rest of `src/`: its modules and formatters. */
  readonly context: ScanContext;
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

/** Every `layout.tsx` from `root`'s parent directory up to `app/`. */
function layoutsAbove(root: string, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  let dir = toPosix(dirname(root));
  for (;;) {
    const layout = `${dir}/layout.tsx`;
    if (known.has(layout)) out.push(layout);
    if (dir === "app" || !dir.startsWith("app/")) break;
    dir = toPosix(dirname(dir));
  }
  return out;
}

/** Every non-test module under `src/`, for resolution and classification. */
function srcModules(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(SRC_DIR)) {
    if (entry === "node_modules" || entry === ".next") continue;
    if (statSync(join(SRC_DIR, entry)).isDirectory()) modulesUnder(entry, out);
    else if (/\.(tsx|ts)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * The scan's knowledge of the rest of `src/`: every module, and every
 * exported currency formatter among them (`currencyFormatters.ts`), judged by
 * this scan's own currency-format and glued-symbol rules. `CostFigure.tsx` is
 * not classified: importing it is the sanctioned route.
 */
export function discoverContext(
  modules: readonly string[] = srcModules()
): ScanContext {
  const formatters = discoverCurrencyFormatters({
    modules,
    read: sourceOf,
    exclude: new Set([COST_HOME]),
    formatsMoney: (snippet, file) =>
      scanSource(file, snippet).some(
        (v) => v.rule === "currency-format" || v.rule === "glued-symbol"
      ),
  });
  return { formatters, modules: new Set(modules) };
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
  const shellLayouts = [
    ...new Set(lensRoots.flatMap((root) => layoutsAbove(root, known))),
  ].sort();
  const scanned = new Set([
    ...all.filter((f) => within(f, lensRoots)),
    ...shellLayouts,
  ]);
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
  return {
    lensRoots,
    shellLayouts,
    files: [...scanned].sort(),
    context: discoverContext(),
  };
}

/** Every violation in scope, outside {@link COST_HOME}. */
export function scanLensTrees(
  scope: CostScanScope = discoverScope()
): CostRenderViolation[] {
  return scope.files
    .filter((file) => file !== COST_HOME)
    .flatMap((file) => scanSource(file, sourceOf(file), scope.context));
}

/** One line per violation, for an assertion message a reader can act on. */
export function describeCostViolation(v: CostRenderViolation): string {
  return `${v.file}:${v.line} [${v.rule}] ${v.detail} — render it through <CostFigure>`;
}
