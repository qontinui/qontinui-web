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
  moneyFormatsAt,
  scanLensTrees,
  scanSource,
  sourceOf,
  type CostRule,
  type ScanContext,
} from "@/test/costRenderScan";
import {
  DEFAULT_EXPORT,
  discoverCurrencyFormatters,
  resolveSrcModule,
  type CurrencyFormatters,
} from "@/test/currencyFormatters";
import {
  CURRENCY_CODES,
  CURRENCY_FIGURE,
  CURRENCY_SYMBOLS,
} from "@/test/currencyTokens";

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
    expect(scanSource(page, real, scope.context)).toEqual([]);
    const withCost = real.replace(
      /<Caption id="dev-ops\.page" \/>/,
      '<Caption id="dev-ops.page" /><span>{fleet.cost_usd}</span>'
    );
    expect(withCost).not.toBe(real);
    expect(scanSource(page, withCost).map((v) => v.rule)).toContain(
      "money-value"
    );
  });

  /** A finding from the classifier (`currencyFormatters.ts`), not from a money NAME. */
  const FORMATTER = "currency formatter";
  /** The glued-symbol findings, by what they found. */
  const GLUED_AFTER = "glued after a JSX value";
  const GLUED_BEFORE = "glued to a JSX value";
  const OWN_ELEMENT = "in its own element, beside a JSX value";
  const CODE_VALUE = "a currency code `currency` beside a JSX value";

  // Each case names the guard it exercises by the rule and the detail that
  // guard reports, so it goes red when THAT guard is removed — not merely when
  // the page holds some finding. The locals are not money-named (`m`, `mod`,
  // `fmt`): a money-named one would be flagged by its name whatever the
  // classifier said.
  it.each<[string, string, string, CostRule, string]>([
    [
      "a cost read through a renamed destructuring",
      "",
      "{(() => { const { cost_usd: c } = fleet; return <span>{c}</span>; })()}",
      "money-value",
      "a money value `cost_usd`",
    ],
    [
      "the repo's own currency formatter, from outside app/ and components/",
      'import { formatCurrency } from "@/data/model-costs/calc";\n',
      "<span>{formatCurrency(fleet.amount, currency)}</span>",
      "money-value",
      FORMATTER,
    ],
    [
      "that formatter imported under another name",
      'import { formatCurrency as fmt } from "@/data/model-costs/calc";\n',
      "<span>{fmt(fleet.amount, currency)}</span>",
      "money-value",
      FORMATTER,
    ],
    [
      "that formatter imported the way the repo imports it, through its barrel",
      'import { formatCurrency } from "@/data/model-costs";\n',
      "<span>{formatCurrency(fleet.amount, currency)}</span>",
      "money-value",
      FORMATTER,
    ],
    [
      "that formatter through its barrel, under another name",
      'import { formatCurrency as fmt } from "@/data/model-costs";\n',
      "<span>{fmt(fleet.amount, currency)}</span>",
      "money-value",
      FORMATTER,
    ],
    [
      "that formatter read through a namespace import of its module",
      'import * as calc from "@/data/model-costs/calc";\n',
      "<span>{calc.formatCurrency(fleet.amount, currency)}</span>",
      "money-value",
      `${FORMATTER} \`formatCurrency\` (data/model-costs/calc.ts), read through the namespace \`calc\``,
    ],
    [
      "that formatter read through a namespace import of its barrel",
      'import * as m from "@/data/model-costs";\n',
      "<span>{m.formatCurrency(fleet.amount, currency)}</span>",
      "money-value",
      `${FORMATTER} \`formatCurrency\` (data/model-costs/index.ts), read through the namespace \`m\``,
    ],
    [
      "its module loaded with import()",
      'const mod = import("@/data/model-costs");\n',
      "<span>{String(mod)}</span>",
      "money-value",
      `loads data/model-costs/index.ts, which exports the ${FORMATTER}(s)`,
    ],
    [
      "a symbol in an element of its own, beside the figure",
      "",
      '<span><span className="unit">$</span>{fleet.amount}</span>',
      "glued-symbol",
      OWN_ELEMENT,
    ],
    [
      'a code after the {" "} spacer Prettier writes',
      "",
      '<span>{fleet.amount}{" "}USD</span>',
      "glued-symbol",
      GLUED_AFTER,
    ],
    [
      "a code after the spacer, in Prettier's wrapped form",
      "",
      '<span>\n  {fleet.amount}{" "}\n  USD\n</span>',
      "glued-symbol",
      GLUED_AFTER,
    ],
    [
      "a currency code value beside the figure",
      "",
      "<span>{fleet.amount} {fleet.currency}</span>",
      "glued-symbol",
      CODE_VALUE,
    ],
    [
      "a code after a no-break space written as &nbsp;",
      "",
      "<span>{fleet.amount}&nbsp;USD</span>",
      "glued-symbol",
      GLUED_AFTER,
    ],
    [
      "a symbol before a no-break space written as &nbsp;",
      "",
      "<span>$&nbsp;{fleet.total}</span>",
      "glued-symbol",
      GLUED_BEFORE,
    ],
    [
      "a code after a numeric no-break space",
      "",
      "<span>{fleet.amount}&#160;EUR</span>",
      "glued-symbol",
      GLUED_AFTER,
    ],
    [
      "a sign after a thin space written as &thinsp;",
      "",
      "<span>{fleet.amount}&thinsp;€</span>",
      "glued-symbol",
      GLUED_AFTER,
    ],
    [
      "a code value after &nbsp;",
      "",
      "<span>{fleet.amount}&nbsp;{fleet.currency}</span>",
      "glued-symbol",
      CODE_VALUE,
    ],
    [
      "a code in its own element after &nbsp;",
      "",
      "<span>{fleet.amount}&nbsp;<small>USD</small></span>",
      "glued-symbol",
      OWN_ELEMENT,
    ],
    [
      "a code shown by a logical child",
      "",
      '<span>{fleet.amount}{showUnit && " USD"}</span>',
      "glued-symbol",
      GLUED_AFTER,
    ],
    [
      "a code shown by a conditional child",
      "",
      '<span>{fleet.amount}{showUnit ? " USD" : ""}</span>',
      "glued-symbol",
      GLUED_AFTER,
    ],
  ])(
    "goes red on a real lens page with %s",
    (_name, imports, render, rule, detail) => {
      const page = "app/(app)/admin/coord/devops/page.tsx";
      const real = sourceOf(page);
      // A replacer FUNCTION: a replacement string would read `$&` in a
      // fixture (`$&nbsp;`) as "the matched text".
      const withCost = `${imports}${real.replace(
        /<Caption id="dev-ops\.page" \/>/,
        (caption) => `${caption}${render}`
      )}`;
      expect(withCost).toContain(render);
      const found = scanSource(page, withCost, scope.context);
      expect(
        found.filter((v) => v.rule === rule && v.detail.includes(detail)),
        found.map(describeCostViolation).join("\n")
      ).not.toEqual([]);
    }
  );
});

/** Classify a synthetic tree the way `discoverContext` classifies the real one. */
function classify(
  files: Record<string, string>,
  declared?: CurrencyFormatters
): { formatters: CurrencyFormatters; context: ScanContext } {
  const formatters = discoverCurrencyFormatters({
    modules: Object.keys(files),
    read: (f) => files[f] ?? "",
    moneyFormatsAt,
    declared,
  });
  return {
    formatters,
    context: { formatters, modules: new Set(Object.keys(files)) },
  };
}

function exportsOf(formatters: CurrencyFormatters, file: string): string[] {
  return [...(formatters.get(file) ?? [])].sort();
}

/** A data module holding one currency formatter and one count formatter. */
const MONEY_MODULE =
  'export function formatCurrency(a: number, c: string) { return new Intl.NumberFormat("en", { style: "currency", currency: c }).format(a); }\n' +
  "export function formatCount(n: number) { return String(n); }";
/** A module that formats no money. */
const PLAIN_MODULE = "export const label = (n: number) => `${n} runs`;";

/** One module of every shape a formatter can be exported or reached by. */
const SHAPES: Record<string, string> = {
  "data/money/fmt.ts": MONEY_MODULE,
  "lib/named.ts": 'export { formatCurrency } from "@/data/money/fmt";',
  "lib/renamed.ts":
    'export { formatCurrency as asText } from "@/data/money/fmt";',
  "lib/star.ts": 'export * from "@/data/money/fmt";',
  "lib/starNs.ts": 'export * as fmt from "@/data/money/fmt";',
  "lib/passedOn.ts":
    'import { formatCurrency } from "@/data/money/fmt";\nexport { formatCurrency };',
  "lib/listed.ts":
    "function glue(n: number) { return `$${n}`; }\nexport { glue as formatAmount };",
  "lib/defaultFn.ts":
    'export default function fmt(n: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n); }',
  "lib/defaultName.ts":
    "const glue = (n: number) => `${n} USD`;\nexport default glue;",
  "lib/defaultAnon.ts": "export default (n: number) => `€${n}`;",
  "lib/instance.ts":
    'export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });',
  "lib/viaInstance.ts":
    'const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });\n' +
    "export function formatUsd(n: number) { return nf.format(n); }",
  "lib/viaNamespace.ts":
    'import * as m from "@/data/money/fmt";\n' +
    'export const wrap = (n: number) => m.formatCurrency(n, "USD");\n' +
    "export const count = (n: number) => m.formatCount(n);",
  "lib/viaDefault.ts":
    'import fmt from "@/lib/defaultFn";\nexport const twice = (n: number) => fmt(n) + fmt(n);',
  "lib/viaLoad.ts":
    'export async function later(n: number) { const m = await import("@/data/money/fmt"); return m.formatCurrency(n, "USD"); }',
  "lib/notMoney.ts":
    'export { formatCount } from "@/data/money/fmt";\nexport * from "@/lib/plain";',
  "lib/plain.ts": PLAIN_MODULE,
};

describe("currency formatters are found by what they do, anywhere under src/", () => {
  it("finds the repo's own formatter outside the scanned folders, and through its barrel", () => {
    expect(
      scope.context.formatters
        .get("data/model-costs/calc.ts")
        ?.has("formatCurrency")
    ).toBe(true);
    // `data/model-costs/index.ts` is `export * from "./calc"` — the path the
    // repo's own caller imports the formatter by.
    expect(
      scope.context.formatters
        .get("data/model-costs/index.ts")
        ?.has("formatCurrency")
    ).toBe(true);
  });

  // The classifier keeps no currency text of its own: which code formats
  // money is the scan's rules' answer, asked of every module. One fixture per
  // code and symbol the vocabulary holds, so a code added there is covered
  // here the same day.
  it.each([...CURRENCY_CODES])(
    "classifies a formatter whose only money text is the code %s",
    (code) => {
      const { formatters, context } = classify({
        "lib/glued.ts": `export const glued = (n: number) => n + " ${code}";`,
        "lib/Shown.tsx": `export function Shown({ n }: { n: number }) { return <span>{n}&nbsp;${code}</span>; }`,
      });
      expect(exportsOf(formatters, "lib/glued.ts")).toEqual(["glued"]);
      expect(exportsOf(formatters, "lib/Shown.tsx")).toEqual(["Shown"]);
      expect(
        scanSource(
          "app/(app)/x/page.tsx",
          'import { glued } from "@/lib/glued";\n<b>{glued(x)}</b>',
          context
        ).filter((v) => v.detail.includes("currency formatter"))
      ).not.toEqual([]);
    }
  );

  it.each([...CURRENCY_SYMBOLS])(
    "classifies a formatter whose only money text is the symbol %s",
    (symbol) => {
      const { formatters } = classify({
        "lib/glued.ts": `export const glued = (n: number) => "${symbol}" + n;`,
      });
      expect(exportsOf(formatters, "lib/glued.ts")).toEqual(["glued"]);
    }
  );

  it.each<[string, string]>([
    [
      "a sign written as a unicode escape",
      'export const glued = (n: number) => "\\u20AC" + n;',
    ],
    [
      "a sign written as a character reference",
      "export const Glued = ({ n }: { n: number }) => <span>&euro;{n}</span>;",
    ],
    [
      "a code after a no-break space reference",
      "export const Glued = ({ n }: { n: number }) => <span>{n}&nbsp;CHF</span>;",
    ],
    [
      "a code shown by a conditional child",
      'export const Glued = ({ n, on }: { n: number; on: boolean }) => <span>{n}{on ? " CAD" : ""}</span>;',
    ],
    [
      "number-format options the scan cannot read",
      'export const glued = (n: number, o: Intl.NumberFormatOptions) => n.toLocaleString("en", o);',
    ],
  ])("classifies a formatter with %s", (_name, text) => {
    const { formatters } = classify({ "lib/glued.tsx": text });
    expect(formatters.get("lib/glued.tsx")?.size ?? 0).toBe(1);
  });

  it("declares the cost home's raw formatter, and nothing else of it", () => {
    expect(exportsOf(scope.context.formatters, COST_HOME)).toEqual([
      "formatCostAmount",
    ]);
  });

  it("classifies a function by its body, and a wrapper of one to a fixed point", () => {
    const { formatters, context } = classify({
      "data/money/fmt.ts": MONEY_MODULE,
      "lib/wrap.ts":
        'import { formatCurrency as base } from "@/data/money/fmt";\n' +
        'export const formatAmount = (n: number) => base(n, "USD");',
      "lib/glued.ts": "export const dollars = (n: number) => `$${n}`;",
      "lib/plain.ts": PLAIN_MODULE,
    });
    expect(exportsOf(formatters, "data/money/fmt.ts")).toEqual([
      "formatCurrency",
    ]);
    expect(exportsOf(formatters, "lib/wrap.ts")).toEqual(["formatAmount"]);
    expect(exportsOf(formatters, "lib/glued.ts")).toEqual(["dollars"]);
    expect(formatters.has("lib/plain.ts")).toBe(false);

    for (const lens of [
      'import { formatAmount } from "@/lib/wrap";\n<b>{formatAmount(x)}</b>',
      'import { formatAmount as f } from "../../../lib/wrap";\n<b>{f(x)}</b>',
    ]) {
      expect(
        scanSource("app/(app)/x/page.tsx", lens, context).map((v) => v.rule)
      ).toContain("money-value");
    }
    expect(
      scanSource(
        "app/(app)/x/page.tsx",
        'import { formatCount } from "@/data/money/fmt";\n<b>{formatCount(x)}</b>',
        context
      )
    ).toEqual([]);
  });

  it("classifies every name a module exports one under", () => {
    const { formatters } = classify(SHAPES);
    const expected: Record<string, string[]> = {
      "lib/named.ts": ["formatCurrency"],
      "lib/renamed.ts": ["asText"],
      "lib/star.ts": ["formatCurrency"],
      "lib/starNs.ts": ["fmt"],
      "lib/passedOn.ts": ["formatCurrency"],
      "lib/listed.ts": ["formatAmount"],
      "lib/defaultFn.ts": [DEFAULT_EXPORT],
      "lib/defaultName.ts": [DEFAULT_EXPORT],
      "lib/defaultAnon.ts": [DEFAULT_EXPORT],
      "lib/instance.ts": ["usd"],
      "lib/viaInstance.ts": ["formatUsd"],
      "lib/viaNamespace.ts": ["wrap"],
      "lib/viaDefault.ts": ["twice"],
      "lib/viaLoad.ts": ["later"],
    };
    for (const [file, names] of Object.entries(expected)) {
      expect(exportsOf(formatters, file), file).toEqual(names);
    }
    // A module passing on only what formats no money exports no formatter.
    expect(formatters.has("lib/notMoney.ts")).toBe(false);
    expect(formatters.has("lib/plain.ts")).toBe(false);
  });

  it("makes a wrapper of the cost home's raw formatter a formatter, but not CostFigure", () => {
    const { formatters } = classify(
      {
        [COST_HOME]:
          "export function formatCostAmount(n: number) { return n.toFixed(2); }\n" +
          "export function CostFigure() { return null; }",
        "lib/costText.ts":
          'import { formatCostAmount } from "@/components/presentation/CostFigure";\n' +
          "export const costText = (n: number) => formatCostAmount(n);",
        "lib/figure.ts":
          'import { CostFigure } from "@/components/presentation/CostFigure";\n' +
          "export const Figure = CostFigure;",
      },
      new Map([[COST_HOME, new Set(["formatCostAmount"])]])
    );
    expect(exportsOf(formatters, "lib/costText.ts")).toEqual(["costText"]);
    expect(formatters.has("lib/figure.ts")).toBe(false);
  });
});

describe("module resolution, without touching the disk", () => {
  it("resolves an alias, a relative path, an index, a trailing slash and the @cloud mirror", () => {
    const known = new Set([
      "lib/a.ts",
      "lib/runner-client/index.ts",
      "cloud-absent/nav-items.ts",
    ]);
    expect(resolveSrcModule("app/x/page.tsx", "@/lib/a", known)).toBe(
      "lib/a.ts"
    );
    expect(resolveSrcModule("app/x/page.tsx", "../../lib/a", known)).toBe(
      "lib/a.ts"
    );
    // `lib/runner-client.ts` re-exports `"./runner-client/"`; an alias with a
    // trailing slash names the same index.
    expect(
      resolveSrcModule("lib/runner-client.ts", "./runner-client/", known)
    ).toBe("lib/runner-client/index.ts");
    expect(
      resolveSrcModule("app/x/page.tsx", "@/lib/runner-client/", known)
    ).toBe("lib/runner-client/index.ts");
    // `@cloud/*` is the OSS mirror under src/ (the composed overlay is not).
    expect(resolveSrcModule("app/x/page.tsx", "@cloud/nav-items", known)).toBe(
      "cloud-absent/nav-items.ts"
    );
    expect(resolveSrcModule("app/x/page.tsx", "react", known)).toBeNull();
    expect(resolveSrcModule("app/x/page.tsx", "@/lib/none", known)).toBeNull();
  });
});

describe("a lens module reaching a currency formatter, every way it can", () => {
  const { context } = classify(SHAPES);
  const rulesOf = (source: string) =>
    scanSource("app/(app)/x/page.tsx", source, context).map((v) => v.rule);
  /** What the classifier's own rules found: nothing here is money-NAMED. */
  const formatterFindings = (source: string) =>
    scanSource("app/(app)/x/page.tsx", source, context).filter(
      (v) => v.rule === "money-value" && v.detail.includes("currency formatter")
    );

  it.each<string>([
    'import { formatCurrency } from "@/lib/named";\n<b>{formatCurrency(x, c)}</b>',
    'import { asText as m } from "@/lib/renamed";\n<b>{m(x, c)}</b>',
    'import { formatCurrency } from "@/lib/star";\n<b>{formatCurrency(x, c)}</b>',
    'import { fmt } from "@/lib/starNs";\n<b>{fmt.formatCurrency(x, c)}</b>',
    'import { formatCurrency } from "@/lib/passedOn";\n<b>{formatCurrency(x, c)}</b>',
    'import { formatAmount } from "@/lib/listed";\n<b>{formatAmount(x)}</b>',
    'import fmt from "@/lib/defaultFn";\n<b>{fmt(x)}</b>',
    'import formatAmount from "@/lib/defaultFn";\n<b>{formatAmount(x)}</b>',
    'import glue from "@/lib/defaultName";\n<b>{glue(x)}</b>',
    'import anything from "@/lib/defaultAnon";\n<b>{anything(x)}</b>',
    'import { usd } from "@/lib/instance";\n<b>{usd.format(x)}</b>',
    'import { formatUsd } from "@/lib/viaInstance";\n<b>{formatUsd(x)}</b>',
    'import * as m from "@/data/money/fmt";\n<b>{m.formatCurrency(x, c)}</b>',
    'import * as m from "@/lib/star";\n<b>{m.formatCurrency(x, c)}</b>',
    'import * as m from "@/data/money/fmt";\n<b>{m["formatCurrency"](x, c)}</b>',
    'import * as m from "@/data/money/fmt";\nconst { formatCurrency: f } = m;\nconst el = <b>{f(x, c)}</b>;',
    'import * as m from "@/data/money/fmt";\nconst { ...all } = m;',
    'import * as m from "@/data/money/fmt";\n<b>{m[key](x, c)}</b>',
    'import * as m from "@/data/money/fmt";\nrender(m);',
    'export * from "@/lib/star";',
    'export * as amounts from "@/data/money/fmt";',
    'export { formatCurrency as f } from "@/lib/star";',
    'const m = await import("@/lib/star");',
    'const Lazy = dynamic(() => import("@/data/money/fmt"));',
  ])("fails %s", (source) => {
    expect(formatterFindings(source)).not.toEqual([]);
  });

  it.each<string>([
    'import { formatCount } from "@/data/money/fmt";\n<b>{formatCount(x)}</b>',
    'import * as m from "@/data/money/fmt";\n<b>{m.formatCount(x)}</b>',
    'import * as m from "@/data/money/fmt";\nconst { formatCount } = m;',
    'import * as plain from "@/lib/plain";\nrender(plain);',
    'export * from "@/lib/plain";',
    'export { formatCount } from "@/lib/star";',
    'const m = await import("@/lib/plain");',
    'import { count } from "@/lib/viaNamespace";\n<b>{count(x)}</b>',
  ])("passes %s", (source) => {
    expect(rulesOf(source)).toEqual([]);
  });
});

/** What a fixture needs for its `<CostFigure>` to be the sanctioned one. */
const IMPORT_COST_FIGURE =
  'import { CostFigure } from "@/components/presentation";\n';

function rulesIn(
  source: string,
  file = "fixture.tsx",
  context?: ScanContext
): CostRule[] {
  return scanSource(file, source, context).map((v) => v.rule);
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
    [
      "a cost read through a renamed destructuring",
      "const { cost_usd: c } = fleet; const el = <b>{c}</b>;",
      "money-value",
    ],
    [
      "a cost read through a nested renamed destructuring",
      "const { usage: { cost_usd: c } } = fleet; const el = <b>{c}</b>;",
      "money-value",
    ],
    [
      "a cost read through a renamed parameter",
      "const Cell = ({ cost_usd: amount }) => <td>{amount}</td>;",
      "money-value",
    ],
    [
      "a cost prop read under another name",
      "function Cell({ totalCost: v }) { return <td>{v}</td>; }",
      "money-value",
    ],
    [
      "a money formatter imported under another name",
      'import { formatUsd as fmt } from "@/lib/format";',
      "money-value",
    ],
    [
      "a money-named binding re-exported under another name",
      'export { formatUsd as fmt } from "@/lib/format";',
      "money-value",
    ],
    [
      "the default export of a money-named module",
      'import fmt from "@/lib/formatUsd";',
      "money-value",
    ],
    [
      "a currency format reached through window.Intl",
      "new window.Intl.NumberFormat(l, opts);",
      "currency-format",
    ],
    [
      "a currency format through a destructured NumberFormat",
      "const { NumberFormat: NF } = Intl; new NF(l, opts);",
      "currency-format",
    ],
    [
      "a currency format through an aliased NumberFormat",
      "const NF = globalThis.Intl.NumberFormat; NF(l, { style: kind });",
      "currency-format",
    ],
    [
      "a symbol in an element of its own, before a value",
      '<td><span className="unit">$</span>{row.total}</td>',
      "glued-symbol",
    ],
    [
      "a code in an element of its own, after a value",
      "<td>{row.total}<small>USD</small></td>",
      "glued-symbol",
    ],
    ["a cent sign after a value", "<span>{x}¢</span>", "glued-symbol"],
    [
      'a code after the {" "} spacer Prettier writes',
      '<span>{x}{" "}USD</span>',
      "glued-symbol",
    ],
    [
      "a code after the spacer, in Prettier's wrapped form",
      '<span>\n  {x}{" "}\n  USD\n</span>',
      "glued-symbol",
    ],
    ["a symbol before a spacer", '<span>${" "}{x}</span>', "glued-symbol"],
    [
      "a code after an empty comment child",
      "<span>{x}{/* per run */}USD</span>",
      "glued-symbol",
    ],
    [
      "a symbol in a string child",
      '<span>{"Total: $"}{x}</span>',
      "glued-symbol",
    ],
    [
      "a currency code value after a value",
      "<td>{row.total} {row.currency}</td>",
      "glued-symbol",
    ],
    [
      "a currency code value before a value",
      "<td>{currencyCode} {amount}</td>",
      "glued-symbol",
    ],
    [
      "a currency code value in an element of its own",
      "<td>{row.total}<small>{row.currency}</small></td>",
      "glued-symbol",
    ],
    ["a figure with no leading digit", 'const s = "$.50";', "literal-figure"],
    [
      "a figure with the symbol after it",
      'const s = "12,00 €";',
      "literal-figure",
    ],
    // JSX text keeps character references raw in the syntax tree
    // (`&nbsp;USD`); the page shows the character. Every rule reads it decoded.
    [
      "a code after a no-break space reference",
      "<span>{x}&nbsp;USD</span>",
      "glued-symbol",
    ],
    [
      "a symbol before a no-break space reference",
      "<span>$&nbsp;{x}</span>",
      "glued-symbol",
    ],
    [
      "a code after a decimal no-break space",
      "<span>{x}&#160;EUR</span>",
      "glued-symbol",
    ],
    [
      "a code after a hex no-break space",
      "<span>{x}&#xA0;EUR</span>",
      "glued-symbol",
    ],
    [
      "a sign after an en space reference",
      "<span>{x}&ensp;£</span>",
      "glued-symbol",
    ],
    [
      "a code after an em space reference",
      "<span>{x}&emsp;GBP</span>",
      "glued-symbol",
    ],
    [
      "a sign after a thin space reference",
      "<span>{x}&thinsp;€</span>",
      "glued-symbol",
    ],
    [
      "a code after a zero-width space",
      "<span>{x}&#8203;USD</span>",
      "glued-symbol",
    ],
    [
      "a code after a no-break space character",
      "<span>{x} USD</span>",
      "glued-symbol",
    ],
    ["a sign written as a reference", "<span>&euro;{x}</span>", "glued-symbol"],
    [
      "a sign written as a hex reference",
      "<span>&#x20AC;{x}</span>",
      "glued-symbol",
    ],
    [
      "a cent sign written as a reference",
      "<span>{x}&cent;</span>",
      "glued-symbol",
    ],
    [
      "a code value after a no-break space reference",
      "<span>{x}&nbsp;{row.currency}</span>",
      "glued-symbol",
    ],
    [
      "a code element after a no-break space reference",
      "<span>{x}&nbsp;<small>USD</small></span>",
      "glued-symbol",
    ],
    [
      "a code element holding a no-break space reference",
      "<span>{x}<small>&nbsp;USD</small></span>",
      "glued-symbol",
    ],
    [
      "a code shown by a logical child",
      '<span>{x}{showUnit && " USD"}</span>',
      "glued-symbol",
    ],
    [
      "a code shown by a conditional child",
      '<span>{x}{showUnit ? " USD" : ""}</span>',
      "glued-symbol",
    ],
    [
      "a code shown by a ?? child",
      '<span>{x}{unit ?? " USD"}</span>',
      "glued-symbol",
    ],
    [
      "a symbol chosen by a conditional child",
      '<span>{euro ? "€" : "$"}{x}</span>',
      "glued-symbol",
    ],
    [
      "a symbol chosen by a conditional, as a child of its own",
      '<span>{euro ? "€" : "$"}</span>',
      "glued-symbol",
    ],
    [
      "a symbol element chosen by a conditional",
      '<span>{x}<small>{euro ? "€" : "$"}</small></span>',
      "glued-symbol",
    ],
    [
      "a code element after a conditional spacer",
      '<span>{x}{wide ? " " : ""}<small>USD</small></span>',
      "glued-symbol",
    ],
    [
      "a figure written with a no-break space reference",
      "<p>42&nbsp;USD</p>",
      "literal-figure",
    ],
    [
      "a figure written with a sign reference",
      "<p>&euro;42</p>",
      "literal-figure",
    ],
    [
      "a figure in an attribute, written with a reference",
      '<span title="&#36;42">x</span>',
      "literal-figure",
    ],
    [
      "the label written with a no-break space reference",
      "<span>list-price&nbsp;equivalent</span>",
      "literal-figure",
    ],
  ])("%s", (_name, source, rule) => {
    expect(rulesIn(source)).toContain(rule);
  });

  it("flags a currency formatter's import by what the formatter does, whatever it is called", () => {
    const context: ScanContext = {
      formatters: new Map([["data/fmt.ts", new Set(["formatCurrency"])]]),
      modules: new Set(["data/fmt.ts"]),
    };
    expect(
      rulesIn(
        'import { formatCurrency as f } from "@/data/fmt";\n<td>{f(fleet.amount, currency)}</td>',
        "fixture.tsx",
        context
      )
    ).toContain("money-value");
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
    [
      "type-only imports of money-named types",
      'import type { CostRow } from "@/lib/api/costs";\nimport { type PriceTier } from "@/lib/pricing";',
    ],
    [
      "a renamed destructuring of a key that is not money",
      "const { label: text } = item; const el = <b>{text}</b>;",
    ],
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
    ["a currency code shown on its own", "<p>Currency: {currency}</p>"],
    ["a spacer between a count and its noun", '<p>{count}{" "}sessions</p>'],
    [
      "a no-break space reference between a count and its noun",
      "<p>{count}&nbsp;sessions</p>",
    ],
    ["a copyright reference beside a year", "<p>&copy; 2026 Acme Corp</p>"],
    ["references that are not money", "<p>{a}&nbsp;&mdash;&nbsp;{b}</p>"],
    ["a conditional child of words", '<p>{open ? "Open" : "Closed"}</p>'],
    [
      "a logical child of a noun beside a count",
      '<p>{count}{showUnit && " runs"}</p>',
    ],
    ["a conditional that renders nothing", '<p>{n}{cond ? "" : null}</p>'],
  ])("%s", (_name, source) => {
    expect(rulesIn(source)).toEqual([]);
  });
});

describe("one currency vocabulary, read by both layers", () => {
  it.each([...CURRENCY_CODES])(
    "%s is a figure to the page check and glued to the source scan",
    (code) => {
      expect(CURRENCY_FIGURE.test(`12 ${code}`)).toBe(true);
      expect(CURRENCY_FIGURE.test(`${code} 12`)).toBe(true);
      expect(rulesIn(`<span>{x} ${code}</span>`)).toContain("glued-symbol");
      expect(rulesIn(`<span>${code} {x}</span>`)).toContain("glued-symbol");
      expect(rulesIn(`const s = \`\${x} ${code}\`;`)).toContain("glued-symbol");
    }
  );

  it.each([...CURRENCY_SYMBOLS])(
    "%s is a figure to the page check and glued to the source scan",
    (symbol) => {
      // `$` is written before its figure and `¢` after; the rest either way.
      expect(
        CURRENCY_FIGURE.test(`${symbol}12`) ||
          CURRENCY_FIGURE.test(`12${symbol}`)
      ).toBe(true);
      expect(rulesIn(`<span>{x}${symbol}</span>`)).toContain("glued-symbol");
      expect(rulesIn(`<span>${symbol}{x}</span>`)).toContain("glued-symbol");
    }
  );
});

describe("the presentation package re-exports its own CostFigure", () => {
  it("passes the barrel's re-export of CostFigure and its label, and nothing else of the kind", () => {
    const context: ScanContext = {
      formatters: new Map(),
      modules: new Set([COST_HOME, "components/presentation/index.ts"]),
    };
    expect(
      rulesIn(
        'export { CostFigure, COST_EQUIVALENT_LABEL } from "./CostFigure";',
        "components/presentation/index.ts",
        context
      )
    ).toEqual([]);
    // Its raw formatter stays flagged even from there.
    expect(
      rulesIn(
        'export { formatCostAmount } from "./CostFigure";',
        "components/presentation/index.ts",
        context
      )
    ).toContain("money-value");
    // The same names from anywhere else are flagged.
    expect(
      rulesIn('export { CostFigure } from "./CostFigure";', "fixture.tsx")
    ).toContain("money-value");
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
