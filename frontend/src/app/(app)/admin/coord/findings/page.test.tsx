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
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
}));

import CoordFindingsPage from "./page";

/**
 * The empty state wraps "findings" in a `GlossaryTerm`, so its sentence spans
 * elements and a plain text matcher would find nothing — which would make the
 * `toBeNull()` assertions below pass vacuously. Match the paragraph's whole
 * text instead.
 */
function emptyStateText(re: RegExp) {
  return (_: string, el: Element | null) =>
    el?.tagName === "P" && re.test(el.textContent ?? "");
}

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

    it("names an unprovisioned store on the BY-ID degrade, not 'not answering'", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? Promise.resolve({
              available: false,
              count: 0,
              findings: [],
              unavailable:
                "coord reports its findings store is not provisioned (`available: false`).",
              unavailable_kind: "unprovisioned",
            })
          : new Promise(() => {})
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not provisioned/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /not answering/i
      );
    });

    it("names the LIST degrade's kind while the by-id read is still out", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? new Promise(() => {})
          : Promise.resolve({
              available: false,
              count: 0,
              findings: [],
              unavailable:
                "coord reports its findings store is not provisioned (`available: false`).",
              unavailable_kind: "unprovisioned",
            })
      );
      render(<CoordFindingsPage />);

      await screen.findByTestId("coord-findings-unavailable");
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not provisioned/i
        )
      );
    });

    it("lets the BY-ID degrade's kind outrank the list's once it answers", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? {
                available: false,
                count: 0,
                findings: [],
                unavailable: "coord's findings reader is not answering.",
                unavailable_kind: "not_deployed",
              }
            : {
                available: false,
                count: 0,
                findings: [],
                unavailable:
                  "coord reports its findings store is not provisioned (`available: false`).",
                unavailable_kind: "unprovisioned",
              }
        )
      );
      render(<CoordFindingsPage />);

      await screen.findByTestId("coord-findings-unavailable");
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not answering/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /not provisioned/i
      );
    });

    it("styles a BY-ID degrade as severe when it is the only degrade on screen", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? {
                available: false,
                count: 0,
                findings: [],
                unavailable:
                  "coord did not answer the findings store (HTTP 503).",
                unavailable_kind: "unreachable",
              }
            : page([finding({ finding_id: ID_B })])
        )
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not answering/i
        )
      );
      expect(screen.queryByTestId("coord-findings-unavailable")).toBeNull();
      expect(
        screen.getByTestId("coord-findings-linked").getAttribute("data-severe")
      ).toBe("true");
    });

    it("keeps a not_deployed BY-ID degrade muted — the one benign kind", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? {
                available: false,
                count: 0,
                findings: [],
                unavailable: "coord's findings reader is not answering.",
                unavailable_kind: "not_deployed",
              }
            : page([finding({ finding_id: ID_B })])
        )
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not answering/i
        )
      );
      expect(
        screen.getByTestId("coord-findings-linked").getAttribute("data-severe")
      ).toBe("false");
    });

    it("follows the LIST degrade's severity while the by-id read is still out", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? new Promise(() => {})
          : Promise.resolve({
              available: false,
              count: 0,
              findings: [],
              unavailable: "coord's findings reader is not answering.",
              unavailable_kind: "not_deployed",
            })
      );
      render(<CoordFindingsPage />);

      await screen.findByTestId("coord-findings-unavailable");
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /cannot be looked up/i
        )
      );
      expect(
        screen.getByTestId("coord-findings-linked").getAttribute("data-severe")
      ).toBe("false");
    });

    it("never styles a malformed id as a degrade, even under a severe list degrade", async () => {
      withLinkedId("not-a-uuid");
      httpGet.mockResolvedValue({
        available: false,
        count: 0,
        findings: [],
        unavailable: "coord did not answer the findings store (HTTP 503).",
        unavailable_kind: "unreachable",
      });
      render(<CoordFindingsPage />);

      await screen.findByTestId("coord-findings-unavailable");
      const banner = screen.getByTestId("coord-findings-linked");
      expect(banner).toHaveTextContent(/not a finding id/i);
      expect(banner.getAttribute("data-severe")).toBe("false");
    });

    it("does not style an authoritative by-id answer as a degrade, whatever the list did", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? page([])
            : {
                available: false,
                count: 0,
                findings: [],
                unavailable:
                  "coord did not answer the findings store (HTTP 503).",
                unavailable_kind: "unreachable",
              }
        )
      );
      render(<CoordFindingsPage />);

      await screen.findByTestId("coord-findings-unavailable");
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-findings-linked")
        ).not.toHaveTextContent(/cannot be looked up|looking for/i)
      );
      expect(
        screen.getByTestId("coord-findings-linked").getAttribute("data-severe")
      ).toBe("false");
    });

    it("does not call a linked row beyond a FULL page 'outside the filters'", async () => {
      // One page, no paging: 50 newer rows prove nothing about the rows past
      // them, so the linked row may match the filters and simply sit beyond.
      withLinkedId();
      const full = Array.from({ length: 50 }, (_, i) =>
        finding({
          finding_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        })
      );
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=") ? page([finding()]) : page(full)
        )
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not among the rows loaded/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /outside the current filters/i
      );
    });

    it("a by-id throw after a by-id degrade names the failure, not the degrade", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? {
                available: false,
                count: 0,
                findings: [],
                unavailable:
                  "coord did not answer the findings store (HTTP 503).",
                unavailable_kind: "unreachable",
              }
            : page([])
        )
      );
      render(<CoordFindingsPage />);
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not answering/i
        )
      );

      httpGet.mockImplementation((url: string) =>
        String(url).includes("finding_id=")
          ? Promise.reject(new Error("GET … failed: 500 - boom"))
          : Promise.resolve(page([]))
      );
      await userEvent.click(
        screen.getByRole("button", { name: /refresh findings/i })
      );

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /refresh to retry/i
        )
      );
    });

    it("keeps the linked row expanded across a filter change", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=") ? page([finding()]) : page([])
        )
      );
      render(<CoordFindingsPage />);
      await waitFor(() =>
        expect(
          screen.getByTestId(`coord-finding-detail-${ID_A}`)
        ).toBeInTheDocument()
      );

      await userEvent.type(screen.getByTestId("coord-findings-topic"), "x");
      await waitFor(() => expect(listUrl()).toMatch(/topic=x/));

      expect(
        screen.getByTestId(`coord-finding-detail-${ID_A}`)
      ).toBeInTheDocument();
      expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
        /expanded below/i
      );
      // A filter IS set and the page is short: now "outside" is licensed.
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /outside the current filters/i
        )
      );
    });

    it("with NO filter set, never claims the row is outside the filters", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=") ? page([finding()]) : page([])
        )
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /not among the rows loaded/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /outside the current filters/i
      );
    });

    it("names expiry for an expired linked row the list leaves out", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? page([finding({ expires_at: LAPSED })])
            : page([])
        )
      );
      render(<CoordFindingsPage />);

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /lists leave out expired findings/i
        )
      );
      expect(screen.getByTestId("coord-findings-linked")).not.toHaveTextContent(
        /outside the current filters/i
      );
    });

    it("says NOT FOUND when the by-id read answered, even if the list degraded", async () => {
      withLinkedId();
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("finding_id=")
            ? page([])
            : {
                available: false,
                count: 0,
                findings: [],
                unavailable:
                  "coord did not answer the findings store (HTTP 503).",
                unavailable_kind: "unreachable",
              }
        )
      );
      render(<CoordFindingsPage />);

      // The setup this test is about: the LIST degrade is on screen.
      await screen.findByTestId("coord-findings-unavailable");
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
          /no finding with that id/i
        )
      );
      expect(
        screen.getByTestId("coord-findings-unavailable")
      ).toBeInTheDocument();
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

      const banner = await screen.findByTestId("coord-findings-unavailable");
      expect(banner).toHaveTextContent(/has not deployed/i);
      // `not_deployed` is the one benign reading — no amber/severe chrome.
      expect(banner.getAttribute("data-severe")).toBe("false");
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /could not be read/i
      );
      // The empty state must not contradict the banner above it.
      expect(
        screen.queryByText(emptyStateText(/no findings match/i))
      ).toBeNull();
      expect(screen.getByTestId("coord-findings-unknown")).toHaveTextContent(
        /unknown/i
      );
    });

    it("shows an unreachable coord as the severe (amber) case, not the calm one", async () => {
      httpGet.mockResolvedValue({
        available: false,
        count: 0,
        findings: [],
        unavailable: "coord did not answer the findings store (HTTP 503).",
        unavailable_kind: "unreachable",
      });
      render(<CoordFindingsPage />);

      const banner = await screen.findByTestId("coord-findings-unavailable");
      expect(banner.getAttribute("data-severe")).toBe("true");
    });

    it("shows an unprovisioned store as severe — R3's floor for UNKNOWN, never calm", async () => {
      httpGet.mockResolvedValue({
        available: false,
        count: 0,
        findings: [],
        unavailable:
          "coord reports its findings store is not provisioned (`available: false`).",
        unavailable_kind: "unprovisioned",
      });
      render(<CoordFindingsPage />);

      const banner = await screen.findByTestId("coord-findings-unavailable");
      expect(banner.getAttribute("data-severe")).toBe("true");
    });

    it("defaults to severe when an older backend omits unavailable_kind", async () => {
      httpGet.mockResolvedValue({
        available: false,
        count: 0,
        findings: [],
        unavailable: "coord did not answer the findings store (HTTP 500).",
      });
      render(<CoordFindingsPage />);

      const banner = await screen.findByTestId("coord-findings-unavailable");
      expect(banner.getAttribute("data-severe")).toBe("true");
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
      expect(
        screen.queryByText(emptyStateText(/no findings match/i))
      ).toBeNull();
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /could not read the findings store/i
      );
    });

    it("does not carry an OLD query's degrade over to a new filter's failure", async () => {
      httpGet.mockResolvedValueOnce({
        available: false,
        count: 0,
        findings: [],
        unavailable: "coord did not answer the findings store (HTTP 503).",
        unavailable_kind: "unreachable",
      });
      render(<CoordFindingsPage />);
      await screen.findByTestId("coord-findings-unavailable");

      httpGet.mockRejectedValue(new Error("GET … failed: 400 - unknown kind"));
      await userEvent.type(screen.getByTestId("coord-findings-kind"), "g");

      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
          /could not read the findings store/i
        )
      );
      expect(screen.getByTestId("coord-findings-health")).not.toHaveTextContent(
        /HTTP 503/
      );
      expect(screen.queryByTestId("coord-findings-unavailable")).toBeNull();
    });

    it("does not keep an earlier degrade's cause when a REFRESH then throws", async () => {
      httpGet.mockResolvedValueOnce({
        available: false,
        count: 0,
        findings: [],
        unavailable: "coord did not answer the findings store (HTTP 503).",
        unavailable_kind: "unreachable",
      });
      render(<CoordFindingsPage />);
      await screen.findByTestId("coord-findings-unavailable");

      httpGet.mockRejectedValue(new Error("GET … failed: 401 - unauthorized"));
      await userEvent.click(screen.getByTestId("coord-findings-refresh"));

      await waitFor(() =>
        expect(screen.queryByTestId("coord-findings-unavailable")).toBeNull()
      );
      expect(screen.getByTestId("coord-findings-health")).not.toHaveTextContent(
        /HTTP 503/
      );
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /could not read the findings store/i
      );
    });

    it("reads UNKNOWN after success, then degrade, then a throw on the same query", async () => {
      httpGet.mockResolvedValueOnce(page([finding()]));
      render(<CoordFindingsPage />);
      await screen.findByTestId("coord-finding-row");

      httpGet.mockResolvedValueOnce({
        available: false,
        count: 0,
        findings: [],
        unavailable: "coord did not answer the findings store (HTTP 503).",
        unavailable_kind: "unreachable",
      });
      await userEvent.click(screen.getByTestId("coord-findings-refresh"));
      await screen.findByTestId("coord-findings-unavailable");

      httpGet.mockRejectedValue(new Error("GET … failed: 401 - unauthorized"));
      await userEvent.click(screen.getByTestId("coord-findings-refresh"));

      expect(
        await screen.findByTestId("coord-findings-unknown")
      ).toHaveTextContent(/unknown, not none/i);
      expect(
        screen.queryByText(emptyStateText(/no findings match these filters/i))
      ).toBeNull();
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /could not read the findings store/i
      );
    });

    it("renders an honest empty state when coord CONFIRMS nothing matches", async () => {
      httpGet.mockResolvedValue(page([]));
      render(<CoordFindingsPage />);

      expect(
        await screen.findByText(
          emptyStateText(/no findings match these filters/i)
        )
      ).toBeInTheDocument();
      expect(screen.queryByTestId("coord-findings-unknown")).toBeNull();
    });
  });

  /**
   * Plan `2026-09-26-findings-console-reads-one-page-as-the-corpus`: the page
   * follows coord's `next_cursor` on click, and says what the loaded rows are
   * known to cover. Shaped on `notifications/page.test.tsx`'s walk tests.
   */
  describe("Load older (the keyset walk)", () => {
    /** A distinct, well-formed finding id per index. */
    const fid = (i: number) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const rowsFrom = (from: number, n: number) =>
      Array.from({ length: n }, (_, k) =>
        finding({ finding_id: fid(from + k), title: `Finding ${from + k}` })
      );
    /** The envelope a coord carrying the bounded-read contract sends. */
    const more = (cursor: string) => ({
      truncated: true,
      bound_kind: "at_least",
      next_cursor: cursor,
    });
    const done = {
      truncated: false,
      bound_kind: "complete",
      next_cursor: null,
    };
    const cursorUrls = () => urls().filter((u) => u.includes("cursor="));

    /** A promise the test settles by hand — to hold a page in flight. */
    function deferred<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("hides the control when truncated is false, even with a cursor", async () => {
      httpGet.mockResolvedValue(
        page(rowsFrom(0, 2), { truncated: false, next_cursor: "c1" })
      );
      render(<CoordFindingsPage />);
      await screen.findAllByTestId("coord-finding-row");
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();
    });

    it("hides the control when next_cursor is null, even if truncated", async () => {
      httpGet.mockResolvedValue(
        page(rowsFrom(0, 2), { truncated: true, next_cursor: null })
      );
      render(<CoordFindingsPage />);
      await screen.findAllByTestId("coord-finding-row");
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();
    });

    it("hides the control when both keys are ABSENT — today's coord", async () => {
      httpGet.mockResolvedValue(page(rowsFrom(0, 50)));
      render(<CoordFindingsPage />);
      await screen.findAllByTestId("coord-finding-row");
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();
      expect(screen.queryByTestId("coord-findings-walk-hint")).toBeNull();
      // A full page with no envelope is not the corpus: the badge says UNKNOWN,
      // never "all 50".
      const badge = screen.getByTestId("coord-findings-count");
      expect(badge).toHaveTextContent(/unknown/i);
      expect(badge).not.toHaveTextContent(/all 50/i);
    });

    it("keeps today's 'all N shown' on a SHORT page with no envelope", async () => {
      httpGet.mockResolvedValue(page(rowsFrom(0, 3)));
      render(<CoordFindingsPage />);
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
          "all 3 shown"
        )
      );
    });

    it("walks two pages, appends in order and dedupes by finding_id", async () => {
      httpGet.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("cursor=c1")) {
          // Page 2 repeats the head's last row — dedupe must drop it.
          return Promise.resolve(
            page([...rowsFrom(1, 1), ...rowsFrom(2, 2)], done)
          );
        }
        return Promise.resolve(page(rowsFrom(0, 2), more("c1")));
      });
      render(<CoordFindingsPage />);

      expect(await screen.findAllByTestId("coord-finding-row")).toHaveLength(2);
      expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
        "2+ shown — more exist"
      );
      expect(screen.getByTestId("coord-findings-walk-hint")).toHaveTextContent(
        /not a snapshot/i
      );

      await userEvent.click(screen.getByTestId("coord-findings-load-older"));

      await waitFor(() =>
        expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(4)
      );
      expect(
        screen
          .getAllByTestId("coord-finding-row")
          .map((r) => r.textContent?.match(/Finding \d+/)?.[0])
      ).toEqual(["Finding 0", "Finding 1", "Finding 2", "Finding 3"]);
      // The last page said complete and handed back no cursor: the walk is
      // over, and the count is every row LOADED, not the last page's 3.
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();
      expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
        "all 4 shown"
      );
      expect(cursorUrls()).toHaveLength(1);
    });

    it("carries the filters with the cursor", async () => {
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("cursor=")
            ? page(rowsFrom(5, 1), done)
            : page(rowsFrom(0, 1), more("c1"))
        )
      );
      render(<CoordFindingsPage />);
      await userEvent.type(screen.getByTestId("coord-findings-topic"), "coord");
      await waitFor(() => expect(listUrl()).toMatch(/topic=coord/));
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      await waitFor(() => expect(cursorUrls()).toHaveLength(1));
      const q = new URLSearchParams(cursorUrls()[0].split("?")[1] ?? "");
      expect(q.get("cursor")).toBe("c1");
      expect(q.get("topic")).toBe("coord");
      expect(q.get("limit")).toBe("50");
    });

    it("ends the walk on an EMPTY page even when coord still hands back a cursor", async () => {
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("cursor=")
            ? page([], more("c2"))
            : page(rowsFrom(0, 2), more("c1"))
        )
      );
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );

      await waitFor(() =>
        expect(screen.queryByTestId("coord-findings-load-older")).toBeNull()
      );
      expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(2);
      expect(cursorUrls()).toHaveLength(1);
    });

    it("ends the walk when a proxy that drops the cursor serves page 1 again", async () => {
      // A proxy predating the cursor forward answers the SAME page 1 — every
      // row a duplicate. That must stop the walk, not loop it.
      httpGet.mockResolvedValue(page(rowsFrom(0, 2), more("c1")));
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      await waitFor(() =>
        expect(screen.queryByTestId("coord-findings-load-older")).toBeNull()
      );
      expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(2);
      // coord still says more exist; the page must not leave that a dead end.
      expect(
        screen.getByTestId("coord-findings-walk-stalled")
      ).toHaveTextContent(/added nothing new.*refresh/i);
    });

    it("shows no stall note when the walk ends on coord's own 'complete'", async () => {
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("cursor=")
            ? page([], done)
            : page(rowsFrom(0, 2), more("c1"))
        )
      );
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
          "all 2 shown"
        )
      );
      expect(screen.queryByTestId("coord-findings-walk-stalled")).toBeNull();
    });

    it("never appends an OLD walk's page onto a Refresh's new head", async () => {
      // The race: page 2 of walk 1 is in flight, a Refresh starts walk 2, walk
      // 2's head lands with its own cursor, THEN walk 1's page 2 lands.
      const oldPage = deferred<unknown>();
      const newHead = deferred<unknown>();
      let heads = 0;
      httpGet.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("cursor=c1")) return oldPage.promise;
        if (u.includes("cursor=")) return Promise.resolve(page([], done));
        heads += 1;
        return heads === 1
          ? Promise.resolve(page(rowsFrom(0, 2), more("c1")))
          : newHead.promise;
      });
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      await waitFor(() => expect(cursorUrls()).toHaveLength(1));

      await userEvent.click(
        screen.getByRole("button", { name: /refresh findings/i })
      );
      // The head read in flight retires walk 1's cursor at once.
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();

      await act(async () => {
        newHead.resolve(page(rowsFrom(10, 2), more("c-new")));
      });
      await act(async () => {
        oldPage.resolve(page(rowsFrom(2, 2), done));
      });

      // Walk 1's page did not land: only the new head's rows…
      expect(
        screen
          .getAllByTestId("coord-finding-row")
          .map((r) => r.textContent?.match(/Finding \d+/)?.[0])
      ).toEqual(["Finding 10", "Finding 11"]);
      // …its cursor did not overwrite walk 2's, and the spinner reset.
      const button = screen.getByTestId("coord-findings-load-older");
      expect(button).toHaveTextContent("Load older");
      expect(button).not.toBeDisabled();
      expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
        "2+ shown — more exist"
      );
      await userEvent.click(button);
      await waitFor(() =>
        expect(cursorUrls().some((u) => u.includes("cursor=c-new"))).toBe(true)
      );
    });

    it("a failed Refresh leaves no old cursor to append onto stale rows", async () => {
      let heads = 0;
      httpGet.mockImplementation((url: string) => {
        if (String(url).includes("cursor=")) {
          return Promise.resolve(page(rowsFrom(2, 2), done));
        }
        heads += 1;
        return heads === 1
          ? Promise.resolve(page(rowsFrom(0, 2), more("c1")))
          : Promise.reject(new Error("GET … failed: 503 - down"));
      });
      render(<CoordFindingsPage />);
      await screen.findByTestId("coord-findings-load-older");

      await userEvent.click(
        screen.getByRole("button", { name: /refresh findings/i })
      );
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
          /stopped updating/i
        )
      );
      // The last read that landed stays on screen, and nothing pages from it.
      expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(2);
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();
      expect(cursorUrls()).toHaveLength(0);
    });

    it("shows coord's total only when it sends a number", async () => {
      httpGet.mockResolvedValue(
        page(rowsFrom(0, 2), { ...more("c1"), total: 240 })
      );
      const { unmount } = render(<CoordFindingsPage />);
      expect(
        await screen.findByTestId("coord-findings-total")
      ).toHaveTextContent("240 in total");
      unmount();

      httpGet.mockResolvedValue(
        page(rowsFrom(0, 2), { ...more("c1"), total: null })
      );
      render(<CoordFindingsPage />);
      await screen.findAllByTestId("coord-finding-row");
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
          "2+ shown"
        )
      );
      expect(screen.queryByTestId("coord-findings-total")).toBeNull();
    });

    it("turns the strip amber on an UNKNOWN bound, and green on a complete one", async () => {
      httpGet.mockResolvedValue(page(rowsFrom(0, 50)));
      const { unmount } = render(<CoordFindingsPage />);
      await screen.findAllByTestId("coord-finding-row");
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-health")).toHaveAttribute(
          "data-health-level",
          "amber"
        )
      );
      expect(screen.getByTestId("coord-findings-health")).toHaveTextContent(
        /whether more exist is unknown/i
      );
      unmount();

      httpGet.mockResolvedValue(page(rowsFrom(0, 3)));
      render(<CoordFindingsPage />);
      await waitFor(() =>
        expect(screen.getByTestId("coord-findings-health")).toHaveAttribute(
          "data-health-level",
          "green"
        )
      );
    });

    it("resets the walk on a filter change and discards the OLD filter's page in flight", async () => {
      const stale = deferred<unknown>();
      httpGet.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes("cursor=c1")) return stale.promise;
        if (u.includes("topic=x")) {
          return Promise.resolve(page(rowsFrom(20, 1), done));
        }
        return Promise.resolve(page(rowsFrom(0, 2), more("c1")));
      });
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      await waitFor(() => expect(cursorUrls()).toHaveLength(1));

      await userEvent.type(screen.getByTestId("coord-findings-topic"), "x");
      await waitFor(() =>
        expect(screen.getByText("Finding 20")).toBeInTheDocument()
      );
      // The new filter's head carried no cursor: no control.
      expect(screen.queryByTestId("coord-findings-load-older")).toBeNull();

      // Filter A's page lands late. It must not append into filter B's list.
      await act(async () => {
        stale.resolve(page(rowsFrom(2, 2), done));
      });
      expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(1);
      expect(screen.queryByText("Finding 2")).toBeNull();
      expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
        "all 1 shown"
      );
    });

    it("Refresh re-reads page 1 and drops the appended pages", async () => {
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("cursor=")
            ? page(rowsFrom(2, 2), done)
            : page(rowsFrom(0, 2), more("c1"))
        )
      );
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      await waitFor(() =>
        expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(4)
      );

      await userEvent.click(
        screen.getByRole("button", { name: /refresh findings/i })
      );

      await waitFor(() =>
        expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(2)
      );
      // Back at the top of a fresh walk: the head's cursor is offered again.
      expect(
        screen.getByTestId("coord-findings-load-older")
      ).toBeInTheDocument();
      expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
        "2+ shown — more exist"
      );
    });

    it("on a refused cursor keeps the rows, shows coord's message, and restarts on request", async () => {
      httpGet.mockImplementation((url: string) =>
        String(url).includes("cursor=")
          ? Promise.reject(
              new Error(
                "GET /api/v1/operations/coord/findings failed: 400 - cursor does not match this query"
              )
            )
          : Promise.resolve(page(rowsFrom(0, 2), more("c1")))
      );
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );

      const err = await screen.findByTestId("coord-findings-paging-error");
      expect(err).toHaveTextContent(/cursor does not match this query/);
      // The loaded rows are still coord's answer: kept, and the LIST is not
      // stale or UNKNOWN because an append failed.
      expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(2);
      expect(screen.getByTestId("coord-findings-health")).not.toHaveTextContent(
        /stopped updating|could not read/i
      );
      expect(screen.getByTestId("coord-findings-count")).toHaveTextContent(
        "2+ shown — more exist"
      );
      // No silent retry.
      expect(cursorUrls()).toHaveLength(1);
      // Still retryable by hand.
      expect(
        screen.getByTestId("coord-findings-load-older")
      ).toBeInTheDocument();

      const heads = urls().filter((u) => !u.includes("cursor=")).length;
      await userEvent.click(screen.getByTestId("coord-findings-restart"));
      await waitFor(() =>
        expect(screen.queryByTestId("coord-findings-paging-error")).toBeNull()
      );
      expect(urls().filter((u) => !u.includes("cursor=")).length).toBe(
        heads + 1
      );
      expect(cursorUrls()).toHaveLength(1);
    });

    it("names a degraded PAGE as a failed append, not a degraded list", async () => {
      httpGet.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes("cursor=")
            ? {
                available: false,
                count: 0,
                findings: [],
                unavailable:
                  "coord did not answer the findings store (HTTP 503).",
                unavailable_kind: "unreachable",
              }
            : page(rowsFrom(0, 2), more("c1"))
        )
      );
      render(<CoordFindingsPage />);
      await userEvent.click(
        await screen.findByTestId("coord-findings-load-older")
      );
      expect(
        await screen.findByTestId("coord-findings-paging-error")
      ).toHaveTextContent(/HTTP 503/);
      expect(screen.getAllByTestId("coord-finding-row")).toHaveLength(2);
      expect(screen.queryByTestId("coord-findings-unavailable")).toBeNull();
    });

    describe("the linked-row banner reads the bound", () => {
      function withLinkedId() {
        window.history.replaceState({}, "", `/?id=${ID_A}`);
      }

      it("says 'outside the filters' only once the walk reaches a COMPLETE bound", async () => {
        withLinkedId();
        httpGet.mockImplementation((url: string) => {
          const u = String(url);
          if (u.includes("finding_id="))
            return Promise.resolve(page([finding()]));
          if (u.includes("cursor=c1")) {
            return Promise.resolve(page(rowsFrom(60, 1), done));
          }
          return Promise.resolve(page(rowsFrom(10, 2), more("c1")));
        });
        render(<CoordFindingsPage />);
        await userEvent.type(screen.getByTestId("coord-findings-topic"), "x");
        await waitFor(() => expect(listUrl()).toMatch(/topic=x/));

        // at_least: the row may sit past what is loaded.
        await waitFor(() =>
          expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
            /not among the rows loaded/i
          )
        );
        expect(
          screen.getByTestId("coord-findings-linked")
        ).not.toHaveTextContent(/outside the current filters/i);

        await userEvent.click(screen.getByTestId("coord-findings-load-older"));

        // complete: every matching row is loaded, and the linked one is not.
        await waitFor(() =>
          expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
            /outside the current filters/i
          )
        );
      });

      it("never says 'outside the filters' on an explicit UNKNOWN bound, however short", async () => {
        withLinkedId();
        httpGet.mockImplementation((url: string) =>
          Promise.resolve(
            String(url).includes("finding_id=")
              ? page([finding()])
              : page(rowsFrom(10, 1), {
                  bound_kind: "unknown",
                  truncated: null,
                  next_cursor: null,
                })
          )
        );
        render(<CoordFindingsPage />);
        await userEvent.type(screen.getByTestId("coord-findings-topic"), "x");
        await waitFor(() => expect(listUrl()).toMatch(/topic=x/));

        await waitFor(() =>
          expect(screen.getByTestId("coord-findings-linked")).toHaveTextContent(
            /not among the rows loaded/i
          )
        );
        expect(
          screen.getByTestId("coord-findings-linked")
        ).not.toHaveTextContent(/outside the current filters/i);
      });
    });
  });
});
