/**
 * Driving `/admin/coord/home`'s disclosures from a page test, shared by the
 * page tests that render it. `page.presentation.armed.test.tsx` must not import
 * this: it stays free of everything but the page and the presentation helper.
 */

import { expect } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Run `check` on the page as rendered, then behind every disclosure: the
 * recently-cleared panel opened, then every record row expanded in turn (a
 * list keeps one row open, so each is checked open on its own).
 */
export function checkBehindEveryDisclosure(check: () => void) {
  check();
  const cleared = screen.queryByTestId("coord-home.degrading.cleared");
  if (cleared) {
    fireEvent.click(
      within(cleared).getByRole("button", { name: /Recently cleared/ })
    );
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
