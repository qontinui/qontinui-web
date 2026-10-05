import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** /api/v1/ai-tasks/[id]/findings/[findingId] — proxied via `proxyToBackend`. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) {
  const { id, findingId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/ai-tasks/${id}/findings/${findingId}`,
    {
      tokenSources: ["cookie", "header"],
      onMissingToken: "401",
      unauthorizedBodyKey: "detail",
      forwardBody: "json",
      body: "json",
      errorBody: "detail",
    }
  );
}
