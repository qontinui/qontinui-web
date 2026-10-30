/**
 * The digital twin entered with `?present=1` while the presentation scope
 * cannot be read: its lens bar says every title is withheld, as the console's
 * header does (`admin/coord/layout.scope-unknown.population.test.tsx`).
 *
 * The REAL layout and lens; only the read and the router's search params are
 * faked. Its own file, because the scope store is module-wide and this test
 * needs it to have read nothing yet.
 */

import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
vi.mock("@/lib/api/presentationScope", () => ({
  fetchPresentationScope: vi.fn(async () => {
    throw new Error("coord is down");
  }),
  savePresentationScope: vi.fn(),
}));

import DigitalTwinLayout from "./layout";

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("DigitalTwinLayout — presenting on a scope that cannot be read", () => {
  it("says every title is withheld in the lens bar, in its own words", async () => {
    window.history.replaceState(null, "", "/digital-twin?present=1");
    const { container } = render(
      <DigitalTwinLayout>
        <p>Twin page</p>
      </DigitalTwinLayout>
    );

    const bar = screen.getByTestId("digital-twin-lens-bar");
    expect(
      await within(bar).findByTestId("presentation-scope-failed-notice")
    ).toHaveTextContent("Titles withheld: scope unknown");
    expect(container.innerHTML).not.toContain("coord is down");
  });
});
