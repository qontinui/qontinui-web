/**
 * `/admin/coord/decision-policies`, end to end against a mocked `httpClient`.
 *
 * The page, its list, its dialog and its hook are all REAL here — only the
 * transport, the auth context and the toaster are stubbed. That is deliberate:
 * every fact this surface exists to protect is a property of the BODY that
 * reaches coord or of the sentence the operator reads before pressing a
 * button, and both die in a test that mocks the hook.
 *
 * Coverage is enumerated, not guessed: cardinality (0 / 1 / many), the create
 * body's exact shape, the client-side JSON refusal, the payload-is-a-replace
 * path, the graduation confirm in both directions, the inert-at-always_escalate
 * copy, one distinct message per failing call, and the non-admin gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();
/** `GET …/coord/next-step-settings` — coord's served per-domain defaults. */
const getSettings = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    // The policy calls go through `httpClient.fetch` (the typed /operations
    // client); route each request onto the per-verb mock the assertions read.
    fetch: async (url: string, init: { method?: string; body?: string }) => {
      const method = init.method ?? "GET";
      const body = JSON.parse(init.body ?? "null");
      let out: unknown;
      if (method === "GET")
        out = url.endsWith("/coord/next-step-settings")
          ? await getSettings(url)
          : await get(url);
      else if (method === "POST") out = await post(url, body);
      else if (method === "PATCH") out = await patch(url, body);
      else if (method === "DELETE") out = await del(url);
      else throw new Error(`fetch mock: unexpected ${method} ${url}`);
      // A mock that resolves a `Response` (an error path) is answered
      // as-is, so a non-2xx goes through `readJson` like the real one.
      return out instanceof Response
        ? out
        : new Response(JSON.stringify(out ?? null));
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

let isCoordAdmin = true;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin }),
}));

import DecisionPoliciesPage from "./page";

interface Row {
  policy_id: string;
  decision_domain: string | null;
  mode: string;
  autonomy_level: string;
  name: string;
  payload: unknown;
  repo?: string | null;
  priority?: number;
  enabled?: boolean;
  built_in?: boolean;
}

function row(patchRow: Row) {
  return {
    tenant_id: "t1",
    repo: null,
    kind: null,
    condition: {},
    action: {},
    priority: 100,
    enabled: true,
    rationale: null,
    default_source: null,
    expires_at: null,
    created_at: "2026-09-01T00:00:00Z",
    created_by: "operator:someone",
    updated_at: "2026-09-01T00:00:00Z",
    updated_by: "operator:someone",
    built_in: false,
    override_state: null,
    system_rule_id: null,
    ...patchRow,
  };
}

const PR_FIX = row({
  policy_id: "pf-1",
  decision_domain: "pr_fix",
  mode: "guidance",
  autonomy_level: "always_escalate",
  name: "pr_fix autonomous repair frame",
  payload: { notes: "pilot" },
  repo: "qontinui/qontinui-dev-notes",
});

const RED_MAIN = row({
  policy_id: "rm-1",
  decision_domain: "red_main_fix",
  mode: "guidance",
  autonomy_level: "auto_decide",
  name: "red main fixer",
  payload: {},
});

const NEXT_STEP = row({
  policy_id: "ns-1",
  decision_domain: "next_step",
  mode: "guidance",
  autonomy_level: "guidance_only",
  name: "next step frame",
  payload: {},
});

/** coord's system-band seed row for the sixth domain (built_in). */
const ADMISSION_STALL = row({
  policy_id: "as-1",
  decision_domain: "admission_stall_fix",
  mode: "guidance",
  autonomy_level: "auto_decide",
  name: "admission stall responder",
  payload: {},
  built_in: true,
});

const ARCH_TRADEOFF = row({
  policy_id: "at-1",
  decision_domain: "architecture_tradeoff",
  mode: "guidance",
  autonomy_level: "guidance_only",
  name: "architecture trade-off frame",
  payload: {},
});

/** A v2 row this page must NOT claim — it belongs to /admin/coord/gate-clearance. */
const GATE_CLEARANCE = row({
  policy_id: "gc-1",
  decision_domain: "gate_clearance",
  mode: "data_driven",
  autonomy_level: "always_escalate",
  name: "security-surface clearance",
  payload: { gate_class: "security-surface", authority: "operator_only" },
});

/** What coord's next-step settings served on 2026-10-14, spelled out. */
const SERVED_DEFAULTS = [
  ["next_step", "auto_decide", "system_row"],
  ["pr_fix", "auto_decide", "system_row"],
  ["red_main_fix", "auto_decide", "system_row"],
  ["admission_stall_fix", "auto_decide", "system_row"],
  ["architecture_tradeoff", "guidance_only", "system_row"],
  ["verification_sufficiency", "guidance_only", "code_fallback"],
] as const;

/** `[domain, default level, default source, resolved_from?, autonomy_level?]` */
type ServedDefault =
  | readonly [string, string, string]
  | readonly [string, string, string, string, string];

function serveDefaults(rows: readonly ServedDefault[]) {
  getSettings.mockResolvedValue({
    master_enabled: true,
    can_edit: true,
    domains: rows.map(([decision_domain, level, source, from, current]) => ({
      decision_domain,
      label: decision_domain,
      description: "",
      autonomy_level: current ?? level,
      default_autonomy_level: level,
      default_source: source,
      mode: "guidance",
      resolved_from: from ?? "system",
      requires_master: false,
      effective: false,
    })),
  });
}

function serve(policies: unknown[]) {
  get.mockResolvedValue({ policies, total: policies.length });
}

beforeEach(() => {
  vi.clearAllMocks();
  isCoordAdmin = true;
  serve([]);
  serveDefaults(SERVED_DEFAULTS);
  post.mockResolvedValue(PR_FIX);
  patch.mockResolvedValue({});
  del.mockResolvedValue(undefined);
});

/** Open the create dialog and return it. */
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("new-decision-policy"));
  return screen.getByTestId("decision-policy-editor");
}

async function expandFirstRow(user: ReturnType<typeof userEvent.setup>) {
  const rows = await screen.findAllByTestId("decision-policy-row");
  await user.click(within(rows[0]!).getByRole("button", { expanded: false }));
}

describe("cardinality", () => {
  it("says what an EMPTY workspace means rather than showing a blank list", async () => {
    render(<DecisionPoliciesPage />);
    const empty = await screen.findByTestId("no-decision-policies");
    expect(empty.textContent).toContain("escalated_no_policy");
    expect(screen.queryAllByTestId("decision-policy-row")).toHaveLength(0);
  });

  it("renders one row", async () => {
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    expect(await screen.findAllByTestId("decision-policy-row")).toHaveLength(1);
    expect(screen.queryByTestId("no-decision-policies")).toBeNull();
  });

  it("renders many, in coord's domain order, and drops a foreign domain", async () => {
    serve([
      ARCH_TRADEOFF,
      RED_MAIN,
      ADMISSION_STALL,
      GATE_CLEARANCE,
      PR_FIX,
      NEXT_STEP,
    ]);
    render(<DecisionPoliciesPage />);
    const rows = await screen.findAllByTestId("decision-policy-row");
    expect(rows).toHaveLength(5);
    // admission_stall_fix sits between red_main_fix and architecture_tradeoff,
    // exactly where coord's DOMAIN_SPECS puts it.
    expect(rows.map((r) => r.getAttribute("data-row-key"))).toEqual([
      "ns-1",
      "pf-1",
      "rm-1",
      "as-1",
      "at-1",
    ]);
    // The gate_clearance row is a v2 row too, and is not this page's.
    expect(screen.queryByText("security-surface clearance")).toBeNull();
  });
});

describe("the inert-at-always_escalate fact", () => {
  it("is on the page before the form is opened", async () => {
    render(<DecisionPoliciesPage />);
    const banner = await screen.findByTestId("decision-policies-inert-banner");
    expect(banner.textContent).toContain("arms nothing");
    expect(banner.textContent).toContain("always_escalate");
    expect(banner.textContent).toContain("escalated_by_policy");
  });

  it("is repeated inside the create dialog", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    expect(
      within(dialog).getByTestId("decision-policy-inert-note").textContent
    ).toContain("always_escalate");
  });
});

describe("create", () => {
  it("offers admission_stall_fix in the domain picker, in coord's order", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByLabelText("Decision domain"));
    const options = (await screen.findAllByRole("option")).map(
      (o) => o.textContent
    );
    expect(options).toEqual([
      "next_step",
      "pr_fix",
      "red_main_fix",
      "admission_stall_fix",
      "architecture_tradeoff",
      "verification_sufficiency",
    ]);
    await user.click(screen.getByRole("option", { name: "admission_stall_fix" }));
    expect(
      within(dialog).getByText(/merge-train steward when your tenant's/)
    ).toBeTruthy();
  });

  it("warns that a new admission_stall_fix row overrides coord's auto_decide default, and offers no repo", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByLabelText("Decision domain"));
    await user.click(
      await screen.findByRole("option", { name: "admission_stall_fix" })
    );
    const warning = await within(dialog).findByTestId(
      "decision-policy-default-override-warning"
    );
    expect(warning.textContent).toContain("system default at auto_decide");
    expect(warning.textContent).toContain("workspace-wide row");
    expect(warning.textContent).toContain("turns that default off");
    // Coord consults this domain with repo = None: no repo field is offered.
    expect(within(dialog).queryByLabelText("Repo scope")).toBeNull();
    expect(
      within(dialog).getByTestId("decision-policy-repo-not-served").textContent
    ).toContain("with no repo");
  });

  it("warns for architecture_tradeoff's guidance_only default as well", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByLabelText("Decision domain"));
    await user.click(
      await screen.findByRole("option", { name: "architecture_tradeoff" })
    );
    expect(
      (
        await within(dialog).findByTestId(
          "decision-policy-default-override-warning"
        )
      ).textContent
    ).toContain("system default at guidance_only");
    expect(within(dialog).getByLabelText("Repo scope")).toBeTruthy();
  });

  it("does not warn for verification_sufficiency, whose default is no row", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByLabelText("Decision domain"));
    await user.click(
      await screen.findByRole("option", { name: "verification_sufficiency" })
    );
    // Wait for the read to land (the loading caution clears), then: nothing.
    await waitFor(() =>
      expect(
        within(dialog).queryByTestId("decision-policy-default-loading")
      ).toBeNull()
    );
    expect(
      within(dialog).queryByTestId("decision-policy-default-unknown")
    ).toBeNull();
    expect(
      within(dialog).queryByTestId("decision-policy-default-override-warning")
    ).toBeNull();
    expect(getSettings).toHaveBeenCalledWith(
      "/api/v1/operations/coord/next-step-settings"
    );
  });

  it("follows the LIVE default: a system row moved to always_escalate draws no warning", async () => {
    serveDefaults([["pr_fix", "always_escalate", "system_row"]]);
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByLabelText("Decision domain"));
    await user.click(await screen.findByRole("option", { name: "pr_fix" }));
    await waitFor(() =>
      expect(
        within(dialog).queryByTestId("decision-policy-default-loading")
      ).toBeNull()
    );
    expect(
      within(dialog).queryByTestId("decision-policy-default-unknown")
    ).toBeNull();
    expect(
      within(dialog).queryByTestId("decision-policy-default-override-warning")
    ).toBeNull();
  });

  it("shows an UNKNOWN caution, not silence, when the default cannot be read", async () => {
    getSettings.mockRejectedValue(new Error("coord unreachable"));
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-default-unknown").textContent
      ).toContain("coord unreachable")
    );
    const caution = within(dialog).getByTestId(
      "decision-policy-default-unknown"
    );
    expect(caution.textContent).toContain(
      "Could not read coord's current default for this domain"
    );
    expect(caution.textContent).toContain("outranks it and turns it off");
    expect(
      within(dialog).queryByTestId("decision-policy-default-override-warning")
    ).toBeNull();
  });

  it("says it is reading coord's default before the read answers", async () => {
    getSettings.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    expect(
      within(dialog).getByTestId("decision-policy-default-loading").textContent
    ).toBe("Reading coord's current default for this domain…");
    expect(
      within(dialog).queryByTestId("decision-policy-default-unknown")
    ).toBeNull();
  });

  it("defers to an existing workspace override rather than claiming to turn the default off", async () => {
    serveDefaults([
      ["next_step", "auto_decide", "system_row", "tenant", "guidance_only"],
    ]);
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    const warning = await within(dialog).findByTestId(
      "decision-policy-default-override-warning"
    );
    expect(warning.textContent).toBe(
      "A workspace row already overrides coord's default for this domain at guidance_only; a new row " +
        "takes effect only if it outranks that row (lower priority number, then older)."
    );
  });

  it("names an existing row already scoped to the same repo", async () => {
    serve([PR_FIX]);
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    await screen.findAllByTestId("decision-policy-row");
    const dialog = await openCreate(user);
    await user.click(within(dialog).getByLabelText("Decision domain"));
    await user.click(await screen.findByRole("option", { name: "pr_fix" }));
    await user.type(
      within(dialog).getByLabelText("Repo scope"),
      "qontinui/qontinui-dev-notes"
    );
    const warning = await within(dialog).findByTestId(
      "decision-policy-default-override-warning"
    );
    expect(warning.textContent).toBe(
      "A row scoped to qontinui/qontinui-dev-notes already exists for this domain: " +
        '"pr_fix autonomous repair frame" (at always_escalate, priority 100). This row takes effect for ' +
        "qontinui/qontinui-dev-notes only if it outranks it (lower priority number, then older), and then " +
        "at always_escalate."
    );
  });

  it("shows the UNKNOWN caution when the domain is missing from coord's answer", async () => {
    serveDefaults([["pr_fix", "auto_decide", "system_row"]]);
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    // The form starts on next_step, which this answer does not list.
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-default-unknown").textContent
      ).toContain("does not list this domain")
    );
  });

  it("re-words the warning for a repo-scoped row", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText("Repo scope"), "o/r");
    expect(
      (
        await within(dialog).findByTestId(
          "decision-policy-default-override-warning"
        )
      ).textContent
    ).toContain("A row scoped to o/r outranks it for that repo");
  });

  it("posts decision_domain + mode + payload, and no v1 or autonomy field", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);

    await user.type(
      within(dialog).getByLabelText("Name"),
      "pr_fix autonomous repair frame"
    );
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "pilot"}');

    await user.click(within(dialog).getByTestId("decision-policy-save"));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe("/api/v1/operations/coord/policies");
    const body = post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.decision_domain).toBe("next_step");
    expect(body.mode).toBe("guidance");
    expect(body.payload).toEqual({ notes: "pilot" });
    expect(body.name).toBe("pr_fix autonomous repair frame");
    expect(Object.keys(body)).not.toContain("autonomy_level");
    expect(Object.keys(body)).not.toContain("kind");
    expect(Object.keys(body)).not.toContain("condition");
    expect(Object.keys(body)).not.toContain("action");
  });

  it("offers no autonomy control at all in the create form", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);
    expect(
      within(dialog).queryByTestId("decision-policy-graduation")
    ).toBeNull();
    expect(within(dialog).queryByText("Auto decide")).toBeNull();
  });

  it("catches malformed JSON client-side and never sends it", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText("Name"), "a name");
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": ');

    expect(
      within(dialog).getByTestId("decision-policy-payload-error").textContent
    ).toContain("Not valid JSON");
    const save = within(dialog).getByTestId("decision-policy-save");
    expect(save).toHaveProperty("disabled", true);
    await user.click(save);
    expect(post).not.toHaveBeenCalled();
  });

  it("warns about a payload field coord would accept and then drop", async () => {
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);

    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    // NB: `[` opens a key descriptor in user-event's keyboard grammar, so the
    // payload typed here deliberately avoids one. `{{` is its escape for `{`.
    await user.type(payload, '{{"rubric": {{}}');

    const warnings = within(dialog).getByTestId(
      "decision-policy-payload-warnings"
    );
    expect(warnings.textContent).toContain("rubric.instructions");
    expect(warnings.textContent).toContain("silently drop");
  });
});

describe("editing an existing row", () => {
  it("takes the REPLACE path for a payload change, and says so first", async () => {
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    await user.click(
      screen.getByRole("button", {
        name: "Edit pr_fix autonomous repair frame",
      })
    );

    const dialog = screen.getByTestId("decision-policy-editor");
    // Nothing changed yet: no replace warning, and Save would PATCH.
    expect(
      within(dialog).queryByTestId("decision-policy-replace-note")
    ).toBeNull();

    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');

    expect(
      within(dialog).getByTestId("decision-policy-replace-note").textContent
    ).toContain("replaces");

    await user.click(within(dialog).getByTestId("decision-policy-save"));

    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    // Create FIRST, then delete — the old row keeps deciding in between.
    expect(post).toHaveBeenCalledTimes(1);
    expect(
      (post.mock.calls[0]?.[1] as Record<string, unknown>).payload
    ).toEqual({ notes: "changed" });
    expect(del.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/coord/policies/pf-1"
    );
    // And NOT a PATCH, which would have silently kept the old payload.
    expect(patch).not.toHaveBeenCalled();
  });

  it("names the repos a workspace → repo replace releases, and that it can re-arm the default", async () => {
    const user = userEvent.setup();
    serve([RED_MAIN]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    await user.click(
      screen.getByRole("button", { name: "Edit red main fixer" })
    );
    const dialog = screen.getByTestId("decision-policy-editor");

    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');
    await user.type(within(dialog).getByLabelText("Repo scope"), "o/r");

    const release = await within(dialog).findByTestId(
      "decision-policy-release-caution"
    );
    await waitFor(() =>
      expect(release.textContent).toBe(
        "Repos other than o/r stop using this row and go back to coord's default (at auto_decide), " +
          "unless another workspace row covers them. With coord's system default at auto_decide, this " +
          "can re-arm dispatch for those repos."
      )
    );
  });

  it("warns that replacing a graduated row de-graduates it", async () => {
    const user = userEvent.setup();
    serve([RED_MAIN]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    await user.click(
      screen.getByRole("button", { name: "Edit red main fixer" })
    );

    const dialog = screen.getByTestId("decision-policy-editor");
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');

    const note = within(dialog).getByTestId("decision-policy-replace-note");
    expect(note.textContent).toContain("always_escalate");
    expect(note.textContent).toContain("auto_decide");
  });

  it("PATCHes a name-only edit instead of replacing the row", async () => {
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    await user.click(
      screen.getByRole("button", {
        name: "Edit pr_fix autonomous repair frame",
      })
    );

    const dialog = screen.getByTestId("decision-policy-editor");
    await user.type(within(dialog).getByLabelText("Name"), " v2");
    await user.click(within(dialog).getByTestId("decision-policy-save"));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/coord/policies/pf-1"
    );
    const body = patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.name).toBe("pr_fix autonomous repair frame v2");
    // Neither of the two fields coord's PATCH must never receive from here.
    expect(Object.keys(body)).not.toContain("payload");
    expect(Object.keys(body)).not.toContain("enabled");
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe("an in-place scope edit", () => {
  async function openEditOf(
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) {
    await expandFirstRow(user);
    await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
    return screen.getByTestId("decision-policy-editor");
  }

  it("cautions at the row's CURRENT level when a repo row is made workspace-wide, and still PATCHes", async () => {
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditOf(user, "pr_fix autonomous repair frame");
    expect(
      within(dialog).queryByTestId("decision-policy-scope-edit-caution")
    ).toBeNull();

    await user.clear(within(dialog).getByLabelText("Repo scope"));
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-scope-edit-caution")
          .textContent
      ).toContain(
        "Workspace-wide, this row (at always_escalate) outranks coord's system default (auto_decide) for every repo without its own row."
      )
    );
    expect(
      within(dialog).getByTestId("decision-policy-scope-edit-caution")
        .textContent
    ).toContain("qontinui/qontinui-dev-notes stops using this row");
    // A PATCH keeps the level, so it is not the create-time "turns it off" text.
    expect(
      within(dialog).queryByTestId("decision-policy-default-override-warning")
    ).toBeNull();

    await user.click(within(dialog).getByTestId("decision-policy-save"));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect((patch.mock.calls[0]?.[1] as Record<string, unknown>).repo).toBe(
      null
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("names the new repo when a workspace row is moved to one", async () => {
    const user = userEvent.setup();
    serve([RED_MAIN]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditOf(user, "red main fixer");
    await user.type(within(dialog).getByLabelText("Repo scope"), "o/r");
    const caution = within(dialog).getByTestId(
      "decision-policy-scope-edit-caution"
    );
    expect(caution.textContent).toContain(
      "For o/r, this row will outrank coord's system default and any workspace row at this row's level auto_decide."
    );
    expect(caution.textContent).toContain(
      "Repos other than o/r stop using this row"
    );
  });
});

describe("what a replace or a priority edit releases or contests", () => {
  async function openEditByName(
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) {
    const rows = await screen.findAllByTestId("decision-policy-row");
    const target = rows.find((r) => r.textContent?.includes(name));
    if (!target) throw new Error(`no row named ${name}`);
    await user.click(within(target).getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
    return screen.getByTestId("decision-policy-editor");
  }

  it("names what the OLD domain loses when a replace changes the domain", async () => {
    const user = userEvent.setup();
    serve([RED_MAIN]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "red main fixer");
    await user.click(within(dialog).getByLabelText("Decision domain"));
    await user.click(await screen.findByRole("option", { name: "pr_fix" }));

    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-release-caution")
          .textContent
      ).toBe(
        "red_main_fix loses this row and goes back to another row or coord's default (at auto_decide). " +
          "With coord's system default at auto_decide, this can re-arm dispatch for red_main_fix."
      )
    );
    const note = within(dialog).getByTestId(
      "decision-policy-replace-note"
    ).textContent;
    expect(note).toContain("the replacement's domain is never left with no policy");
    expect(note).toContain("the old domain (red_main_fix) does lose this row");
  });

  it("raises no release caution for a repo-scoped admission_stall_fix row, which never served", async () => {
    const REPO_ADMISSION = row({
      policy_id: "ra-1",
      decision_domain: "admission_stall_fix",
      mode: "guidance",
      autonomy_level: "auto_decide",
      name: "repo admission frame",
      payload: {},
      repo: "o/r",
    });
    const user = userEvent.setup();
    serve([REPO_ADMISSION]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "repo admission frame");
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');

    // The replacement is workspace-wide, so the default warning still shows.
    await within(dialog).findByTestId(
      "decision-policy-default-override-warning"
    );
    expect(
      within(dialog).queryByTestId("decision-policy-release-caution")
    ).toBeNull();
  });

  it("says when a priority-only edit hands the scope to this row", async () => {
    const ARMED = row({
      policy_id: "pf-2",
      decision_domain: "pr_fix",
      mode: "guidance",
      autonomy_level: "auto_decide",
      name: "armed repo frame",
      payload: {},
      repo: "qontinui/qontinui-dev-notes",
      priority: 50,
    });
    const user = userEvent.setup();
    serve([PR_FIX, ARMED]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "pr_fix autonomous repair frame");
    expect(
      within(dialog).queryByTestId("decision-policy-priority-caution")
    ).toBeNull();

    const priority = within(dialog).getByLabelText("Priority");
    await user.clear(priority);
    await user.type(priority, "10");
    expect(
      within(dialog).getByTestId("decision-policy-priority-caution").textContent
    ).toBe(
      'This row now ranks above "armed repo frame" (auto_decide) for qontinui/qontinui-dev-notes — ' +
        "consults take this row's always_escalate."
    );
  });
});

describe("ranking within the edited row's own band", () => {
  async function openEditByName(
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) {
    const rows = await screen.findAllByTestId("decision-policy-row");
    const target = rows.find((r) => r.textContent?.includes(name));
    if (!target) throw new Error(`no row named ${name}`);
    await user.click(within(target).getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
    return screen.getByTestId("decision-policy-editor");
  }

  const TENANT_ADMISSION = row({
    policy_id: "ta-1",
    decision_domain: "admission_stall_fix",
    mode: "guidance",
    autonomy_level: "always_escalate",
    name: "tenant admission frame",
    payload: {},
    priority: 50,
  });

  /** coord's system seed — another tenant, band 2. */
  const SEED = {
    ...row({
      policy_id: "seed-1",
      decision_domain: "admission_stall_fix",
      mode: "guidance",
      autonomy_level: "auto_decide",
      name: "system-default admission-stall response",
      payload: {},
      built_in: true,
    }),
    tenant_id: "system-tenant",
  };

  async function movePriority(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    to: string
  ) {
    const priority = within(dialog).getByLabelText("Priority");
    await user.clear(priority);
    await user.type(priority, to);
  }

  it("a built-in seed never competes: a priority edit across 100 gives no caution", async () => {
    const user = userEvent.setup();
    serve([TENANT_ADMISSION, SEED]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "tenant admission frame");
    await movePriority(user, dialog, "150");
    expect(
      within(dialog).queryByTestId("decision-policy-priority-caution")
    ).toBeNull();
  });

  it("mirror: a tenant row at a different level across 100 does draw the caution", async () => {
    const OTHER_TENANT_ROW = row({
      policy_id: "ta-2",
      decision_domain: "admission_stall_fix",
      mode: "guidance",
      autonomy_level: "auto_decide",
      name: "other tenant admission frame",
      payload: {},
      priority: 100,
    });
    const user = userEvent.setup();
    serve([TENANT_ADMISSION, OTHER_TENANT_ROW, SEED]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "tenant admission frame");
    await movePriority(user, dialog, "150");
    expect(
      within(dialog).getByTestId("decision-policy-priority-caution").textContent
    ).toBe(
      'This row now ranks below "other tenant admission frame" (auto_decide) for the workspace — ' +
        "consults take auto_decide instead of this row's always_escalate."
    );
  });

  it("a replace that keeps the scope says it loses the tie the old row won", async () => {
    const ARMED_SAME_PRIORITY = row({
      policy_id: "pf-3",
      decision_domain: "pr_fix",
      mode: "guidance",
      autonomy_level: "auto_decide",
      name: "armed repo frame",
      payload: {},
      repo: "qontinui/qontinui-dev-notes",
      priority: 100,
    });
    const user = userEvent.setup();
    serve([
      PR_FIX,
      { ...ARMED_SAME_PRIORITY, created_at: "2026-09-05T00:00:00Z" },
    ]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "pr_fix autonomous repair frame");
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');
    expect(
      within(dialog).getByTestId("decision-policy-replace-rank-caution")
        .textContent
    ).toBe(
      'The replacement is the newest row, so it ranks below "armed repo frame" (auto_decide) for ' +
        "qontinui/qontinui-dev-notes — consults take auto_decide instead of this row's always_escalate."
    );
  });

  it("narrowing the only workspace row uses the system-default wording, not 'a workspace row already overrides'", async () => {
    serveDefaults([
      ...SERVED_DEFAULTS.filter(([d]) => d !== "red_main_fix"),
      ["red_main_fix", "auto_decide", "system_row", "tenant", "auto_decide"],
    ]);
    const user = userEvent.setup();
    serve([RED_MAIN]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "red main fixer");
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');
    await user.type(within(dialog).getByLabelText("Repo scope"), "o/r");

    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-default-override-warning")
          .textContent
      ).toContain(
        "This domain has a coord system default at auto_decide. A row scoped to o/r outranks it"
      )
    );
    expect(
      within(dialog).getByTestId("decision-policy-default-override-warning")
        .textContent
    ).not.toContain("A workspace row already overrides");
    expect(
      within(dialog).getByTestId("decision-policy-release-caution").textContent
    ).toContain(
      "With coord's system default at auto_decide, this can re-arm dispatch for those repos."
    );
  });
});

describe("built-in coord system rows", () => {
  it("offer no edit, delete or graduation, and say how to override them", async () => {
    const user = userEvent.setup();
    serve([ADMISSION_STALL]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    expect(
      screen.getByTestId("decision-policy-built-in-note").textContent
    ).toBe("coord system default — override it by creating a workspace row.");
    expect(
      screen.queryByRole("button", { name: "Edit admission stall responder" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete admission stall responder" })
    ).toBeNull();
    expect(screen.queryByTestId("decision-policy-graduation")).toBeNull();
  });

  it("still offers them on a workspace row", async () => {
    const user = userEvent.setup();
    serve([RED_MAIN]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    expect(screen.queryByTestId("decision-policy-built-in-note")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit red main fixer" })
    ).toBeTruthy();
  });
});

describe("only claiming re-armed dispatch where coord can dispatch", () => {
  async function openEditByName(
    user: ReturnType<typeof userEvent.setup>,
    name: string
  ) {
    const rows = await screen.findAllByTestId("decision-policy-row");
    const target = rows.find((r) => r.textContent?.includes(name));
    if (!target) throw new Error(`no row named ${name}`);
    await user.click(within(target).getByRole("button", { expanded: false }));
    await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
    return screen.getByTestId("decision-policy-editor");
  }

  async function narrowToRepo(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement
  ) {
    const payload = within(dialog).getByTestId("decision-policy-payload");
    await user.clear(payload);
    await user.type(payload, '{{"notes": "changed"}');
    await user.type(within(dialog).getByLabelText("Repo scope"), "o/r");
  }

  it("architecture_tradeoff narrowed to a repo restores a guidance frame, not dispatch", async () => {
    const user = userEvent.setup();
    serve([ARCH_TRADEOFF]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "architecture trade-off frame");
    await narrowToRepo(user, dialog);
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-release-caution")
          .textContent
      ).toBe(
        "Repos other than o/r stop using this row and go back to coord's default (at guidance_only), " +
          "unless another workspace row covers them. With coord's system default at guidance_only, " +
          "this restores coord's guidance_only frame for those repos."
      )
    );
  });

  it("next_step at guidance_only narrowed to a repo does not claim dispatch", async () => {
    serveDefaults([["next_step", "guidance_only", "system_row"]]);
    const user = userEvent.setup();
    serve([NEXT_STEP]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "next step frame");
    await narrowToRepo(user, dialog);
    await waitFor(() =>
      expect(
        within(dialog).getByTestId("decision-policy-release-caution")
          .textContent
      ).toContain("this restores coord's guidance_only frame for those repos.")
    );
    expect(
      within(dialog).getByTestId("decision-policy-release-caution").textContent
    ).not.toContain("dispatch");
  });

  it("a disabled row's priority edit gives no ranking caution", async () => {
    const ARMED = row({
      policy_id: "pf-2",
      decision_domain: "pr_fix",
      mode: "guidance",
      autonomy_level: "auto_decide",
      name: "armed repo frame",
      payload: {},
      repo: "qontinui/qontinui-dev-notes",
      priority: 50,
    });
    const user = userEvent.setup();
    serve([{ ...PR_FIX, enabled: false }, ARMED]);
    render(<DecisionPoliciesPage />);
    const dialog = await openEditByName(user, "pr_fix autonomous repair frame");
    const priority = within(dialog).getByLabelText("Priority");
    await user.clear(priority);
    await user.type(priority, "10");
    expect(
      within(dialog).queryByTestId("decision-policy-priority-caution")
    ).toBeNull();
  });
});

describe("a tenant's customize-override row", () => {
  it("keeps its controls and is not labelled a coord system default", async () => {
    const OVERRIDE = {
      ...row({
        policy_id: "ov-1",
        decision_domain: "admission_stall_fix",
        mode: "guidance",
        autonomy_level: "guidance_only",
        name: "customized admission responder",
        payload: {},
        built_in: true,
      }),
      override_state: "customized",
      system_rule_id: "as-1",
    };
    const user = userEvent.setup();
    serve([OVERRIDE]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    expect(screen.queryByTestId("decision-policy-built-in-note")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Edit customized admission responder",
      })
    ).toBeTruthy();
  });
});

describe("the graduation control", () => {
  async function pickAutonomy(
    user: ReturnType<typeof userEvent.setup>,
    label: string
  ) {
    await user.click(screen.getByTestId("decision-policy-graduation"));
    await user.click(await screen.findByRole("option", { name: label }));
  }

  it("confirms before LOOSENING, and PATCHes only autonomy_level", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);

    await pickAutonomy(user, "Auto decide");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain("always_escalate to auto_decide");
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[0]).toBe(
      "/api/v1/operations/coord/policies/pf-1"
    );
    expect(patch.mock.calls[0]?.[1]).toEqual({ autonomy_level: "auto_decide" });
    confirm.mockRestore();
  });

  it("sends nothing when the loosening confirm is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);

    await pickAutonomy(user, "Guidance only");

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("does NOT confirm a tightening", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    serve([RED_MAIN]); // auto_decide
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);

    await pickAutonomy(user, "Always escalate");

    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[1]).toEqual({
      autonomy_level: "always_escalate",
    });
    confirm.mockRestore();
  });

  it("shows the current level on the row and in the detail", async () => {
    const user = userEvent.setup();
    serve([NEXT_STEP]);
    render(<DecisionPoliciesPage />);
    const rows = await screen.findAllByTestId("decision-policy-row");
    expect(
      within(rows[0]!)
        .getByTestId("decision-policy-status")
        .getAttribute("data-autonomy-level")
    ).toBe("guidance_only");

    await expandFirstRow(user);
    expect(
      screen.getByTestId("decision-policy-autonomy").textContent
    ).toContain("Guidance only");
  });

  it("refuses to offer a dial for a level it cannot read", async () => {
    const user = userEvent.setup();
    serve([
      row({
        policy_id: "x-1",
        decision_domain: "pr_fix",
        mode: "guidance",
        autonomy_level: "shadow",
        name: "from a newer coord",
        payload: {},
      }),
    ]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);

    expect(
      screen.getByTestId("decision-policy-graduation-unknown").textContent
    ).toContain("shadow");
    expect(screen.queryByTestId("decision-policy-graduation")).toBeNull();
  });
});

describe("every failing call gets its own sentence", () => {
  it("names the LIST failure, keeps the page usable, and retries in place", async () => {
    get.mockRejectedValue(new Error("coord unreachable"));
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);

    const panel = await screen.findByTestId("decision-policies-load-failed");
    expect(panel).toBe(screen.getByRole("alert"));
    expect(panel.textContent).toContain("not the same as this workspace having none");
    expect(toastError).toHaveBeenCalledWith(
      "Failed to load decision policies: coord unreachable"
    );

    serve([PR_FIX]);
    await user.click(screen.getByTestId("decision-policies-retry"));
    expect(await screen.findAllByTestId("decision-policy-row")).toHaveLength(1);
  });

  it("names the CREATE failure", async () => {
    post.mockRejectedValue(new Error("Forbidden"));
    const user = userEvent.setup();
    render(<DecisionPoliciesPage />);
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText("Name"), "a name");
    await user.click(within(dialog).getByTestId("decision-policy-save"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to create the decision policy: Forbidden"
      )
    );
    // The dialog stays open on failure — closing it would discard the payload.
    expect(screen.getByTestId("decision-policy-editor")).toBeTruthy();
  });

  it("names the GRADUATION failure differently from the create one", async () => {
    patch.mockRejectedValue(new Error("Forbidden"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);

    await user.click(screen.getByTestId("decision-policy-graduation"));
    await user.click(await screen.findByRole("option", { name: "Auto decide" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to change the autonomy level: Forbidden"
      )
    );
    confirm.mockRestore();
  });

  it("names the name-edit PATCH failure as an update, not a graduation", async () => {
    patch.mockRejectedValue(new Error("Forbidden"));
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);
    await expandFirstRow(user);
    await user.click(
      screen.getByRole("button", {
        name: "Edit pr_fix autonomous repair frame",
      })
    );
    const dialog = screen.getByTestId("decision-policy-editor");
    await user.type(within(dialog).getByLabelText("Name"), " v2");
    await user.click(within(dialog).getByTestId("decision-policy-save"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update the decision policy: Forbidden"
      )
    );
  });
});

describe("the non-admin gate", () => {
  it("hides every mutating control and says why", async () => {
    isCoordAdmin = false;
    const user = userEvent.setup();
    serve([PR_FIX]);
    render(<DecisionPoliciesPage />);

    await screen.findAllByTestId("decision-policy-row");
    expect(screen.queryByTestId("new-decision-policy")).toBeNull();
    expect(screen.getByTestId("coord-admin-only-notice")).toBeTruthy();

    // The rows themselves stay readable — which frame coord serves is
    // diagnostic, not privileged.
    await expandFirstRow(user);
    expect(screen.queryByTestId("decision-policy-graduation")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Edit pr_fix autonomous repair frame",
      })
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Delete pr_fix autonomous repair frame",
      })
    ).toBeNull();
    expect(screen.getByTestId("decision-policy-autonomy")).toBeTruthy();
  });
});
