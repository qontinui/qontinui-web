import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * API Route Handler for /api/v1/ai-tasks/[id]/findings/[findingId]
 *
 * This route reads the access token from HttpOnly cookies and forwards
 * requests to the backend with proper Bearer authentication.
 *
 * Required because Next.js rewrites don't forward cookies to the backend.
 */

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

async function getAccessToken(request: NextRequest): Promise<string | null> {
  // Get the access token from cookie (preferred) or Authorization header (fallback)
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findingId: string }> }
) {
  try {
    const accessToken = await getAccessToken(request);
    const { id, findingId } = await params;

    if (!accessToken) {
      return NextResponse.json(
        { detail: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const backendUrl = `${BACKEND_URL}/api/v1/ai-tasks/${id}/findings/${findingId}`;

    const response = await fetch(backendUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[AI Tasks Finding API Route] Error:", error);
    return NextResponse.json(
      {
        detail: "Failed to proxy request to backend",
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
