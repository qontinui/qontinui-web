/**
 * Tests for the onboarding wizard's paired-elsewhere UX.
 *
 * Pairing is ADDITIVE m:n (plan
 * `2026-07-02-session-scoped-multi-tenant-device-binding` Phase 3/9,
 * repurposing the Phase-1b blocking warning from
 * `2026-07-02-multi-tenant-device-pairing-reconsideration`): a runner
 * device serves many tenants concurrently, and pairing here ADDS a
 * binding without touching the others. Under test:
 *   - PairDeviceStep renders a purely INFORMATIONAL note when
 *     `paired_elsewhere` is non-empty — no confirmation gate, pair-start
 *     fires on the first click;
 *   - empty/absent `paired_elsewhere` (older coord) renders no note and
 *     the same one-click flow;
 *   - repeated entries for one hostname (one per binding) collapse into a
 *     single line with the binding count;
 *   - the step-2 paired indicator says "paired elsewhere — pair here to
 *     add" instead of the ambiguous bare "waiting".
 *
 * Plus the Phase-2b accept step (plan
 * `2026-08-29-coord-tenant-repo-parity-and-onboarding-completion`, "the wizard
 * tells the truth"): accept now registers AND provisions the repo in coord, so
 * the wizard must send a `github_remote`, report worktree allocation in all
 * THREE states coord distinguishes, decode coord's typed refusals instead of
 * dumping `HTTP 409: {…}`, and expose the per-step provisioning outcomes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  AuditStep,
  ClaudeCodeStep,
  PairDeviceStep,
} from "./MergeOrchestrationOnboarding";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const PAIR_START_OK = {
  state: "PAIR-CODE-123",
  redirect_url: "https://example.test/pair",
  expires_in: 300,
};

const ELSEWHERE = [
  {
    hostname: "spaceship",
    name: "spaceship-runner",
    last_seen_at: "2026-07-01T12:00:00Z",
  },
];

describe("<PairDeviceStep> paired-elsewhere informational note", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("starts pairing on first click when no device is paired elsewhere", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(<PairDeviceStep onPaired={() => {}} pairedElsewhere={[]} />);

    expect(screen.queryByTestId("paired-elsewhere-info")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/coord/devices/pair-start");
    await waitFor(() => expect(screen.getByText("PAIR-CODE-123")).toBeTruthy());
  });

  it("degrades identically when the field is absent (older coord)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(<PairDeviceStep onPaired={() => {}} />);

    expect(screen.queryByTestId("paired-elsewhere-info")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("shows the additive-pairing note and pair-start fires on the FIRST click (no confirmation gate)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAIR_START_OK));
    render(<PairDeviceStep onPaired={() => {}} pairedElsewhere={ELSEWHERE} />);

    // Informational note is visible, naming the device — additive copy,
    // no steal language.
    const note = screen.getByTestId("paired-elsewhere-info");
    expect(note.textContent).toContain("spaceship");
    expect(note.textContent).toContain("also serves 1 other tenant");
    expect(note.textContent).toContain(
      "Pairing here adds this tenant — existing pairings are unaffected"
    );
    expect(note.textContent).not.toContain("unpair");

    // No confirmation gate exists: the first click starts pairing.
    expect(screen.queryByTestId("pair-anyway-button")).toBeNull();
    fireEvent.click(screen.getByTestId("start-pairing-button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/coord/devices/pair-start");
    await waitFor(() => expect(screen.getByText("PAIR-CODE-123")).toBeTruthy());
  });

  it("collapses repeated hostname entries (one per binding) into a counted line", () => {
    render(
      <PairDeviceStep
        onPaired={() => {}}
        pairedElsewhere={[
          ...ELSEWHERE,
          { hostname: "spaceship", name: null, last_seen_at: null },
        ]}
      />
    );

    const note = screen.getByTestId("paired-elsewhere-info");
    expect(note.textContent).toContain("also serves 2 other tenants");
    // One line per device, not per binding.
    expect(screen.getAllByText("spaceship")).toHaveLength(1);
  });
});

describe("<ClaudeCodeStep> paired indicator", () => {
  const base = {
    paired: false,
    claude_code_available: false,
    ready: false,
  };

  it("says 'waiting' when never paired anywhere", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired_elsewhere: [] }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "waiting"
    );
  });

  it("says 'paired elsewhere — pair here to add' when paired elsewhere", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired_elsewhere: ELSEWHERE }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "paired elsewhere — pair here to add"
    );
  });

  it("says 'yes' when paired for THIS tenant (elsewhere list irrelevant)", () => {
    render(
      <ClaudeCodeStep
        status={{ ...base, paired: true, paired_elsewhere: [] }}
        onReady={() => {}}
      />
    );
    expect(screen.getByTestId("paired-indicator").textContent).toContain("yes");
  });

  it("degrades to 'waiting' when the field is absent (older coord)", () => {
    render(<ClaudeCodeStep status={base} onReady={() => {}} />);
    expect(screen.getByTestId("paired-indicator").textContent).toContain(
      "waiting"
    );
  });
});

// ---------------------------------------------------------------------------
// Step 3 — accept now registers + provisions the repo
// ---------------------------------------------------------------------------

const AUDITED_REPO = "acme/widgets";
const AUDITED_PROFILE = {
  framework_signals: ["fastapi"],
  escalate_paths: [],
  line_budget: 500,
};

/**
 * Drive the audit flow to the STARTER_PROFILE cards, routing each call by URL:
 * POST /audit answers 202 {agent_id}, GET /audit-status answers ready, and
 * POST /accept answers whatever the caller supplied.
 */
function installAuditFlow(acceptResponse: () => Response) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/onboarding/audit-status")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            agent_id: "agent-1",
            starter_profile: AUDITED_PROFILE,
            audit_confidence: 0.9,
          }),
          { status: 200 }
        )
      );
    }
    if (url.includes("/onboarding/audit") && method === "POST") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            agent_id: "agent-1",
            repo: AUDITED_REPO,
            status: "running",
          }),
          { status: 202 }
        )
      );
    }
    if (url.includes("/onboarding/accept")) {
      return Promise.resolve(acceptResponse());
    }
    return Promise.reject(new Error(`unexpected fetch: ${method} ${url}`));
  });
}

async function reachStarterProfileCards() {
  render(<AuditStep ready />);
  fireEvent.change(screen.getByPlaceholderText("qontinui/qontinui-coord"), {
    target: { value: AUDITED_REPO },
  });
  fireEvent.click(screen.getByRole("button", { name: "Audit" }));
  await screen.findByTestId("starter-profile-cards");
}

function acceptBodySent(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/onboarding/accept")
  );
  if (!call) throw new Error("accept was never called");
  return JSON.parse((call[1] as RequestInit).body as string);
}

function okAccept(body: Record<string, unknown>) {
  return () => new Response(JSON.stringify(body), { status: 200 });
}

function errorAccept(status: number, body: unknown) {
  return () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    });
}

describe("<AuditStep> accept — github_remote", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("pre-fills the remote from the slug and sends it", async () => {
    installAuditFlow(
      okAccept({ repo: AUDITED_REPO, worktree_allocation: "enabled" })
    );
    await reachStarterProfileCards();

    const input = screen.getByTestId("github-remote-input") as HTMLInputElement;
    expect(input.value).toBe("https://github.com/acme/widgets.git");

    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));
    await screen.findByTestId("accept-result");
    expect(acceptBodySent().github_remote).toBe(
      "https://github.com/acme/widgets.git"
    );
  });

  it("sends an operator-corrected remote verbatim", async () => {
    installAuditFlow(
      okAccept({ repo: AUDITED_REPO, worktree_allocation: "enabled" })
    );
    await reachStarterProfileCards();

    fireEvent.change(screen.getByTestId("github-remote-input"), {
      target: { value: "git@github.example.internal:acme/widgets.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));
    await screen.findByTestId("accept-result");

    expect(acceptBodySent().github_remote).toBe(
      "git@github.example.internal:acme/widgets.git"
    );
  });

  it("sends NO github_remote when the operator clears the field", async () => {
    // The whole point of the field: a cleared remote must reach coord as
    // absent so `repo_has_no_remote` can fire, rather than the wizard quietly
    // re-synthesizing the value the operator just deleted.
    installAuditFlow(
      errorAccept(422, {
        error: "repo_has_no_remote",
        repo: AUDITED_REPO,
        hint: "supply the clone URL",
      })
    );
    await reachStarterProfileCards();

    fireEvent.change(screen.getByTestId("github-remote-input"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));
    await screen.findByTestId("accept-failure");

    expect("github_remote" in acceptBodySent()).toBe(false);
  });
});

describe("<AuditStep> accept — worktree allocation has THREE states", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("reports 'enabled'", async () => {
    installAuditFlow(
      okAccept({ repo: AUDITED_REPO, worktree_allocation: "enabled" })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const notice = await screen.findByTestId("worktree-allocation");
    expect(notice.getAttribute("data-worktree-allocation")).toBe("enabled");
    expect(notice.textContent).toContain("enabled");
  });

  it("reports 'blocked_no_remote' and says what to do about it", async () => {
    installAuditFlow(
      okAccept({ repo: AUDITED_REPO, worktree_allocation: "blocked_no_remote" })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const notice = await screen.findByTestId("worktree-allocation");
    expect(notice.getAttribute("data-worktree-allocation")).toBe(
      "blocked_no_remote"
    );
    expect(notice.textContent).toContain("blocked");
    expect(notice.textContent).toContain("clone URL");
  });

  it("reports 'pending_first_reconcile' as its OWN state, never as enabled", async () => {
    // A failed reconcile can leave a legitimate registry row behind, so
    // allocation may still 409 briefly. Collapsing this into "enabled" is
    // precisely the lie this phase removes.
    installAuditFlow(
      okAccept({
        repo: AUDITED_REPO,
        worktree_allocation: "pending_first_reconcile",
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const notice = await screen.findByTestId("worktree-allocation");
    expect(notice.getAttribute("data-worktree-allocation")).toBe(
      "pending_first_reconcile"
    );
    expect(notice.textContent).toContain("pending first reconcile");
    expect(notice.textContent).toContain("409");
  });

  it("reports UNKNOWN — not success — when an older coord omits the field", async () => {
    installAuditFlow(okAccept({ repo: AUDITED_REPO }));
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const notice = await screen.findByTestId("worktree-allocation");
    expect(notice.getAttribute("data-worktree-allocation")).toBe("unknown");
    expect(notice.textContent).toContain("unknown");
  });
});

describe("<AuditStep> accept — provisioning disclosure", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("lists each step and flags the failed one", async () => {
    installAuditFlow(
      okAccept({
        repo: AUDITED_REPO,
        worktree_allocation: "pending_first_reconcile",
        provisioning: {
          registry: "inserted",
          bare_init: "created",
          hook: "refreshed",
          mirror_seed: "seeded",
          reconcile: "failed: remote hung up",
        },
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const block = await screen.findByTestId("provisioning-steps");
    expect(block.textContent).toContain("1 failed");
    expect(block.textContent).toContain("mirror_seed");
    expect(block.textContent).toContain("failed: remote hung up");
    // A failure opens the disclosure rather than hiding it behind a click.
    expect(block.hasAttribute("open")).toBe(true);
  });

  it("renders nothing when coord reported no provisioning steps", async () => {
    installAuditFlow(
      okAccept({ repo: AUDITED_REPO, worktree_allocation: "enabled" })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    await screen.findByTestId("accept-result");
    expect(screen.queryByTestId("provisioning-steps")).toBeNull();
  });
});

describe("<AuditStep> accept — typed refusals", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  const typed: Array<[number, string, string]> = [
    [403, "repo_not_in_tenant", "no enrollment for your tenant"],
    [422, "repo_has_no_remote", "No GitHub remote was supplied"],
    [
      409,
      "repo_registered_to_another_tenant",
      "Another tenant already holds this repo slug",
    ],
    [409, "repo_unenrolled", "un-enrollment tombstone"],
  ];

  it.each(typed)(
    "decodes a structured %i %s into operator copy plus coord's hint",
    async (status, code, copy) => {
      installAuditFlow(
        errorAccept(status, {
          detail: { error: code, repo: AUDITED_REPO, hint: "coord says do X" },
        })
      );
      await reachStarterProfileCards();
      fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

      const failure = await screen.findByTestId("accept-failure");
      expect(failure.getAttribute("data-accept-error")).toBe(code);
      expect(failure.textContent).toContain(copy);
      expect(screen.getByTestId("accept-failure-hint").textContent).toBe(
        "coord says do X"
      );
      // Never the raw dump the wizard used to show.
      expect(failure.textContent).not.toContain(`HTTP ${status}`);
    }
  );

  it("decodes a STRINGIFIED detail (older backend that has not opted in)", async () => {
    installAuditFlow(
      errorAccept(409, {
        detail: JSON.stringify({
          error: "repo_unenrolled",
          repo: AUDITED_REPO,
          hint: "re-enrol it first",
        }),
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.getAttribute("data-accept-error")).toBe("repo_unenrolled");
    expect(screen.getByTestId("accept-failure-hint").textContent).toBe(
      "re-enrol it first"
    );
  });

  it("decodes coord's body with no FastAPI envelope at all", async () => {
    installAuditFlow(
      errorAccept(422, { error: "repo_has_no_remote", repo: AUDITED_REPO })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.getAttribute("data-accept-error")).toBe(
      "repo_has_no_remote"
    );
    // No hint from coord — the wizard's own copy still explains the refusal.
    expect(screen.queryByTestId("accept-failure-hint")).toBeNull();
    expect(failure.textContent).toContain("Coord will not invent one");
  });

  it("names an unrecognized coord error code rather than swallowing it", async () => {
    installAuditFlow(errorAccept(409, { detail: { error: "some_new_code" } }));
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.getAttribute("data-accept-error")).toBe("some_new_code");
    expect(failure.textContent).toContain("some_new_code");
  });

  it("falls back to the raw body when it is not coord's contract", async () => {
    installAuditFlow(errorAccept(502, "<html>bad gateway</html>"));
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.getAttribute("data-accept-error")).toBe("unknown");
    expect(failure.textContent).toContain("HTTP 502");
    expect(failure.textContent).toContain("bad gateway");
  });

  it("keeps the profile editable after a refusal so accept can be retried", async () => {
    installAuditFlow(
      errorAccept(422, {
        detail: { error: "repo_has_no_remote", repo: AUDITED_REPO },
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    await screen.findByTestId("accept-failure");
    expect(screen.getByTestId("starter-profile-cards")).toBeTruthy();
    expect(screen.getByTestId("github-remote-input")).toBeTruthy();
    expect(screen.queryByTestId("accept-result")).toBeNull();
  });
});

describe("<AuditStep> accept — the PRODUCTION error envelope", () => {
  // `app/middleware/error_handler.py` replaces FastAPI's default handler for
  // the real app: a dict `HTTPException.detail` carrying an `error` key is
  // SPLICED into the top level of a standardized envelope, so what actually
  // reaches the browser has no `detail` key at all. The bare-`FastAPI()`
  // backend tests never see this shape, which is exactly why it is pinned
  // here.
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("decodes coord's code and hint out of the spliced envelope", async () => {
    installAuditFlow(
      errorAccept(409, {
        error: "repo_registered_to_another_tenant",
        message: "{'error': 'repo_registered_to_another_tenant', ...}",
        timestamp: 1756500000.0,
        path: "https://app.test/api/v1/operations/pr-merge/onboarding/accept",
        repo: AUDITED_REPO,
        hint: "ask an operator to release the registration",
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.getAttribute("data-accept-error")).toBe(
      "repo_registered_to_another_tenant"
    );
    expect(failure.textContent).toContain(
      "Another tenant already holds this repo slug"
    );
    expect(screen.getByTestId("accept-failure-hint").textContent).toBe(
      "ask an operator to release the registration"
    );
    // The envelope's Python-repr `message` is noise, not operator copy.
    expect(failure.textContent).not.toContain("{'error'");
  });

  it("does NOT mistake the backend's own generic code for a coord refusal", async () => {
    // When coord's body is not a typed object the handler fills `error` from
    // its own status→code table and puts the raw body in `message`. Reading
    // "CONFLICT" as a coord refusal would invent a refusal coord never made.
    installAuditFlow(
      errorAccept(409, {
        error: "CONFLICT",
        message: "coord said something unstructured",
        timestamp: 1756500000.0,
        path: "https://app.test/api/v1/operations/pr-merge/onboarding/accept",
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.getAttribute("data-accept-error")).toBe("unknown");
    // The envelope's `message` is shown, not the whole envelope with its
    // timestamp/path noise.
    expect(failure.textContent).toContain("coord said something unstructured");
    expect(failure.textContent).not.toContain("timestamp");
  });

  it("reports the 504 an over-tight proxy timeout would produce, verbatim", async () => {
    // The backend overrides `_COORD_TIMEOUT` for accept precisely so this
    // does not happen on every real repo; if it ever does, the operator sees
    // the reason rather than a generic failure.
    installAuditFlow(
      errorAccept(504, {
        error: "GATEWAY_TIMEOUT",
        message: "timeout waiting for coord",
        timestamp: 1756500000.0,
        path: "https://app.test/api/v1/operations/pr-merge/onboarding/accept",
      })
    );
    await reachStarterProfileCards();
    fireEvent.click(screen.getByRole("button", { name: "Accept & save" }));

    const failure = await screen.findByTestId("accept-failure");
    expect(failure.textContent).toContain("HTTP 504");
    expect(failure.textContent).toContain("timeout waiting for coord");
  });
});
