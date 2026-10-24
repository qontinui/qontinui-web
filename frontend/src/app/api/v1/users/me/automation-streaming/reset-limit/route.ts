import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** POST /api/v1/users/me/automation-streaming/reset-limit — proxied via `proxyToBackend`. */
export async function POST(request: NextRequest) {
  return proxyToBackend(
    request,
    "/api/v1/users/me/automation-streaming/reset-limit",
    {
      tokenSources: ["cookie", "header"],
      onMissingToken: "401",
      unauthorizedBodyKey: "error",
      errorBody: "details",
    }
  );
}
