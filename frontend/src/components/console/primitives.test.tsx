/**
 * The console primitives, tested at the primitive level.
 *
 * `MergePipeline.test.tsx` already exercises most of these THROUGH the merge
 * pipeline, and it stays the oracle for "did the extraction change anything".
 * What it cannot do is bind the rules for a surface that composes a primitive
 * differently — so the clauses that are the RULE rather than the pipeline's
 * use of it are asserted here, once, against the primitive itself:
 *
 * - R6's `–`-not-`0` for an unfetched count (`FilterTabs`, `StatCluster`);
 * - R2's fixed slot order and its truncate-don't-wrap treatment (`RecordRow`);
 * - R5's fixed section order and shared border (`RecordDetail`);
 * - the loading / empty / rows trichotomy and one-open-at-a-time (`RecordList`);
 * - R1's level → dot/border mapping and the badge cluster (`HealthStrip`).
 *
 * See `frontend/docs/console-ui-style-guide.md` §2 and §3.2.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { FilterTabs } from "./FilterTabs";
import { HealthStrip } from "./HealthStrip";
import { RecordDetail } from "./RecordDetail";
import { RecordList } from "./RecordList";
import { RecordRow } from "./RecordRow";
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
        accent="border-l-2 border-l-red-500/80"
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
