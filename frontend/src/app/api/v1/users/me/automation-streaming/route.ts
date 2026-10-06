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
  let backendPath = "/api/v1/users/me/automation-streaming";
  if (request.url.includes("/toggle")) backendPath += "/toggle";
  else if (request.url.includes("/reset-limit")) backendPath += "/reset-limit";
  return proxyToBackend(request, backendPath, {
    ...OPTIONS,
    errorBody: { error: "Failed to proxy request to backend" },
  });
}
