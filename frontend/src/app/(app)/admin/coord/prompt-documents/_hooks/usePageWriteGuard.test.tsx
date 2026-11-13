/**
 * `PageWriteGuardProvider`'s contract with everything under it — the page's
 * project (`usePageProject`) and its cross-tab guard (`usePageWriteGuard`),
 * taken once for the list and the settings alike (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D1, D10):
 *
 * 1. **`pin` is the page's project, never the project stored at mount.**
 *    While the page's project is UNKNOWN (the layout's provider still
 *    reading), nothing is pinned, though a project was stored when the page
 *    mounted; once the provider answers, the page's project is.
 * 2. **`resolvePin` and `writeAllowed` keep one identity for the page's
 *    lifetime**, while the pin they answer changes. A hook that holds the
 *    resolver through `useSendTimePin` would absorb a new identity silently,
 *    so the page-level suites cannot see this; it is checked here. And the
 *    resolver answers the pin as it is CALLED, not the one it was made with.
 * 3. **Outside any provider there is no guard**, and a component that must
 *    send under one says so rather than sending unguarded.
 *
 * The suites that drive the page and the list through the real HTTP client
 * (`PromptDocumentsCrossTab`, `PromptDocumentsPageCrossTab`,
 * `PromptDocumentsPageSettingsCrossTab`) prove what the guard does to
 * requests; this file pins what the provider hands its children.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook } from "@testing-library/react";

const listTenantsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/operations/tenants", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { TenantProvider } from "@/contexts/tenant-context";
import {
  PageWriteGuardProvider,
  usePageWriteGuardContext,
  useRequiredPageWriteGuard,
  type PageWriteGuardValue,
} from "../_components/PageWriteGuard";

const KEY = "qontinui.active_tenant_id";
const B = "t-bravo";

/** Every value the provider handed its child, one per render. */
let seen: PageWriteGuardValue[] = [];
function Probe() {
  const guard = usePageWriteGuardContext();
  if (guard) seen.push(guard);
  return null;
}

/** The value the provider handed its child last. */
function latest(): PageWriteGuardValue {
  const value = seen[seen.length - 1];
  if (!value) throw new Error("the provider handed its child nothing");
  return value;
}

beforeEach(() => {
  seen = [];
  localStorage.clear();
  listTenantsMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/**
 * Mount in Bravo under the layout's tenant provider, whose membership read
 * answers only when the returned `answer` is called: until then the page's
 * project is UNKNOWN.
 */
function mountWhileTheProviderReads(): { answer: () => Promise<void> } {
  let release: () => void = () => {};
  listTenantsMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            tenants: [{ id: B, slug: "b", name: "Bravo" }],
            active_tenant_id: B,
          });
      })
  );
  localStorage.setItem(KEY, B);
  render(
    <TenantProvider>
      <PageWriteGuardProvider>
        <Probe />
      </PageWriteGuardProvider>
    </TenantProvider>
  );
  return {
    answer: () =>
      act(async () => {
        release();
      }),
  };
}

describe("PageWriteGuardProvider", () => {
  it("pins nothing while the page's project is UNKNOWN, though a project was stored at mount", async () => {
    const { answer } = mountWhileTheProviderReads();

    const unknown = latest();
    expect(unknown.mountTenant).toBe(B);
    expect(unknown.pageTenant).toBeUndefined();
    expect(unknown.pin).toBeUndefined();
    expect(unknown.resolvePin()).toBeUndefined();

    await answer();

    expect(latest().pageTenant).toBe(B);
    expect(latest().pin).toEqual({ tenant: B });
  });

  it("keeps one resolvePin and one writeAllowed while the pin changes, and the resolver answers the pin as it is called", async () => {
    const { answer } = mountWhileTheProviderReads();
    const { resolvePin, writeAllowed } = latest();

    await answer();

    // The provider handed down a new value — the page's project is known now
    // — and the two functions are the ones it handed down first.
    expect(latest().pin).toEqual({ tenant: B });
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen.map((value) => value.resolvePin))).toEqual(
      new Set([resolvePin])
    );
    expect(new Set(seen.map((value) => value.writeAllowed))).toEqual(
      new Set([writeAllowed])
    );
    // Asked now, the first resolver answers the project it was not told of
    // when it was made.
    expect(resolvePin()).toEqual({ tenant: B });
  });

  it("is absent outside a provider, where a component that must send under one throws rather than sending unguarded", () => {
    // React reports the render error it rethrows; that report is not under test.
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      renderHook(() => usePageWriteGuardContext()).result.current
    ).toBeNull();
    expect(() => renderHook(() => useRequiredPageWriteGuard())).toThrow(
      /PageWriteGuardProvider/
    );
  });
});
