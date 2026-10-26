/**
 * What the page check records of a render, read from the render itself (plan
 * `2026-10-23-console-presentation-spaces` D3; `readinessRecorder.ts`).
 *
 * A ready route counts only when the checked view's React root holds the
 * route's page module's own component under a presenting lens, the check read
 * everything that component rendered, and check (b) read the registry that
 * render registers with. Each row below is a render the review rounds showed
 * passing the check while the page was not what the check read — and the
 * record must not name the page as presented, or must not claim the real
 * provider's registry, for any of them.
 */

import { memo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, TestRunner, vi } from "vitest";
import { UIBridgeProvider, useUIComponent } from "@qontinui/ui-bridge/react";
import { FixedPresentationMode, OperatorOnly } from "@/components/presentation";
import {
  findPresentationViolations,
  renderInPresentationMode,
  type PresentationView,
} from "./presentation";
import { provesRoute } from "./readinessEvidence";
import { appendCheck, presentationCheckRecord } from "./readinessRecorder";

const ROUTE = "/admin/coord/devops";

/** The route's page, as its module exports it. */
function DevOpsPage() {
  return <main>Fleet health</main>;
}
/** A mock's stand-in: the same markup, another component. */
function StandIn() {
  return <main>Fleet health</main>;
}
function HealthPanel() {
  return <section>One panel of the page</section>;
}

const TARGETS = [{ route: ROUTE, page: DevOpsPage }];
/** The record of a check reading `read` (default: what the check reads by default). */
const recordOf = (view: PresentationView, read: Element = document.body) =>
  presentationCheckRecord(view, 0, TARGETS, read);

function Providers({ children }: { children: ReactNode }) {
  return <div data-testid="providers">{children}</div>;
}

describe("presentationCheckRecord — which pages the checked view holds", () => {
  it("names the page mounted under the presenting lens", () => {
    expect(recordOf(renderInPresentationMode(<DevOpsPage />))).toEqual({
      render: expect.any(Number),
      presented: [ROUTE],
      operator: [],
      unread: [],
      violations: 0,
      registry: "provider",
    });
  });

  it("names it however deep in the caller's providers", () => {
    const view = renderInPresentationMode(
      <section>
        <DevOpsPage />
      </section>,
      { wrapper: Providers }
    );
    expect(recordOf(view).presented).toEqual([ROUTE]);
  });

  it("names a page exported as a memo by the object its module exports", () => {
    const MemoPage = memo(DevOpsPage);
    const view = renderInPresentationMode(<MemoPage />);
    expect(
      presentationCheckRecord(
        view,
        0,
        [{ route: ROUTE, page: MemoPage }],
        document.body
      ).presented
    ).toEqual([ROUTE]);
  });

  it("names the page in the operator view when no presenting lens is above it", () => {
    const view = renderInPresentationMode(
      <FixedPresentationMode presenting={false}>
        <DevOpsPage />
      </FixedPresentationMode>
    );
    expect(recordOf(view)).toMatchObject({ presented: [], operator: [ROUTE] });
  });

  it("reads the nearest lens above the page", () => {
    const view = renderInPresentationMode(
      <FixedPresentationMode presenting={false}>
        <FixedPresentationMode presenting>
          <DevOpsPage />
        </FixedPresentationMode>
      </FixedPresentationMode>
    );
    expect(recordOf(view).presented).toEqual([ROUTE]);
  });

  it("names the page presented only when every mount of it is presenting", () => {
    const view = renderInPresentationMode(
      <>
        <DevOpsPage />
        <FixedPresentationMode presenting={false}>
          <DevOpsPage />
        </FixedPresentationMode>
      </>
    );
    expect(recordOf(view)).toMatchObject({ presented: [], operator: [ROUTE] });
  });

  it("names a page that portals into the document the check reads", () => {
    function DialogPage() {
      return createPortal(<p role="dialog">Fleet health</p>, document.body);
    }
    const view = renderInPresentationMode(
      <>
        Loading
        <DialogPage />
      </>
    );
    expect(
      presentationCheckRecord(
        view,
        0,
        [{ route: ROUTE, page: DialogPage }],
        document.body
      )
    ).toMatchObject({ presented: [ROUTE], unread: [] });
  });
});

describe("presentationCheckRecord — a view without the page names none", () => {
  const none = { presented: [], operator: [], unread: [] };

  it("is a view unmounted before the check", () => {
    const view = renderInPresentationMode(<DevOpsPage />);
    view.unmount();
    expect(recordOf(view)).toMatchObject(none);
  });

  it("is a view re-rendered to something else", () => {
    const view = renderInPresentationMode(<DevOpsPage />);
    view.rerender(<HealthPanel />);
    expect(recordOf(view)).toMatchObject(none);
  });

  it("is a view whose wrapper drops the page", () => {
    const view = renderInPresentationMode(<DevOpsPage />, {
      wrapper: () => null,
    });
    expect(recordOf(view)).toMatchObject(none);
  });

  it("is the page inside the lens's own OperatorOnly", () => {
    const view = renderInPresentationMode(
      <OperatorOnly placeholder={<p>shown in the operator view</p>}>
        <DevOpsPage />
      </OperatorOnly>
    );
    expect(recordOf(view)).toMatchObject(none);
  });

  it("is a stand-in mocked into the page's place, whatever it renders", () => {
    expect(recordOf(renderInPresentationMode(<StandIn />))).toMatchObject(none);
  });

  it("is a view a destructuring assignment put in the page's view's place", () => {
    let view = renderInPresentationMode(<DevOpsPage />);
    [view] = [renderInPresentationMode(<HealthPanel />)];
    expect(recordOf(view)).toMatchObject(none);
  });

  it("is another render in the same document — the page's render is not this view", () => {
    renderInPresentationMode(<DevOpsPage />);
    const panel = renderInPresentationMode(<HealthPanel />);
    expect(recordOf(panel)).toMatchObject(none);
  });

  it("is a view without a container: a statement about the document", () => {
    renderInPresentationMode(<DevOpsPage />);
    expect(
      recordOf({ uiBridge: { unobservable: "a document view" } })
    ).toMatchObject(none);
  });
});

describe("presentationCheckRecord — a page whose output the check did not read is unread, not presented", () => {
  /** The page's own markup, an enabled control (check (a) fails it), rendered where it is put. */
  function ControlPage() {
    return (
      <main>
        <button type="button">Drain this machine</button>
      </main>
    );
  }
  const CONTROL_TARGETS = [{ route: ROUTE, page: ControlPage }];
  const unread = { presented: [], operator: [], unread: [ROUTE] };

  it("fails the check when rendered where the check reads (the control is seen)", () => {
    expect(
      findPresentationViolations(renderInPresentationMode(<ControlPage />)).map(
        (v) => v.kind
      )
    ).toContain("enabled-control");
  });

  it("is a page portaled into a detached element, while the view's own container shows something else", () => {
    const detached = document.createElement("div");
    const view = renderInPresentationMode(
      <>Loading{createPortal(<ControlPage />, detached)}</>
    );
    // The check reads the document: the control is in no part of it.
    const violations = findPresentationViolations(view);
    expect(violations).toEqual([]);
    const record = presentationCheckRecord(
      view,
      violations.length,
      CONTROL_TARGETS,
      document.body
    );
    expect(record).toMatchObject(unread);
    expect(provesRoute(record, ROUTE)).toBe(false);
  });

  it("is a page that portals outside a narrowed element the check reads", () => {
    function DialogPage() {
      return (
        <>
          <p>Fleet health</p>
          {createPortal(
            <button type="button">Drain this machine</button>,
            document.body
          )}
        </>
      );
    }
    const view = renderInPresentationMode(<DialogPage />);
    const narrowed = { ...view, baseElement: view.container };
    const violations = findPresentationViolations(narrowed);
    expect(violations).toEqual([]);
    const record = presentationCheckRecord(
      narrowed,
      violations.length,
      [{ route: ROUTE, page: DialogPage }],
      view.container
    );
    expect(record).toMatchObject(unread);
    expect(provesRoute(record, ROUTE)).toBe(false);
  });

  it("is a page that portals into another document (an iframe), whose nodes are no instance of this realm's Node", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const inFrame = frame.contentDocument?.body;
    let view: ReturnType<typeof renderInPresentationMode> | undefined;
    try {
      if (inFrame === undefined) throw new Error("the iframe has no document");
      // The hazard: a node of another document is not an `instanceof` the Node
      // of this one, so a reader keyed on `instanceof Node` never sees it.
      expect(inFrame instanceof Node).toBe(false);
      function FramePage() {
        return (
          <>
            <main>Fleet health</main>
            {createPortal(
              <button type="button">Drain this machine</button>,
              inFrame as Element
            )}
          </>
        );
      }
      view = renderInPresentationMode(<FramePage />);
      // Checks (a)-(e) read this document, not the frame's: the control is unseen.
      const violations = findPresentationViolations(view);
      expect(violations).toEqual([]);
      const record = presentationCheckRecord(
        view,
        violations.length,
        [{ route: ROUTE, page: FramePage }],
        document.body
      );
      expect(record).toMatchObject(unread);
      expect(provesRoute(record, ROUTE)).toBe(false);
    } finally {
      // The portal's button leaves the frame before the frame leaves the page.
      view?.unmount();
      frame.remove();
    }
  });

  it.each<[string, (away: Element) => ReactNode]>([
    [
      "second",
      (away) => (
        <>
          <DevOpsPage />
          {createPortal(<DevOpsPage />, away)}
        </>
      ),
    ],
    [
      "first",
      (away) => (
        <>
          {createPortal(<DevOpsPage />, away)}
          <DevOpsPage />
        </>
      ),
    ],
  ])(
    "is a page mounted twice with the %s mount's output portaled out of what the check reads",
    (_which, ui) => {
      const view = renderInPresentationMode(ui(document.createElement("div")));
      // One mount is read in full; a page counts only when every mount is.
      expect(recordOf(view)).toMatchObject(unread);
    }
  );

  it("is a page rendered inside a detached element that is the very one the check reads", () => {
    const detached = document.createElement("div");
    const view = renderInPresentationMode(<DevOpsPage />, {
      container: detached,
    });
    // Every node of the page is inside `read`, and on no screen.
    expect(recordOf(view, detached)).toMatchObject(unread);
    expect(findPresentationViolations(view).map((v) => v.kind)).toEqual([
      "unmounted-view",
    ]);
  });

  it("is a page whose <title> React hoists into the head, until the check reads the whole document", () => {
    function TitledPage() {
      return (
        <main>
          <title>Fleet health</title>
          Machines
        </main>
      );
    }
    const view = renderInPresentationMode(<TitledPage />);
    const targets = [{ route: ROUTE, page: TitledPage }];
    // The title shows in the browser's tab, outside document.body.
    expect(
      presentationCheckRecord(view, 0, targets, document.body)
    ).toMatchObject(unread);
    expect(
      presentationCheckRecord(view, 0, targets, document.documentElement)
    ).toMatchObject({ presented: [ROUTE], unread: [] });
  });

  it("is a page that rendered nothing inside a caller's frame", () => {
    function NothingPage() {
      return null;
    }
    const view = renderInPresentationMode(<NothingPage />, {
      wrapper: Providers,
    });
    expect(
      presentationCheckRecord(
        view,
        0,
        [{ route: ROUTE, page: NothingPage }],
        document.body
      )
    ).toMatchObject(unread);
  });

  it("is a page that rendered only blank text", () => {
    function BlankPage() {
      return <>{"   "}</>;
    }
    const view = renderInPresentationMode(<BlankPage />, {
      wrapper: Providers,
    });
    expect(
      presentationCheckRecord(
        view,
        0,
        [{ route: ROUTE, page: BlankPage }],
        document.body
      )
    ).toMatchObject(unread);
  });
});

describe("presentationCheckRecord — how check (b) saw the UI Bridge", () => {
  /** A page whose only unsafe surface is a write UI Bridge action. */
  function WritePage() {
    useUIComponent({
      id: "fleet-drain",
      name: "Fleet drain",
      actions: [
        {
          id: "drain",
          label: "Drain",
          effect: "write",
          handler: async () => true,
        },
      ],
    });
    return <main>Fleet health</main>;
  }
  const WRITE_TARGETS = [{ route: ROUTE, page: WritePage }];
  const checked = (view: PresentationView) => {
    const violations = findPresentationViolations(view);
    return {
      kinds: violations.map((v) => v.kind),
      record: presentationCheckRecord(
        view,
        violations.length,
        WRITE_TARGETS,
        document.body
      ),
    };
  };

  it("is the provider only for the registry the helper read back from the real UIBridgeProvider", () => {
    expect(recordOf(renderInPresentationMode(<DevOpsPage />)).registry).toBe(
      "provider"
    );
  });

  it("is the provider for a copy of the page's own view, and (b) sees the page's write action", () => {
    const view = renderInPresentationMode(<WritePage />);
    const { kinds, record } = checked({ ...view });
    expect(kinds).toEqual(["write-registration"]);
    expect(record.registry).toBe("provider");
  });

  it("is another render's for a view assembled from two renders: (b) fails it, and the record proves nothing", () => {
    const page = renderInPresentationMode(<WritePage />);
    const other = renderInPresentationMode(<HealthPanel />);
    const { kinds, record } = checked({ ...page, uiBridge: other.uiBridge });
    expect(kinds).toEqual(["unread-registry"]);
    expect(record).toMatchObject({
      presented: [ROUTE],
      registry: "another-render",
    });
    expect(provesRoute(record, ROUTE)).toBe(false);
  });

  it("is another provider's for a caller's wrapper that mounts its own UIBridgeProvider: (b) fails it, and the record proves nothing", () => {
    const view = renderInPresentationMode(<WritePage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <UIBridgeProvider>{children}</UIBridgeProvider>
      ),
    });
    const { kinds, record } = checked(view);
    // The write action registered with the wrapper's provider, which (b)
    // does not read — so (b) fails the read itself.
    expect(kinds).toEqual(["unread-registry"]);
    expect(record).toMatchObject({
      presented: [ROUTE],
      registry: "another-provider",
    });
    expect(provesRoute(record, ROUTE)).toBe(false);
  });

  it("is another provider's for a page that mounts a UIBridgeProvider of its own", () => {
    function OwnBridgePage() {
      return (
        <UIBridgeProvider>
          <WritePage />
        </UIBridgeProvider>
      );
    }
    const view = renderInPresentationMode(<OwnBridgePage />);
    const violations = findPresentationViolations(view);
    expect(violations.map((v) => v.kind)).toEqual(["unread-registry"]);
    expect(
      presentationCheckRecord(
        view,
        violations.length,
        [{ route: ROUTE, page: OwnBridgePage }],
        document.body
      ).registry
    ).toBe("another-provider");
  });

  it("is unbound for a view without a container, or one unmounted", () => {
    const view = renderInPresentationMode(<DevOpsPage />);
    expect(recordOf({ uiBridge: view.uiBridge }).registry).toBe("unbound");
    view.unmount();
    expect(recordOf(view).registry).toBe("unbound");
  });

  it("is the caller's for a registry view a test supplied, even one shaped like the provider's", () => {
    const view = renderInPresentationMode(<DevOpsPage />, {
      uiBridge: {
        registry: { getAllComponents: () => [], getAllElements: () => [] },
      },
    });
    expect(recordOf(view).registry).toBe("caller");
  });

  it("is unobservable when the test said so", () => {
    const view = renderInPresentationMode(<DevOpsPage />, {
      uiBridge: { unobservable: "this suite mocks the SDK" },
    });
    expect(recordOf(view).registry).toBe("unobservable");
  });

  it("carries the violation count it is given", () => {
    const view = renderInPresentationMode(<DevOpsPage />);
    expect(
      presentationCheckRecord(view, 4, TARGETS, document.body).violations
    ).toBe(4);
  });
});

describe("presentationCheckRecord — which render it read", () => {
  it("numbers one render alike in every check over it, however it is re-rendered or copied", () => {
    const view = renderInPresentationMode(<DevOpsPage />);
    const first = recordOf(view).render;
    expect(first).toEqual(expect.any(Number));
    view.rerender(<HealthPanel />);
    expect(recordOf(view).render).toBe(first);
    expect(recordOf({ ...view, baseElement: view.container }).render).toBe(
      first
    );
  });

  it("keeps one numbering across two copies of the recorder, as vi.resetModules() makes them", async () => {
    const copy = async () => {
      vi.resetModules();
      return import("./readinessRecorder");
    };
    const p = await copy();
    const q = await copy();
    // Two evaluations of the module, not one.
    expect(q.presentationCheckRecord).not.toBe(p.presentationCheckRecord);
    const x = renderInPresentationMode(<DevOpsPage />);
    const y = renderInPresentationMode(<DevOpsPage />);
    const readByP = p.presentationCheckRecord(x, 0, TARGETS, document.body);
    const readByQ = q.presentationCheckRecord(y, 0, TARGETS, document.body);
    expect(readByP.render).toEqual(expect.any(Number));
    // Two renders never share a number, whichever copy numbered them ...
    expect(readByQ.render).not.toBe(readByP.render);
    // ... and one render keeps its number whichever copy reads it.
    expect(q.presentationCheckRecord(x, 0, TARGETS, document.body).render).toBe(
      readByP.render
    );
  });

  it("numbers another render otherwise, and a view without a container not at all", () => {
    const one = renderInPresentationMode(<DevOpsPage />);
    const two = renderInPresentationMode(<DevOpsPage />);
    expect(recordOf(two).render).not.toBe(recordOf(one).render);
    expect(recordOf({ uiBridge: one.uiBridge }).render).toBe(null);
  });
});

describe("appendCheck — the records a test keeps", () => {
  const record = (render: number, violations = 0) => ({
    render,
    presented: [ROUTE],
    operator: [],
    unread: [],
    violations,
    registry: "provider" as const,
  });

  it("keeps a polled check once: an equal record after its twin is not added", () => {
    expect(appendCheck([record(1)], record(1))).toEqual([record(1)]);
  });

  it("keeps a record of another render, or another reading, even when the rest is equal", () => {
    expect(appendCheck([record(1, 1)], record(2, 1))).toEqual([
      record(1, 1),
      record(2, 1),
    ]);
    expect(appendCheck([record(1)], record(1, 1))).toEqual([
      record(1),
      record(1, 1),
    ]);
  });

  it("keeps a record that differs only in how the UI Bridge was seen", () => {
    // The verdict reads a render's LAST check: a clean one through a registry
    // the test supplied must not be dropped as a repeat of the provider's.
    const viaCaller = { ...record(1), registry: "caller" as const };
    expect(appendCheck([record(1)], viaCaller)).toEqual([record(1), viaCaller]);
  });

  it.each([
    ["presented", { presented: [ROUTE] }],
    ["operator", { operator: [ROUTE] }],
    ["unread", { unread: [ROUTE] }],
  ])("keeps a record that differs only in its %s list", (_which, change) => {
    // The verdict reads a render's LAST check. One that saw the page gone must
    // not be dropped as a repeat of one that saw it, nor the reverse: with the
    // `unread` list ignored, presented-clean, page absent, page unread would
    // collapse to two records and prove a route the last check refused.
    const gone = { ...record(1), presented: [] as string[] };
    const back = { ...gone, ...change };
    expect(appendCheck([gone], back)).toEqual([gone, back]);
  });
});

describe("recordPresentationCheck", () => {
  it("records nothing in a test file that proves no ready route", () => {
    findPresentationViolations(renderInPresentationMode(<DevOpsPage />));
    expect(TestRunner.getCurrentTest()?.meta.presentationChecks).toBe(
      undefined
    );
  });
});
