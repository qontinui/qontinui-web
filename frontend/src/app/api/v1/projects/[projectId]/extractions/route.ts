import { NextRequest, NextResponse } from "next/server";
import { proxyToBackend, type ProxyOptions } from "@/lib/server/proxyToBackend";

/** /api/v1/projects/[projectId]/extractions — proxied via `proxyToBackend`. */
const OPTIONS: ProxyOptions = {
  tokenSources: ["cookie"],
  onMissingToken: "forward",
  forwardBody: "text",
  query: "raw",
  body: "passthrough",
  errorBody: "throw",
};

type Context = { params: Promise<{ projectId: string }> };

export async function GET(
  request: NextRequest,
  { params }: Context
): Promise<NextResponse> {
  const { projectId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/projects/${projectId}/extractions`,
    OPTIONS
  );
}

export async function POST(
  request: NextRequest,
  { params }: Context
): Promise<NextResponse> {
  const { projectId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/projects/${projectId}/extractions`,
    OPTIONS
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: Context
): Promise<NextResponse> {
  const { projectId } = await params;
  return proxyToBackend(
    request,
    `/api/v1/projects/${projectId}/extractions`,
    OPTIONS
  );
}
