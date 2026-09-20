/**
 * `/admin/coord/plan-forks` — the fork list reaches the screen.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4b.
 * The derivations are pinned over the pure module in `forkStatus.test.ts`;
 * what is pinned here is that both HALVES render — above all the kind-fork
 * half, which a page rendering `groups` alone drops silently — and that the
 * page presents the fork without proposing a resolution.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DivergentResponse } from "./forkStatus";

const get = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/plan-forks",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: true }),
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

import CoordPlanForksPage from "./page";

const RESPONSE: DivergentResponse = {
  groups: [
    {
      kind: "plan",
      slug: "2026-09-05-every-bounded-read",
      variant_count: 2,
      variants: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          kind: "plan",
          kind_locked: false,
          content_sha256: "aaaaaaaaaaaabbbbbbbbbbbb",
          source_repo: "qontinui-dev-notes/plans",
          source_path: "2026-09-05-every-bounded-read.md",
          title: "Every bounded read",
          status: "vetted",
          current_version: 4,
          updated_at: "2026-09-18T00:00:00Z",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          kind: "plan",
          kind_locked: false,
          content_sha256: "ccccccccccccdddddddddddd",
          source_repo: "qontinui-web/docs",
          source_path: "2026-09-05-every-bounded-read.md",
          title: "Every bounded read (older wording)",
          status: "draft",
          current_version: 1,
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    },
  ],
  total: 1,
  kind_forks: [
    {
      slug: "2026-08-01-plan-corpus",
      source_repo: "qontinui-dev-notes/plans",
      kinds: ["plan", "report"],
      variant_count: 2,
      resolvable: false,
      variants: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          kind: "plan",
          kind_locked: false,
          content_sha256: "eeeeeeeeeeeeffffffffffff",
          source_repo: "qontinui-dev-notes/plans",
          source_path: "2026-08-01-plan-corpus.md",
          title: "Plan corpus",
          status: "shipped",
          current_version: 2,
          updated_at: "2026-08-20T00:00:00Z",
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          kind: "report",
          kind_locked: true,
          content_sha256: "eeeeeeeeeeeeffffffffffff",
          source_repo: "qontinui-dev-notes/plans",
          source_path: "2026-08-01-plan-corpus.md",
          title: "Plan corpus",
          status: "shipped",
          current_version: 2,
          updated_at: "2026-08-21T00:00:00Z",
        },
      ],
    },
  ],
  kind_fork_total: 1,
};

beforeEach(() => {
  get.mockReset();
});

describe("/admin/coord/plan-forks consumes /plan-library/divergent", () => {
  it("asks the route by name — it had no consumer before this page", async () => {
    get.mockResolvedValue(RESPONSE);
    render(<CoordPlanForksPage />);

    await screen.findByTestId("coord-fork-content-row");
    expect(String(get.mock.calls[0]?.[0])).toContain(
      "/api/v1/plan-library/divergent"
    );
  });

  it("renders the KIND-fork half, which a (kind, slug) grouping cannot see", async () => {
    get.mockResolvedValue(RESPONSE);
    render(<CoordPlanForksPage />);

    const row = await screen.findByTestId("coord-fork-kind-row");
    expect(row).toHaveTextContent("2026-08-01-plan-corpus");
    expect(within(row).getByTestId("coord-fork-kinds")).toHaveTextContent(
      "plan vs report"
    );
    const verdict = within(row).getByTestId("coord-fork-kind-verdict");
    expect(verdict).toHaveAttribute("data-fork-kind", "kind_operator");
    expect(verdict).toHaveAttribute("data-resolvable", "false");
    expect(screen.getByTestId("coord-fork-kind-total")).toHaveTextContent("1");
  });

  it("says the scanner will heal a resolvable kind fork, and waits", async () => {
    get.mockResolvedValue({
      ...RESPONSE,
      groups: [],
      total: 0,
      kind_forks: [{ ...RESPONSE.kind_forks![0], resolvable: true }],
    });
    render(<CoordPlanForksPage />);

    const verdict = await screen.findByTestId("coord-fork-kind-verdict");
    expect(verdict).toHaveAttribute("data-fork-kind", "kind_self_healing");
    expect(verdict).toHaveTextContent("scanner will heal");
  });

  it("renders a content fork with every copy's source, digest and version", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(RESPONSE);
    render(<CoordPlanForksPage />);

    const row = await screen.findByTestId("coord-fork-content-row");
    await user.click(within(row).getByRole("button"));

    const variants = await screen.findAllByTestId("coord-fork-variant");
    expect(variants).toHaveLength(2);
    // Newest touched first — a temporal ordering, stated as such.
    expect(variants[0]).toHaveTextContent("qontinui-dev-notes/plans");
    expect(variants[1]).toHaveTextContent("qontinui-web/docs");
    expect(
      within(variants[0]).getByTestId("coord-fork-variant-digest")
    ).toHaveTextContent("aaaaaaaaaaaa");
    expect(screen.getByTestId("coord-fork-content-detail")).toHaveTextContent(
      "not a ranking"
    );
  });

  it("surfaces the fork and proposes NO resolution", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(RESPONSE);
    render(<CoordPlanForksPage />);

    const row = await screen.findByTestId("coord-fork-content-row");
    await user.click(within(row).getByRole("button"));

    const page = screen.getByTestId("coord-plan-forks-page");
    // No control that would pick a winner: the disposition is a content
    // judgement and stays the operator's.
    expect(page).toHaveTextContent("content judgement");
    expect(page).not.toHaveTextContent(/keep this copy/i);
    expect(page).not.toHaveTextContent(/resolve fork/i);
  });

  it("names the title disagreement when the copies do not even share one", async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(RESPONSE);
    render(<CoordPlanForksPage />);

    const row = await screen.findByTestId("coord-fork-content-row");
    await user.click(within(row).getByRole("button"));
    expect(
      await screen.findByTestId("coord-fork-title-disagreement")
    ).toHaveTextContent("older wording");
  });

  it("reads a failed request as UNKNOWN in BOTH sections, never as clean", async () => {
    get.mockRejectedValue(new Error("GET /x failed: 503 - upstream"));
    render(<CoordPlanForksPage />);

    expect(
      await screen.findByTestId("coord-fork-content-unknown")
    ).toHaveTextContent("unknown, not none");
    expect(screen.getByTestId("coord-fork-kind-unknown")).toHaveTextContent(
      "unknown, not none"
    );
    expect(screen.getByTestId("coord-fork-content-total")).toHaveTextContent(
      "–"
    );
  });

  it("reads a measured clean as a measurement, and says it was computed now", async () => {
    get.mockResolvedValue({
      groups: [],
      total: 0,
      kind_forks: [],
      kind_fork_total: 0,
    });
    render(<CoordPlanForksPage />);

    expect(
      await screen.findByTestId("coord-fork-content-empty")
    ).toHaveTextContent("as measured by this read");
    expect(screen.getByTestId("coord-plan-forks-health")).toHaveTextContent(
      "fresh zero"
    );
  });

  it("never calls an unserved groups list a measured empty under a positive total", async () => {
    // `total: 4` and no `groups`. The `?? []` printed "no two copies of one
    // plan disagree, as measured by this read" directly under a header
    // reading (4) — a measurement claim about rows the response never carried.
    get.mockResolvedValue({ total: 4, kind_forks: [], kind_fork_total: 0 });
    render(<CoordPlanForksPage />);

    const unstated = await screen.findByTestId("coord-fork-content-unstated");
    expect(unstated).toHaveTextContent("unknown — not none");
    expect(screen.queryByTestId("coord-fork-content-empty")).toBeNull();
    expect(screen.getByTestId("coord-fork-content-total")).toHaveTextContent(
      "4"
    );
  });

  it("never calls an unserved kind_forks list a measured empty", async () => {
    get.mockResolvedValue({ groups: [], total: 0, kind_fork_total: 3 });
    render(<CoordPlanForksPage />);

    const unstated = await screen.findByTestId("coord-fork-kind-unstated");
    expect(unstated).toHaveTextContent("unknown — not none");
    expect(screen.queryByTestId("coord-fork-kind-empty")).toBeNull();
    expect(screen.getByTestId("coord-plan-forks-health")).not.toHaveTextContent(
      /scanner can heal/i
    );
  });
});
