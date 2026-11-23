/**
 * A `RecordRow`'s slots answer to the ROW, never the viewport.
 *
 * qontinui-web#2359 (plan
 * `2026-11-08-consoles-paint-zeros-before-the-first-read-and-the-row-reason-cap-reads-the-viewport`
 * Phase 2) made the row's root a named inline-size container
 * (`@container/record-row`) and moved the primitive's own reason from
 * `hidden sm:inline` onto it. Content a CONSUMER puts in a slot — a chip
 * group, a secondary badge, a short text — is the same kind of thing, and a
 * viewport breakpoint on it has the same defect: in a console narrowed by a
 * sidebar, a split pane or a dialog it stays revealed at a wide viewport and
 * takes the width the label (the row's identifying text) needed
 * [policy: ux-priorities/no-widget-may-hide-identifying-text,
 * ux-priorities/a-fixed-width-container-declares-its-overflow].
 *
 * The population is DISCOVERED, not listed: every non-test `.tsx` under `src/`
 * is parsed, and every `<RecordRow …>` element's props (the slots: `identity`,
 * `label`, `status`, `reason`, `time`, and the root's own `className`) are
 * walked for a `className` that carries a viewport variant. `children` — the
 * expanded detail panel below the line — is not a slot and is not walked.
 *
 * Limits, stated so they are not assumed. The walk reads the JSX written
 * INSIDE a `<RecordRow>`'s props, so it does not see:
 * - a component rendered there (`<StatusBadge>`, `<RowTime>`, a chip
 *   component), which is not followed into its own module;
 * - a slot whose value is a local variable or a prop forwarded from a wrapper
 *   (ReconciliationRow's `badges`, for example), which is not resolved;
 * - `RecordRow` imported under another name, which is not recognised.
 * A row hand-built without `RecordRow` (the agent registry's, the merge
 * train's) is outside this population by construction; those rows carry
 * their own class-contract cases.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { VIEWPORT_VARIANT } from "@/test/recordRowSlot";

const SRC = join(__dirname, "..", "..");

interface Violation {
  file: string;
  line: number;
  classes: string;
}

interface ScanResult {
  recordRows: number;
  violations: Violation[];
}

function isRecordRowTag(tag: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tag) && tag.text === "RecordRow";
}

/** Every string piece of a className expression: literals, template parts. */
function classStrings(node: ts.Node, out: { text: string; node: ts.Node }[]) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    out.push({ text: node.text, node });
  }
  ts.forEachChild(node, (child) => classStrings(child, out));
}

/** Walks one `<RecordRow>`'s attributes for viewport-variant classNames. */
function scanAttributes(
  attributes: ts.JsxAttributes,
  source: ts.SourceFile,
  file: string,
  violations: Violation[]
) {
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "className" &&
      node.initializer
    ) {
      const pieces: { text: string; node: ts.Node }[] = [];
      classStrings(node.initializer, pieces);
      for (const piece of pieces) {
        if (VIEWPORT_VARIANT.test(piece.text)) {
          violations.push({
            file,
            line:
              source.getLineAndCharacterOfPosition(piece.node.getStart(source))
                .line + 1,
            classes: piece.text.trim(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(attributes);
}

/** Scans one module's source text; the detector tests below call it directly. */
function scanSource(file: string, text: string): ScanResult {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const result: ScanResult = { recordRows: 0, violations: [] };
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      isRecordRowTag(node.tagName)
    ) {
      result.recordRows += 1;
      scanAttributes(node.attributes, source, file, result.violations);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...sourceFiles(path));
    } else if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".stories.tsx")
    ) {
      out.push(path);
    }
  }
  return out;
}

function scanTree(): ScanResult & { files: number } {
  const total: ScanResult & { files: number } = {
    recordRows: 0,
    violations: [],
    files: 0,
  };
  for (const path of sourceFiles(SRC)) {
    const text = readFileSync(path, "utf8");
    if (!text.includes("<RecordRow")) continue;
    const result = scanSource(relative(SRC, path), text);
    // Only a file that RENDERS one counts: a comment naming `<RecordRow` is
    // not a consumer.
    if (result.recordRows > 0) total.files += 1;
    total.recordRows += result.recordRows;
    total.violations.push(...result.violations);
  }
  return total;
}

describe("the detector catches the shape it names", () => {
  const row = (slots: string, children = "") =>
    `export const R = () => (<RecordRow identity="x" expanded={false} onToggle={() => {}} ${slots}>${children}</RecordRow>);`;

  it("finds a viewport reveal in a slot", () => {
    const { violations } = scanSource(
      "a.tsx",
      row(`status={<span className="hidden sm:inline">s</span>}`)
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].classes).toBe("hidden sm:inline");
  });

  it("finds one in a template literal, a cn() call and a stacked variant", () => {
    const { violations } = scanSource(
      "a.tsx",
      row(
        "label={<><span className={`hidden md:inline ${x}`} />" +
          '<span className={cn("a", "lg:flex")} />' +
          '<span className="hover:xl:block" />' +
          '<span className="max-sm:hidden" />' +
          '<span className="hidden min-md:inline" />' +
          '<span className="not-sm:flex" />' +
          '<span className="not-max-lg:hidden" />' +
          '<span className="min-[900px]:inline" /></>}'
      )
    );
    expect(violations.map((v) => v.classes)).toEqual([
      "hidden md:inline",
      "lg:flex",
      "hover:xl:block",
      "max-sm:hidden",
      "hidden min-md:inline",
      "not-sm:flex",
      "not-max-lg:hidden",
      "min-[900px]:inline",
    ]);
  });

  it("finds one on the row's own className", () => {
    const { violations } = scanSource(
      "a.tsx",
      row('className="opacity-70 sm:opacity-100"')
    );
    expect(violations).toHaveLength(1);
  });

  it("accepts the row's container variants, named and unnamed", () => {
    const { violations, recordRows } = scanSource(
      "a.tsx",
      row(
        'status={<span className="hidden @min-[45rem]/record-row:inline" />} ' +
          'label={<span className="hidden @min-[66rem]:inline" />}'
      )
    );
    expect(recordRows).toBe(1);
    expect(violations).toEqual([]);
  });

  it("does not walk the expanded detail (children) or other elements", () => {
    const { violations } = scanSource(
      "a.tsx",
      row("", '<div className="grid sm:grid-cols-2" />') +
        '\nexport const S = () => <div className="hidden sm:inline" />;'
    );
    expect(violations).toEqual([]);
  });
});

describe("every RecordRow slot in the app answers to the row", () => {
  const tree = scanTree();

  it("scanned the real population, not an empty one", () => {
    // A wrong root or a renamed primitive would otherwise pass vacuously
    // [policy: testing/a-green-run-must-prove-it-ran]. This tree renders
    // `<RecordRow>` 67 times from 52 files; the floors sit below that so the
    // census can shrink without this line going stale, while a scan of
    // nothing still reds.
    expect(tree.files).toBeGreaterThan(40);
    expect(tree.recordRows).toBeGreaterThan(50);
  });

  it("carries no viewport variant in any slot", () => {
    expect(
      tree.violations.map((v) => `${v.file}:${v.line}  ${v.classes}`)
    ).toEqual([]);
  });
});
