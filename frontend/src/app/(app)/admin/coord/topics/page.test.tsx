/**
 * `/admin/coord/topics` — the list says which topics have stopped, counts
 * each tab from the one list coord serves, renders a count not yet loaded as
 * `–`, and says a pending migration as exactly that (plan
 * `2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator`
 * Phase 8, D9).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type {
  TopicListResponse,
  TopicSummary,
} from "@/lib/api/operations/coordTopics";

const fetchTopics = vi.fn();
vi.mock("@/lib/api/operations/coordTopics", () => ({
  fetchTopics: (...args: unknown[]) => fetchTopics(...args),
}));

let mockTab: string | null = null;
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockTab ? { tab: mockTab } : {}),
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/admin/coord/topics",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import CoordTopicsPage from "./page";

function topic(over: Partial<TopicSummary> = {}): TopicSummary {
  return {
    id: "7a1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
    slug: "subproject-topics",
    title: "Subproject topics",
    summary: null,
    status: "active",
    parent_topic_id: null,
    headline: "stalled",
    top_reason: "qontinui-coord#4298 waits on a closed author",
    subprojects_total: 3,
    subprojects_working: 1,
    unknown_members: 0,
    last_activity_at: "2026-11-20T11:00:00Z",
    last_rollup_as_of: "2026-11-20T11:30:00Z",
    ...over,
  };
}

function list(
  topics: TopicSummary[],
  unassigned: number | null = 4
): TopicListResponse {
  return {
    as_of: "2026-11-20T12:00:00Z",
    tables_ready: true,
    unassigned_subprojects: unassigned,
    topics,
  };
}

function tabCount(tab: string): HTMLElement {
  return screen.getByTestId(`coord-topics-tab-${tab}`);
}

describe("CoordTopicsPage", () => {
  beforeEach(() => {
    fetchTopics.mockReset();
    replace.mockReset();
    mockTab = null;
  });

  it("lists every topic with its badge, reason and working/total, and a red strip on a stall", async () => {
    fetchTopics.mockResolvedValue(
      list([
        topic(),
        topic({
          id: "b",
          slug: "calm",
          title: "A calm topic",
          headline: "working",
          top_reason: null,
        }),
      ])
    );
    render(<CoordTopicsPage />);
    await screen.findByText("Subproject topics");
    expect(screen.getByText("A calm topic")).toBeInTheDocument();
    expect(screen.getByTestId("coord-topics-strip")).toHaveAttribute(
      "data-health-level",
      "red"
    );
    expect(within(tabCount("stalled")).getByText("1")).toBeInTheDocument();
    expect(within(tabCount("all")).getByText("2")).toBeInTheDocument();
    // A measured zero is a 0, not a dash.
    expect(within(tabCount("done")).getByText("0")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("coord-topic-row-working")[0]
    ).toHaveTextContent("1/3");
    expect(screen.getByTestId("coord-topics-unassigned")).toHaveTextContent(
      "Subprojects that belong to no topic: 4"
    );
  });

  it("filters rows by the tab in the URL", async () => {
    mockTab = "working";
    fetchTopics.mockResolvedValue(
      list([
        topic(),
        topic({ id: "b", title: "A calm topic", headline: "working" }),
      ])
    );
    render(<CoordTopicsPage />);
    await screen.findByText("A calm topic");
    expect(screen.queryByText("Subproject topics")).not.toBeInTheDocument();
  });

  it("dashes every count before any read answers, and never claims an empty list", () => {
    fetchTopics.mockReturnValue(new Promise(() => {}));
    render(<CoordTopicsPage />);
    expect(within(tabCount("all")).getByText("–")).toBeInTheDocument();
    expect(within(tabCount("stalled")).getByText("–")).toBeInTheDocument();
    expect(screen.queryByTestId("coord-topics-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("coord-topics-unassigned")).toHaveTextContent(
      "not read yet"
    );
  });

  it("says a pending migration as 'topics not available yet', never 'no topics'", async () => {
    fetchTopics.mockRejectedValue(
      new Error(
        'GET /api/v1/operations/topics failed: 503 - {"error":"schema_migration_pending"}'
      )
    );
    render(<CoordTopicsPage />);
    const empty = await screen.findByTestId("coord-topics-empty");
    expect(empty).toHaveTextContent(
      "topics not available yet (migration pending)"
    );
    expect(empty).toHaveTextContent(/is unknown/);
    expect(screen.getByTestId("coord-topics-strip")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(within(tabCount("all")).getByText("–")).toBeInTheDocument();
  });

  it("an unassigned count coord did not take is a dash, said as unknown", async () => {
    fetchTopics.mockResolvedValue(list([topic()], null));
    render(<CoordTopicsPage />);
    const line = await screen.findByTestId("coord-topics-unassigned");
    await waitFor(() => expect(line).toHaveTextContent("unknown, not zero"));
    expect(line).toHaveTextContent("–");
  });

  it("a topic never rolled up is unknown and listed under All", async () => {
    fetchTopics.mockResolvedValue(
      list([
        topic({ headline: null, top_reason: null, last_rollup_as_of: null }),
      ])
    );
    render(<CoordTopicsPage />);
    await screen.findByText("Subproject topics");
    expect(screen.getByTestId("coord-topics-strip")).toHaveAttribute(
      "data-health-level",
      "amber"
    );
    expect(within(tabCount("done")).getByText("0")).toBeInTheDocument();
  });

  it("a topic never rolled up says its activity is unknown, not absent", async () => {
    fetchTopics.mockResolvedValue(
      list([
        topic({
          headline: null,
          last_activity_at: null,
          last_rollup_as_of: null,
        }),
      ])
    );
    render(<CoordTopicsPage />);
    await screen.findByText("Subproject topics");
    expect(screen.getByText("activity unknown")).toBeInTheDocument();
    expect(screen.queryByText("no activity reported")).not.toBeInTheDocument();
  });
});
