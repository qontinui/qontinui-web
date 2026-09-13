/**
 * The tenant "Spawn fixer sessions for stuck PRs" dial against a mocked
 * transport. The hook and helpers are REAL; only `httpClient` and the toaster
 * are stubbed, because what this surface protects is the PATCH body that
 * reaches coord and the sentence the operator reads.
 *
 * Enumerated: the three tenant positions (NULL / true / false) on read and on
 * write, every source (default / tenant / repo / unknown), the unsupported
 * coord build, a load failure and its retry, a save failure, an unconfirmed
 * save, a click during an in-flight save, read-only access, the autonomy-off
 * note, and a click on the already-active position.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const get = vi.fn();
const patch = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    patch: (...args: unknown[]) => patch(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { FixerSpawnToggle } from "./FixerSpawnToggle";

const PATH = "/api/v1/operations/pr-merge/settings";
const POSITIONS = ["default", "on", "off"] as const;

function settings(fields: Record<string, unknown>) {
  return {
    tenant_id: "t1",
    profile: { auto_merge_enabled: true, ...fields },
  };
}

const DEFAULT_ON = settings({
  auto_fix_pr_tenant: null,
  auto_fix_pr: true,
  auto_fix_pr_source: "default",
});

function checked(value: (typeof POSITIONS)[number]): string | null {
  return screen
    .getByTestId(`fixer-spawn-${value}`)
    .getAttribute("aria-checked");
}

async function tenantText(): Promise<string> {
  await waitFor(() =>
    expect(
      screen.getByTestId("fixer-spawn-tenant-setting").textContent
    ).not.toMatch(/Loading/)
  );
  return screen.getByTestId("fixer-spawn-tenant-setting").textContent ?? "";
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("FixerSpawnToggle — read", () => {
  it("NULL tenant column: Default is selected and the default decides", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    render(<FixerSpawnToggle canEdit />);
    expect(await tenantText()).toContain(
      "Tenant setting: On — from the default (on)."
    );
    expect(get).toHaveBeenCalledWith(PATH);
    expect(checked("default")).toBe("true");
    expect(checked("on")).toBe("false");
    expect(checked("off")).toBe("false");
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("explicit tenant Off", async () => {
    get.mockResolvedValue(
      settings({
        auto_fix_pr_tenant: false,
        auto_fix_pr: false,
        auto_fix_pr_source: "tenant",
      })
    );
    render(<FixerSpawnToggle canEdit />);
    expect(await tenantText()).toContain(
      "Tenant setting: Off — from this tenant's setting."
    );
    expect(checked("off")).toBe("true");
  });

  it("tenant On overridden by a repo's explicit false reads Off from the repo", async () => {
    get.mockResolvedValue(
      settings({
        auto_fix_pr_tenant: true,
        auto_fix_pr: false,
        auto_fix_pr_source: "repo",
      })
    );
    render(<FixerSpawnToggle canEdit />);
    expect(await tenantText()).toContain(
      "Tenant setting: Off — from a repo's .qontinui/config.yml."
    );
    expect(checked("on")).toBe("true");
  });

  it("an unknown source is never rendered as on", async () => {
    get.mockResolvedValue(
      settings({
        auto_fix_pr_tenant: null,
        auto_fix_pr: true,
        auto_fix_pr_source: "unknown",
      })
    );
    render(<FixerSpawnToggle canEdit />);
    const text = await tenantText();
    expect(text).toContain("Unknown (treated as off)");
    expect(text).not.toMatch(/Tenant setting: On/);
  });

  it("a coord build without the fields says so and disables every position", async () => {
    get.mockResolvedValue(settings({}));
    render(<FixerSpawnToggle canEdit />);
    expect(await tenantText()).toContain("Unknown (treated as off)");
    expect(screen.getByTestId("fixer-spawn-unsupported")).toBeTruthy();
    for (const v of POSITIONS) {
      expect(
        (screen.getByTestId(`fixer-spawn-${v}`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
  });

  it("a load failure renders unknown, never on, and Retry reloads", async () => {
    get.mockRejectedValueOnce(new Error("GET failed: 502"));
    render(<FixerSpawnToggle canEdit />);
    expect(await tenantText()).toContain("Unknown (treated as off)");
    expect(screen.getByTestId("fixer-spawn-error").textContent).toContain(
      "502"
    );
    expect(screen.queryByTestId("fixer-spawn-unsupported")).toBeNull();

    get.mockResolvedValueOnce(DEFAULT_ON);
    await userEvent.click(screen.getByTestId("fixer-spawn-retry"));
    await waitFor(() => expect(checked("default")).toBe("true"));
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("fixer-spawn-error")).toBeNull();
  });

  it("read-only access disables every position", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    render(<FixerSpawnToggle canEdit={false} />);
    await tenantText();
    for (const v of POSITIONS) {
      expect(
        (screen.getByTestId(`fixer-spawn-${v}`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
  });

  it("notes dispatch is off ONLY for a not_effective autonomy row", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    const { rerender } = render(
      <FixerSpawnToggle canEdit autonomyState="not_effective" />
    );
    await tenantText();
    expect(screen.getByTestId("fixer-spawn-autonomy-off")).toBeTruthy();
    // `unknown` is coord's normal pr_fix verdict (unobserved conjunct); an
    // absent state means the row did not load. Neither is "flag off".
    for (const state of ["unknown", "effective", undefined] as const) {
      rerender(<FixerSpawnToggle canEdit autonomyState={state} />);
      expect(screen.queryByTestId("fixer-spawn-autonomy-off")).toBeNull();
      expect(screen.queryByText(/platform flag off/)).toBeNull();
    }
  });

  it("explains a read-only switch when edit rights could not be determined", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    render(<FixerSpawnToggle canEdit={false} editRightsKnown={false} />);
    await tenantText();
    expect(screen.getByTestId("fixer-spawn-rights-unknown")).toBeTruthy();
  });

  it("arrow keys move focus between positions without writing", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    expect(screen.getByTestId("fixer-spawn-default").tabIndex).toBe(0);
    expect(screen.getByTestId("fixer-spawn-on").tabIndex).toBe(-1);
    screen.getByTestId("fixer-spawn-default").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByTestId("fixer-spawn-on"));
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(screen.getByTestId("fixer-spawn-off"));
    expect(patch).not.toHaveBeenCalled();
  });
});

describe("FixerSpawnToggle — write", () => {
  it.each([
    ["off", false, "tenant", false],
    ["on", true, "tenant", true],
  ] as const)(
    "clicking %s PATCHes auto_fix_pr=%s and re-seeds from the response",
    async (choice, body, source, effective) => {
      get.mockResolvedValue(DEFAULT_ON);
      patch.mockResolvedValue(
        settings({
          auto_fix_pr_tenant: body,
          auto_fix_pr: effective,
          auto_fix_pr_source: source,
        })
      );
      render(<FixerSpawnToggle canEdit />);
      await tenantText();
      await userEvent.click(screen.getByTestId(`fixer-spawn-${choice}`));
      await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
      expect(patch).toHaveBeenCalledWith(PATH, { auto_fix_pr: body });
      await waitFor(() => expect(checked(choice)).toBe("true"));
      expect(toastSuccess).toHaveBeenCalled();
    }
  );

  it("clicking Default sends null (clear the override), not false", async () => {
    get.mockResolvedValue(
      settings({
        auto_fix_pr_tenant: false,
        auto_fix_pr: false,
        auto_fix_pr_source: "tenant",
      })
    );
    patch.mockResolvedValue(DEFAULT_ON);
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-default"));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(PATH, { auto_fix_pr: null })
    );
    await waitFor(() => expect(checked("default")).toBe("true"));
  });

  it("clicking the already-active position sends nothing", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-default"));
    expect(patch).not.toHaveBeenCalled();
  });

  it("a failed save keeps the previous state and toasts the error", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    patch.mockRejectedValue(new Error("PATCH failed: 400 - unknown field"));
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-off"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(checked("default")).toBe("true");
    expect(checked("off")).toBe("false");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("a 2xx that does not read back the sent value is NOT reported as saved", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    patch.mockResolvedValue(settings({}));
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-off"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    // It reloads the authoritative state instead of trusting the write.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  // The envelope the browser actually receives: the backend error handler puts
  // coord's refusal body under `message`, and HttpClient prefixes the status.
  const refusal = (status: number, body: object | string) =>
    new Error(
      `PATCH ${PATH} failed: ${status} - ${JSON.stringify({
        error: "service_unavailable",
        message: typeof body === "string" ? body : JSON.stringify(body),
        timestamp: 0,
        path: PATH,
      })}`
    );

  it.each([
    [
      "commit_unconfirmed 503 (written: null)",
      refusal(503, {
        error: "auto_fix_pr_column_unavailable",
        cause: "commit_unconfirmed",
        written: null,
      }),
    ],
    ["proxy 504 timeout", refusal(504, "timeout waiting for coord")],
    [
      "client abort",
      new Error(
        "Request timeout - backend may be starting up. Please try again."
      ),
    ],
  ])("%s is reported as outcome UNKNOWN and reloads", async (_label, error) => {
    get.mockResolvedValue(DEFAULT_ON);
    patch.mockRejectedValue(error);
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-off"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/outcome unknown/i);
    expect(toastSuccess).not.toHaveBeenCalled();
    // Not treated as a clean failure either: it re-reads what coord serves.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it.each([
    [
      "written: false 503",
      refusal(503, {
        error: "auto_fix_pr_column_unavailable",
        cause: "write_failed",
        written: false,
      }),
    ],
    ["proxy 502 (nothing sent)", refusal(502, "coord is not reachable")],
  ])("%s is a clean failure: error shown, no reload", async (_label, error) => {
    get.mockResolvedValue(DEFAULT_ON);
    patch.mockRejectedValue(error);
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-off"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).not.toMatch(/outcome unknown/i);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledTimes(1);
    expect(checked("default")).toBe("true");
  });

  it("a click during an in-flight save is dropped, not raced", async () => {
    get.mockResolvedValue(DEFAULT_ON);
    let resolvePatch: (v: unknown) => void = () => {};
    patch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        })
    );
    render(<FixerSpawnToggle canEdit />);
    await tenantText();
    await userEvent.click(screen.getByTestId("fixer-spawn-off"));
    await waitFor(() =>
      expect(
        screen.getByTestId("fixer-spawn-on").getAttribute("aria-disabled")
      ).toBe("true")
    );
    await userEvent.click(screen.getByTestId("fixer-spawn-on"));
    expect(patch).toHaveBeenCalledTimes(1);

    resolvePatch(
      settings({
        auto_fix_pr_tenant: false,
        auto_fix_pr: false,
        auto_fix_pr_source: "tenant",
      })
    );
    await waitFor(() => expect(checked("off")).toBe("true"));
    expect(patch).toHaveBeenCalledTimes(1);
  });
});
