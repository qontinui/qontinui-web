import { NextRequest } from "next/server";
import { proxyToBackend, type ProxyOptions } from "@/lib/server/proxyToBackend";

/** /api/v1/users/me/automation-streaming — proxied via `proxyToBackend`. */
const OPTIONS: ProxyOptions = {
  tokenSources: ["cookie", "header"],
  onMissingToken: "401",
  unauthorizedBodyKey: "error",
  forwardBody: "json",
  errorBody: "details",
};

export async function GET(request: NextRequest) {
  return proxyToBackend(
    request,
    "/api/v1/users/me/automation-streaming",
    OPTIONS
  );
}

export async function POST(request: NextRequest) {
  return proxyToBackend(request, "/api/v1/users/me/automation-streaming", {
    ...OPTIONS,
    errorBody: { error: "Failed to proxy request to backend" },
  });
}
