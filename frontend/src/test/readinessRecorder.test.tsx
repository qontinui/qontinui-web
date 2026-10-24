/**
 * What the page check records of a render, read from the render itself (plan
 * `2026-10-23-console-presentation-spaces` D3; `readinessRecorder.ts`).
 *
 * A ready route counts only when the checked view's React root holds the
 * route's page module's own component under a presenting lens. Each row below
 * is a render the review rounds showed a source reader accepting while the
 * page was not on the screen when the check ran — and the record must not name
 * the page for any of them.
 */

import { memo, type ReactNode } from "react";
import { describe, expect, it, TestRunner } from "vitest";
import { FixedPresentationMode, OperatorOnly } from "@/components/presentation";
import {
  findPresentationViolations,
  renderInPresentationMode,
  type PresentationView,
} from "./presentation";
import { presentationCheckRecord } from "./readinessRecorder";

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
const recordOf = (view: PresentationView) =>
  presentationCheckRecord(view, 0, TARGETS);

function Providers({ children }: { children: ReactNode }) {
  return <div data-testid="providers">{children}</div>;
}

describe("presentationCheckRecord — which pages the checked view holds", () => {
  it("names the page mounted under the presenting lens", () => {
    expect(recordOf(renderInPresentationMode(<DevOpsPage />))).toEqual({
      presented: [ROUTE],
      operator: [],
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
      presentationCheckRecord(view, 0, [{ route: ROUTE, page: MemoPage }])
        .presented
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
});

describe("presentationCheckRecord — a view without the page names none", () => {
  const none = { presented: [], operator: [] };

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

describe("presentationCheckRecord — how check (b) saw the UI Bridge", () => {
  it("is the provider only for the registry the helper read back from the real UIBridgeProvider", () => {
    expect(recordOf(renderInPresentationMode(<DevOpsPage />)).registry).toBe(
      "provider"
    );
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
    expect(presentationCheckRecord(view, 4, TARGETS).violations).toBe(4);
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
