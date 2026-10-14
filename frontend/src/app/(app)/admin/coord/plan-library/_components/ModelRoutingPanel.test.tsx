/**
 * ModelRoutingPanel — the operator's model family per plan difficulty (plan
 * `2026-10-08-operator-editable-model-family-per-plan-difficulty`).
 *
 * Pinned through the real hook over a mocked `httpClient`, because the
 * properties that matter cross the two: the form starts from what is SERVED,
 * a save sends the FULL map, what is shown afterwards is the backend's answer
 * rather than the form's, and a failed read or save never paints a value
 * nobody confirmed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { ModelRoutingPanel } from "./ModelRoutingPanel";

const FAMILIES = [
  { family: "fable", display: "Fable (latest)" },
  { family: "opus", display: "Opus (latest)" },
  { family: "sonnet", display: "Sonnet (latest)" },
  { family: "haiku", display: "Haiku (latest)" },
];
const DEFAULTS = { high: "fable", medium: "opus", low: "sonnet" };
const tiersOf = (m: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(m).map(([k, v]) => [
      k,
      FAMILIES.find((f) => f.family === v)?.display ?? v,
    ])
  );

function response(
  selectors: Record<string, string>,
  overrides: Record<string, unknown> = {}
) {
  return {
    model_selectors: selectors,
    model_tiers: tiersOf(selectors),
    model_selector_vocabulary: "claude_code_agent_tool_v1",
    sources: { high: "default", medium: "default", low: "default" },
    default_selectors: DEFAULTS,
    families: FAMILIES,
    updated_at: null,
    updated_by_user_id: null,
    can_edit: true,
    ...overrides,
  };
}

const select = (level: string) =>
  screen.getByTestId(`model-routing-select-${level}`) as HTMLSelectElement;

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
  deleteMock.mockReset();
});

describe("ModelRoutingPanel", () => {
  it("starts from the served map, with each level's provenance", async () => {
    getMock.mockResolvedValue(
      response(DEFAULTS, {
        sources: { high: "stored", medium: "default", low: "default" },
      })
    );
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("fable"));
    expect(getMock).toHaveBeenCalledWith("/api/v1/plan-library/model-routing");
    expect(select("medium").value).toBe("opus");
    expect(select("low").value).toBe("sonnet");
    expect(screen.getByTestId("model-routing-source-high")).toHaveTextContent(
      "set"
    );
    expect(screen.getByTestId("model-routing-source-low")).toHaveTextContent(
      "default"
    );
    // Nothing changed yet: nothing to save.
    expect(screen.getByTestId("model-routing-save")).toBeDisabled();
  });

  it("saves the FULL map and then shows the backend's answer", async () => {
    getMock.mockResolvedValue(response(DEFAULTS));
    const stored = { high: "opus", medium: "opus", low: "sonnet" };
    putMock.mockResolvedValue(
      response(stored, {
        sources: { high: "stored", medium: "stored", low: "stored" },
        updated_at: "2026-10-08T12:00:00Z",
      })
    );
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("fable"));

    fireEvent.change(select("high"), { target: { value: "opus" } });
    expect(
      screen.getByTestId("model-routing-changed-high")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("model-routing-save"));

    await waitFor(() =>
      expect(screen.getByTestId("model-routing-saved")).toBeInTheDocument()
    );
    expect(putMock).toHaveBeenCalledWith(
      "/api/v1/plan-library/model-routing",
      stored
    );
    expect(screen.getByTestId("model-routing-saved")).toHaveTextContent(
      "high → Opus (latest), medium → Opus (latest), low → Sonnet (latest)"
    );
    expect(screen.getByTestId("model-routing-source-high")).toHaveTextContent(
      "set"
    );
    expect(screen.queryByTestId("model-routing-changed-high")).toBeNull();
    expect(screen.getByTestId("model-routing-save")).toBeDisabled();
  });

  it("a refused save says so and leaves the served badges alone", async () => {
    getMock.mockResolvedValue(response(DEFAULTS));
    putMock.mockRejectedValue(new Error("401 Unauthorized"));
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("fable"));

    fireEvent.change(select("low"), { target: { value: "haiku" } });
    fireEvent.click(screen.getByTestId("model-routing-save"));

    await waitFor(() =>
      expect(screen.getByTestId("model-routing-save-error")).toHaveTextContent(
        "401 Unauthorized"
      )
    );
    expect(screen.queryByTestId("model-routing-saved")).toBeNull();
    expect(screen.getByTestId("model-routing-source-low")).toHaveTextContent(
      "default"
    );
    // The draft is kept so the operator can retry.
    expect(select("low").value).toBe("haiku");
  });

  it("Discard restores the served map", async () => {
    getMock.mockResolvedValue(
      response(
        { high: "opus", medium: "opus", low: "haiku" },
        { sources: { high: "stored", medium: "stored", low: "stored" } }
      )
    );
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("opus"));

    fireEvent.change(select("high"), { target: { value: "fable" } });
    expect(screen.getByTestId("model-routing-save")).toBeEnabled();
    fireEvent.click(screen.getByTestId("model-routing-discard"));
    expect(select("high").value).toBe("opus");
    expect(screen.getByTestId("model-routing-save")).toBeDisabled();
  });

  it("Reset DELETEs the stored rows and shows the defaults served again", async () => {
    getMock.mockResolvedValue(
      response(
        { high: "opus", medium: "opus", low: "haiku" },
        { sources: { high: "stored", medium: "stored", low: "stored" } }
      )
    );
    deleteMock.mockResolvedValue(response(DEFAULTS));
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("opus"));

    fireEvent.click(screen.getByTestId("model-routing-reset"));
    await waitFor(() => expect(select("high").value).toBe("fable"));
    expect(deleteMock).toHaveBeenCalledWith(
      "/api/v1/plan-library/model-routing"
    );
    expect(putMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("model-routing-source-high")).toHaveTextContent(
      "default"
    );
    // Nothing stored any more: nothing to reset.
    expect(screen.getByTestId("model-routing-reset")).toBeDisabled();
  });

  it("a refresh returning the same map keeps unsaved edits", async () => {
    getMock.mockImplementation(() => Promise.resolve(response(DEFAULTS)));
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("fable"));

    fireEvent.change(select("high"), { target: { value: "opus" } });
    fireEvent.click(screen.getByTestId("model-routing-refresh"));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(select("high").value).toBe("opus");
  });

  it("the 'saved' line goes once a refresh re-reads the map", async () => {
    getMock.mockImplementation(() => Promise.resolve(response(DEFAULTS)));
    const stored = { high: "opus", medium: "opus", low: "sonnet" };
    putMock.mockResolvedValue(response(stored));
    render(<ModelRoutingPanel />);
    await waitFor(() => expect(select("high").value).toBe("fable"));

    fireEvent.change(select("high"), { target: { value: "opus" } });
    fireEvent.click(screen.getByTestId("model-routing-save"));
    await waitFor(() =>
      expect(screen.getByTestId("model-routing-saved")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("model-routing-refresh"));
    await waitFor(() =>
      expect(screen.queryByTestId("model-routing-saved")).toBeNull()
    );
  });

  it("a failed first read is UNKNOWN — never the defaults", async () => {
    getMock.mockRejectedValue(new Error("503 Service Unavailable"));
    render(<ModelRoutingPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("model-routing-unknown")).toHaveTextContent(
        "503 Service Unavailable"
      )
    );
    expect(screen.queryByTestId("model-routing-select-high")).toBeNull();
  });

  it("is read-only for a scope that cannot be written", async () => {
    getMock.mockResolvedValue(response(DEFAULTS, { can_edit: false }));
    render(<ModelRoutingPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("model-routing-readonly")).toBeInTheDocument()
    );
    expect(select("high")).toBeDisabled();
    expect(screen.getByTestId("model-routing-save")).toBeDisabled();
  });
});
