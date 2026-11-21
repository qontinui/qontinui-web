/**
 * `usePackageInstall` hands the install mutation's own error to the dialog,
 * so a refused install (for example a version that failed its security scan)
 * shows the server's reason rather than a bare "Installation failed".
 *
 * Mutation: dropping `installError` (or reading it from anywhere but the
 * mutation) reds the failure case.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ installPackage: vi.fn() }));

vi.mock("@/services/service-factory", () => ({
  codePackageService: service,
}));

import { usePackageInstall } from "./usePackageInstall";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  service.installPackage.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("usePackageInstall", () => {
  it("passes the install mutation's error through as installError", async () => {
    service.installPackage.mockRejectedValue(
      new Error("Package failed security scan")
    );
    const { result } = renderHook(() => usePackageInstall("7"), { wrapper });

    expect(result.current.installError).toBeUndefined();

    await act(async () => {
      await result.current.handleInstall("42", "11");
    });

    expect(service.installPackage).toHaveBeenCalledWith({
      package_id: "7",
      version_id: "11",
      project_id: "42",
    });
    await waitFor(() =>
      expect(result.current.installError).toBe("Package failed security scan")
    );
    expect(result.current.installStatus).toBe("failed");
    expect(result.current.installProgress).toBe(0);
  });
});
