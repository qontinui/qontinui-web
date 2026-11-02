import { NextRequest } from "next/server";
import { proxyToBackend, type ProxyOptions } from "@/lib/server/proxyToBackend";

/** /api/v1/execution/runs/[runId] — proxied via `proxyToBackend`. */
const OPTIONS: ProxyOptions = {
  tokenSources: ["cookie", "header"],
  onMissingToken: "401",
  unauthorizedBodyKey: "detail",
  errorBody: "detail",
};

type Context = { params: Promise<{ runId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { runId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/execution/runs/${encodeURIComponent(runId)}`,
    OPTIONS
  );
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const { runId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/execution/runs/${encodeURIComponent(runId)}`,
    OPTIONS
  );
}
