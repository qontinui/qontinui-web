/**
 * `PageWriteGuardProvider`'s contract with everything under it — the page's
 * project (`usePageProject`) and its cross-tab guard (`usePageWriteGuard`),
 * taken once for the list and the settings alike (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard` D1, D10):
 *
 * 1. **`pin` is the project the page shows.** While the page's project has
 *    never been known (the layout's provider still reading), that is the
 *    project stored at mount, which the list's mount read is pinned to and
 *    so was answered in; once the provider answers, the page's project. With nothing stored at mount, or
 *    none selected, nothing is pinned, and every write is refused with the
 *    reason; dialogs still open.
 * 2. **`resolvePin` and `writeAllowed` keep one identity for the page's
 *    lifetime**, while the pin they answer changes. A hook that holds the
 *    resolver through `useSendTimePin` would absorb a new identity silently,
 *    so the page-level suites cannot see this; it is checked here. And the
 *    resolver answers the pin as it is CALLED, not the one it was made with.
 * 3. **Outside any provider there is no guard**, and a component or a
 *    section hook that must send under one throws rather than sending
 *    unguarded.
 *
 * And the guard itself (D3, D4, D5, #7, #9):
 *
 * 4. **The guard is never off.** While the page's project is UNKNOWN it
 *    compares the stored project with the one stored at mount (H09), and a
 *    `storage` event with no key — another tab's `localStorage.clear()` —
 *    locks it like any other change of the selection (H22).
 * 5. **The notice names only the cause it observed** (H08): another tab only
 *    once a `storage` event delivered the change, and in red, naming the
 *    page's project and the stored one.
 * 6. **This tab's own switch never locks the page**, not even for the one
 *    render a lock derived from a lagging page project would show.
 * 7. **Focus moves to Reload when the page locks** (H07), from a control the
 *    fieldset disabled or from `<body>`, and never out of an open dialog.
 *    While locked, the fieldset is described by the notice.
 *
 * The suites that drive the page and the list through the real HTTP client
 * (`PromptDocumentsCrossTab`, `PromptDocumentsPageCrossTab`,
 * `PromptDocumentsPageSettingsCrossTab`) prove what the guard does to
 * requests; this file pins what the provider hands its children and shows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

const listTenantsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/operations/tenants", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import { TenantProvider, useTenant } from "@/contexts/tenant-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PageWriteGuardProvider,
  usePageWriteGuardContext,
  useRequiredPageWriteGuard,
  type PageWriteGuardValue,
} from "../_components/PageWriteGuard";
import { usePageSendGuard } from "./usePageWriteGuardContext";

const KEY = "qontinui.active_tenant_id";
const B = "t-bravo";
const SYS = "t-system";

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
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/**
 * Mount with `stored` stored (Bravo by default; `null`: a fresh browser,
 * nothing stored) under the layout's tenant provider, whose membership read
 * answers only when the returned `answer` is called: until then the page's
 * project is UNKNOWN. It answers Bravo as the only membership and the home
 * project.
 */
function mountWhileTheProviderReads(stored: string | null = B): {
  answer: () => Promise<void>;
} {
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
  if (stored !== null) localStorage.setItem(KEY, stored);
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
  it("pins the project stored at mount while the page's project is UNKNOWN, and the page's own once known", async () => {
    // Corrected (review round 1, A2): this test asserted that NOTHING was
    // pinned while the page's project was UNKNOWN, though a project was
    // stored at mount. Every write sent then went unpinned, and a 429 retry
    // or a token-refresh replay of it after another tab's switch landed in
    // that tab's project. The list's mount read is pinned to the mount
    // project, so it was answered there; writes are pinned there too, and the
    // guard refuses them once another project is stored.
    const { answer } = mountWhileTheProviderReads();

    const unknown = latest();
    expect(unknown.mountTenant).toBe(B);
    expect(unknown.pageTenant).toBeUndefined();
    expect(unknown.pin).toEqual({ tenant: B });
    expect(unknown.resolvePin()).toEqual({ tenant: B });

    await answer();

    expect(latest().pageTenant).toBe(B);
    expect(latest().pin).toEqual({ tenant: B });
  });

  it.each([
    [
      "none selected: no provider, nothing stored",
      () => {
        render(
          <PageWriteGuardProvider>
            <Probe />
          </PageWriteGuardProvider>
        );
      },
    ],
    [
      "never known: the provider still reading, nothing stored at mount",
      () => {
        mountWhileTheProviderReads(null);
      },
    ],
  ] as const)(
    "refuses every write while the page has no project to pin it to, and says why, but its dialogs still open (%s)",
    (_label, mount) => {
      mount();
      expect(latest().pin).toBeUndefined();

      let wrote = true;
      let opened = false;
      act(() => {
        wrote = latest().writeAllowed();
        opened = latest().projectUnchanged();
      });

      expect(wrote).toBe(false);
      // The refusal, as the operator reads it.
      expect(vi.mocked(toast.error).mock.calls).toEqual([
        [
          "Nothing was sent: this page has no project to send a change in. Select a project, or reload the page.",
        ],
      ]);
      expect(opened).toBe(true);
      // Nothing changed under the page: it is not locked.
      expect(latest().locked).toBeNull();
      expect(
        screen.queryByTestId("prompt-documents-cross-tab")
      ).not.toBeInTheDocument();
    }
  );

  it("keeps one resolvePin and one writeAllowed while the pin changes, and the resolver answers the pin as it is called", async () => {
    // A fresh browser: nothing is stored, so nothing is pinned until the
    // provider answers and the page's project is the one it reconciles to.
    const { answer } = mountWhileTheProviderReads(null);
    const { resolvePin, writeAllowed } = latest();
    expect(resolvePin()).toBeUndefined();

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
    // A settings section's guard has no unguarded mode either.
    expect(() => renderHook(() => usePageSendGuard())).toThrow(
      /PageWriteGuardProvider/
    );
  });
});

/** Another tab writes the stored project: the event only OTHER tabs get. */
function anotherTabStores(tenant: string) {
  localStorage.setItem(KEY, tenant);
  window.dispatchEvent(
    new StorageEvent("storage", { key: KEY, newValue: tenant })
  );
}

/** Both projects, named, as the layout's provider serves them in Bravo. */
const BOTH = {
  tenants: [
    { id: B, slug: "b", name: "Bravo" },
    { id: SYS, slug: "s", name: "System" },
  ],
  active_tenant_id: B,
};

/** The notice, as the operator reads it. */
const notice = () => screen.getByTestId("prompt-documents-cross-tab");

/** A dialog the page opened: portalled out of its fieldset, as all of them are. */
function OpenDialog() {
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>History</DialogTitle>
        <DialogDescription>A dialog the page opened.</DialogDescription>
        <input data-testid="in-dialog" aria-label="Change note" />
      </DialogContent>
    </Dialog>
  );
}

describe("the guard is never off", () => {
  it("while the page's project is UNKNOWN, a change from the mount project locks the page", async () => {
    const { answer } = mountWhileTheProviderReads();
    expect(latest().pageTenant).toBeUndefined();
    expect(latest().locked).toBeNull();

    await act(async () => anotherTabStores(SYS));

    // Still UNKNOWN, and locked against the project stored at mount.
    expect(latest().pageTenant).toBeUndefined();
    expect(latest().locked).toBe("another_tab");
    expect(screen.getByTestId("prompt-documents-controls")).toBeDisabled();
    // The membership list is not read yet: neither project has a name to give.
    expect(notice()).toHaveTextContent(
      "everything below belongs to project t-bravo, and the active project is now project t-system."
    );
    let allowed = true;
    act(() => {
      allowed = latest().writeAllowed();
    });
    expect(allowed).toBe(false);

    // Known at last, as the mount project, and still locked.
    await answer();
    expect(latest().pageTenant).toBe(B);
    expect(latest().locked).toBe("another_tab");
  });

  it("locks on a storage clear() that empties the selection", async () => {
    localStorage.setItem(KEY, B);
    render(
      <PageWriteGuardProvider>
        <Probe />
      </PageWriteGuardProvider>
    );
    expect(latest().locked).toBeNull();

    // Another tab clears its storage: the event names no key, and the
    // selection goes with everything else.
    await act(async () => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(latest().locked).toBe("another_tab");
    expect(notice()).toHaveTextContent(
      "the active project is now your home project (none selected)."
    );
  });
});

describe("the notice", () => {
  it("names another tab only when a storage event delivered the change", async () => {
    listTenantsMock.mockResolvedValue(BOTH);
    localStorage.setItem(KEY, B);
    render(
      <TenantProvider>
        <PageWriteGuardProvider>
          <Probe />
        </PageWriteGuardProvider>
      </TenantProvider>
    );
    await waitFor(() => expect(latest().pageTenant).toBe(B));

    // Stored with no event yet: the call-time check finds the change, and
    // cannot say who made it.
    localStorage.setItem(KEY, SYS);
    act(() => {
      expect(latest().writeAllowed()).toBe(false);
    });
    expect(latest().locked).toBe("unattributed");
    expect(notice()).toHaveTextContent(
      "The active project changed since this page loaded — reload to continue. Until you reload, no change made on this page is sent: everything below belongs to Bravo, and the active project is now System."
    );
    expect(notice()).not.toHaveTextContent("another tab");
    expect(toast.error).toHaveBeenLastCalledWith(
      "The active project changed since this page loaded — reload to continue. Nothing was sent."
    );

    // Its event arrives, and only another document receives one.
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: KEY, newValue: SYS })
      );
    });
    expect(latest().locked).toBe("another_tab");
    expect(notice()).toHaveTextContent(
      "The active project was changed in another tab — reload to continue. Until you reload, no change made on this page is sent: everything below belongs to Bravo, and the active project is now System."
    );
    act(() => {
      expect(latest().writeAllowed()).toBe(false);
    });
    expect(toast.error).toHaveBeenLastCalledWith(
      "The active project was changed in another tab — reload to continue. Nothing was sent."
    );
  });

  it("is a red alert, its Reload outside the fieldset it disables", async () => {
    localStorage.setItem(KEY, B);
    render(
      <PageWriteGuardProvider>
        <button data-testid="edit">Edit</button>
      </PageWriteGuardProvider>
    );

    await act(async () => anotherTabStores(SYS));

    expect(notice()).toHaveAttribute("role", "alert");
    // Red (D5): only the operator's Reload, or a switch back, clears it.
    expect(notice()).toHaveClass(
      "border-red-500/40",
      "bg-red-500/10",
      "text-red-700",
      "dark:text-red-400"
    );
    expect(screen.getByTestId("edit")).toBeDisabled();
    expect(
      screen.getByTestId("prompt-documents-cross-tab-reload")
    ).toBeEnabled();
  });
});

describe("the disabled fieldset's description", () => {
  it("names the fieldset as a group, locked or not", async () => {
    localStorage.setItem(KEY, B);
    render(
      <PageWriteGuardProvider>
        <button data-testid="edit">Edit</button>
      </PageWriteGuardProvider>
    );
    const group = screen.getByRole("group", {
      name: "Prompt documents and their settings",
    });
    expect(group).toBe(screen.getByTestId("prompt-documents-controls"));

    await act(async () => anotherTabStores(SYS));

    expect(group).toBeDisabled();
    expect(group).toHaveAccessibleName("Prompt documents and their settings");
  });

  it("is the notice while the page is locked, and nothing once it clears", async () => {
    localStorage.setItem(KEY, B);
    render(
      <PageWriteGuardProvider>
        <button data-testid="edit">Edit</button>
      </PageWriteGuardProvider>
    );
    const fieldset = screen.getByTestId("prompt-documents-controls");
    expect(fieldset).not.toHaveAttribute("aria-describedby");

    await act(async () => anotherTabStores(SYS));

    // A disabled control's reason is announced with it: the notice.
    expect(fieldset).toHaveAttribute("aria-describedby", notice().id);
    expect(notice().id).not.toBe("");
    expect(fieldset).toHaveAccessibleDescription(
      expect.stringContaining(
        "The active project was changed in another tab — reload to continue."
      )
    );

    await act(async () => anotherTabStores(B));

    expect(fieldset).not.toHaveAttribute("aria-describedby");
  });
});

describe("this tab's own switch through the provider", () => {
  it("never locks the page, not even for one render", async () => {
    listTenantsMock.mockResolvedValue(BOTH);
    localStorage.setItem(KEY, B);
    let switchTo: (id: string) => void = () => {};
    function Switcher() {
      switchTo = useTenant().setActiveTenantId;
      return null;
    }
    render(
      <TenantProvider>
        <Switcher />
        <PageWriteGuardProvider>
          <Probe />
        </PageWriteGuardProvider>
      </TenantProvider>
    );
    await waitFor(() => expect(latest().pageTenant).toBe(B));
    const from = seen.length;

    // The provider stores the project first, then re-renders with it.
    await act(async () => switchTo(SYS));

    expect(latest().pageTenant).toBe(SYS);
    const during = seen.slice(from);
    expect(during.length).toBeGreaterThan(0);
    // Every value handed down on the way, not only the last, was unlocked.
    expect(during.map((value) => value.locked)).toEqual(during.map(() => null));
    expect(
      screen.queryByTestId("prompt-documents-cross-tab")
    ).not.toBeInTheDocument();
  });
});

describe("focus when the page locks", () => {
  it("moves focus from a now-disabled control to Reload, and leaves focus inside an open dialog", async () => {
    localStorage.setItem(KEY, B);
    const page = render(
      <PageWriteGuardProvider>
        <button data-testid="edit">Edit</button>
      </PageWriteGuardProvider>
    );
    act(() => screen.getByTestId("edit").focus());
    expect(screen.getByTestId("edit")).toHaveFocus();

    await act(async () => anotherTabStores(SYS));

    expect(screen.getByTestId("edit")).toBeDisabled();
    expect(
      screen.getByTestId("prompt-documents-cross-tab-reload")
    ).toHaveFocus();
    page.unmount();

    // The operator is typing in a dialog the page opened: that focus is theirs.
    localStorage.setItem(KEY, B);
    render(
      <PageWriteGuardProvider>
        <OpenDialog />
      </PageWriteGuardProvider>
    );
    const field = await screen.findByTestId("in-dialog");
    act(() => field.focus());
    expect(field).toHaveFocus();

    await act(async () => anotherTabStores(SYS));

    expect(notice()).toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("moves focus to Reload from <body>, where a browser drops it as the fieldset disables the control", async () => {
    // jsdom keeps focus on a control its fieldset disables; a browser
    // (measured: Chromium) drops it to <body> at once. So the path a user
    // takes is the one from <body>, and it is driven here.
    localStorage.setItem(KEY, B);
    render(
      <PageWriteGuardProvider>
        <button data-testid="edit">Edit</button>
      </PageWriteGuardProvider>
    );
    act(() => screen.getByTestId("edit").focus());
    act(() => screen.getByTestId("edit").blur());
    expect(document.body).toHaveFocus();

    await act(async () => anotherTabStores(SYS));

    expect(notice()).toBeInTheDocument();
    expect(
      screen.getByTestId("prompt-documents-cross-tab-reload")
    ).toHaveFocus();
  });

  it.each([
    ["an app modal, which says so with aria-modal", "aria-modal"],
    ["a Radix dialog, which traps focus without aria-modal", "radix"],
  ] as const)(
    "does not move focus from <body> behind %s",
    async (_label, modal) => {
      localStorage.setItem(KEY, B);
      render(
        <>
          <PageWriteGuardProvider>
            <button data-testid="edit">Edit</button>
            {modal === "radix" ? <OpenDialog /> : null}
          </PageWriteGuardProvider>
          {modal === "aria-modal" ? (
            <div role="dialog" aria-modal="true" aria-label="Navigation">
              <input data-testid="in-dialog" aria-label="Search" />
            </div>
          ) : null}
        </>
      );
      // The control the operator was on in the modal went away, and focus
      // fell to <body>.
      const field = await screen.findByTestId("in-dialog");
      act(() => field.focus());
      act(() => field.blur());
      expect(document.body).toHaveFocus();

      await act(async () => anotherTabStores(SYS));

      expect(notice()).toBeInTheDocument();
      expect(document.body).toHaveFocus();
    }
  );
});
