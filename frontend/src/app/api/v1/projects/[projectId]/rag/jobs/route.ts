import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** GET /api/v1/projects/[projectId]/rag/jobs — proxied via `proxyToBackend`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  return proxyToBackend(request, `/api/v1/projects/${projectId}/rag/jobs`, {
    tokenSources: ["cookie", "header"],
    onMissingToken: "401",
    unauthorizedBodyKey: "error",
    query: "raw",
    body: "json",
    errorBody: { error: "Failed to fetch jobs" },
  });
}
