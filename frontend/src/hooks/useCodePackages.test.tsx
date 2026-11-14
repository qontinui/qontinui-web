/**
 * Package mutations refresh the detail entry the marketplace page reads.
 *
 * The detail page caches its package under the URL slug
 * (`packageKeys.detail(slug)`), while every mutation knows only the numeric
 * id. Invalidating `detail(id)` therefore missed the entry the page shows, so
 * a publish or install left the page on its old version and scan. Mutations
 * now invalidate the `packageKeys.details()` prefix.
 *
 * Mutation: restoring `packageKeys.detail(variables.package_id)` in
 * `useInstallPackage`, or `setQueryData(packageKeys.detail(packageId), …)` in
 * `usePublishVersion`, leaves the slug-keyed entry fresh and reds these cases.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CodePackage, PackageInstallation } from "@/types/code-packages";

const service = vi.hoisted(() => ({
  installPackage: vi.fn(),
  publishVersion: vi.fn(),
}));

vi.mock("@/services/service-factory", () => ({
  codePackageService: service,
}));

import {
  packageKeys,
  useInstallPackage,
  usePublishVersion,
} from "./useCodePackages";

const SLUG = "data-extractor";
const ID = "7";

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // The entry the detail page holds: keyed by slug, not id.
  client.setQueryData(packageKeys.detail(SLUG), { id: ID, slug: SLUG });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function slugEntryInvalidated(client: QueryClient): boolean {
  return client.getQueryState(packageKeys.detail(SLUG))?.isInvalidated ?? false;
}

beforeEach(() => {
  service.installPackage.mockReset();
  service.publishVersion.mockReset();
});

describe("package mutations refresh the slug-keyed detail entry", () => {
  it("useInstallPackage invalidates the detail the page cached by slug", async () => {
    service.installPackage.mockResolvedValue({} as PackageInstallation);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useInstallPackage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ package_id: ID, project_id: "42" });
    });

    expect(slugEntryInvalidated(client)).toBe(true);
  });

  it("usePublishVersion invalidates the detail the page cached by slug", async () => {
    service.publishVersion.mockResolvedValue({ id: ID } as CodePackage);
    const { client, wrapper } = setup();
    const { result } = renderHook(() => usePublishVersion(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        packageId: ID,
        data: { version: "1.3.0", code: "def run():\n    return 2\n" },
      });
    });

    expect(slugEntryInvalidated(client)).toBe(true);
    // Nothing is written under the numeric id: the page never reads it.
    expect(client.getQueryData(packageKeys.detail(ID))).toBeUndefined();
  });
});
