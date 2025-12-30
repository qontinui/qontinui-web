import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * API Route Handler for /api/v1/execution/runs/[runId]/tree
 *
 * This route reads the access token from HttpOnly cookies and forwards
 * requests to the backend with proper Bearer authentication.
 */

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

async function getAccessToken(request: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  const accessTokenCookie = cookieStore.get("access_token");
  const authorizationHeader = request.headers.get("Authorization");

  if (accessTokenCookie?.value) {
    return accessTokenCookie.value;
  } else if (authorizationHeader?.startsWith("Bearer ")) {
    return authorizationHeader.substring(7);
  }
  return null;
}

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const accessToken = await getAccessToken(request);
    const { runId } = await params;

    if (!accessToken) {
      return NextResponse.json(
        { detail: "Not authenticated" },
        { status: 401 }
      );
    }

    const backendUrl = `${BACKEND_URL}/api/v1/execution/runs/${runId}/tree`;

    const response = await fetch(backendUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[Execution Tree API Route] Error:", error);
    return NextResponse.json(
      {
        detail: "Failed to proxy request to backend",
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
