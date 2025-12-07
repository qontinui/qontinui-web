import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    console.log("[Connection-Info API Route] GET request received");

    // Get the access token from cookie (preferred) or Authorization header (fallback)
    const cookieStore = await cookies();
    const accessTokenCookie = cookieStore.get("access_token");
    const authorizationHeader = request.headers.get("Authorization");

    // Use cookie token or extract from Authorization header
    let accessToken: string | null = null;
    if (accessTokenCookie?.value) {
      accessToken = accessTokenCookie.value;
      console.log("[Connection-Info API Route] Using token from cookie");
    } else if (authorizationHeader?.startsWith("Bearer ")) {
      accessToken = authorizationHeader.substring(7);
      console.log(
        "[Connection-Info API Route] Using token from Authorization header"
      );
    }

    if (!accessToken) {
      console.error(
        "[Connection-Info API Route] No access token found in cookie or header"
      );
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Use environment variable or fall back to localhost
    const backendBaseUrl =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000";
    const backendUrl = `${backendBaseUrl}/api/v1/users/me/connection-info`;

    console.log("[Connection-Info API Route] Backend URL:", backendUrl);
    console.log(
      "[Connection-Info API Route] Attempting to fetch from backend..."
    );

    const response = await fetch(backendUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log(
      "[Connection-Info API Route] Backend response status:",
      response.status
    );
    console.log(
      "[Connection-Info API Route] Backend response ok:",
      response.ok
    );

    const data = await response.json();
    console.log("[Connection-Info API Route] Backend response data:", data);

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[Connection-Info API Route] ERROR:", error);
    console.error(
      "[Connection-Info API Route] Error name:",
      (error as Error).name
    );
    console.error(
      "[Connection-Info API Route] Error message:",
      (error as Error).message
    );

    return NextResponse.json(
      {
        error: "Failed to proxy request to backend",
        details: (error as Error).message,
        name: (error as Error).name,
      },
      { status: 500 }
    );
  }
}
