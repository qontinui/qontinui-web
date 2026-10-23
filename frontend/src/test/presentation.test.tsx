/**
 * The presentation test helper's own oracle: a surface built the lens's way
 * passes, and each of the four checks fails on exactly the leak it exists for
 * (plan `2026-10-23-console-presentation-spaces` D3). Every later phase's page
 * test leans on this file being right.
 */

import type { ReactNode, Ref } from "react";
import { describe, expect, it } from "vitest";
import { useUIComponent, useUIElement } from "@qontinui/ui-bridge/react";
import { FilterTabs, RecordRow, RefreshButton } from "@/components/console";
import {
  Caption,
  CostFigure,
  FixedPresentationMode,
  MachineName,
  OperatorOnly,
  PresentationModeToggle,
  Provenance,
  RedactedText,
} from "@/components/presentation";
import {
  CURRENCY_FIGURE,
  expectPresentationSafe,
  findPresentationViolations,
  renderInPresentationMode,
  type PresentationViolationKind,
} from "./presentation";

function kinds(view: ReturnType<typeof renderInPresentationMode>) {
  return findPresentationViolations(view).map((v) => v.kind);
}

function expectOnly(
  view: ReturnType<typeof renderInPresentationMode>,
  kind: PresentationViolationKind
) {
  const found = kinds(view);
  expect(found.length).toBeGreaterThan(0);
  expect(new Set(found)).toEqual(new Set([kind]));
}

function WriteAction({
  effect,
}: {
  effect?: "read" | "write" | "destructive";
}) {
  useUIComponent({
    id: `test-action-${effect ?? "undeclared"}`,
    name: "Test action",
    actions: [{ id: "act", label: "Act", effect, handler: async () => true }],
  });
  return null;
}

function ElementWithCustomAction() {
  const { ref } = useUIElement({
    id: "test-element",
    label: "Test element",
    type: "button",
    customActions: {
      wipe: {
        id: "wipe",
        label: "Wipe",
        effect: "destructive",
        handler: async () => true,
      },
    },
  });
  return (
    <span ref={ref as Ref<HTMLSpanElement>} data-presentation-nav="">
      element
    </span>
  );
}

/** A lens page composed the way later phases build theirs. */
function SafeSurface() {
  return (
    <div>
      <PresentationModeToggle />
      <Caption id="dev-ops.page" />
      <FilterTabs
        tabs={[
          { id: "all", label: "All", count: 3 },
          { id: "red", label: "Red", count: null },
        ]}
        active="all"
        onChange={() => {}}
        query=""
        onQueryChange={() => {}}
      />
      <RefreshButton
        onRefresh={() => {}}
        label="Refresh machines"
        title="Re-reads coord"
      />
      <RecordRow
        identity="A"
        label={<MachineName identity={{ hostname: "build-host-1" }} />}
        expanded={false}
        onToggle={() => {}}
      />
      <Provenance source="coord fleet health" asOf="2026-10-23T12:00:00Z" />
      <RedactedText
        text="Portal login redesign"
        repo="client-org/portal"
        descriptor={{ kind: "Plan", status: "draft" }}
      />
      <CostFigure amount={12.5} source="reported" />
      <a href="/admin/coord/runners">Runners</a>
      <div role="tablist">
        <button type="button" role="tab" aria-selected="true">
          Machines
        </button>
      </div>
      <button type="button" disabled>
        Disabled
      </button>
      <input type="text" readOnly value="read only" />
      <input type="hidden" value="x" />
      <WriteAction effect="read" />
      <OperatorOnly>
        <button type="button">Drain this machine</button>
        <WriteAction effect="write" />
        <CostFigure amount={3} source="reported" />
      </OperatorOnly>
    </div>
  );
}

describe("renderInPresentationMode + expectPresentationSafe", () => {
  it("passes a surface built the lens's way", () => {
    const view = renderInPresentationMode(<SafeSurface />);
    expectPresentationSafe(view, { captions: ["dev-ops.page"] });
    expect("registry" in view.uiBridge).toBe(true);
  });

  it("renders in presentation mode, with the scope UNKNOWN by default", () => {
    const view = renderInPresentationMode(
      <RedactedText
        text="Ship the lens"
        repo="qontinui/qontinui-web"
        descriptor={{ kind: "Plan" }}
        data-testid="t"
      />
    );
    expect(view.getByTestId("t")).toHaveAttribute("data-redacted", "true");
  });

  it("takes the scope it is given", () => {
    const view = renderInPresentationMode(
      <RedactedText
        text="Ship the lens"
        repo="qontinui/qontinui-web"
        descriptor={{ kind: "Plan" }}
        data-testid="t"
      />,
      {
        scope: {
          status: "ready",
          scope: { firstPartyOwners: ["qontinui"], confidentialTerms: [] },
        },
      }
    );
    expect(view.getByTestId("t")).toHaveTextContent("Ship the lens");
  });

  it("composes the caller's own wrapper inside the lens", () => {
    function Shell({ children }: { children: ReactNode }) {
      return <main data-testid="shell">{children}</main>;
    }
    const view = renderInPresentationMode(<Caption id="dev-ops.page" />, {
      wrapper: Shell,
    });
    expect(view.getByTestId("shell")).toContainElement(
      view.container.querySelector(
        '[data-presentation-caption="dev-ops.page"]'
      ) as HTMLElement
    );
  });
});

describe("(a) no enabled control except navigation-only ones", () => {
  it("fails on an enabled button", () => {
    expectOnly(
      renderInPresentationMode(
        <button type="button">Drain this machine</button>
      ),
      "enabled-control"
    );
  });

  it("fails on an input, a select, a textarea and an editable region", () => {
    const view = renderInPresentationMode(
      <div>
        <input aria-label="cap" />
        <select aria-label="role">
          <option>Bench</option>
        </select>
        <textarea aria-label="note" />
        <div contentEditable suppressContentEditableWarning>
          edit me
        </div>
      </div>
    );
    expect(kinds(view)).toEqual([
      "enabled-control",
      "enabled-control",
      "enabled-control",
      "enabled-control",
    ]);
  });

  it("fails on an ARIA widget, such as a switch", () => {
    expectOnly(
      renderInPresentationMode(
        <div role="switch" aria-checked="false" tabIndex={0}>
          auto-merge
        </div>
      ),
      "enabled-control"
    );
  });

  it("fails on a menu or dialog trigger — what it opens can write", () => {
    expectOnly(
      renderInPresentationMode(
        <button type="button" aria-haspopup="dialog" aria-expanded="false">
          Drain…
        </button>
      ),
      "enabled-control"
    );
  });

  it("passes what is navigation-only by construction or by claim", () => {
    const view = renderInPresentationMode(
      <div>
        <button type="button" data-presentation-nav="">
          Open the question queue
        </button>
        <button type="button" aria-disabled="true">
          busy
        </button>
        <fieldset disabled>
          <button type="button">inside a disabled fieldset</button>
        </fieldset>
        <button type="button" aria-expanded="false">
          Show detail
        </button>
        <details>
          <summary>More</summary>
        </details>
        <span role="link" tabIndex={0}>
          link-like
        </span>
      </div>
    );
    expect(findPresentationViolations(view)).toEqual([]);
  });

  it("scans portals too, not only the container", () => {
    const view = renderInPresentationMode(<p>body</p>);
    const portal = document.createElement("div");
    portal.innerHTML = '<button type="button">Delete</button>';
    document.body.appendChild(portal);
    try {
      expect(kinds(view)).toEqual(["enabled-control"]);
    } finally {
      portal.remove();
    }
  });
});

describe("(b) no visible write registration", () => {
  it("fails on a mounted component action declaring write", () => {
    expectOnly(
      renderInPresentationMode(<WriteAction effect="write" />),
      "write-registration"
    );
  });

  it("fails on a mounted component action declaring destructive", () => {
    expectOnly(
      renderInPresentationMode(<WriteAction effect="destructive" />),
      "write-registration"
    );
  });

  it("fails on an action that declares no effect — unclassified is not safe", () => {
    expectOnly(
      renderInPresentationMode(<WriteAction />),
      "undeclared-registration"
    );
  });

  it("fails on a connected element's destructive custom action", () => {
    expectOnly(
      renderInPresentationMode(<ElementWithCustomAction />),
      "write-registration"
    );
  });

  it("passes a read action, and a write action behind OperatorOnly", () => {
    expectPresentationSafe(
      renderInPresentationMode(
        <>
          <WriteAction effect="read" />
          <OperatorOnly>
            <WriteAction effect="destructive" />
          </OperatorOnly>
        </>
      )
    );
  });
});

describe("(c) no cost", () => {
  it("fails on CostFigure's operator-mode figure, its label and its amount", () => {
    const view = renderInPresentationMode(
      <FixedPresentationMode presenting={false}>
        <CostFigure amount={4.2} source="reported" />
      </FixedPresentationMode>
    );
    expect(new Set(kinds(view))).toEqual(
      new Set(["cost-figure", "cost-label", "currency-figure"])
    );
  });

  it("fails on a hand-rendered currency figure", () => {
    expectOnly(
      renderInPresentationMode(<p>This run cost $12.50</p>),
      "currency-figure"
    );
    expectOnly(
      renderInPresentationMode(<p>Spend: 30 USD</p>),
      "currency-figure"
    );
    expectOnly(
      renderInPresentationMode(<p>€0.40 per task</p>),
      "currency-figure"
    );
  });

  it("fails on a figure in an attribute, or split across elements", () => {
    expectOnly(
      renderInPresentationMode(<span title="cost: $3.10">hover me</span>),
      "currency-figure"
    );
    expectOnly(
      renderInPresentationMode(
        <p>
          <span>$</span>
          <span>12</span>
        </p>
      ),
      "currency-figure"
    );
  });

  it("fails on the equivalent label rendered anywhere", () => {
    expectOnly(
      renderInPresentationMode(<p>A list-price equivalent figure</p>),
      "cost-label"
    );
  });

  it("does not mistake an ordinary number for a cost", () => {
    expect(CURRENCY_FIGURE.test("12 machines, 3 USB ports, v2.4.0")).toBe(
      false
    );
    expectPresentationSafe(
      renderInPresentationMode(<p>12 machines · 40% busy</p>)
    );
  });
});

describe("(d) captions", () => {
  it("fails when an expected caption did not render", () => {
    const view = renderInPresentationMode(<p>no caption here</p>);
    expect(
      findPresentationViolations(view, { captions: ["dev-ops.page"] }).map(
        (v) => v.kind
      )
    ).toEqual(["missing-caption"]);
  });
});
