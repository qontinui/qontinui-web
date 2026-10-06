import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** /api/v1/execution/runs/[runId]/tree-events — proxied via `proxyToBackend`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/execution/runs/${runId}/tree-events`,
    {
      tokenSources: ["cookie", "header"],
      onMissingToken: "401",
      unauthorizedBodyKey: "detail",
      query: "raw",
      errorBody: "detail",
    }
  );
}
