/**
 * Driving `/admin/coord/home`'s disclosures from a page test, shared by the
 * page tests that render it. `page.presentation.armed.test.tsx` must not import
 * this: it stays free of everything but the page and the presentation helper.
 */

import { expect } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

/** The page's collapsible panels, by testid, with their toggle's name. */
const PANELS: ReadonlyArray<readonly [string, RegExp]> = [
  ["coord-home.degrading.cleared", /Recently cleared/],
  ["coord-home.does-not-know.read", /Sources read/],
];

/** Open the "Sources read" panel of What this view does not know. */
export function openSourcesRead(): HTMLElement {
  const panel = screen.getByTestId("coord-home.does-not-know.read");
  const toggle = within(panel).getByRole("button", { name: /Sources read/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return panel;
}

/**
 * Run `check` on the page as rendered, then behind every disclosure: each
 * collapsible panel opened (recently cleared, sources read), then every record row expanded in turn (a
 * list keeps one row open, so each is checked open on its own).
 *
 * The rows are collected once, after the panels open and before any row is
 * expanded: a record row that appears only inside another row's expanded
 * detail is checked as part of that detail, but is never itself expanded.
 */
export function checkBehindEveryDisclosure(check: () => void) {
  check();
  for (const [testId, name] of PANELS) {
    const panel = screen.queryByTestId(testId);
    if (!panel) continue;
    const toggle = within(panel).getByRole("button", { name });
    if (toggle.getAttribute("aria-expanded") !== "true")
      fireEvent.click(toggle);
    check();
  }
  const rows = [...document.querySelectorAll("[data-console-row]")];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    if (row.getAttribute("aria-expanded") !== "true") fireEvent.click(row);
    check();
  }
}

/** Expand the record row in `region` whose line shows `text`. */
export function expandRow(region: HTMLElement, text: string | RegExp) {
  const row = [...region.querySelectorAll("[data-console-row]")].find((r) =>
    typeof text === "string"
      ? (r.textContent ?? "").includes(text)
      : text.test(r.textContent ?? "")
  );
  if (!row) throw new Error(`no row showing ${String(text)}`);
  if (row.getAttribute("aria-expanded") !== "true") fireEvent.click(row);
  // `RecordRow`'s own wrapper: the line, and its detail once expanded.
  return row.parentElement as HTMLElement;
}
