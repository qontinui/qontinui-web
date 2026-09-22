/**
 * `TenantProvider.refresh()` (plan `2026-09-17-tenant-rename`, Phase D).
 *
 * The rename dialog calls `refresh()` after a rename that coord has ALREADY
 * committed. So a failed refresh must not publish a global `error` (every
 * consumer would then treat the tenant list as unknown) and must not drop the
 * last good list — it reports `false` to its caller instead. `loading` is true
 * while it runs.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const listTenantsMock = vi.fn();

vi.mock("@/components/sessions/api", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
}));

import { TenantProvider, useTenant } from "./tenant-context";

let ctx: ReturnType<typeof useTenant> | null = null;

function Probe() {
  ctx = useTenant();
  return (
    <div>
      <span data-testid="names">
        {ctx.tenants.map((t) => t.name).join(",")}
      </span>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="error">{ctx.error ?? "none"}</span>
    </div>
  );
}

const LIST = (name: string) => ({
  tenants: [{ id: "t-1", slug: "acme", name, roles: ["admin"] }],
  active_tenant_id: "t-1",
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  ctx = null;
});

async function mounted() {
  render(
    <TenantProvider>
      <Probe />
    </TenantProvider>
  );
  await waitFor(() =>
    expect(screen.getByTestId("names").textContent).toBe("Acme")
  );
}

describe("TenantProvider.refresh", () => {
  it("re-reads the list in place and resolves true", async () => {
    listTenantsMock.mockResolvedValueOnce(LIST("Acme"));
    await mounted();

    listTenantsMock.mockResolvedValueOnce(LIST("Acme Renamed"));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await ctx!.refresh();
    });
    expect(ok).toBe(true);
    expect(screen.getByTestId("names").textContent).toBe("Acme Renamed");
    expect(screen.getByTestId("error").textContent).toBe("none");
  });

  it("is loading while it runs", async () => {
    listTenantsMock.mockResolvedValueOnce(LIST("Acme"));
    await mounted();

    let release: (v: unknown) => void = () => undefined;
    listTenantsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = ctx!.refresh();
    });
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("true")
    );
    await act(async () => {
      release(LIST("Acme"));
      await pending;
    });
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("a failed refresh keeps the last list, sets no global error, resolves false", async () => {
    listTenantsMock.mockResolvedValueOnce(LIST("Acme"));
    await mounted();

    listTenantsMock.mockRejectedValueOnce(new Error("GET tenants failed: 502"));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await ctx!.refresh();
    });
    expect(ok).toBe(false);
    expect(screen.getByTestId("error").textContent).toBe("none");
    expect(screen.getByTestId("names").textContent).toBe("Acme");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("a failed FIRST load is still a global error", async () => {
    listTenantsMock.mockRejectedValueOnce(new Error("GET tenants failed: 502"));
    render(
      <TenantProvider>
        <Probe />
      </TenantProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe(
        "GET tenants failed: 502"
      )
    );
  });
});
