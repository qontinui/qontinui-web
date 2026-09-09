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
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
    put: vi.fn(),
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

/** A v2 row this page must NOT claim — it belongs to /admin/coord/gate-clearance. */
const GATE_CLEARANCE = row({
  policy_id: "gc-1",
  decision_domain: "gate_clearance",
  mode: "data_driven",
  autonomy_level: "always_escalate",
  name: "security-surface clearance",
  payload: { gate_class: "security-surface", authority: "operator_only" },
});

function serve(policies: unknown[]) {
  get.mockResolvedValue({ policies, total: policies.length });
}

beforeEach(() => {
  vi.clearAllMocks();
  isCoordAdmin = true;
  serve([]);
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
    serve([RED_MAIN, GATE_CLEARANCE, PR_FIX, NEXT_STEP]);
    render(<DecisionPoliciesPage />);
    const rows = await screen.findAllByTestId("decision-policy-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute("data-row-key"))).toEqual([
      "ns-1",
      "pf-1",
      "rm-1",
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
