import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** GET /api/v1/users/me/connection-info — proxied via `proxyToBackend`. */
export async function GET(request: NextRequest) {
  return proxyToBackend(request, "/api/v1/users/me/connection-info", {
    tokenSources: ["cookie", "header"],
    onMissingToken: "401",
    unauthorizedBodyKey: "error",
    errorBody: "details",
  });
}
