import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** POST /api/v1/projects/[projectId]/rag/search — proxied via `proxyToBackend`. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  return proxyToBackend(request, `/api/v1/projects/${projectId}/rag/search`, {
    tokenSources: ["cookie", "header"],
    onMissingToken: "401",
    unauthorizedBodyKey: "error",
    forwardBody: "text",
    errorBody: { error: "Failed to perform search" },
  });
}
