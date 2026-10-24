/**
 * The presentation test helper's own oracle: a surface built the lens's way
 * passes, and each of the four checks fails on exactly the leak it exists for
 * (plan `2026-10-23-console-presentation-spaces` D3). Every later phase's page
 * test leans on this file being right.
 */

import type { ReactNode, Ref } from "react";
import { cleanup } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUIComponent, useUIElement } from "@qontinui/ui-bridge/react";
import {
  FilterChips,
  FilterTabs,
  NAVIGATION_ONLY_PROPS,
  RecordRow,
  RefreshButton,
  presenterSafetyProps,
} from "@/components/console";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Caption,
  CostFigure,
  FixedPresentationMode,
  MachineName,
  OperatorOnly,
  PresentationModeToggle,
  Provenance,
  RedactedText,
  usePresentationHref,
} from "@/components/presentation";
import {
  CURRENCY_FIGURE,
  expectPresentationSafe,
  findPresentationViolations,
  renderInPresentationMode,
  type PresentationViolationKind,
} from "./presentation";
import {
  CURRENCY_CODES,
  CURRENCY_FIGURE as SHARED_CURRENCY_FIGURE,
} from "./currencyTokens";

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
  // Something on the screen: a render of nothing fails check (f) on its own.
  return <span>{effect ?? "undeclared"} action</span>;
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

/** A link to another lens page, built the way a lens page builds one. */
function LensLink({ to, children }: { to: string; children: ReactNode }) {
  return <a href={usePresentationHref(to)}>{children}</a>;
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
      <FilterChips
        label="kind:"
        options={[
          { value: "red", label: "red", count: 2 },
          { value: "stalled", label: "stalled", count: 0 },
        ]}
        selected={["red"]}
        onToggle={() => {}}
        onClear={() => {}}
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
      <LensLink to="/admin/coord/runners">Runners</LensLink>
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

  it("fails on the UI kit's Select — a combobox's list is a choice that can write", () => {
    expectOnly(
      renderInPresentationMode(
        <Select value="supervised" onValueChange={() => {}}>
          <SelectTrigger aria-label="Autonomy level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="supervised">supervised</SelectItem>
          </SelectContent>
        </Select>
      ),
      "enabled-control"
    );
  });

  it("passes a view-only Select whose trigger claims navigation-only", () => {
    expectPresentationSafe(
      renderInPresentationMode(
        <Select value="24h" onValueChange={() => {}}>
          <SelectTrigger aria-label="Window" {...NAVIGATION_ONLY_PROPS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">last 24 hours</SelectItem>
          </SelectContent>
        </Select>
      )
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

  it("keeps a listed presenter safety control, and only a listed one", () => {
    expectPresentationSafe(
      renderInPresentationMode(
        <button type="button" {...presenterSafetyProps("co-pilot-stop")}>
          Stop
        </button>
      )
    );
    // The closed list is the exemption: a marker naming anything else is
    // itself a violation, on a control or not.
    const forged = renderInPresentationMode(
      <div>
        <button type="button" data-presentation-safety="drain-machine">
          Drain
        </button>
        <span data-presentation-safety="">nothing</span>
      </div>
    );
    const found = findPresentationViolations(forged);
    expect(found.map((v) => v.kind)).toEqual([
      "enabled-control",
      "enabled-control",
    ]);
    expect(found[0].detail).toContain('"drain-machine"');
    expect(found[0].detail).toContain("does not list");
  });

  it("fails on a link to a lens page that drops the presentation — a new tab would show the operator view", () => {
    const view = renderInPresentationMode(
      <div>
        <a href="/admin/coord/runners">Runners</a>
        <a href="/digital-twin?present=0">Twin</a>
        <a href={`${window.location.origin}/admin/coord/devops#machines`}>
          Dev Ops
        </a>
      </div>
    );
    const found = findPresentationViolations(view);
    expect(found.map((v) => v.kind)).toEqual([
      "presentation-dropping-link",
      "presentation-dropping-link",
      "presentation-dropping-link",
    ]);
    expect(found[0]?.detail).toContain("/admin/coord/runners");
    expect(found[0]?.detail).toContain("usePresentationHref");
  });

  it("passes a lens link that carries the presentation, and a link out of the lens", () => {
    expectPresentationSafe(
      renderInPresentationMode(
        <div>
          <LensLink to="/admin/coord/runners">Runners</LensLink>
          <a href="/admin/coord/devops?present=1#machines">Dev Ops</a>
          <a href="/settings">Settings</a>
          <a href="https://docs.example.test/admin/coord">Docs</a>
        </div>
      )
    );
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

  it.each(["$.50", "12,00 €", "12¢", "€-3", "$ 1,234.56", "5 GBP"])(
    "reads %j as a currency figure",
    (figure) => {
      expect(CURRENCY_FIGURE.test(figure)).toBe(true);
      expectOnly(
        renderInPresentationMode(<p>It came to {figure} today</p>),
        "currency-figure"
      );
    }
  );

  it("reads the one currency vocabulary the source scan reads", () => {
    // Not a copy: a second list is how the classifier came to know four codes
    // of nine (review round 4).
    expect(CURRENCY_FIGURE).toBe(SHARED_CURRENCY_FIGURE);
  });

  it.each([...CURRENCY_CODES])(
    "reads a figure in %s as a currency figure on the page",
    (code) => {
      expectOnly(
        renderInPresentationMode(<p>It came to 12 {code} today</p>),
        "currency-figure"
      );
    }
  );

  it("does not mistake an ordinary number for a cost", () => {
    expect(CURRENCY_FIGURE.test("12 machines, 3 USB ports, v2.4.0")).toBe(
      false
    );
    // A `$` after a digit is a pattern's anchor, not a price.
    expect(CURRENCY_FIGURE.test("^0$")).toBe(false);
    expectPresentationSafe(
      renderInPresentationMode(<p>12 machines · 40% busy</p>)
    );
  });
});

describe("(e) no identity", () => {
  it("fails on an email address — personal data", () => {
    expectOnly(
      renderInPresentationMode(<p>Signed in as presenter@example.test</p>),
      "identifier"
    );
  });

  it("fails on a UUID, in text or in a tooltip", () => {
    expectOnly(
      renderInPresentationMode(
        <p>device 0b9d6a54-0000-4000-8000-0000000000aa</p>
      ),
      "identifier"
    );
    expectOnly(
      renderInPresentationMode(
        <span title="Claimed by device:0b9d6a54-0000-4000-8000-0000000000aa">
          claimed
        </span>
      ),
      "identifier"
    );
  });

  it("fails on a name the test forbids, ignoring case, in text or attributes", () => {
    const forbidden = ["build-host-1", "Partner Portal"];
    const first = renderInPresentationMode(<p>Runner: BUILD-HOST-1</p>);
    expect(
      findPresentationViolations(first, { forbidden }).map((v) => v.kind)
    ).toEqual(["foreign-identity"]);
    first.unmount();
    expect(
      findPresentationViolations(
        renderInPresentationMode(<span aria-label="partner portal">x</span>),
        { forbidden }
      ).map((v) => v.kind)
    ).toEqual(["foreign-identity"]);
  });

  it("fails on a forbidden name split across elements", () => {
    const found = findPresentationViolations(
      renderInPresentationMode(
        <p>
          <span>build-</span>
          <span>host-1</span>
        </p>
      ),
      { forbidden: ["build-host-1"] }
    );
    expect(found.map((v) => v.kind)).toEqual(["foreign-identity"]);
    expect(found[0]?.detail).toContain("across adjacent elements");
  });

  it("passes the alias the lens renders in the name's place", () => {
    expectPresentationSafe(
      renderInPresentationMode(
        <MachineName identity={{ hostname: "build-host-1" }} />
      ),
      { forbidden: ["build-host-1"] }
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

describe("(f) the view is on the screen when the check runs", () => {
  it("fails on a view unmounted before the check", () => {
    const view = renderInPresentationMode(
      <button type="button">Drain this machine</button>
    );
    view.unmount();
    // Over nothing, (a)–(e) would pass whatever the page rendered.
    expect(kinds(view)).toEqual(["unmounted-view"]);
    expect(findPresentationViolations(view)[0]?.detail).toContain(
      "unmounted before the check ran"
    );
  });

  it("fails on a view whose container was cleaned up", () => {
    const view = renderInPresentationMode(<p>page</p>);
    cleanup();
    expect(kinds(view)).toEqual(["unmounted-view"]);
    expect(findPresentationViolations(view)[0]?.detail).toContain(
      "not inside the document the check reads"
    );
  });

  it("fails on a view rendered into a detached element", () => {
    // RTL reads a given container as the base element too, so (a)–(e) read
    // the detached tree; what fails it is that none of it is on the screen.
    const view = renderInPresentationMode(<p>page</p>, {
      container: document.createElement("div"),
    });
    expect(kinds(view)).toEqual(["unmounted-view"]);
  });

  it("fails on a view whose container is outside the element the check reads", () => {
    const reads = document.body.appendChild(document.createElement("section"));
    const elsewhere = document.body.appendChild(document.createElement("div"));
    try {
      const view = renderInPresentationMode(<p>page</p>, {
        container: elsewhere,
        baseElement: reads,
      });
      expect(kinds(view)).toEqual(["unmounted-view"]);
    } finally {
      reads.remove();
      elsewhere.remove();
    }
  });

  it("fails on a view whose wrapper drops its children", () => {
    const view = renderInPresentationMode(
      <button type="button">Drain this machine</button>,
      { wrapper: () => null }
    );
    expect(kinds(view)).toEqual(["empty-view"]);
    expect(findPresentationViolations(view)[0]?.detail).toContain(
      "renders nothing but the helper's own sentinel"
    );
  });

  it("fails on a render wrapped whole in OperatorOnly", () => {
    expectOnly(
      renderInPresentationMode(
        <OperatorOnly>
          <button type="button">Drain this machine</button>
        </OperatorOnly>
      ),
      "empty-view"
    );
  });

  it("fails on a view re-rendered to nothing before the check", () => {
    const view = renderInPresentationMode(<p>page</p>);
    view.rerender(<></>);
    expect(kinds(view)).toEqual(["empty-view"]);
  });

  it("reads text, or any element, as rendered", () => {
    expectPresentationSafe(renderInPresentationMode(<>a sentence</>));
    expectPresentationSafe(renderInPresentationMode(<hr />));
  });
});
