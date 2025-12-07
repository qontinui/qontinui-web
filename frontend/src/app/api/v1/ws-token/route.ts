import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * GET /api/v1/ws-token
 *
 * Returns the access token from HttpOnly cookies for WebSocket authentication.
 * WebSocket connections can't send HttpOnly cookies cross-origin, so this endpoint
 * allows the frontend to retrieve the token and pass it as a query parameter.
 *
 * Security: This endpoint requires the request to have the access_token cookie,
 * so it can only be called by authenticated users.
 */
export async function GET(_request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const accessTokenCookie = cookieStore.get("access_token");

    if (!accessTokenCookie?.value) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Return the token for WebSocket authentication
    return NextResponse.json({
      token: accessTokenCookie.value,
    });
  } catch (error) {
    console.error("[WS-Token API Route] ERROR:", error);
    return NextResponse.json(
      { error: "Failed to get WebSocket token" },
      { status: 500 }
    );
  }
}
