import { NextRequest } from "next/server";
import { proxyToBackend, type ProxyOptions } from "@/lib/server/proxyToBackend";

/** /api/v1/execution/runs/[runId] — proxied via `proxyToBackend`. */
const OPTIONS: ProxyOptions = {
  tokenSources: ["cookie", "header"],
  onMissingToken: "401",
  unauthorizedBodyKey: "detail",
  forwardBody: "json",
  errorBody: "detail",
};

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { runId } = await params;
  return proxyToBackend(request, `/api/v1/execution/runs/${runId}`, OPTIONS);
}

export async function PUT(request: NextRequest, { params }: Context) {
  const { runId } = await params;
  const isComplete = new URL(request.url).pathname.endsWith("/complete");
  const backendPath = isComplete
    ? `/api/v1/execution/runs/${runId}/complete`
    : `/api/v1/execution/runs/${runId}`;
  return proxyToBackend(request, backendPath, OPTIONS);
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const { runId } = await params;
  return proxyToBackend(request, `/api/v1/execution/runs/${runId}`, OPTIONS);
}
