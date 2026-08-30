/**
 * The console primitives, tested at the primitive level.
 *
 * `MergePipeline.test.tsx` already exercises most of these THROUGH the merge
 * pipeline, and it stays the oracle for "did the extraction change anything".
 * What it cannot do is bind the rules for a surface that composes a primitive
 * differently — so the clauses that are the RULE rather than the pipeline's
 * use of it are asserted here, once, against the primitive itself:
 *
 * - R6's `–`-not-`0` for an unfetched count (`FilterTabs`, `StatCluster`), and
 *   that `FilterChips` reads the same value the same way inside a counted strip;
 * - `FilterChips`' empty-selection contract: `[]` is NO filter, not an option;
 * - R2's fixed slot order and its truncate-don't-wrap treatment (`RecordRow`);
 * - R5's fixed section order and shared border (`RecordDetail`);
 * - the loading / empty / rows trichotomy and one-open-at-a-time (`RecordList`);
 * - R1's level → dot/border mapping and the badge cluster (`HealthStrip`).
 *
 * See `frontend/docs/console-ui-style-guide.md` §2 and §3.2.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { FilterChips } from "./FilterChips";
import { FilterTabs } from "./FilterTabs";
import { HealthStrip } from "./HealthStrip";
import { RecordDetail } from "./RecordDetail";
import { RecordList } from "./RecordList";
import { RecordRow } from "./RecordRow";
import { rowAccentClass } from "./statusRow";
import { StatCluster } from "./StatCluster";

// ----------------------------------------------------------------------------
// R6 — filter tabs carry live counts, and an unfetched one is a DASH
// ----------------------------------------------------------------------------

describe("FilterTabs (R6)", () => {
  const tabs = [
    { id: "all", label: "All", count: 4 },
    { id: "none", label: "Nothing", count: 0 },
    { id: "unfetched", label: "Unfetched", count: null },
    { id: "absent", label: "Absent" },
  ] as const;

  it("renders `–`, never `0`, for a count nobody fetched", () => {
    render(
      <FilterTabs
        tabs={[...tabs]}
        active="all"
        onChange={() => {}}
        testIdPrefix="t"
      />
    );
    // Known-and-zero is a real answer and must still read as 0.
    expect(screen.getByTestId("t-none")).toHaveTextContent("0");
    // Explicit null and plain absence are the SAME claim: we did not look.
    expect(screen.getByTestId("t-unfetched")).toHaveTextContent("–");
    expect(screen.getByTestId("t-unfetched")).not.toHaveTextContent("0");
    expect(screen.getByTestId("t-absent")).toHaveTextContent("–");
    expect(screen.getByTestId("t-absent")).not.toHaveTextContent("0");
  });

  it("marks the active tab and reports a change", () => {
    const onChange = vi.fn();
    render(
      <FilterTabs
        tabs={[...tabs]}
        active="all"
        onChange={onChange}
        testIdPrefix="t"
      />
    );
    fireEvent.click(screen.getByTestId("t-none"));
    expect(onChange).toHaveBeenCalledWith("none");
  });

  it("paints only an ATTENTION count in the attention hue", () => {
    render(
      <FilterTabs
        tabs={[
          { id: "calm", label: "Calm", count: 9 },
          { id: "loud", label: "Loud", count: 2, attention: true },
        ]}
        active="calm"
        onChange={() => {}}
        testIdPrefix="t"
      />
    );
    expect(
      screen.getByTestId("t-loud").querySelector("span")?.className
    ).toContain("text-red-300");
    expect(
      screen.getByTestId("t-calm").querySelector("span")?.className
    ).toContain("text-muted-foreground");
  });

  it("omits the filter input entirely when no handler is supplied", () => {
    const { rerender } = render(
      <FilterTabs
        tabs={[...tabs]}
        active="all"
        onChange={() => {}}
        queryTestId="q"
      />
    );
    expect(screen.queryByTestId("q")).toBeNull();

    const onQuery = vi.fn();
    rerender(
      <FilterTabs
        tabs={[...tabs]}
        active="all"
        onChange={() => {}}
        query="abc"
        onQueryChange={onQuery}
        queryTestId="q"
      />
    );
    fireEvent.change(screen.getByTestId("q"), { target: { value: "abcd" } });
    expect(onQuery).toHaveBeenCalledWith("abcd");
  });
});

// ----------------------------------------------------------------------------
// R6, multi-select — the same strip where more than one value can be on.
//
// The clause that is the RULE rather than one page's use of it: an EMPTY
// selection is the unfiltered state, and it is not an option. Every console
// filter whose values are a server vocabulary (coord's `severity`, its `kind`
// list) would otherwise have to mint an "any" member the API has never heard
// of and remember to strip it before it reaches a query string.
// ----------------------------------------------------------------------------

describe("FilterChips (R6, multi-select)", () => {
  const options = [
    { value: "info", label: "Info" },
    { value: "warning", label: "Warning" },
    { value: "critical", label: "Critical" },
  ] as const;

  function renderChips(selected: readonly string[], on = vi.fn(), clear = vi.fn()) {
    render(
      <FilterChips
        label="severity"
        options={[...options]}
        selected={[...selected]}
        onToggle={on}
        onClear={clear}
        testIdPrefix="f"
      />
    );
    return { on, clear };
  }

  it("treats an EMPTY selection as the unfiltered state, not as an option", () => {
    renderChips([]);
    // `all` is pressed because nothing is selected — it is a CLEAR action
    // reflecting state, never a fourth value the caller has to filter out.
    expect(screen.getByTestId("f-all")).toHaveAttribute("aria-pressed", "true");
    for (const o of options) {
      expect(screen.getByTestId(`f-${o.value}`)).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    }
    expect(screen.getByTestId("f")).toHaveAttribute("data-selected", "");
  });

  it("marks EVERY selected chip, not just the last one", () => {
    renderChips(["info", "critical"]);
    expect(screen.getByTestId("f-info")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("f-critical")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByTestId("f-warning")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByTestId("f-all")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("f")).toHaveAttribute(
      "data-selected",
      "info,critical"
    );
  });

  it("makes `all` inert while it is already the state, so a no-op cannot fire", () => {
    const { clear } = renderChips([]);
    const all = screen.getByTestId("f-all");
    // A caller's `onClear` is `setState([])` — a FRESH array every call — so a
    // no-op click still invalidates every selection-keyed `useCallback`
    // downstream. On a paging surface that re-runs the page-1 fetch and
    // discards whatever the operator had paged into, for a click that changed
    // no filter. It is also what a screen reader is told: pressed, and inert.
    expect(all).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(all);
    expect(clear).not.toHaveBeenCalled();
  });

  it("keeps the inert `all` chip focusable and un-dimmed", () => {
    renderChips([]);
    const all = screen.getByTestId("f-all");
    // `aria-disabled`, never the real attribute. A real `disabled` drops the
    // button out of the tab order the instant it is activated — the keyboard
    // operator who tabs to `all` and presses Enter loses focus to `<body>` on
    // the one interaction the chip exists for — and picks up the base button's
    // `disabled:opacity-50`, dimming the page's DEFAULT state.
    // `disabled:opacity-50` is a Tailwind VARIANT on the base button class and
    // is always in the class string; what decides whether it paints is the
    // attribute, and the attribute is what must stay off.
    expect(all).not.toBeDisabled();
    all.focus();
    expect(document.activeElement).toBe(all);
  });

  it("re-arms `all` the moment there is something to clear", () => {
    const { clear } = renderChips(["warning"]);
    const all = screen.getByTestId("f-all");
    expect(all).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(all);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("reports the toggled value and leaves add/remove to the caller", () => {
    const { on, clear } = renderChips(["info"]);
    // A chip that is already ON still reports a plain toggle: the primitive
    // holds no selection state, so it cannot and must not decide the result.
    fireEvent.click(screen.getByTestId("f-info"));
    expect(on).toHaveBeenCalledWith("info");
    fireEvent.click(screen.getByTestId("f-warning"));
    expect(on).toHaveBeenLastCalledWith("warning");
    fireEvent.click(screen.getByTestId("f-all"));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("renders no count slot at all when NO option carries a count", () => {
    renderChips([]);
    // Not a row of dashes. An uncounted strip has not failed to look — per-kind
    // counts would cost a request each, so the strip does not claim one.
    expect(screen.getByTestId("f")).not.toHaveTextContent("–");
  });

  it("reads a count the same way FilterTabs does, once the strip has any", () => {
    render(
      <FilterChips
        label="severity"
        options={[
          { value: "info", label: "Info", count: 4 },
          { value: "warning", label: "Warning", count: 0 },
          // Explicit null and plain absence are the SAME claim — we did not
          // look — exactly as on FilterTabs.
          { value: "critical", label: "Critical", count: null },
          { value: "other", label: "Other" },
        ]}
        selected={[]}
        onToggle={() => {}}
        onClear={() => {}}
        testIdPrefix="c"
      />
    );
    expect(screen.getByTestId("c-info")).toHaveTextContent("4");
    expect(screen.getByTestId("c-warning")).toHaveTextContent("0");
    expect(screen.getByTestId("c-critical")).toHaveTextContent("–");
    expect(screen.getByTestId("c-critical")).not.toHaveTextContent("0");
    expect(screen.getByTestId("c-other")).toHaveTextContent("–");
  });

  it("caps a long vocabulary behind `+N more`, and never hides a SELECTED chip", () => {
    // Coord's alert vocabulary was 43 live kinds on 2026-08-24 against the ~10
    // the alerts page was written for, so the cap is what keeps a server-sized
    // option list from spending §5's density budget on a control.
    const many = Array.from({ length: 10 }, (_, i) => ({
      value: `k${i}`,
      label: `K${i}`,
    }));
    render(
      <FilterChips
        label="kind"
        options={many}
        // `k9` is past the cap and selected — the exemption is the point: a
        // filter that hides what it is filtering on is the same defect as a
        // chip that vanishes when its last row resolves.
        selected={["k9"]}
        onToggle={() => {}}
        onClear={() => {}}
        maxVisible={3}
        testIdPrefix="m"
      />
    );
    expect(screen.getByTestId("m-k0")).toBeInTheDocument();
    expect(screen.getByTestId("m-k2")).toBeInTheDocument();
    expect(screen.queryByTestId("m-k3")).toBeNull();
    expect(screen.getByTestId("m-k9")).toHaveAttribute("aria-pressed", "true");
    // 10 options, 4 shown (3 capped + the exempt selection) → 6 hidden.
    expect(screen.getByTestId("m-more")).toHaveTextContent("+6 more");

    fireEvent.click(screen.getByTestId("m-more"));
    expect(screen.getByTestId("m-k3")).toBeInTheDocument();
    expect(screen.getByTestId("m-more")).toHaveTextContent("show fewer");
  });

  it("shows no disclosure when the vocabulary fits, capped or not", () => {
    const { unmount } = render(
      <FilterChips
        label="kind"
        options={[{ value: "a", label: "A" }]}
        selected={[]}
        onToggle={() => {}}
        onClear={() => {}}
        maxVisible={3}
        testIdPrefix="s"
      />
    );
    expect(screen.queryByTestId("s-more")).toBeNull();
    unmount();

    // ...and an uncapped strip never discloses, however long it is.
    renderChips([]);
    expect(screen.queryByTestId("f-more")).toBeNull();
  });

  it("names the group for a screen reader and honours an overridden all-label", () => {
    render(
      <FilterChips
        label="kind"
        options={[{ value: "red_main", label: "Red Main" }]}
        selected={[]}
        onToggle={() => {}}
        onClear={() => {}}
        allLabel="all (list partial)"
        title="this coord build does not serve the kind list"
        testIdPrefix="k"
      />
    );
    const group = screen.getByRole("group", { name: "kind filter" });
    expect(group).toHaveAttribute(
      "title",
      "this coord build does not serve the kind list"
    );
    expect(within(group).getByTestId("k-all")).toHaveTextContent(
      "all (list partial)"
    );
  });
});

// ----------------------------------------------------------------------------
// R2 / R4 — one record = one line, accent on the left edge
// ----------------------------------------------------------------------------

describe("RecordRow (R2, R4)", () => {
  const base = {
    identity: "repo#1",
    label: "feat/thing",
    status: <span data-testid="the-status">Ready</span>,
    time: <span data-testid="the-time">2h</span>,
    reason: "waiting on CI",
  };

  it("keeps the slot order fixed: identity → label → status → reason → time", () => {
    render(
      <RecordRow
        {...base}
        expanded={false}
        onToggle={() => {}}
        data-testid="row"
      />
    );
    const text = screen.getByTestId("row").textContent ?? "";
    expect(text.indexOf("repo#1")).toBeLessThan(text.indexOf("feat/thing"));
    expect(text.indexOf("feat/thing")).toBeLessThan(text.indexOf("Ready"));
    expect(text.indexOf("Ready")).toBeLessThan(text.indexOf("waiting on CI"));
    expect(text.indexOf("waiting on CI")).toBeLessThan(text.indexOf("2h"));
  });

  /**
   * The machine-readable half of the console style — the precondition Phase 4
   * step 1 of the console plan names before its rules may be written.
   *
   * The point of asserting these in a RENDER rather than by grep: a style rule
   * or a spec selector matches the DOM, and a rule with a live evaluator and a
   * dead selector reports PASS. A grep over the source proves an attribute is
   * spelled somewhere; only a render proves it reaches an element, on the one
   * that carries the property the rule is about.
   */
  describe("emits the selectors the style rules address", () => {
    it("marks the row LINE — the element that owns the padding and the size", () => {
      render(
        <RecordRow
          {...base}
          expanded={false}
          onToggle={() => {}}
          data-testid="row"
        />
      );
      const row = document.querySelector("[data-console-row]");
      expect(row).not.toBeNull();
      // Not the wrapper: the density budget is about this element's box.
      expect(row?.tagName).toBe("BUTTON");
      expect(row?.className).toContain("py-2");
      expect(row?.className).toContain("px-3");
      // Stated rather than inherited, so `[data-console-row]{font-size}` is a
      // rule about something this element actually declares.
      expect(row?.className).toContain("text-sm");
    });

    it("paints and declares from ONE prop, so the two cannot disagree", () => {
      const { unmount } = render(
        <RecordRow
          {...base}
          attention="author"
          expanded={false}
          onToggle={() => {}}
          data-testid="row"
        />
      );
      const row = document.querySelector("[data-console-row]");
      expect(row).toHaveAttribute("data-attention", "author");
      // The colour and the attribute are the same fact in two channels, and
      // both come off the same prop — so a rule keyed on one always finds the
      // other on the same element. The accent is the SHARED one, byte for
      // byte: §4.1 says nothing outside `statusRow` may mint a red.
      expect(row?.className).toContain(rowAccentClass({ attention: "author" }));
      expect(row?.className).toContain("border-l-red-500/80");
      unmount();

      // Absent, not `"none"`, when the surface classifies nothing: "this row
      // is calm" and "this surface has no severity model" are different
      // claims, and an audit that conflates them reads the second as the first.
      render(
        <RecordRow
          {...base}
          expanded={false}
          onToggle={() => {}}
          data-testid="row"
        />
      );
      expect(
        document.querySelector("[data-console-row]")
      ).not.toHaveAttribute("data-attention");
    });
  });

  it("truncates rather than wraps, and carries the full text in a title", () => {
    render(
      <RecordRow
        {...base}
        expanded={false}
        onToggle={() => {}}
        data-testid="row"
      />
    );
    const reason = screen.getByTestId("row-reason");
    expect(reason).toHaveAttribute("title", "waiting on CI");
    expect(reason.className).toContain("truncate");
    // Hidden below `sm` — the badge's own title answers "why?" there.
    expect(reason.className).toContain("hidden sm:inline");
  });

  it("drops the inline reason while expanded — the panel carries it in full", () => {
    render(
      <RecordRow
        {...base}
        expanded
        onToggle={() => {}}
        data-testid="row"
      >
        <div data-testid="detail">why</div>
      </RecordRow>
    );
    expect(screen.queryByTestId("row-reason")).toBeNull();
    expect(screen.getByTestId("detail")).toBeInTheDocument();
  });

  it("renders children ONLY while expanded, and toggles on click", () => {
    const onToggle = vi.fn();
    render(
      <RecordRow
        {...base}
        expanded={false}
        onToggle={onToggle}
        data-testid="row"
      >
        <div data-testid="detail">why</div>
      </RecordRow>
    );
    expect(screen.queryByTestId("detail")).toBeNull();
    const button = within(screen.getByTestId("row")).getByRole("button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("puts the accent on the left edge and leaves the row body neutral", () => {
    render(
      <RecordRow
        {...base}
        // The accent is derived from `attention` rather than passed as a
        // class — one prop, so the border and `data-attention` cannot
        // disagree. See the prop's own doc.
        attention="author"
        expanded={false}
        onToggle={() => {}}
        data-testid="row"
      />
    );
    const cls =
      within(screen.getByTestId("row")).getByRole("button").className;
    expect(cls).toContain("border-l-2");
    expect(cls).toContain("border-l-red-500/80");
    // R4's whole point: 40 rows stay readable when 6 are red.
    expect(cls).toContain("bg-card/30");
    expect(cls).not.toContain("bg-red-");
  });

  it("exposes its identity for e2e and derived specs", () => {
    render(
      <RecordRow
        {...base}
        rowKey="qontinui-web#1"
        expanded={false}
        onToggle={() => {}}
        data-testid="row"
      />
    );
    expect(screen.getByTestId("row")).toHaveAttribute(
      "data-row-key",
      "qontinui-web#1"
    );
  });
});

// ----------------------------------------------------------------------------
// R5 — detail expands in place, in a fixed section order
// ----------------------------------------------------------------------------

describe("RecordDetail (R5)", () => {
  it("renders the five slots in order: why → problems → actions → history → raw", () => {
    render(
      <RecordDetail
        data-testid="detail"
        why={<p>WHY</p>}
        problems={<p>PROBLEMS</p>}
        actions={<p>ACTIONS</p>}
        history={<p>HISTORY</p>}
        raw={<p>RAW</p>}
      />
    );
    const text = screen.getByTestId("detail").textContent ?? "";
    expect(text).toBe("WHYPROBLEMSACTIONSHISTORYRAW");
  });

  it("shares the row's border so the two read as one object", () => {
    render(<RecordDetail data-testid="detail" why={<p>x</p>} />);
    const cls = screen.getByTestId("detail").className;
    expect(cls).toContain("border-t-0");
    expect(cls).toContain("rounded-b-md");
  });

  it("costs nothing for an absent slot — no empty wrapper divs", () => {
    render(<RecordDetail data-testid="detail" why={<p>only why</p>} />);
    // Five always-present wrappers would make `space-y-3` add gaps for
    // sections that are not there.
    expect(screen.getByTestId("detail").children).toHaveLength(1);
  });

  it("marks the raw-ids block, and only when there is one", () => {
    // R8's slot, made addressable: a style rule or a spec selector can find
    // "the raw block" instead of guessing at a class string. Phase 4 step 1 of
    // the console plan writes a rule keyed on `[data-console-raw]`, and a rule
    // whose selector matches nothing reports PASS.
    const { unmount } = render(
      <RecordDetail data-testid="detail" why={<p>WHY</p>} raw={<p>RAW</p>} />
    );
    const raw = document.querySelector("[data-console-raw]");
    expect(raw).not.toBeNull();
    expect(raw).toHaveTextContent("RAW");
    // It is ONE child of the container either way, so `space-y-3` spaces the
    // wrapper exactly as it spaced the bare node.
    expect(screen.getByTestId("detail").children).toHaveLength(2);
    unmount();

    // Conditional, so the "an absent slot costs nothing" promise above still
    // holds — an always-present wrapper would reintroduce the gap.
    render(<RecordDetail data-testid="detail" why={<p>WHY</p>} />);
    expect(document.querySelector("[data-console-raw]")).toBeNull();
    expect(screen.getByTestId("detail").children).toHaveLength(1);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["true", true],
    ["an empty string", ""],
    ["an empty array", []],
  ])("emits no wrapper — and no gap — when raw is %s", (_name, raw) => {
    // Every value React itself renders as nothing. The obvious guard
    // (`raw != null && raw !== false`) covers three of them and lets the rest
    // through as an EMPTY wrapper, which is a non-first child of `space-y-3`
    // and therefore a 12px gap at the foot of the panel. Two of the misses
    // arrive by ordinary means: `str && <div/>` yields `""`, and a `||` chain
    // over a nullable string yields it too — which is the exact shape of
    // `<AlertRow>`'s raw slot over a `device_id` typed `string | null`.
    render(<RecordDetail data-testid="detail" why={<p>WHY</p>} raw={raw} />);
    expect(document.querySelector("[data-console-raw]")).toBeNull();
    expect(screen.getByTestId("detail").children).toHaveLength(1);
  });

  it("does NOT detect an empty fragment — the one gap, named", () => {
    // `<></>` is a real React element that happens to render nothing, and
    // telling that apart from a fragment with content means reading
    // `props.children` off an element — walking React's internals to save a
    // 12px gap. The values above are the ones a caller reaches by ORDINARY
    // means (`cond &&`, a nullable string, an empty list); a bare empty
    // fragment is not one of them, and no `raw=` call site in the repo passes
    // one. Asserted so the limit is a measurement rather than an assumption:
    // if this ever starts passing, the guard grew and this test should go.
    render(<RecordDetail data-testid="detail" why={<p>WHY</p>} raw={<></>} />);
    expect(document.querySelector("[data-console-raw]")).not.toBeNull();
  });
});

// ----------------------------------------------------------------------------
// RecordList — loading / empty / rows, and one open at a time
// ----------------------------------------------------------------------------

describe("RecordList (R2, R5)", () => {
  const items = [{ id: "a" }, { id: "b" }];
  const renderRow = (
    item: { id: string },
    ctx: { expanded: boolean; onToggle: () => void }
  ) => (
    <RecordRow
      key={item.id}
      data-testid={`row-${item.id}`}
      identity={item.id}
      label={item.id}
      expanded={ctx.expanded}
      onToggle={ctx.onToggle}
    >
      <div data-testid={`detail-${item.id}`}>detail {item.id}</div>
    </RecordRow>
  );

  it("shows skeletons, NOT an empty state, while unloaded", () => {
    const { container } = render(
      <RecordList
        items={[]}
        itemKey={(i: { id: string }) => i.id}
        renderRow={renderRow}
        loaded={false}
        empty={<p data-testid="empty">nothing here</p>}
      />
    );
    // An empty list while a fetch is in flight would claim nothing exists.
    expect(screen.queryByTestId("empty")).toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBe(3);
  });

  it("shows the caller's honest empty state once loaded", () => {
    render(
      <RecordList
        items={[]}
        itemKey={(i: { id: string }) => i.id}
        renderRow={renderRow}
        loaded
        empty={<p data-testid="empty">Nothing merged in the last 48 hours.</p>}
      />
    );
    expect(screen.getByTestId("empty")).toHaveTextContent(
      "Nothing merged in the last 48 hours."
    );
  });

  it("opens ONE row at a time", () => {
    render(
      <RecordList
        items={items}
        itemKey={(i) => i.id}
        renderRow={renderRow}
        loaded
      />
    );
    fireEvent.click(within(screen.getByTestId("row-a")).getByRole("button"));
    expect(screen.getByTestId("detail-a")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("row-b")).getByRole("button"));
    expect(screen.getByTestId("detail-b")).toBeInTheDocument();
    expect(screen.queryByTestId("detail-a")).toBeNull();

    // Clicking the open row closes it.
    fireEvent.click(within(screen.getByTestId("row-b")).getByRole("button"));
    expect(screen.queryByTestId("detail-b")).toBeNull();
  });

  it("hands the expansion key to the caller when controlled", () => {
    const onChange = vi.fn();
    render(
      <RecordList
        items={items}
        itemKey={(i) => i.id}
        renderRow={renderRow}
        loaded
        expandedKey="a"
        onExpandedKeyChange={onChange}
      />
    );
    expect(screen.getByTestId("detail-a")).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("row-b")).getByRole("button"));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

// ----------------------------------------------------------------------------
// R1 — the health strip and its count-cluster sibling
// ----------------------------------------------------------------------------

describe("HealthStrip (R1)", () => {
  it("reports the level as data, and colours the dot and border from it", () => {
    const { container } = render(
      <HealthStrip data-testid="hs" level="red" headline="Pipeline stuck" />
    );
    const root = screen.getByTestId("hs");
    expect(root).toHaveAttribute("data-health-level", "red");
    expect(root.className).toContain("border-red-500/40");
    expect(container.querySelector("[aria-hidden]")?.className).toContain(
      "bg-red-500"
    );
  });

  it("renders a clickable badge as a real button", () => {
    const onClick = vi.fn();
    render(
      <HealthStrip
        data-testid="hs"
        level="amber"
        headline="Pipeline slow"
        detail="2 stuck"
        badges={[
          { key: "q", label: "queue 3" },
          {
            key: "a",
            label: "needs attention 2",
            tone: "attention",
            onClick,
            "data-testid": "hs-attention",
          },
        ]}
      />
    );
    expect(screen.getByTestId("hs")).toHaveTextContent("queue 3");
    fireEvent.click(screen.getByTestId("hs-attention"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("hs-attention").className).toContain(
      "cursor-pointer"
    );
  });
});

describe("StatCluster (R1)", () => {
  it("renders `–`, never `0`, for a stat nobody fetched", () => {
    render(
      <StatCluster
        data-testid="sc"
        stats={[
          { key: "open", label: "open", value: 0, "data-testid": "s-open" },
          { key: "failed", label: "failed", value: null, "data-testid": "s-failed" },
        ]}
      />
    );
    expect(screen.getByTestId("s-open")).toHaveTextContent("0");
    expect(screen.getByTestId("s-failed")).toHaveTextContent("–");
    expect(screen.getByTestId("s-failed")).not.toHaveTextContent("0");
  });

  it("borrows the attention hue only for the attention tone", () => {
    render(
      <StatCluster
        stats={[
          { key: "a", label: "stuck", value: 3, tone: "attention", "data-testid": "s-a" },
          { key: "b", label: "archived", value: 7, tone: "muted", "data-testid": "s-b" },
        ]}
      />
    );
    expect(screen.getByTestId("s-a").className).toContain("text-red-200");
    expect(screen.getByTestId("s-b").className).not.toContain("text-red-");
  });
});
