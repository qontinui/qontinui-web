import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createLogger } from "@/lib/logger";

const log = createLogger("RAGDashboardRoute");

/**
 * GET /api/v1/projects/[projectId]/rag/dashboard
 *
 * Proxies RAG dashboard requests to backend with proper cookie-based authentication.
 * This route handler reads the access_token from HttpOnly cookie and forwards it
 * as a Bearer token to the backend.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  // Get access token from cookie
  const cookieStore = await cookies();
  const accessTokenCookie = cookieStore.get("access_token");

  // Fallback to Authorization header
  let accessToken: string | null = accessTokenCookie?.value || null;
  if (!accessToken) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      accessToken = authHeader.substring(7);
    }
  }

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const backendUrl =
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000";
  const targetUrl = `${backendUrl}/api/v1/projects/${projectId}/rag/dashboard`;

  log.debug("Proxying to backend");

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[RAG Dashboard Route] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch RAG dashboard" },
      { status: 500 }
    );
  }
}
