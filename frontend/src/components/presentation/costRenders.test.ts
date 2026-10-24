/**
 * D3.1 of plan `2026-10-23-console-presentation-spaces`: "no cost figure". A
 * money figure renders on a lens surface through `CostFigure` or not at all —
 * so it carries "list-price equivalent, not your bill" in operator mode and is
 * a descriptor in presentation mode (served policy `production-and-cost`
 * `per-task-cost-is-a-labelled-equivalent`, items 1 and 4).
 *
 * The scan (`src/test/costRenderScan.ts`) reads every module a lens page can
 * reach, by DIRECTORY, so a page added later is covered the day it lands —
 * and the app shell rendered around every lens page, through the layouts
 * above the lens roots. On `753f6a41d` no lens page renders a cost at all;
 * that is exactly why the guard must be able to fail: the detector tests below
 * each prove one rule catches the shape it names, and "goes red on a real lens
 * page" scans the real Dev Ops page with one cost render added.
 *
 * The rendered-page layer is `expectPresentationSafe` (`src/test/presentation.tsx`):
 * it fails on a CostFigure's figure, on the label, or on any currency figure in
 * a presentation-mode render. This file is the source layer beside it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COST_HOME,
  NON_MONEY_COMPOUNDS,
  describeCostViolation,
  discoverScope,
  isMoneyName,
  scanLensTrees,
  scanSource,
  sourceOf,
  type CostRule,
} from "@/test/costRenderScan";

const scope = discoverScope();

describe("the scope is discovered, not listed", () => {
  it("roots at every layout that mounts the presentation lens", () => {
    expect(scope.lensRoots).toEqual(
      expect.arrayContaining([
        "app/(app)/admin/coord",
        "app/(app)/digital-twin",
      ])
    );
  });

  it("scans the shell around the lens trees, through the layouts above them", () => {
    expect(scope.shellLayouts).toEqual(
      expect.arrayContaining(["app/(app)/layout.tsx"])
    );
    expect(scope.files).toEqual(
      expect.arrayContaining([
        "app/(app)/layout.tsx",
        "components/navigation/sidebar/UnifiedSidebar.tsx",
        "components/navigation/sidebar/_components/ProjectSelector.tsx",
      ])
    );
    // The (app) DIRECTORY is not swept: it holds every page of the app.
    expect(scope.files).not.toContain("app/(app)/overview/_lib/domainCost.ts");
  });

  it("follows the lens pages into the components they render", () => {
    expect(scope.files).toEqual(
      expect.arrayContaining([
        "components/console/HealthStrip.tsx",
        "components/admin/coord/CoordNav.tsx",
        "components/presentation/RedactedText.tsx",
      ])
    );
    expect(
      scope.files.some((f) => f.startsWith("components/operations/"))
    ).toBe(true);
  });

  it("follows modules, not directories: one imported constant brings one file", () => {
    // A console dialog imports SUMMARY_INTENT_KINDS from the Project
    // Overview's `_lib/intent.ts`; the Overview's money code beside it is
    // not rendered on a lens page and is not in scope.
    expect(scope.files).toContain("app/(app)/overview/_lib/intent.ts");
    expect(scope.files).not.toContain("app/(app)/overview/_lib/domainCost.ts");
    expect(scope.files).not.toContain("components/overview/money.ts");
  });

  it("scans real files, CostFigure among them (the scan is not vacuous)", () => {
    expect(scope.files.length).toBeGreaterThanOrEqual(400);
    expect(scope.files).toContain(COST_HOME);
    expect(scope.files).toContain("app/(app)/admin/coord/devops/page.tsx");
    expect(scope.files).toContain("app/(app)/digital-twin/page.tsx");
  });
});

describe("no lens surface renders money outside CostFigure", () => {
  it("finds no currency format, glued symbol, figure or money value in scope", () => {
    expect(scanLensTrees(scope).map(describeCostViolation)).toEqual([]);
  });

  it("exempts CostFigure by path alone — scanned directly, it is what the rules catch", () => {
    expect(scanLensTrees({ ...scope, files: [COST_HOME] })).toEqual([]);
    const direct = scanSource(
      COST_HOME,
      readFileSync(join(__dirname, "CostFigure.tsx"), "utf8")
    );
    // Its Intl format, its code-glued fallback, its label and its amounts.
    expect(new Set(direct.map((v) => v.rule))).toEqual(
      new Set<CostRule>([
        "currency-format",
        "glued-symbol",
        "literal-figure",
        "money-value",
      ])
    );
  });

  it("goes red on a real lens page with one cost render added", () => {
    const page = "app/(app)/admin/coord/devops/page.tsx";
    expect(scope.files).toContain(page);
    const real = sourceOf(page);
    expect(scanSource(page, real)).toEqual([]);
    const withCost = real.replace(
      /<Caption id="dev-ops\.page" \/>/,
      '<Caption id="dev-ops.page" /><span>{fleet.cost_usd}</span>'
    );
    expect(withCost).not.toBe(real);
    expect(scanSource(page, withCost).map((v) => v.rule)).toContain(
      "money-value"
    );
  });
});

/** What a fixture needs for its `<CostFigure>` to be the sanctioned one. */
const IMPORT_COST_FIGURE =
  'import { CostFigure } from "@/components/presentation";\n';

function rulesIn(source: string, file = "fixture.tsx"): CostRule[] {
  return scanSource(file, source).map((v) => v.rule);
}

describe("each rule catches the shape it names", () => {
  it.each<[string, string, CostRule]>([
    ["a cost field in JSX", "<span>{run.cost_usd}</span>", "money-value"],
    ["a camelCase cost", "<td>{session.totalCost}</td>", "money-value"],
    [
      "a cost in an attribute",
      "<span title={run.cost_usd}>x</span>",
      "money-value",
    ],
    ["a chart keyed on cost", '<Line dataKey="cost_usd" />', "money-value"],
    [
      "a cost computed in a module",
      "const t = rows.reduce((s, r) => s + r.costUsd, 0);",
      "money-value",
    ],
    [
      "a destructured cost rendered",
      "const { price } = row; const el = <b>{price}</b>;",
      "money-value",
    ],
    [
      "the raw formatter",
      "<span>{formatCostAmount(1.5)}</span>",
      "money-value",
    ],
    ["a shorthand cost key", "const row = { costUsd };", "money-value"],
    ["a currency code", 'const c = { code: "USD" };', "money-value"],
    [
      "Intl currency",
      'new Intl.NumberFormat("en-US", { style: "currency" });',
      "currency-format",
    ],
    [
      "toLocaleString currency",
      "n.toLocaleString(undefined, { 'style': 'currency' });",
      "currency-format",
    ],
    ["a $-glued template", "const s = `$${total}`;", "glued-symbol"],
    ["a €-glued template", "const s = `€ ${total}`;", "glued-symbol"],
    ["a $-glued JSX value", "<span>${amount}</span>", "glued-symbol"],
    ["a $ concatenation", 'const s = "$" + amount;', "glued-symbol"],
    ["a figure in copy", "<p>Spent $42 today</p>", "literal-figure"],
    ["a figure in a string", 'const s = "costs 5 EUR";', "literal-figure"],
    [
      "the label copied",
      'const s = "list-price equivalent, not your bill";',
      "literal-figure",
    ],
    [
      "a code after a JSX value",
      "<span>{row.amount.toFixed(2)} USD</span>",
      "glued-symbol",
    ],
    [
      "a code before a JSX value",
      "<span>USD {row.amount}</span>",
      "glued-symbol",
    ],
    [
      "a code after a template value",
      "const s = `${x.toFixed(2)} USD`;",
      "glued-symbol",
    ],
    [
      "a currency code interpolated (CostFigure's own fallback, copied)",
      "const s = `${amount.toFixed(2)} ${currency}`;",
      "glued-symbol",
    ],
    [
      "a symbol as its own JSX child",
      '<span>{"$"}{row.amount}</span>',
      "glued-symbol",
    ],
    [
      "a symbol template as a JSX child",
      "<span>{`$`}{x}</span>",
      "glued-symbol",
    ],
    ["a symbol before an element", "<p>$<b>{x}</b></p>", "glued-symbol"],
    [
      "a code concatenated after a value",
      'const s = amount + " USD";',
      "glued-symbol",
    ],
    [
      "Intl options the scan cannot read",
      'new Intl.NumberFormat("en-US", opts);',
      "currency-format",
    ],
    [
      "a currency style written `as const`",
      'new Intl.NumberFormat("en-US", { style: "currency" as const });',
      "currency-format",
    ],
    [
      "a shorthand style bound to currency",
      'const style = "currency"; new Intl.NumberFormat("en", { style });',
      "currency-format",
    ],
    [
      "a computed style key",
      'new Intl.NumberFormat("en", { ["style"]: "currency" });',
      "currency-format",
    ],
    [
      "spread toLocaleString options",
      "n.toLocaleString(undefined, { ...opts });",
      "currency-format",
    ],
    [
      "a currency option from data",
      'n.toLocaleString("en", { style: "decimal", currency: code });',
      "currency-format",
    ],
    [
      "a money formatter",
      "<span>{formatMoney(s.amount)}</span>",
      "money-value",
    ],
    [
      "the raw formatter, imported under another name",
      'import { formatCostAmount as formatAmount } from "@/components/presentation";',
      "money-value",
    ],
    [
      "the raw formatter, re-exported under another name",
      'export { formatCostAmount as formatAmount } from "./money";',
      "money-value",
    ],
    [
      "a CostFigure of the file's own",
      "function CostFigure({ v }: { v: number }) { return <span>{v}</span>; }",
      "money-value",
    ],
    [
      "a CostFigure nobody imported from the presentation package",
      "<CostFigure amount={run.cost_usd} source={null} />",
      "money-value",
    ],
  ])("%s", (_name, source, rule) => {
    expect(rulesIn(source)).toContain(rule);
  });
});

describe("and passes what is not a money render", () => {
  it.each<[string, string]>([
    [
      "a CostFigure, fed cost fields",
      `${IMPORT_COST_FIGURE}<CostFigure amount={run.cost_usd} source={run.cost_source} />`,
    ],
    [
      "a CostFigure with a computed amount",
      `${IMPORT_COST_FIGURE}<CostFigure amount={rows.reduce((s, r) => s + r.cost_usd, 0)} source={null} />`,
    ],
    [
      "a CostFigure imported under its module path",
      'import { CostFigure } from "@/components/presentation/CostFigure";\n<CostFigure amount={run.cost_usd} source={null} />',
    ],
    ["a cost type", "interface Row { cost_usd: number; costSource: string }"],
    ["a cost type alias", "type T = { totalCost: number | null };"],
    [
      "a cost prop handed on",
      `${IMPORT_COST_FIGURE}function C({ costUsd }: { costUsd: number }) { return <CostFigure amount={costUsd} source={null} />; }`,
    ],
    [
      "an import list",
      'import { CostFigure, coverageText } from "@/components/presentation";',
    ],
    ["a re-export", 'export { CostFigure } from "./CostFigure";'],
    ["a regex anchor beside a literal brace", '<p>^[a-z]{"{"}0,63{"}"}$</p>'],
    [
      "a navigation label naming the costs page",
      'const item = { label: "Costs", route: "/overview/financials" };',
    ],
    [
      "a number format with no options",
      'new Intl.NumberFormat("en-US").format(n);',
    ],
    [
      "a date's locale options",
      'd.toLocaleString(undefined, { month: "short", day: "numeric" });',
    ],
    ["a percent format", 'n.toLocaleString("en", { style: "percent" });'],
    ["an attribute name", '<span data-cost-figure="withheld">x</span>'],
    [
      "status currency (freshness)",
      "const s = resolveStatusCurrency(currency);",
    ],
    ["a labelling budget", "<b>{budgetSpent}</b>"],
    ["a billing refusal (a CI state)", "<b>{row.billing_refusal}</b>"],
    [
      "domain cost (effort, not money)",
      "<i className={DOMAIN_COST_VERDICT_BADGE_CLASS[kind]} />",
    ],
    ["a regex back-reference", 'const s = name.replace(/(a)/, "$1");'],
    ["a template with no symbol", "const s = `${count} sessions`;"],
    ["percent", "<b>{percent}%</b>"],
  ])("%s", (_name, source) => {
    expect(rulesIn(source)).toEqual([]);
  });
});

describe("money names", () => {
  it("are read by word part, in every casing", () => {
    for (const name of [
      "cost",
      "cost_usd",
      "totalCostUSD",
      "COST",
      "unitPrice",
      "monthlySpend",
      "dollars",
    ]) {
      expect(isMoneyName(name), name).toBe(true);
    }
    for (const name of [
      "costume",
      "accost",
      "percent",
      "spent",
      "billing",
      "currency",
      "pricey",
    ]) {
      expect(isMoneyName(name), name).toBe(false);
    }
  });

  it("list each non-money compound with a reason", () => {
    for (const { parts, reason } of NON_MONEY_COMPOUNDS) {
      expect(parts).toHaveLength(2);
      expect(reason.length).toBeGreaterThan(20);
    }
    expect(isMoneyName("domainCost")).toBe(false);
    expect(isMoneyName("domainCostUsd")).toBe(true);
  });
});
