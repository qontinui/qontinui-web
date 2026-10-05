import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/server/proxyToBackend";

/** POST /api/v1/users/me/automation-streaming/toggle — proxied via `proxyToBackend`. */
export async function POST(request: NextRequest) {
  return proxyToBackend(
    request,
    "/api/v1/users/me/automation-streaming/toggle",
    {
      tokenSources: ["cookie", "header"],
      onMissingToken: "401",
      unauthorizedBodyKey: "error",
      forwardBody: "json",
      body: "json",
      errorBody: "details",
    }
  );
}
