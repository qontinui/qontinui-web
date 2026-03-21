import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createLogger } from "@/lib/logger";

const log = createLogger("AutomationStreamingResetLimitRoute");

export async function POST(request: NextRequest) {
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
    const backendUrl = `${backendBaseUrl}/api/v1/users/me/automation-streaming/reset-limit`;

    log.debug("Proxying POST to backend");

    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[AutomationStreamingResetLimitRoute] POST error:", error);
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
