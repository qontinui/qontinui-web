import { NextRequest } from "next/server";
import { proxyToBackend, type ProxyOptions } from "@/lib/server/proxyToBackend";

/** /api/v1/execution/runs — proxied via `proxyToBackend`. */
const OPTIONS: ProxyOptions = {
  tokenSources: ["cookie", "header"],
  onMissingToken: "401",
  unauthorizedBodyKey: "detail",
  forwardBody: "json",
  query: "reencoded",
  errorBody: "detail",
};

export async function GET(request: NextRequest) {
  return proxyToBackend(request, "/api/v1/execution/runs", OPTIONS);
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request, "/api/v1/execution/runs", {
    ...OPTIONS,
    query: "drop",
  });
}
