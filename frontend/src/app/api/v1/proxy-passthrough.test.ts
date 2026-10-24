/**
 * Every `/api/v1` proxy verb passes the upstream answer through as it came.
 *
 * They used to re-serialise it with `response.json()`, so a non-JSON upstream
 * body — a load balancer's `text/plain` 502 — threw and became the proxy's own
 * 500, hiding the real status from the caller.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "access_token" ? { name, value: "t" } : undefined,
  }),
}));

import * as aiTasks from "./ai-tasks/route";
import * as aiTask from "./ai-tasks/[id]/route";
import * as aiTaskFinding from "./ai-tasks/[id]/findings/[findingId]/route";
import * as runs from "./execution/runs/route";
import * as run from "./execution/runs/[runId]/route";
import * as runTree from "./execution/runs/[runId]/tree/route";
import * as runTreeEvents from "./execution/runs/[runId]/tree-events/route";
import * as extractions from "./projects/[projectId]/extractions/route";
import * as ragDashboard from "./projects/[projectId]/rag/dashboard/route";
import * as ragEmbeddings from "./projects/[projectId]/rag/embeddings/route";
import * as ragJobs from "./projects/[projectId]/rag/jobs/route";
import * as ragSearch from "./projects/[projectId]/rag/search/route";
import * as ragStates from "./projects/[projectId]/rag/states/route";
import * as streaming from "./users/me/automation-streaming/route";
import * as streamingReset from "./users/me/automation-streaming/reset-limit/route";
import * as streamingToggle from "./users/me/automation-streaming/toggle/route";
import * as connectionInfo from "./users/me/connection-info/route";

type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

const PARAMS = { id: "1", findingId: "2", runId: "3", projectId: "4" };
const ROUTES: [string, Record<string, unknown>][] = [
  ["ai-tasks", aiTasks],
  ["ai-tasks/1", aiTask],
  ["ai-tasks/1/findings/2", aiTaskFinding],
  ["execution/runs", runs],
  ["execution/runs/3", run],
  ["execution/runs/3/tree", runTree],
  ["execution/runs/3/tree-events", runTreeEvents],
  ["projects/4/extractions", extractions],
  ["projects/4/rag/dashboard", ragDashboard],
  ["projects/4/rag/embeddings", ragEmbeddings],
  ["projects/4/rag/jobs", ragJobs],
  ["projects/4/rag/search", ragSearch],
  ["projects/4/rag/states", ragStates],
  ["users/me/automation-streaming", streaming],
  ["users/me/automation-streaming/reset-limit", streamingReset],
  ["users/me/automation-streaming/toggle", streamingToggle],
  ["users/me/connection-info", connectionInfo],
];
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const CASES = ROUTES.flatMap(([path, mod]) =>
  VERBS.filter((v) => typeof mod[v] === "function").map(
    (verb) => [verb, path, mod[verb] as Handler] as const
  )
);

describe("/api/v1 proxy handlers pass the upstream answer through", () => {
  beforeEach(() => {
    vi.stubEnv("BACKEND_URL", "http://backend.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("covers every verb of the 17 handlers", () => {
    expect(CASES).toHaveLength(24);
  });

  it.each(CASES)(
    "%s /api/v1/%s: an upstream text/plain 502 stays a 502",
    async (verb, path, handler) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("Bad Gateway", {
              status: 502,
              headers: { "Content-Type": "text/plain" },
            })
        )
      );
      const hasBody = verb === "POST" || verb === "PUT" || verb === "PATCH";
      const res = await handler(
        new NextRequest(`http://app.test/api/v1/${path}`, {
          method: verb,
          body: hasBody ? "{}" : undefined,
        }),
        { params: Promise.resolve(PARAMS) }
      );
      expect(res.status).toBe(502);
      expect(res.headers.get("Content-Type")).toBe("text/plain");
      expect(await res.text()).toBe("Bad Gateway");
    }
  );
});
