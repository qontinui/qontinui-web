/**
 * Component test for /admin/coord/findings.
 *
 * Plan `2026-09-15-the-console-names-a-finding-it-cannot-open`, Phase 2.
 *
 * The contracts pinned here are the ones the plan is about:
 *
 *  - `?id=<uuid>` EXPANDS the linked row (and does not scroll — nothing under
 *    `admin/coord/` does, and the by-id read is what makes the expansion
 *    reachable from a cold page with a filter already on);
 *  - the by-id read is its OWN request, so the link survives a filter that
 *    excludes the row and an expiry that has lapsed;
 *  - the "expired" and "not found" banner arms are DISTINCT, pinned by
 *    mutation: the same row, one boolean apart, must not produce one sentence;
 *  - the FIRST render says "looking", never "no such finding";
 *  - the six accepted query keys are the only ones sent;
 *  - `triaged=false` carries its own narrowness caveat on screen;
 *  - a malformed `?id=` is never sent, a by-id answer is accepted only for the
 *    id asked for, and the by-id read's own degrade never reads as "not found".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
}));

import CoordFindingsPage from "./page";

const ID_A = "fec41291-67ed-4cf8-b331-888ad1126b45";
const ID_B = "0f4d1a2b-6c8e-4f10-9a33-2b7c5d8e1f90";

/** Far enough ahead to be inside an ordinary retention window. */
const SOON = new Date(Date.now() + 9 * 86_400_000).toISOString();
/** Already lapsed. */
const LAPSED = new Date(Date.now() - 9 * 86_400_000).toISOString();
/** A dossier head's hundred-year TTL. */
const CENTURY = new Date(Date.now() + 100 * 365 * 86_400_000).toISOString();

function finding(over: Record<string, unknown> = {}) {
  return {
    finding_id: ID_A,
    title: "A created document sends no notice",
    body: "The console printed the uuid and nothing could open it.",
    kind: "observation",
    topic: "prompt-documents",
    scope: "tenant",
    resource_keys: ["repo:qontinui-web"],
    artifact_refs: null,
    author_session: "session:9f1e",
    created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    expires_at: SOON,
    triaged_at: null,
    triaged_by: null,
    supersedes: null,
    tenant_id: null,
    ...over,
  };
}

function page(
  rows: Record<string, unknown>[],
  over: Record<string, unknown> = {}
) {
  return {
    available: true,
    count: rows.length,
    findings: rows,
    // coord's shapes: a COUNT of applied resource keys, and the triage
    // filter's wire spelling ("any" | "false" | "true").
    finding_id_applied: null,
    kind_applied: null,
    limit: 50,
    resource_keys_applied: 0,
    resource_keys_truncated: false,
    triaged_applied: "any",
    ...over,
  };
}

/** Every URL `httpClient.get` was called with, in order. */
function urls(): string[] {
  return httpGet.mock.calls.map((c) => String(c[0]));
}

/** The MOST RECENT list read — the filters test asserts about the newest one. */
function listUrl(): string {
  return [...urls()].reverse().find((u) => !u.includes("finding_id=")) ?? "";
}

describe("CoordFindingsPage", () => {
  beforeEach(() => {
    httpGet.mockReset();
    window.history.replaceState({}, "", "/");
  });

  it("renders a row per finding, with the title and no uuid in the default view", async () => {
    httpGet.mockResolvedValue(
      page([finding(), finding({ finding_id: ID_B, title: "Second" })])
    );
    render(<CoordFindingsPage />);

    expect(await screen.findAllByTestId("coord-finding-row")).toHaveLength(2);
    expect(
      screen.getByText("A created document sends no notice")
    ).toBeInTheDocument();
    // R8: the raw id lives in the expanded detail, not on the row.
    expect(screen.queryByTestId(`coord-finding-id-${ID_A}`)).toBeNull();
  });

  it("sends only the six accepted keys, and only the ones set", async () => {
    httpGet.mockResolvedValue(page([]));
    render(<CoordFindingsPage />);
    await waitFor(() => expect(httpGet).toHaveBeenCalled());

    const query = new URLSearchParams(listUrl().split("?")[1] ?? "");
    expect([...query.keys()]).toEqual(["limit"]);

    await userEvent.type(screen.getByTestId("coord-findings-topic"), "coord");
    await waitFor(() => expect(listUrl()).toMatch(/topic=coord/));
    const after = new URLSearchParams(listUrl().split("?")[1] ?? "");
    for (const key of after.keys()) {
      expect([
        "finding_id",
        "resource_keys",
        "topic",
        "kind",
        "limit",
        "triaged",
      ]).toContain(key);
    }
  });

  it("sends triaged=false for untriaged-only, and says why the count narrows", async () => {
    httpGet.mockResolvedValue(page([finding()]));
    render(<CoordFindingsPage />);
    await waitFor(() => expect(httpGet).toHaveBeenCalled());

    expect(screen.queryByTestId("coord-findings-triage-caveat")).toBeNull();

    await userEvent.click(screen.getByTestId("coord-findings-triaged"));
    await userEvent.click(await screen.findByText("Not yet read"));

    await waitFor(() => expect(listUrl()).toMatch(/triaged=false/));
    // Two numbers must never disagree in silence.
    const caveat = await screen.findByTestId("coord-findings-triage-caveat");
    expect(caveat).toHaveTextContent(/dossier heads/i);
    expect(caveat).toHaveTextContent(/other tenants/i);
  });

  it("shows a dossier head as KEPT, never as expiring", async () => {
    httpGet.mockResolvedValue(
      page([finding({ kind: "dossier", expires_at: CENTURY })])
    );
    render(<CoordFindingsPage />);

    const row = await screen.findByTestId("coord-finding-row");
    const badge = row.querySelector("[data-status-kind]");
    expect(badge).toHaveAttribute("data-status-kind", "durable");
    expect(badge).toHaveTextContent(/kept indefinitely/i);
    // Never a countdown. The label is the claim; the reason beside it is
    // allowed to use the word while denying it ("kept rather than expiring").
    expect(badge).not.toHaveTextContent(/expires? in/i);
    expect(row).not.toHaveTextContent(/expired/i);
  });

  it("states expiry as a fact on an expired row rather than hiding it", async () => {
    httpGet.mockResolvedValue(page([finding({ expires_at: LAPSED })]));
    render(<CoordFindingsPage />);

    const row = await screen.findByTestId("coord-finding-row");
    const badge = row.querySelector("[data-status-kind]");
    expect(badge).toHaveAttribute("data-status-kind", "expired");
    expect(badge).toHaveTextContent(/expired/i);
  });

  it("puts the raw ids, the kind and the routed dossier in the expanded detail", async () => {
    httpGet.mockResolvedValue(
      page([
        finding({
          artifact_refs: { dossier_slug: "worktree-siblings" },
          triaged_at: new Date().toISOString(),
          triaged_by: "findings-steward",
        }),
      ])
    );
    render(<CoordFindingsPage />);

    await userEvent.click(
      await screen.findByRole("button", { expanded: false })
    );

    const detail = await screen.findByTestId(`coord-finding-detail-${ID_A}`);
    expect(
      within(detail).getByTestId(`coord-finding-id-${ID_A}`)
    ).toHaveTextContent(ID_A);
    expect(
      within(detail).getByTestId(`coord-finding-dossier-${ID_A}`)
    ).toHaveTextContent(/worktree-siblings/);
    expect(
      within(detail).getByTestId(`coord-finding-dossier-${ID_A}`)
    ).toHaveTextContent(/findings-steward/);
  });

  it("keeps the finding's kind enum off the screen and in a data attribute", async () => {
    httpGet.mockResolvedValue(page([finding({ kind: "observation" })]));
    render(<CoordFindingsPage />);

    const row = await screen.findByTestId("coord-finding-row");
    expect(
      row.querySelector('[data-finding-kind="observation"]')
    ).not.toBeNull();
    // The collapsed row says the topic, not the kind.
    expect(row).toHaveTextContent("prompt-documents");
    expect(row).not.toHaveTextContent("observation");
  });

  describe("the ?id= deep link", () => {
    function withLinkedId(id = ID_A) {
      window.history.replaceState({}, "", `/?id=${id}`);
    }

    const originalScrollIntoView = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it("reads the finding BY ID, separately from the filtered list", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=") ? page([finding()]) : page([])
        )
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(urls().some((u) => u.includes(`finding_id=${ID_A}`))).toBe(true)
      );
    });

    it("EXPANDS the linked row — it does not scroll", async () => {
      withLinkedId();
      // The list read excludes it (an empty page); the by-id read serves it.
      // That is the case the separate request exists for.
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=") ? page([finding()]) : page([])
        )
      );
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(
          screen.getByRole("button", { expanded: true })
        ).toBeInTheDocument()
      );
      expect(
        screen.getByTestId(`coord-finding-detail-${ID_A}`)
      ).toBeInTheDocument();
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
        /expanded below/i
      );
    });

    it("says 'looking', not 'not found', on the first render", async () => {
      withLinkedId();
      // A read that never settles: the first paint is exactly the state the
      // banner's arm order exists to get right.
      httpGet.mockImplementation(() => new Promise(() => {}));
      render(<CoordFindingsPage />);

      const banner = await screen.findByTestId("coord-findings-linked");
      expect(banner).toHaveTextContent(/looking for the linked finding/i);
      expect(banner).not.toHaveTextContent(/another tenant/i);
      expect(banner).not.toHaveTextContent(/no finding/i);
    });

    it("keeps the EXPIRED and NOT-FOUND arms distinct, one boolean apart", async () => {
      // The mutation. Same page, same request, and the only difference is
      // whether coord served a row — an expired row IS found, and reporting it
      // as missing while it sits expanded on screen is the failure this arm
      // was added for.
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? page([finding({ expires_at: LAPSED })])
            : page([])
        )
      );
      const expiredView = render(<CoordFindingsPage />);
      const expiredLine = (await screen.findByTestId("coord-findings-linked"))
        .textContent;
      expect(expiredLine).toMatch(/expanded below/i);
      expect(expiredLine).toMatch(/past its retention window/i);
      expiredView.unmount();

      httpGet.mockReset();
      httpGet.mockResolvedValue(page([]));
      render(<CoordFindingsPage />);
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /another tenant/i
        )
      );
      const missingLine = screen.getByTestId(
        "coord-findings-linked"
      ).textContent;
      expect(missingLine).not.toMatch(/expanded below/i);
      expect(missingLine).not.toEqual(expiredLine);
    });

    it("blames the read, not the id, when the by-id look-up throws", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? Promise.reject(new Error("GET … failed: 500 - boom"))
          : Promise.resolve(page([]))
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /read failed/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /another tenant/i
      );
    });

    it("never sends a malformed id, and names the LINK as the problem", async () => {
      withLinkedId("not-a-uuid");
      httpGet.mockResolvedValue(page([]));
      render(<CoordFindingsPage />);

      const banner = await screen.findByTestId("coord-findings-linked");
      expect(banner).toHaveTextContent(/not a finding id/i);
      expect(banner).not.toHaveTextContent(/read failed/i);
      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(urls().some((u) => u.includes("finding_id="))).toBe(false);
    });

    it("accepts a by-id answer only for the id it asked for", async () => {
      // A door that IGNORED `finding_id` still answers with a well-formed page.
      // Taking its first row on trust would expand some other finding under a
      // banner saying it is the linked one.
      withLinkedId();
      httpGet.mockResolvedValue(page([finding({ finding_id: ID_B })]));
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /no finding with that id/i
        )
      );
      expect(screen.queryByRole("button", { expanded: true })).toBeNull();
    });

    it("reports the BY-ID read's own degrade, even while the list is still out", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? Promise.resolve({
              available: false,
              count: 0,
              findings: [],
              unavailable:
                "coord did not answer the findings store (HTTP 503).",
              unavailable_kind: "unreachable",
            })
          : new Promise(() => {})
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not answering/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /another tenant/i
      );
    });

    it("re-issues the by-id read from the refresh control", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? Promise.reject(new Error("GET … failed: 500 - boom"))
          : Promise.resolve(page([]))
      );
      render(<CoordFindingsPage />);
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /refresh to retry/i
        )
      );
      const before = urls().filter((u) => u.includes("finding_id=")).length;

      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=") ? page([finding()]) : page([])
        )
      );
      await userEvent.click(
        screen.getByRole("button", { name: /refresh findings/i })
      );

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /expanded below/i
        )
      );
      expect(urls().filter((u) => u.includes("finding_id=")).length).toBe(
        before + 1
      );
    });
  });

  describe("degraded reads", () => {
    it("says coord is not answering rather than showing an empty store", async () => {
      httpGet.mockResolvedValue({
        available: false,
        count: 0,
        findings: [],
        unavailable:
          "coord has no findings reader yet — its route has not deployed.",
        unavailable_kind: "not_deployed",
      });
      render(<CoordFindingsPage />);

      expect(
        await screen.findByTestId("coord-findings-unavailable")
      ).toHaveTextContent(/has not deployed/i);
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /could not be read/i
      );
      // The empty state must not contradict the banner above it.
      expect(screen.queryByText(/no findings match/i)).toBeNull();
      expect(screen.getByTestId("coord-findings-unknown")).toHaveTextContent(
        /unknown/i
      );
    });

    it("says UNKNOWN, not 'no findings match', after a failed first read", async () => {
      httpGet.mockRejectedValue(new Error("GET … failed: 500 - boom"));
      render(<CoordFindingsPage />);

      expect(
        await screen.findByTestId("coord-findings-unknown")
      ).toHaveTextContent(/unknown, not none/i);
    });

    it("says UNKNOWN, not 'no findings match', when a NEW filter's read fails", async () => {
      // First read lands; the operator types a filter; that read fails. The
      // cleared list must read as unknown for the new query — `loaded` from the
      // previous query must not make it claim "no findings match".
      httpGet.mockResolvedValueOnce(page([finding()]));
      render(<CoordFindingsPage />);
      await screen.findByTestId("coord-finding-row");

      httpGet.mockRejectedValue(new Error("GET … failed: 400 - unknown kind"));
      await userEvent.type(screen.getByTestId("coord-findings-kind"), "g");

      expect(
        await screen.findByTestId("coord-findings-unknown")
      ).toHaveTextContent(/unknown, not none/i);
      expect(screen.queryByText(/no findings match/i)).toBeNull();
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /could not read the findings store/i
      );
    });

    it("renders an honest empty state when coord CONFIRMS nothing matches", async () => {
      httpGet.mockResolvedValue(page([]));
      render(<CoordFindingsPage />);

      expect(
        await screen.findByText(/no findings match these filters/i)
      ).toBeInTheDocument();
      expect(screen.queryByTestId("coord-findings-unknown")).toBeNull();
    });
  });
});
