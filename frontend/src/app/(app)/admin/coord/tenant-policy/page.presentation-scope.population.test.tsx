/**
 * The presentation scope form, entered the way its population enters it (plan
 * `2026-10-23-console-presentation-spaces` D3.3: both lists are tenant data,
 * "editable in operator mode only" — on this page).
 *
 * The REAL tenant-policy page, with every panel on it, as an operator sees it
 * (no presentation lens above it: in operator mode none is needed); what is
 * faked is only the network (`httpClient`, which the scope read, the scope
 * save and the other panels' policy reads all go through). The other panels
 * get a 404 and render their own labelled failure, which is not under test
 * here.
 * The file imports nothing the phase added, so without the phase it fails on
 * its assertions, not on an import.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

const wire = vi.hoisted(() => {
  const record = (version: number, terms: string[]) => ({
    tenant_id: "00000000-0000-0000-0000-00000000000a",
    first_party_owners: ["qontinui"],
    first_party_owners_source: "configured",
    first_party_owners_unknown_reason: null,
    // The effective terms add the viewer's other project; the stored half
    // (`configured`) does not.
    confidential_terms: [...terms, "Partner Portal"],
    configured: {
      first_party_owners: ["qontinui"],
      confidential_terms: terms,
      version,
      updated_at: "2026-10-23T12:00:00Z",
      updated_by: "admin@example.test",
    },
    defaults: {
      registered_repo_owners: ["qontinui"],
      registered_repo_owners_unknown_reason: null,
      viewer_other_tenant_names: ["Partner Portal"],
    },
    can_edit: true,
  });
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    puts: [] as unknown[],
    respond(url: string, init: { method?: string; body?: unknown } = {}) {
      if (url.includes("/presentation/scope")) {
        if (init.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            confidential_terms: string[];
          };
          this.puts.push(body);
          return json(record(4, body.confidential_terms));
        }
        return json(record(3, ["Acme Corp"]));
      }
      return new Response("null", { status: 404 });
    },
  };
});

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: { method?: string; body?: unknown }) =>
      wire.respond(url, init),
  },
}));

import TenantPolicyPage from "./page";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  wire.puts.length = 0;
  window.history.replaceState(null, "", "/admin/coord/tenant-policy");
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("/admin/coord/tenant-policy — the presentation scope", () => {
  it("lets an admin replace the project's stored presentation scope, seeded from what is stored", async () => {
    render(<TenantPolicyPage />);

    const terms = (await screen.findByTestId(
      "presentation-scope-terms-input"
    )) as HTMLTextAreaElement;
    // The stored term only: never the viewer's other project.
    expect(terms.value).toBe("Acme Corp");

    fireEvent.change(terms, { target: { value: "Acme Corp\nGlobex" } });
    fireEvent.click(screen.getByTestId("presentation-scope-save"));
    expect(
      await screen.findByTestId("presentation-scope-saved")
    ).toHaveTextContent("version 4");
    expect(wire.puts).toEqual([
      {
        first_party_owners: ["qontinui"],
        confidential_terms: ["Acme Corp", "Globex"],
        expected_version: 3,
        // The project the stored scope was read for: the write is refused if
        // the request resolves to another.
        expected_tenant_id: "00000000-0000-0000-0000-00000000000a",
      },
    ]);
  });
});
