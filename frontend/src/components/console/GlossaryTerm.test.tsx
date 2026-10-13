/**
 * GlossaryTerm (plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * Phase C3): the definition shown is the generated table's `short`, byte for
 * byte, with no request; and every `<GlossaryTerm id>` in the tree names a
 * term the generated glossary defines.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GLOSSARY, isGlossaryTerm } from "@qontinui/shared-types/glossary";

import { GlossaryTerm } from "./GlossaryTerm";

const SRC = join(__dirname, "..", "..");

/** Every `.tsx` under `src/`, tests excluded. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (name.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** `<GlossaryTerm … id=…>` openings, with the id attribute's raw value. */
const USAGE = /<GlossaryTerm\b([^>]*)>/g;
const ID_ATTR = /\bid=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\}|\{([^}]*)\})/;

describe("GlossaryTerm", () => {
  it("shows the generated definition, byte for byte, on focus", async () => {
    render(<GlossaryTerm id="gate" />);
    const trigger = screen.getByText(GLOSSARY.gate.term);
    expect(trigger.getAttribute("data-glossary-term")).toBe("gate");
    fireEvent.focus(trigger);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe(GLOSSARY.gate.short);
  });

  it("renders the caller's words in place of the display name", () => {
    render(<GlossaryTerm id="work_unit">work units</GlossaryTerm>);
    const trigger = screen.getByText("work units");
    expect(trigger.getAttribute("data-glossary-term")).toBe("work_unit");
    // Keyboard-reachable: the definition is not hover-only.
    expect(trigger.tabIndex).toBe(0);
  });

  it("renders with no request — the glossary is compiled in", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<GlossaryTerm id="merge_train" />);
    fireEvent.focus(screen.getByText(GLOSSARY.merge_train.term));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("every <GlossaryTerm id> in the tree", () => {
  const files = sourceFiles(SRC);
  const usages: { file: string; id: string | null; raw: string }[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(USAGE)) {
      const attrs = m[1];
      const id = ID_ATTR.exec(attrs);
      usages.push({
        file: relative(SRC, file),
        id: id ? (id[1] ?? id[2] ?? null) : null,
        raw: m[0],
      });
    }
  }

  it("finds the adoption sites (the scan is not vacuous)", () => {
    const sites = new Set(usages.map((u) => u.file));
    // The /admin/coord/* column headers and empty states this primitive was
    // first adopted on (C3). A scan that stopped seeing them would pass
    // everything below by seeing nothing.
    for (const expected of [
      "app/(app)/admin/coord/gates/_components/GatesTable.tsx",
      "app/(app)/admin/coord/work-units/page.tsx",
      "app/(app)/admin/coord/findings/page.tsx",
    ]) {
      expect(sites, expected).toContain(expected);
    }
    expect(usages.length).toBeGreaterThanOrEqual(10);
  });

  it("names a term the generated glossary defines", () => {
    const bad = usages.filter((u) => u.id !== null && !isGlossaryTerm(u.id));
    expect(bad).toEqual([]);
  });

  it("uses a literal id, or one the type system checked", () => {
    // A non-literal id (`id={term}`) is allowed only where the expression is
    // already typed as the union — the component's own prop type enforces
    // that at compile time. The literal ids are what this scan can check.
    const dynamic = usages.filter((u) => u.id === null);
    for (const u of dynamic) {
      expect(u.raw, u.file).toMatch(/\bid=\{/);
    }
  });
});
