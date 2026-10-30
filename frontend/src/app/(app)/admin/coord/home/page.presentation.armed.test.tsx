/**
 * /admin/coord/home's no-leak guarantee, entered at the page, importing only
 * the page and the presentation test helper (plan
 * `2026-10-23-console-presentation-spaces` Phase 2).
 *
 * `page.presentation.test.tsx` is the page's full proof, but it imports the
 * lens's own modules (`_lib/homeLens`, `_components/HomeLens`, its fixture), so
 * reverting the lens fails it at compile, which says nothing about the
 * guarantee. This file imports none of them and carries its body inline, so
 * with the lens reverted it still compiles, renders, and fails on the assertion
 * below: a question's own text on the screen. That is what lets
 * `arming-record.sh prove` arm a lens symbol with `enters_via: CoordHomePage`.
 * Keep it free of imports from the lens, or it stops being able to read red by
 * assertion.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderInPresentationMode } from "@/test/presentation";

const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [],
    activeTenantId: null,
    loading: false,
    error: null,
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/coord/home",
}));

import CoordHomePage from "./page";

/**
 * One question whose texts split on the scope's confidential terms: the
 * question and its options name no term, so only the lens's descriptor keeps
 * them off the screen; the other two name one.
 */
function body() {
  const askedAt = new Date().toISOString();
  return {
    schema: 1,
    generated_at: askedAt,
    needs_me: {
      state: "read",
      total: 1,
      omitted: 0,
      items: [
        {
          source: "agent_question",
          id: "q-1",
          asked_at: askedAt,
          fork: "Ship the pilot before the audit?",
          options: ["Ship it now", "Wait a quarter"],
          recommendation: "Hold until Acme Corp signs",
          if_overturned: "The Acme Corp pilot runs without a contract",
          blocking: null,
        },
      ],
    },
  };
}

describe("the presented page", () => {
  it("never shows a question's own text", async () => {
    httpFetch.mockImplementation(
      async () => new Response(JSON.stringify(body()))
    );
    renderInPresentationMode(<CoordHomePage />, {
      scope: {
        status: "ready",
        scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme"] },
      },
    });
    const row = await waitFor(() =>
      screen.getByTestId("coord-home.needs-you.row")
    );

    /** The whole DOM, attributes included, so a `title` cannot carry it. */
    const expectNoOwnText = () => {
      const html = document.body.innerHTML.toLowerCase();
      for (const own of [
        "acme",
        "ship the pilot",
        "ship it now",
        "wait a quarter",
        "without a contract",
      ]) {
        expect(html, own).not.toContain(own);
      }
    };
    expectNoOwnText();
    // What stands in for the text is the item's own fixed fields, its age known.
    expect(row).toHaveTextContent(/Question · area unknown · decide · /);
    expect(row).not.toHaveTextContent("age unknown");

    // Its detail holds the recommendation, the consequence and the options.
    fireEvent.click(row.querySelector("[data-console-row]") as Element);
    expect(row).toHaveTextContent(/Recommended: Recommendation · /);
    expect(row).toHaveTextContent(/If you overturn it: Consequence · /);
    expect(row).toHaveTextContent(/Options: Options · /);
    expectNoOwnText();
  });
});
