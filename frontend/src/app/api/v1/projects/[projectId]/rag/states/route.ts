import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** GET /api/v1/projects/[projectId]/rag/states — proxied via `proxyToBackend`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/projects/${encodeURIComponent(projectId)}/rag/states`,
    {
      tokenSources: ["cookie", "header"],
      onMissingToken: "401",
      unauthorizedBodyKey: "error",
      errorBody: { error: "Failed to fetch states" },
    }
  );
}
