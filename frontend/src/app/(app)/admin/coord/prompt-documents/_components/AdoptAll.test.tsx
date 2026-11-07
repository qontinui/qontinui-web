/**
 * "Adopt all updates", driven through the real list and dialog.
 *
 * What is pinned, and why each would fail silently:
 *
 * 1. **The button exists only when coord has said this is NOT the system
 *    tenant** — never in the system tenant, never while that answer is
 *    unknown — and only when coord flags an update; its count is coord's.
 * 2. **The preview is a FRESH read of the newest open, pinned in versions AND
 *    tenant.** A late read from an earlier open cannot replace it, and a
 *    project switched in another tab stops the run before its next request.
 * 3. **Unticked rows are not sent.** Everything is ticked by default.
 * 4. **The run is sequential, continues past a refusal, and calls a row
 *    "refused" only on coord's 4xx.** A row nobody can confirm is reconciled
 *    against the post-run re-read.
 * 5. **One summary, announced; no toast per document; focus follows the run.**
 * 6. **A degraded re-read is UNKNOWN, never "nothing to adopt".**
 * 7. **Leaving the page mid-run stops the loop.**
 * 8. **Layout: one scrolling body, no scroll container inside it, a footer
 *    outside it.** jsdom has no layout engine, so this pins the STRUCTURE; the
 *    measured check at a laptop viewport is the visual check's job.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();
const postMock = vi.fn();
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});
vi.mock("sonner", () => ({ toast: toastMock }));

import { PromptDocumentList } from "./PromptDocumentList";
import { AdoptAllDialog } from "./AdoptAllDialog";
import { UnreadableAnswerError } from "@/services/http-client";
import type { AdoptAllCandidate, AdoptOne } from "../_lib/adoptAll";
import type { PromptDocumentKind, PromptDocumentSummary } from "../types";

const API = "/api/v1/operations";
const LIST = `${API}/coord/prompt-documents`;
const STATUS = `${API}/coord/prompt-documents/auto-publish/status`;
const TENANT_KEY = "qontinui.active_tenant_id";

/** Coord's not_system_tenant answer, exactly as the browser receives it. */
const NOT_SYSTEM_TENANT = new Error(
  `GET ${STATUS} failed: 403 - ${JSON.stringify({
    error: "FORBIDDEN",
    message:
      '{"error":"not_system_tenant","detail":"publishing to the fleet is available only from the system tenant (coord.tenants.is_system)"}',
    timestamp: 1794048000.1,
    path: `https://api.qontinui.io${STATUS}`,
  })}`
);

/**
 * Coord's real document_moved refusal (`upstream_decisions.rs` `conflict()`
 * puts the sentence under `detail`), as the browser receives it: relayed by
 * the web backend as a string under `message`, beside its generic code.
 */
function movedError(name: string, expected: number, actual: number): Error {
  const url = `${LIST}/policy/${name}/upstream-adopt`;
  return new Error(
    `POST ${url} failed: 409 - ${JSON.stringify({
      error: "CONFLICT",
      message: JSON.stringify({
        error: "document_moved",
        detail: `the decision was made against version ${expected} but the document is now at version ${actual}`,
        current_version: actual,
      }),
      timestamp: 1794048000.1,
      path: `https://api.qontinui.io${url}`,
    })}`
  );
}

function summary(
  kind: PromptDocumentKind,
  name: string,
  extra: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return {
    id: `doc-${kind}-${name}`,
    kind,
    name,
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_by: "someone@example.com",
    updated_at: "2026-11-07T10:00:00Z",
    ...extra,
  };
}

/** A document coord flags as having publication v1 available. */
function flagged(
  kind: PromptDocumentKind,
  name: string,
  extra: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return summary(kind, name, {
    upstream_publication_version: null,
    latest_publication_version: 1,
    local_modified: true,
    update_available: true,
    ...extra,
  });
}

type StatusArm =
  | "not_system"
  | "system"
  | "pending"
  | "not_proxied"
  | "error_naming_the_code";

/**
 * Serve `reads` in order for the list route — the page's first read, then the
 * re-read taken when the dialog opens, then the post-run re-read — repeating
 * the last one. A read may be an Error (the read fails) or a `{degraded}`
 * object. The auto-publish status read answers per `status`: one arm for
 * every call, or a list (the page's read, then the re-ask at open, …),
 * repeating the last.
 */
function serveLists(
  reads: Array<PromptDocumentSummary[] | Error | { degraded: string }>,
  statusArms: StatusArm | StatusArm[] = "not_system"
) {
  let n = 0;
  let k = 0;
  const arms = Array.isArray(statusArms) ? statusArms : [statusArms];
  getMock.mockImplementation((url: string) => {
    if (url === LIST) {
      const read = reads[Math.min(n, reads.length - 1)] ?? [];
      n += 1;
      if (read instanceof Error) return Promise.reject(read);
      if (!Array.isArray(read)) {
        return Promise.resolve({ documents: [], degraded: read.degraded });
      }
      return Promise.resolve({ documents: read, degraded: null });
    }
    if (url === STATUS) {
      const arm = arms[Math.min(k, arms.length - 1)] ?? "not_system";
      k += 1;
      switch (arm) {
        case "not_system":
          return Promise.reject(NOT_SYSTEM_TENANT);
        case "system":
          return Promise.resolve({ candidates: [], count: 1 });
        case "pending":
          return new Promise(() => {});
        case "not_proxied":
          return Promise.reject(
            new Error(`GET ${STATUS} failed: 404 - {"detail":"Not Found"}`)
          );
        case "error_naming_the_code":
          // The sniffing latch DOES latch this as not_system_tenant — it
          // names the code — but a 500 is not coord's answer.
          return Promise.reject(
            new Error(
              `GET ${STATUS} failed: 500 - {"error":"INTERNAL_SERVER_ERROR","message":"upstream said not_system_tenant then failed"}`
            )
          );
      }
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

const listReads = () =>
  getMock.mock.calls.filter(([url]) => url === LIST).length;

function adoptedBody(kind: string, name: string, to: number) {
  return {
    adopted: true,
    kind,
    name,
    from_version: to - 1,
    to_version: to,
    publication_version: 1,
    local_modified: true,
  };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
  localStorage.setItem(TENANT_KEY, "t-bauhaus");
});
afterEach(() => {
  localStorage.removeItem(TENANT_KEY);
});

describe("when the Adopt all updates button is offered", () => {
  it("is offered once coord has said this is not the system tenant", async () => {
    serveLists([[flagged("policy", "testing")]], "not_system");
    render(<PromptDocumentList />);
    expect(await screen.findByTestId("adopt-all")).toHaveTextContent(
      "Adopt all updates (1)"
    );
  });

  it("is never offered in the system tenant, whose status read succeeds", async () => {
    serveLists([[flagged("policy", "testing")]], "system");
    render(<PromptDocumentList />);
    // Settled: the status read ANSWERED, which is what puts "Publish all
    // changed (1)" on screen.
    expect(await screen.findByTestId("publish-all")).toHaveTextContent(
      "Publish all changed (1)"
    );
    // Unlatched: the publish-mode control the latch arms below withdraw.
    expect(
      screen.getByTestId("doc-publish-mode-policy-testing")
    ).toBeInTheDocument();
    // Per-row adopt is still there; only the bulk control is withheld.
    expect(screen.getByTestId("doc-upstream-policy-testing")).toBeVisible();
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  });

  it("is not offered while the status read has not answered", async () => {
    serveLists([[flagged("policy", "testing")]], "pending");
    render(<PromptDocumentList />);
    await screen.findByTestId("doc-row-policy-testing");
    await waitFor(() =>
      expect(getMock.mock.calls.some(([u]) => u === STATUS)).toBe(true)
    );
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-upstream-policy-testing")).toBeVisible();
  });

  it.each([
    ["the proxy does not carry the route", "not_proxied"],
    [
      "a 500 latched as not_system_tenant only because it names the code",
      "error_naming_the_code",
    ],
  ] as const)(
    "is not offered on a latched answer that is not coord's: %s",
    async (_, arm) => {
      serveLists([[flagged("policy", "testing")]], arm);
      render(<PromptDocumentList />);
      // Settled: the latch withdraws the row's publish-mode control, which an
      // unlatched page shows (the system-tenant test above has it).
      await screen.findByTestId("doc-row-policy-testing");
      await waitFor(() =>
        expect(
          screen.queryByTestId("doc-publish-mode-policy-testing")
        ).not.toBeInTheDocument()
      );
      expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
      expect(screen.getByTestId("doc-upstream-policy-testing")).toBeVisible();
    }
  );

  it("is not offered on an answer another tab's project earned", async () => {
    // The page is in the system tenant. Another tab switches to B, and THIS
    // page's publish-all dry run goes to B and is answered not_system_tenant.
    localStorage.setItem(TENANT_KEY, "t-system");
    const notSystemFor = (verb: string, url: string) =>
      new Error(
        `${verb} ${url} failed: 403 - ${JSON.stringify({
          error: "FORBIDDEN",
          message: JSON.stringify({ error: "not_system_tenant", detail: "x" }),
        })}`
      );
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) {
        return localStorage.getItem(TENANT_KEY) === "t-system"
          ? Promise.resolve({ candidates: [], count: 1 })
          : Promise.reject(notSystemFor("GET", STATUS));
      }
      if (url === LIST) {
        return Promise.resolve({
          documents: [
            flagged("policy", "coordination", { current_version: 7 }),
          ],
          degraded: null,
        });
      }
      return Promise.reject(new Error(url));
    });
    // B's refusal is HELD, and answered only after the other tab has switched
    // back: the stamp must be the project the request was PINNED to (its
    // header on every attempt), not whatever is stored when the answer lands.
    let answerDryRun: (() => void) | undefined;
    postMock.mockImplementation((url: string) => {
      if (!url.endsWith("/publish-all")) {
        return Promise.resolve(adoptedBody("policy", "coordination", 8));
      }
      if (localStorage.getItem(TENANT_KEY) === "t-system") {
        return Promise.resolve({ dry_run: true, candidates: [] });
      }
      return new Promise((_, reject) => {
        answerDryRun = () => reject(notSystemFor("POST", url));
      });
    });
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    const publishAll = await screen.findByTestId("publish-all");
    localStorage.setItem(TENANT_KEY, "t-other");
    await user.click(publishAll);
    await waitFor(() => expect(answerDryRun).toBeDefined());
    // The other tab switches back; then B's answer lands and is latched.
    localStorage.setItem(TENANT_KEY, "t-system");
    await act(async () => {
      answerDryRun?.();
    });
    await user.keyboard("{Escape}");
    // Let the refusal land and latch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // It is stamped with the project it was sent in, so it says nothing about
    // the system tenant: that tenant's publish controls stay, and Adopt all is
    // not offered on it.
    expect(
      screen.getByTestId("doc-publish-mode-policy-coordination")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
    expect(
      postMock.mock.calls.filter(([u]) => String(u).endsWith("/upstream-adopt"))
    ).toEqual([]);
  });

  it("stamps a refreshed status read with the project it was PINNED to, not the one stored when it answers", async () => {
    localStorage.setItem(TENANT_KEY, "t-system");
    let answerRefresh: (() => void) | undefined;
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) {
        if (localStorage.getItem(TENANT_KEY) === "t-system") {
          return Promise.resolve({ candidates: [], count: 1 });
        }
        // Sent in B; answered after the other tab switches back.
        return new Promise((_, reject) => {
          answerRefresh = () => reject(NOT_SYSTEM_TENANT);
        });
      }
      if (url === LIST) {
        return Promise.resolve({
          documents: [
            flagged("policy", "coordination", { current_version: 7 }),
          ],
          degraded: null,
        });
      }
      return Promise.reject(new Error(url));
    });
    const { rerender } = render(
      <PromptDocumentList autoPublishRefreshKey={0} />
    );
    await screen.findByTestId("publish-all");
    localStorage.setItem(TENANT_KEY, "t-other");
    rerender(<PromptDocumentList autoPublishRefreshKey={1} />);
    await waitFor(() => expect(answerRefresh).toBeDefined());
    localStorage.setItem(TENANT_KEY, "t-system");
    await act(async () => {
      answerRefresh?.();
    });
    // Let the refusal land and latch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // It is stamped with the project it was sent in, so Adopt all is not
    // offered on the system tenant. And the newest status answer the page
    // holds is now about another project, so the system tenant's publish
    // controls are withheld until a read in the system tenant answers.
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("doc-publish-mode-policy-coordination")
    ).not.toBeInTheDocument();
  });

  it("stamps an armed publish-all with the project it was PINNED to, not the one stored when it answers", async () => {
    localStorage.setItem(TENANT_KEY, "t-system");
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) return Promise.resolve({ candidates: [], count: 1 });
      if (url === LIST) {
        return Promise.resolve({
          documents: [
            flagged("policy", "coordination", { current_version: 7 }),
          ],
          degraded: null,
        });
      }
      return Promise.reject(new Error(url));
    });
    let answerArmed: (() => void) | undefined;
    postMock.mockImplementation((url: string, body: { dry_run?: boolean }) => {
      if (!url.endsWith("/publish-all")) return Promise.reject(new Error(url));
      if (body?.dry_run !== false) {
        return Promise.resolve({
          dry_run: true,
          candidates: [
            {
              kind: "policy",
              name: "coordination",
              current_version: 7,
              next_publication_version: 2,
            },
          ],
        });
      }
      // The armed run, sent in B; answered after the other tab switches back.
      return new Promise((_, reject) => {
        answerArmed = () =>
          reject(
            new Error(
              `POST ${url} failed: 403 - ${JSON.stringify({
                error: "FORBIDDEN",
                message: JSON.stringify({
                  error: "not_system_tenant",
                  detail: "x",
                }),
              })}`
            )
          );
      });
    });
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("publish-all"));
    const confirm = await screen.findByTestId("publish-all-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());
    localStorage.setItem(TENANT_KEY, "t-other");
    await user.click(confirm);
    await waitFor(() => expect(answerArmed).toBeDefined());
    localStorage.setItem(TENANT_KEY, "t-system");
    await act(async () => {
      answerArmed?.();
    });
    await user.keyboard("{Escape}");
    // Let the refusal land and latch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // It is stamped with the project it was sent in, so it says nothing about
    // the system tenant: that tenant's publish controls stay, and Adopt all is
    // not offered on it.
    expect(
      screen.getByTestId("doc-publish-mode-policy-coordination")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  });

  it("withdraws the button when a later status read in the same project answers as the system tenant", async () => {
    // The page's read said not-system; a refreshed read, pinned to the same
    // project, now answers 200 — which the status door gives only the system
    // tenant. The earlier answer no longer holds.
    serveLists([[flagged("policy", "testing")]], ["not_system", "system"]);
    const { rerender } = render(
      <PromptDocumentList autoPublishRefreshKey={0} />
    );
    await screen.findByTestId("adopt-all");
    rerender(<PromptDocumentList autoPublishRefreshKey={1} />);
    await waitFor(() =>
      expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument()
    );
    expect(await screen.findByTestId("publish-all")).toHaveTextContent(
      "Publish all changed (1)"
    );
  });

  it("is absent when coord flags nothing — including flags that are false or absent", async () => {
    serveLists([
      [
        summary("policy", "testing", { update_available: false }),
        summary("policy", "coordination"), // absent: UNKNOWN
      ],
    ]);
    render(<PromptDocumentList />);
    await screen.findByTestId("doc-row-policy-testing");
    await waitFor(() =>
      expect(getMock.mock.calls.some(([u]) => u === STATUS)).toBe(true)
    );
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  });

  it("is absent on an empty store", async () => {
    serveLists([[]]);
    render(<PromptDocumentList />);
    await waitFor(() => expect(listReads()).toBeGreaterThanOrEqual(1));
    expect(screen.queryByTestId("adopt-all")).not.toBeInTheDocument();
  });

  it("counts every flagged document, of every kind", async () => {
    const policies = Array.from({ length: 15 }, (_, i) =>
      flagged("policy", `p${String(i).padStart(2, "0")}`)
    );
    serveLists([
      [
        ...policies,
        flagged("agent_playbook", "merge-shepherd"),
        flagged("prompt_template", "review"),
        summary("policy", "not-flagged", { update_available: false }),
      ],
    ]);
    render(<PromptDocumentList />);
    expect(await screen.findByTestId("adopt-all")).toHaveTextContent(
      "Adopt all updates (17)"
    );
    // The toolbar wraps rather than pushing its third button off a narrow screen.
    expect(screen.getByTestId("adopt-all").parentElement).toHaveClass(
      "flex-wrap"
    );
  });
});

async function openAdoptAll() {
  const user = userEvent.setup();
  await user.click(await screen.findByTestId("adopt-all"));
  await screen.findByTestId("adopt-all-candidates");
  return user;
}

describe("the adopt-all preview", () => {
  it("lists every flagged document with its versions and what adopting would replace", async () => {
    serveLists([
      [
        flagged("policy", "testing", { current_version: 6 }),
        flagged("policy", "coordination", {
          current_version: 32,
          latest_publication_version: 3,
          upstream_publication_version: 2,
        }),
        flagged("policy", "escalation-bar", {
          upstream_publication_version: 2,
          local_modified: undefined,
        }),
        flagged("agent_playbook", "merge-shepherd", {
          current_version: 4,
          latest_publication_version: 2,
          upstream_publication_version: 1,
          local_modified: false,
        }),
        // Would overwrite, but has no publication version to pin: not counted.
        flagged("policy", "unpinned", {
          upstream_publication_version: 2,
          latest_publication_version: null,
        }),
      ],
    ]);
    render(<PromptDocumentList />);
    await openAdoptAll();

    expect(
      within(screen.getByTestId("adopt-all-candidates")).getAllByRole(
        "listitem"
      )
    ).toHaveLength(5);
    expect(
      screen.getByTestId("adopt-all-versions-policy-testing")
    ).toHaveTextContent("v6 → publication v1");
    // Never adopted: named, NOT called an overwrite, and coord's own
    // local_modified is stated rather than overridden.
    expect(
      screen.getByTestId("adopt-all-never-adopted-policy-testing")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("adopt-all-overwrites-policy-testing")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("adopt-all-effect-policy-testing")
    ).toHaveTextContent("Coord reports it locally modified");
    expect(
      screen.getByTestId("adopt-all-overwrites-policy-coordination")
    ).toHaveTextContent("would overwrite local edits");
    // The counts are over adoptable rows, each group counted.
    expect(screen.getByTestId("adopt-all-count-overwrites")).toHaveTextContent(
      "1 would overwrite local edits."
    );
    expect(
      screen.getByTestId("adopt-all-count-never-adopted")
    ).toHaveTextContent(/^1 has never adopted/);
    expect(screen.getByTestId("adopt-all-count-unknown")).toHaveTextContent(
      "For 1, coord did not say"
    );
    expect(screen.getByTestId("adopt-all-restorable-notice")).toHaveTextContent(
      "restorable from the row's History"
    );
    // It names the project the preview was read in.
    // It names the project the run is pinned to. With no membership list to
    // find that project in, it shows the id and says the project is unknown.
    expect(screen.getByTestId("adopt-all-tenant")).toHaveTextContent(
      "Project: t-bauhaus (unknown project — not in this page's project list)"
    );
    // Ticked by default, except the row with nothing to pin.
    expect(
      screen.getByTestId("adopt-all-include-policy-testing")
    ).toHaveAttribute("data-state", "checked");
    expect(
      screen.getByTestId("adopt-all-include-policy-unpinned")
    ).toBeDisabled();
    expect(screen.getByTestId("adopt-all-confirm")).toHaveTextContent(
      "Adopt 4 documents"
    );
  });

  it("pins every adopt to the FRESH read taken at open, and skips unticked rows", async () => {
    const atLoad = [
      flagged("policy", "testing", { current_version: 2 }),
      flagged("policy", "coordination", { current_version: 30 }),
      flagged("policy", "held-back", { current_version: 9 }),
    ];
    const atOpen = [
      flagged("policy", "testing", { current_version: 5 }),
      flagged("policy", "coordination", {
        current_version: 32,
        latest_publication_version: 3,
      }),
      flagged("policy", "held-back", { current_version: 9 }),
    ];
    serveLists([atLoad, atOpen]);
    postMock.mockImplementation((url: string) =>
      Promise.resolve(adoptedBody("policy", url.split("/").at(-2) ?? "", 10))
    );
    render(<PromptDocumentList />);
    const user = await openAdoptAll();

    expect(
      screen.getByTestId("adopt-all-versions-policy-testing")
    ).toHaveTextContent("v5 → publication v1");
    await user.click(screen.getByTestId("adopt-all-include-policy-held-back"));
    await user.click(screen.getByTestId("adopt-all-confirm"));

    await screen.findByTestId("adopt-all-summary");
    // In the order the list shows them (it sorts by description, then name),
    // each at its pin.
    expect(postMock.mock.calls).toEqual([
      [
        `${LIST}/policy/coordination/upstream-adopt`,
        { publication_version: 3, expected_version: 32 },
      ],
      [
        `${LIST}/policy/testing/upstream-adopt`,
        { publication_version: 1, expected_version: 5 },
      ],
    ]);
    expect(
      screen.getByTestId("adopt-all-outcome-policy-held-back")
    ).toHaveTextContent("Held back");
  });

  it("takes the NEWEST open's read: a slow read from an earlier open is dropped", async () => {
    let releaseFirstReopenRead: (() => void) | undefined;
    let n = 0;
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) return Promise.reject(NOT_SYSTEM_TENANT);
      if (url !== LIST) return Promise.reject(new Error(url));
      n += 1;
      if (n === 1) {
        return Promise.resolve({
          documents: [flagged("policy", "testing", { current_version: 2 })],
          degraded: null,
        });
      }
      if (n === 2) {
        // The first open's re-read: slow, and OLDER than the second's.
        return new Promise((resolve) => {
          releaseFirstReopenRead = () =>
            resolve({
              documents: [flagged("policy", "testing", { current_version: 3 })],
              degraded: null,
            });
        });
      }
      return Promise.resolve({
        documents: [flagged("policy", "testing", { current_version: 4 })],
        degraded: null,
      });
    });
    postMock.mockResolvedValue(adoptedBody("policy", "testing", 5));
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));
    await screen.findByTestId("adopt-all-previewing");
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("adopt-all"));
    expect(
      await screen.findByTestId("adopt-all-versions-policy-testing")
    ).toHaveTextContent("v4 → publication v1");

    // The earlier open's read lands late, while this preview is on screen.
    // It must not replace it: the version shown is the version pinned.
    await act(async () => {
      releaseFirstReopenRead?.();
    });
    expect(
      screen.getByTestId("adopt-all-versions-policy-testing")
    ).toHaveTextContent("v4 → publication v1");
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await screen.findByTestId("adopt-all-summary");
    expect(postMock.mock.calls).toEqual([
      [
        `${LIST}/policy/testing/upstream-adopt`,
        { publication_version: 1, expected_version: 4 },
      ],
    ]);
    expect(
      screen.getByTestId("adopt-all-versions-policy-testing")
    ).toHaveTextContent("v4 → publication v1");
  });

  it("offers nothing when the re-read at open fails — the page's rows are no evidence", async () => {
    serveLists([
      [flagged("policy", "testing", { current_version: 4 })],
      new Error(`GET ${LIST} failed: 502 - coord unreachable`),
    ]);
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));

    expect(
      await screen.findByTestId("adopt-all-reread-failed")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("adopt-all-candidates")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("treats a degraded re-read as UNKNOWN, never as nothing to adopt", async () => {
    serveLists([
      [flagged("policy", "testing")],
      { degraded: "store_unprovisioned" },
    ]);
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));

    expect(await screen.findByTestId("adopt-all-degraded")).toHaveTextContent(
      "store_unprovisioned"
    );
    expect(screen.queryByTestId("adopt-all-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
  });

  it("offers nothing to confirm when the re-read finds no update left", async () => {
    serveLists([
      [flagged("policy", "testing")],
      [summary("policy", "testing", { update_available: false })],
    ]);
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));

    expect(await screen.findByTestId("adopt-all-empty")).toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
  });

  it("re-asks coord at open, and offers nothing when it now answers as the system tenant", async () => {
    // The page's read said not-system; the re-ask at open answers 200, which
    // the status door gives only the system tenant.
    serveLists([[flagged("policy", "testing")]], ["not_system", "system"]);
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));
    expect(
      await screen.findByTestId("adopt-all-system-tenant")
    ).toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("offers nothing when the re-ask at open gets no usable answer", async () => {
    serveLists(
      [[flagged("policy", "testing")]],
      ["not_system", "error_naming_the_code"]
    );
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));
    expect(
      await screen.findByTestId("adopt-all-tenancy-unknown")
    ).toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
  });

  it("refuses the preview when the project changes while the open is asking coord", async () => {
    serveLists([[flagged("policy", "testing")]]);
    const answer = getMock.getMockImplementation();
    let releaseProbe: (() => void) | undefined;
    let statusCalls = 0;
    getMock.mockImplementation((url: string) => {
      if (url === STATUS && ++statusCalls === 2) {
        // The re-ask at open: held while another tab switches the project.
        return new Promise((_, reject) => {
          releaseProbe = () => reject(NOT_SYSTEM_TENANT);
        });
      }
      return answer?.(url);
    });
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));
    await waitFor(() => expect(statusCalls).toBe(2));
    localStorage.setItem(TENANT_KEY, "t-qontinui");
    await act(async () => {
      releaseProbe?.();
    });
    expect(
      await screen.findByTestId("adopt-all-tenant-changed")
    ).toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
  });

  it("refuses to preview when the project changed in another tab since load", async () => {
    serveLists([[flagged("policy", "testing")]]);
    render(<PromptDocumentList />);
    await screen.findByTestId("adopt-all");
    const readsBefore = listReads();
    localStorage.setItem(TENANT_KEY, "t-qontinui");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("adopt-all"));

    expect(
      await screen.findByTestId("adopt-all-tenant-changed")
    ).toBeInTheDocument();
    expect(screen.getByTestId("adopt-all-confirm")).toBeDisabled();
    // No read was even taken in the other project.
    expect(listReads()).toBe(readsBefore);
  });
});

describe("the adopt-all run", () => {
  it("adopts one at a time, continues past a refusal, and ends with one summary, a re-read and focus on it", async () => {
    serveLists([
      [
        flagged("policy", "engineering-priorities", { current_version: 10 }),
        flagged("policy", "session-protocol", { current_version: 13 }),
        flagged("policy", "testing", { current_version: 6 }),
      ],
    ]);
    const refusal = movedError("session-protocol", 13, 14);
    let release: (() => void) | undefined;
    postMock.mockImplementation((url: string) => {
      if (url.includes("/engineering-priorities/")) {
        return new Promise((resolve) => {
          release = () =>
            resolve(adoptedBody("policy", "engineering-priorities", 11));
        });
      }
      if (url.includes("/session-protocol/")) return Promise.reject(refusal);
      return Promise.resolve(adoptedBody("policy", "testing", 7));
    });
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    const readsBeforeRun = listReads();

    await user.click(screen.getByTestId("adopt-all-confirm"));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId("adopt-all-outcome-policy-engineering-priorities")
    ).toHaveTextContent("Adopting");
    expect(
      screen.getByTestId("adopt-all-outcome-policy-testing")
    ).toHaveTextContent("Waiting");
    // Focus moved to the one control that acts during the run.
    await waitFor(() =>
      expect(screen.getByTestId("adopt-all-stop")).toHaveFocus()
    );

    await act(async () => {
      release?.();
    });

    const summaryLine = await screen.findByTestId("adopt-all-summary");
    expect(postMock).toHaveBeenCalledTimes(3);
    expect(summaryLine).toHaveTextContent("2 adopted, 1 refused");
    await waitFor(() => expect(summaryLine).toHaveFocus());
    expect(screen.getByTestId("adopt-all-live")).toHaveTextContent(
      "2 adopted, 1 refused"
    );
    expect(screen.getByTestId("adopt-all-live")).toHaveAttribute(
      "aria-live",
      "polite"
    );
    expect(
      screen.getByTestId("adopt-all-outcome-policy-engineering-priorities")
    ).toHaveTextContent("adopted as v11");
    // A 4xx: refused, in coord's own words.
    const refused = screen.getByTestId(
      "adopt-all-outcome-policy-session-protocol"
    );
    expect(refused).toHaveTextContent("refused");
    expect(refused).toHaveTextContent("Coord answered and declined it");
    expect(refused).toHaveTextContent(refusal.message);
    await waitFor(() => expect(listReads()).toBeGreaterThan(readsBeforeRun));
    // The re-read says what coord holds for the refused row.
    expect(
      await screen.findByTestId("adopt-all-reread-policy-session-protocol")
    ).toHaveTextContent("Re-read: still at v13, unchanged");
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId("adopt-all-confirm")).not.toBeInTheDocument();
  });

  it("calls a 504 and a dropped connection NOT CONFIRMED, and reconciles them against the re-read", async () => {
    serveLists([
      [
        flagged("policy", "gateway", { current_version: 5 }),
        flagged("policy", "network", { current_version: 8 }),
      ],
      [
        flagged("policy", "gateway", { current_version: 5 }),
        flagged("policy", "network", { current_version: 8 }),
      ],
      // After the run: the 504's adopt DID commit; the dropped one did not.
      [
        summary("policy", "gateway", {
          current_version: 6,
          upstream_publication_version: 1,
          latest_publication_version: 1,
          update_available: false,
        }),
        flagged("policy", "network", { current_version: 8 }),
      ],
    ]);
    postMock.mockImplementation((url: string) =>
      url.includes("/gateway/")
        ? Promise.reject(
            new Error(
              `POST ${LIST}/policy/gateway/upstream-adopt failed: 504 - {"error":"GATEWAY_TIMEOUT","message":"coord did not answer in time"}`
            )
          )
        : Promise.reject(new TypeError("Failed to fetch"))
    );
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));

    expect(await screen.findByTestId("adopt-all-summary")).toHaveTextContent(
      "0 adopted, 0 refused, 2 not confirmed"
    );
    expect(
      screen.getByTestId("adopt-all-outcome-policy-gateway")
    ).toHaveTextContent("not confirmed");
    expect(
      screen.getByTestId("adopt-all-outcome-policy-gateway")
    ).not.toHaveTextContent(/^refused/);
    expect(
      await screen.findByTestId("adopt-all-reread-policy-gateway")
    ).toHaveTextContent(
      "Re-read: now at v6, tracking publication v1 — the adopt is in place."
    );
    expect(
      screen.getByTestId("adopt-all-reread-policy-network")
    ).toHaveTextContent("Re-read: still at v8, unchanged — nothing landed.");
  });

  it("never reconciles a row against another project's re-read", async () => {
    // B's run; mid-run another tab switches to A, whose own policy/a happens
    // to track publication v1 at a new version.
    serveLists([[flagged("policy", "a")]]);
    const listInA = {
      documents: [
        summary("policy", "a", {
          current_version: 40,
          upstream_publication_version: 1,
          latest_publication_version: 1,
          update_available: false,
        }),
      ],
      degraded: null,
    };
    const inB = getMock.getMockImplementation();
    getMock.mockImplementation((url: string) =>
      url === LIST && localStorage.getItem(TENANT_KEY) === "t-a"
        ? Promise.resolve(listInA)
        : inB?.(url)
    );
    postMock.mockImplementationOnce(async () => {
      localStorage.setItem(TENANT_KEY, "t-a");
      throw new Error(`POST ${LIST}/policy/a/upstream-adopt failed: 504 - {}`);
    });
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    const readsBeforeRun = listReads();
    await user.click(screen.getByTestId("adopt-all-confirm"));

    const reread = await screen.findByTestId("adopt-all-reread-policy-a");
    await waitFor(() => expect(reread).not.toHaveTextContent("Re-reading"));
    expect(reread).toHaveTextContent(
      "could not be re-read in this run's project"
    );
    expect(reread).not.toHaveTextContent("the adopt is in place");
    // And this page's rows were not reloaded from A.
    expect(listReads()).toBe(readsBeforeRun);
  });

  it("never reconciles against a re-read the project changed DURING", async () => {
    serveLists([[flagged("policy", "a")]]);
    const answer = getMock.getMockImplementation();
    let releaseReread: (() => void) | undefined;
    let listCalls = 0;
    getMock.mockImplementation((url: string) => {
      if (url === LIST && ++listCalls === 3) {
        // The post-run re-read: the project switches while it is in flight.
        return new Promise((resolve) => {
          releaseReread = () => {
            localStorage.setItem(TENANT_KEY, "t-a");
            resolve({
              documents: [
                summary("policy", "a", {
                  current_version: 40,
                  upstream_publication_version: 1,
                  latest_publication_version: 1,
                  update_available: false,
                }),
              ],
              degraded: null,
            });
          };
        });
      }
      return answer?.(url);
    });
    postMock.mockRejectedValueOnce(
      new Error(`POST ${LIST}/policy/a/upstream-adopt failed: 504 - {}`)
    );
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await waitFor(() => expect(listCalls).toBe(3));
    await act(async () => {
      releaseReread?.();
    });
    const reread = await screen.findByTestId("adopt-all-reread-policy-a");
    await waitFor(() => expect(reread).not.toHaveTextContent("Re-reading"));
    expect(reread).toHaveTextContent(
      "could not be re-read in this run's project"
    );
  });

  it("says an answer arrived but could not be read, rather than that none came", async () => {
    serveLists([[flagged("policy", "a")]]);
    postMock.mockRejectedValue(
      new UnreadableAnswerError(
        200,
        new SyntaxError(
          "Unexpected token '<', \"<!doctype \"... is not valid JSON"
        )
      )
    );
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await screen.findByTestId("adopt-all-summary");
    const outcome = screen.getByTestId("adopt-all-outcome-policy-a");
    expect(outcome).toHaveTextContent("not confirmed");
    expect(outcome).toHaveTextContent(
      "An answer arrived but could not be read"
    );
    expect(outcome).not.toHaveTextContent("No answer came back");
  });

  it("says a refusal the web backend gave was not coord's", async () => {
    serveLists([[flagged("policy", "a")]]);
    postMock.mockRejectedValue(
      new Error(
        `POST ${LIST}/policy/a/upstream-adopt failed: 401 - ${JSON.stringify({
          error: "UNAUTHORIZED",
          message: "Not authenticated",
        })}`
      )
    );
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await screen.findByTestId("adopt-all-summary");
    const outcome = screen.getByTestId("adopt-all-outcome-policy-a");
    expect(outcome).toHaveTextContent(
      "Refused (HTTP 401), not in coord's words; nothing was adopted."
    );
    expect(outcome).not.toHaveTextContent("Coord answered and declined it");
  });

  it("stops the run before its next request when the project changes mid-run", async () => {
    serveLists([[flagged("policy", "a"), flagged("policy", "b")]]);
    postMock.mockImplementationOnce(async () => {
      // Another tab switches the project while the first adopt is in flight.
      localStorage.setItem(TENANT_KEY, "t-qontinui");
      return adoptedBody("policy", "a", 3);
    });
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));

    const line = await screen.findByTestId("adopt-all-summary");
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(line).toHaveTextContent("The active project changed during the run");
    expect(screen.getByTestId("adopt-all-outcome-policy-b")).toHaveTextContent(
      "the active project changed"
    );
  });

  it("stops after the document in flight when asked", async () => {
    serveLists([
      [flagged("policy", "a"), flagged("policy", "b"), flagged("policy", "c")],
    ]);
    let release: (() => void) | undefined;
    postMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(adoptedBody("policy", "a", 3));
        })
    );
    render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId("adopt-all-stop"));
    const stopButton = screen.getByTestId("adopt-all-stop");
    expect(stopButton).toHaveTextContent("Stopping after this one");
    // It says so, and keeps focus: a control that disabled itself would drop
    // focus to the page.
    expect(stopButton).toHaveAttribute("aria-disabled", "true");
    // jsdom never moves focus off a `disabled` element, so focus alone would
    // pass for a control that disabled itself; assert it did not.
    expect(stopButton).not.toBeDisabled();
    expect(stopButton).toHaveFocus();
    await act(async () => {
      release?.();
    });

    expect(await screen.findByTestId("adopt-all-summary")).toHaveTextContent(
      "1 adopted, 0 refused, 2 not attempted"
    );
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("stops the loop when the page goes away mid-run", async () => {
    serveLists([[flagged("policy", "a"), flagged("policy", "b")]]);
    let release: (() => void) | undefined;
    postMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(adoptedBody("policy", "a", 3));
        })
    );
    postMock.mockResolvedValue(adoptedBody("policy", "b", 3));
    const { unmount } = render(<PromptDocumentList />);
    const user = await openAdoptAll();
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

    const readsBefore = listReads();
    unmount();
    await act(async () => {
      release?.();
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(postMock).toHaveBeenCalledTimes(1);
    // Nor is the list re-read for a page that is gone.
    expect(listReads()).toBe(readsBefore);
  });

  it("keeps the footer outside the one scrolling body, with no scroll container inside it", async () => {
    serveLists([
      // Real descriptions, so the row text that could be cut short is on
      // screen for the check below.
      Array.from({ length: 17 }, (_, i) =>
        flagged("policy", `p${i}`, {
          description: `Policy ${i} — a description long enough to wrap onto a second line in the dialog`,
        })
      ),
    ]);
    render(<PromptDocumentList />);
    await openAdoptAll();

    const dialog = screen.getByTestId("adopt-all-dialog");
    const body = screen.getByTestId("adopt-all-body");
    const footer = screen.getByTestId("adopt-all-footer");
    for (const cls of ["flex", "flex-col", "max-h-[90vh]", "overflow-hidden"]) {
      expect(dialog).toHaveClass(cls);
    }
    expect(dialog).toHaveClass("max-w-[calc(100%-2rem)]");
    expect(dialog).toHaveClass("sm:max-w-[min(48rem,calc(100%-2rem))]");
    expect(dialog).not.toHaveClass("sm:max-w-lg");
    for (const cls of ["min-h-0", "flex-1", "overflow-y-auto"]) {
      expect(body).toHaveClass(cls);
    }
    expect(footer).toHaveClass("shrink-0");
    expect(body.contains(footer)).toBe(false);
    expect(footer.parentElement).toBe(dialog);
    expect(within(footer).getByTestId("adopt-all-confirm")).toBeInTheDocument();
    expect(
      within(body).getByTestId("adopt-all-row-policy-p16")
    ).toBeInTheDocument();
    expect(nestedScrollContainers(body)).toEqual([]);
  });
});

describe("the adopt-all dialog on its own", () => {
  it("ignores a preview that changes while a run is writing", async () => {
    const rowA: AdoptAllCandidate = {
      kind: "policy",
      name: "a",
      description: null,
      current_version: 2,
      latest_publication_version: 1,
      upstream_publication_version: null,
      local_modified: true,
      update_available: true,
    };
    let release: (() => void) | undefined;
    const onAdopt = vi.fn<AdoptOne>(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              value: {
                kind: "policy",
                name: "a",
                from_version: 2,
                to_version: 3,
                publication_version: 1,
                local_modified: true,
              },
            });
        })
    );
    const props = {
      open: true,
      onOpenChange: () => {},
      previewSource: "fresh" as const,
      tenantLabel: "bauhaus-b2b",
      tenantUnchanged: () => true,
      onAdopt,
      onFinished: async () => null,
    };
    const { rerender } = render(
      <AdoptAllDialog {...props} candidates={[rowA]} />
    );
    await userEvent.setup().click(screen.getByTestId("adopt-all-confirm"));
    await waitFor(() => expect(onAdopt).toHaveBeenCalledTimes(1));

    // A late preview arrives mid-run.
    rerender(
      <AdoptAllDialog
        {...props}
        candidates={[{ ...rowA, name: "late", current_version: 9 }]}
      />
    );
    expect(screen.getByTestId("adopt-all-outcome-policy-a")).toHaveTextContent(
      "Adopting"
    );
    await act(async () => {
      release?.();
    });
    expect(await screen.findByTestId("adopt-all-summary")).toHaveTextContent(
      "1 adopted, 0 refused"
    );
  });
});

/**
 * Every element inside `root` that a class makes a scroll or clip container,
 * or that cuts its own text short — any `overflow-*` value but `visible`,
 * `truncate`, `text-ellipsis`, `line-clamp-*` — under any variant prefix
 * (`sm:`, `hover:`, …).
 */
function nestedScrollContainers(root: HTMLElement): string[] {
  const OVERFLOW =
    /^(?:[a-z0-9-]+:)*(?:overflow-(?:[xy]-)?(?:auto|scroll|hidden|clip)|truncate|text-ellipsis|line-clamp-(?:\d+|\[.+\]))$/;
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .filter((el) => Array.from(el.classList).some((c) => OVERFLOW.test(c)))
    .map(
      (el) =>
        `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? ""}] ${el.className}`
    );
}
