/**
 * `/admin/coord/topics/[id]` — summary, next steps, members with weight/state
 * and their basis as plain sentences, children and history; coord's 404 is
 * an answer, a pending migration is unknown (plan
 * `2026-11-16-subproject-topics-agents-and-coord-group-subprojects-into-topics-without-the-operator`
 * Phase 8, D9).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TopicDetailResponse } from "@/lib/api/operations/coordTopics";

const fetchTopic = vi.fn();
vi.mock("@/lib/api/operations/coordTopics", () => ({
  fetchTopic: (...args: unknown[]) => fetchTopic(...args),
}));

const TOPIC_ID = "7a1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: TOPIC_ID }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
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

import TopicDetailPage from "./page";

const DETAIL: TopicDetailResponse = {
  as_of: "2026-11-20T12:00:00Z",
  topic: {
    id: TOPIC_ID,
    slug: "subproject-topics",
    title: "Subproject topics",
    summary: "Group subprojects into topics without the operator.",
    status: "active",
    parent_topic_id: null,
    headline: "working",
    top_reason: null,
    subprojects_total: 2,
    subprojects_working: 1,
    unknown_members: 0,
    last_activity_at: "2026-11-20T11:00:00Z",
    last_rollup_as_of: "2026-11-20T11:30:00Z",
    next_steps: "Land the coord doors, then the pages.",
    intent_ref: null,
    aliases: ["topics"],
    created_by: "agent",
    merged_into: null,
  },
  members: [
    {
      subproject_id: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
      subproject_title: "topics-web-pages",
      weight: 0.82,
      state: "confirmed",
      decided_by: "agent",
      decided_by_session: "s-1",
      basis: [
        {
          signal: "plan_family",
          ref: "2026-11-16-subproject-topics",
          score: 0.9,
        },
        { signal: "declared", ref: "1bea9f99", score: 1 },
        { signal: "semantic", ref: "could_not_read", score: null },
      ],
      headline: "working",
    },
  ],
  children: [
    { id: "c1", slug: "child", title: "A child topic", status: "proposed" },
  ],
  history: [],
};

describe("TopicDetailPage", () => {
  beforeEach(() => {
    fetchTopic.mockReset();
  });

  it("renders summary, next steps, members with weight/state and basis sentences, and children", async () => {
    fetchTopic.mockResolvedValue(DETAIL);
    render(<TopicDetailPage />);
    expect(await screen.findByTestId("coord-topic-summary")).toHaveTextContent(
      "Group subprojects into topics"
    );
    expect(screen.getByTestId("coord-topic-next-steps")).toHaveTextContent(
      "Land the coord doors"
    );
    const row = screen.getByTestId("coord-topic-member-row");
    expect(row).toHaveTextContent("topics-web-pages");
    expect(
      within(row).getByTestId("coord-topic-member-weight")
    ).toHaveTextContent("82% · confirmed");
    fireEvent.click(within(row).getByRole("button"));
    const basis = await screen.findByTestId("coord-topic-member-basis");
    expect(basis).toHaveTextContent(
      "shares plan `2026-11-16-subproject-topics`"
    );
    expect(basis).toHaveTextContent("tagged by session 1bea9f99");
    expect(basis).toHaveTextContent("could not read similar wording");
    expect(screen.getByTestId("coord-topic-children")).toHaveTextContent(
      "A child topic"
    );
  });

  it("links the parent topic and names the intent anchor when coord sends them", async () => {
    const PARENT = "9b1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
    fetchTopic.mockResolvedValue({
      ...DETAIL,
      topic: {
        ...DETAIL.topic,
        parent_topic_id: PARENT,
        intent_ref: { kind: "product_intent", name: "roadmap", claim: "c-3" },
      },
    });
    render(<TopicDetailPage />);
    const parent = await screen.findByTestId("coord-topic-parent");
    expect(within(parent).getByRole("link")).toHaveAttribute(
      "href",
      `/admin/coord/topics/${PARENT}`
    );
    expect(screen.getByTestId("coord-topic-intent")).toHaveTextContent(
      'product_intent/roadmap, claim "c-3"'
    );
  });

  it("says nothing about a parent or an anchor the topic does not have", async () => {
    fetchTopic.mockResolvedValue(DETAIL);
    render(<TopicDetailPage />);
    await screen.findByTestId("coord-topic-summary");
    expect(screen.queryByTestId("coord-topic-parent")).toBeNull();
    expect(screen.queryByTestId("coord-topic-intent")).toBeNull();
  });

  it("says coord's 404 as an answer", async () => {
    fetchTopic.mockRejectedValue(
      new Error(
        `GET /api/v1/operations/topics/${TOPIC_ID} failed: 404 - {"error":"topic_not_found"}`
      )
    );
    render(<TopicDetailPage />);
    expect(
      await screen.findByTestId("coord-topic-not-found")
    ).toHaveTextContent("coord has no topic");
  });

  it("says a pending migration as 'topics not available yet'", async () => {
    fetchTopic.mockRejectedValue(
      new Error(
        `GET /api/v1/operations/topics/${TOPIC_ID} failed: 503 - {"error":"schema_migration_pending"}`
      )
    );
    render(<TopicDetailPage />);
    expect(await screen.findByTestId("coord-topic-unknown")).toHaveTextContent(
      "topics not available yet (migration pending)"
    );
  });
});
