import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createLogger } from "@/lib/logger";

const log = createLogger("AutomationStreamingRoute");

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const accessTokenCookie = cookieStore.get("access_token");
    const authorizationHeader = request.headers.get("Authorization");

    let accessToken: string | null = null;
    if (accessTokenCookie?.value) {
      accessToken = accessTokenCookie.value;
    } else if (authorizationHeader?.startsWith("Bearer ")) {
      accessToken = authorizationHeader.substring(7);
    }

    if (!accessToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const backendBaseUrl =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000";
    const backendUrl = `${backendBaseUrl}/api/v1/users/me/automation-streaming`;

    log.debug("Proxying GET to backend");

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
    console.error("[AutomationStreamingRoute] GET error:", error);
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

export async function POST(request: NextRequest) {
  try {
    // Get the access token from cookie (preferred) or Authorization header (fallback)
    const cookieStore = await cookies();
    const accessTokenCookie = cookieStore.get("access_token");
    const authorizationHeader = request.headers.get("Authorization");

    // Use cookie token or extract from Authorization header
    let accessToken: string | null = null;
    if (accessTokenCookie?.value) {
      accessToken = accessTokenCookie.value;
    } else if (authorizationHeader?.startsWith("Bearer ")) {
      accessToken = authorizationHeader.substring(7);
    }

    if (!accessToken) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the request body
    const body = await request.json();

    // Determine which backend endpoint to call based on the URL
    const backendBaseUrl =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000";
    let backendUrl = `${backendBaseUrl}/api/v1/users/me/automation-streaming`;

    // Check if this is a toggle or reset-limit request
    if (request.url.includes("/toggle")) {
      backendUrl += "/toggle";
    } else if (request.url.includes("/reset-limit")) {
      backendUrl += "/reset-limit";
    }

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("Error proxying to backend:", error);
    return NextResponse.json(
      { error: "Failed to proxy request to backend" },
      { status: 500 }
    );
  }
}
