/**
 * The tenant "Spawn fixer sessions for stuck PRs" dial against a mocked
 * transport. The hook and helpers are REAL; only `httpClient` and the toaster
 * are stubbed, because what this surface protects is the PATCH body that
 * reaches coord and the sentence the operator reads.
 *
 * Enumerated: the three tenant positions (NULL / true / false) on read and on
 * write, every effective source (default / tenant / repo / unknown), the
 * unsupported coord build, a load failure, a save failure, read-only access,
 * and a click on the already-active position.
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

function settings(fields: Record<string, unknown>) {
  return {
    tenant_id: "t1",
    profile: { auto_merge_enabled: true, ...fields },
  };
}

function pressed(value: "default" | "on" | "off"): string | null {
  return screen
    .getByTestId(`fixer-spawn-${value}`)
    .getAttribute("aria-pressed");
}

async function effectiveText(): Promise<string> {
  await waitFor(() =>
    expect(screen.getByTestId("fixer-spawn-effective").textContent).not.toMatch(
      /Loading/
    )
  );
  return screen.getByTestId("fixer-spawn-effective").textContent ?? "";
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe("FixerSpawnToggle — read", () => {
  it("NULL tenant column: Default is selected and the default decides", async () => {
    get.mockResolvedValue(
      settings({
        auto_fix_pr_tenant: null,
        auto_fix_pr: true,
        auto_fix_pr_source: "default",
      })
    );
    render(<FixerSpawnToggle canEdit />);
    expect(await effectiveText()).toContain("Effective: On — from the default (on).");
    expect(get).toHaveBeenCalledWith(PATH);
    expect(pressed("default")).toBe("true");
    expect(pressed("on")).toBe("false");
    expect(pressed("off")).toBe("false");
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
    expect(await effectiveText()).toContain(
      "Effective: Off — from this tenant's setting."
    );
    expect(pressed("off")).toBe("true");
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
    expect(await effectiveText()).toContain(
      "Effective: Off — from a repo's .qontinui/config.yml."
    );
    expect(pressed("on")).toBe("true");
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
    const text = await effectiveText();
    expect(text).toContain("Unknown (treated as off)");
    expect(text).not.toMatch(/Effective: On/);
  });

  it("a coord build without the fields says so and disables every position", async () => {
    get.mockResolvedValue(settings({}));
    render(<FixerSpawnToggle canEdit />);
    expect(await effectiveText()).toContain("Unknown (treated as off)");
    expect(screen.getByTestId("fixer-spawn-unsupported")).toBeTruthy();
    for (const v of ["default", "on", "off"] as const) {
      expect(
        (screen.getByTestId(`fixer-spawn-${v}`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
  });

  it("a load failure renders unknown, never on, and shows the error", async () => {
    get.mockRejectedValue(new Error("GET failed: 502"));
    render(<FixerSpawnToggle canEdit />);
    expect(await effectiveText()).toContain("Unknown (treated as off)");
    expect(screen.getByTestId("fixer-spawn-error").textContent).toContain("502");
    expect(screen.queryByTestId("fixer-spawn-unsupported")).toBeNull();
  });

  it("read-only access disables the positions", async () => {
    get.mockResolvedValue(
      settings({
        auto_fix_pr_tenant: null,
        auto_fix_pr: true,
        auto_fix_pr_source: "default",
      })
    );
    render(<FixerSpawnToggle canEdit={false} />);
    await effectiveText();
    expect(
      (screen.getByTestId("fixer-spawn-off") as HTMLButtonElement).disabled
    ).toBe(true);
  });
});

describe("FixerSpawnToggle — write", () => {
  const base = settings({
    auto_fix_pr_tenant: null,
    auto_fix_pr: true,
    auto_fix_pr_source: "default",
  });

  it.each([
    ["off", false, "tenant", false],
    ["on", true, "tenant", true],
  ] as const)(
    "clicking %s PATCHes auto_fix_pr=%s and re-seeds from the response",
    async (choice, body, source, effective) => {
      get.mockResolvedValue(base);
      patch.mockResolvedValue(
        settings({
          auto_fix_pr_tenant: body,
          auto_fix_pr: effective,
          auto_fix_pr_source: source,
        })
      );
      render(<FixerSpawnToggle canEdit />);
      await effectiveText();
      await userEvent.click(screen.getByTestId(`fixer-spawn-${choice}`));
      await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
      expect(patch).toHaveBeenCalledWith(PATH, { auto_fix_pr: body });
      await waitFor(() => expect(pressed(choice)).toBe("true"));
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
    patch.mockResolvedValue(base);
    render(<FixerSpawnToggle canEdit />);
    await effectiveText();
    await userEvent.click(screen.getByTestId("fixer-spawn-default"));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(PATH, { auto_fix_pr: null })
    );
    await waitFor(() => expect(pressed("default")).toBe("true"));
  });

  it("clicking the already-active position sends nothing", async () => {
    get.mockResolvedValue(base);
    render(<FixerSpawnToggle canEdit />);
    await effectiveText();
    await userEvent.click(screen.getByTestId("fixer-spawn-default"));
    expect(patch).not.toHaveBeenCalled();
  });

  it("a failed save keeps the previous state and toasts the error", async () => {
    get.mockResolvedValue(base);
    patch.mockRejectedValue(new Error("PATCH failed: 400 - unknown field"));
    render(<FixerSpawnToggle canEdit />);
    await effectiveText();
    await userEvent.click(screen.getByTestId("fixer-spawn-off"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(pressed("default")).toBe("true");
    expect(pressed("off")).toBe("false");
    expect(await effectiveText()).toContain("Effective: On — from the default (on).");
  });
});
