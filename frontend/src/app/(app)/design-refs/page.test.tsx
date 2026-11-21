/**
 * /design-refs — rendered (plan
 * `2026-11-13-design-reference-library-stores-described-web-examples-for-any-project-to-query`
 * Phase 1b-i). What is pinned, and why each would go red:
 *
 * - a pasted list posts ONE batch whose `urls` has one entry per distinct URL,
 *   and the submitted rows show the derived tier — "not derived yet" until the
 *   worker's pre-check wrote one, then the tier and its reason;
 * - the Add form sends no tier field at all (the submitter does not pick it);
 * - the Jobs tab shows a failed job's worker error and a Retry that re-queues
 *   it; an unreadable queue is "unknown", never "no jobs";
 * - a read that filled the page says its counts are a floor, and neither the
 *   strip nor the empty state claims "nothing is waiting"; its tab counts
 *   read `N+`;
 * - a list over the batch limit cannot be submitted, and the count line says
 *   why.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CaptureJob } from "@/lib/api/design-refs";

const api = vi.hoisted(() => ({
  // A small page so a full read is cheap to build.
  CAPTURE_JOBS_PAGE_LIMIT: 2,
  // A small batch limit, so going over it is cheap to type.
  CAPTURE_JOB_BATCH_MAX_URLS: 2,
  fetchCaptureJobs: vi.fn(),
  createCaptureJobs: vi.fn(),
  retryCaptureJob: vi.fn(),
  moveCaptureJob: vi.fn(),
}));
vi.mock("@/lib/api/design-refs", () => api);

import DesignRefsPage from "./page";

function job(over: Partial<CaptureJob> = {}): CaptureJob {
  return {
    id: "j1",
    url: "https://a.example/pricing",
    domain: "a.example",
    scope_kind: "page",
    crawl_depth: null,
    flow_goal: null,
    notes: null,
    source: "operator",
    submitter_kind: "operator",
    submitter_id: null,
    is_reproduction: false,
    state: "queued",
    browser: "launched",
    claimed_by: null,
    claimed_until: null,
    derived_tier: null,
    tier_reason: null,
    error: null,
    created_at: "2026-11-16T00:00:00Z",
    updated_at: "2026-11-16T00:00:00Z",
    ...over,
  };
}

async function renderPage() {
  await act(async () => {
    render(<DesignRefsPage />);
  });
}

describe("/design-refs", () => {
  beforeEach(() => {
    api.fetchCaptureJobs.mockReset().mockResolvedValue([]);
    api.createCaptureJobs.mockReset();
    api.retryCaptureJob.mockReset();
    api.moveCaptureJob.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("refuses to submit a list over the batch limit and says why", async () => {
    await renderPage();
    fireEvent.change(screen.getByTestId("design-refs-add-urls"), {
      target: {
        value: "https://a.example\nhttps://b.example\nhttps://c.example",
      },
    });
    expect(screen.getByTestId("design-refs-add-count")).toHaveTextContent(
      "over the limit of 2 per submission; remove 1 to submit"
    );
    expect(screen.getByTestId("design-refs-add-submit")).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-add-submit"));
    });
    expect(api.createCaptureJobs).not.toHaveBeenCalled();
  });

  it("creates one job per distinct URL and shows the tier as not derived yet", async () => {
    const created = [
      job({ id: "j1", url: "https://a.example", domain: "a.example" }),
      job({ id: "j2", url: "https://b.example", domain: "b.example" }),
    ];
    api.createCaptureJobs.mockResolvedValue({ created, refused: [] });
    await renderPage();

    fireEvent.change(screen.getByTestId("design-refs-add-urls"), {
      target: {
        value: "https://a.example\nhttps://b.example\nhttps://a.example",
      },
    });
    expect(screen.getByTestId("design-refs-add-count")).toHaveTextContent(
      "2 URLs"
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-add-submit"));
    });

    expect(api.createCaptureJobs).toHaveBeenCalledTimes(1);
    const body = api.createCaptureJobs.mock.calls[0][0];
    expect(body.urls).toEqual(["https://a.example", "https://b.example"]);
    expect(body).not.toHaveProperty("tier");
    expect(body).not.toHaveProperty("derived_tier");
    const rows = await screen.findAllByTestId("design-refs-add-job");
    expect(rows).toHaveLength(2);
    expect(
      screen.getAllByTestId("design-refs-add-job-tier")[0]
    ).toHaveTextContent("not derived yet");
  });

  it("shows the derived tier and reason once the worker's pre-check wrote them", async () => {
    api.createCaptureJobs.mockResolvedValue({
      created: [job({ id: "j1" })],
      refused: [],
    });
    // The page's re-read after the submit returns the pre-checked job.
    api.fetchCaptureJobs.mockResolvedValue([
      job({
        id: "j1",
        state: "running",
        derived_tier: "public",
        tier_reason: { robots: "allowed" },
      }),
    ]);
    await renderPage();
    fireEvent.change(screen.getByTestId("design-refs-add-urls"), {
      target: { value: "https://a.example/pricing" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-add-submit"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("design-refs-add-job-tier")).toHaveTextContent(
        "tier: public — robots: allowed"
      )
    );
  });

  it("lists URLs the backend refused", async () => {
    api.createCaptureJobs.mockResolvedValue({
      created: [],
      refused: [
        {
          url: "https://gone.example/x",
          error: "do_not_capture",
          message: "This URL is on the tenant's do-not-capture list.",
        },
      ],
    });
    await renderPage();
    fireEvent.change(screen.getByTestId("design-refs-add-urls"), {
      target: { value: "https://gone.example/x" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-add-submit"));
    });
    expect(
      await screen.findByTestId("design-refs-add-refused-row")
    ).toHaveTextContent("do-not-capture");
  });

  it("shows a failed job's error on the Jobs tab and retries it", async () => {
    api.fetchCaptureJobs.mockResolvedValue([
      job({ id: "j9", state: "failed", error: "blocked by a bot challenge" }),
    ]);
    api.retryCaptureJob.mockResolvedValue(job({ id: "j9", state: "queued" }));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-view-jobs"));
    });
    expect(
      await screen.findByTestId("design-refs-job-reason")
    ).toHaveTextContent("blocked by a bot challenge");
    await act(async () => {
      fireEvent.click(
        within(screen.getByTestId("design-refs-job-row")).getByRole("button", {
          expanded: false,
        })
      );
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("design-refs-job-retry"));
    });
    expect(api.retryCaptureJob).toHaveBeenCalledWith("j9");
  });

  it("reads an unreadable queue as unknown, not as no jobs", async () => {
    api.fetchCaptureJobs.mockRejectedValue(new Error("nope"));
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-view-jobs"));
    });
    expect(
      await screen.findByTestId("design-refs-jobs-unknown")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("design-refs-jobs-empty")).toBeNull();
  });

  it("says counts are a floor when the read filled the page", async () => {
    api.fetchCaptureJobs.mockResolvedValue([
      job({ id: "j1", state: "done" }),
      job({ id: "j2", state: "done" }),
    ]);
    await renderPage();
    const health = screen.getByTestId("design-refs-health");
    expect(health).not.toHaveTextContent("Nothing is waiting to be captured");
    expect(health).toHaveTextContent("among the newest 2 jobs");
    expect(screen.getByTestId("design-refs-view-jobs")).toHaveTextContent("0+");
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-view-jobs"));
    });
    expect(
      await screen.findByTestId("design-refs-jobs-truncated")
    ).toHaveTextContent("counts are a floor");
    expect(screen.getByTestId("design-refs-jobs-filter-all")).toHaveTextContent(
      "2+"
    );
    expect(
      screen.getByTestId("design-refs-jobs-filter-done")
    ).toHaveTextContent("2+");
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-jobs-filter-queued"));
    });
    expect(screen.getByTestId("design-refs-jobs-empty")).toHaveTextContent(
      "among the newest 2; older jobs were not read"
    );
  });

  it("shows no floor note when the read is shorter than the page", async () => {
    api.fetchCaptureJobs.mockResolvedValue([job({ id: "j1", state: "done" })]);
    await renderPage();
    expect(screen.getByTestId("design-refs-health")).toHaveTextContent(
      "Nothing is waiting to be captured"
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("design-refs-view-jobs"));
    });
    expect(screen.queryByTestId("design-refs-jobs-truncated")).toBeNull();
    expect(
      screen.getByTestId("design-refs-jobs-filter-all")
    ).not.toHaveTextContent("+");
  });
});
