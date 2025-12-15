import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

async function proxyToBackend(
  request: NextRequest,
  params: Promise<{ projectId: string }>
): Promise<NextResponse> {
  const { projectId } = await params;
  const cookieStore = await cookies();
  const accessTokenCookie = cookieStore.get("access_token");

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (accessTokenCookie?.value) {
    headers["Authorization"] = `Bearer ${accessTokenCookie.value}`;
  }

  const url = new URL(request.url);
  const backendUrl = `${BACKEND_URL}/api/v1/projects/${projectId}/extractions${url.search}`;

  const fetchOptions: RequestInit = {
    method: request.method,
    headers,
  };

  // Include body for POST, PUT, PATCH
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    fetchOptions.body = await request.text();
  }

  const response = await fetch(backendUrl, fetchOptions);

  // For 204 No Content, return empty response
  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }

  const data = await response.text();

  return new NextResponse(data, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") || "application/json",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  return proxyToBackend(request, context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  return proxyToBackend(request, context.params);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
): Promise<NextResponse> {
  return proxyToBackend(request, context.params);
}
