import { NextRequest } from "next/server";
import { proxyToBackend, type ProxyOptions } from "@/lib/server/proxyToBackend";

/** /api/v1/ai-tasks/[id] — proxied via `proxyToBackend`. */
const OPTIONS: ProxyOptions = {
  tokenSources: ["cookie", "header"],
  onMissingToken: "401",
  unauthorizedBodyKey: "detail",
  forwardBody: "json",
  body: "json",
  errorBody: "detail",
};

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const { id } = await params;
  return proxyToBackend(request, `/api/v1/ai-tasks/${id}`, OPTIONS);
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const { id } = await params;
  return proxyToBackend(request, `/api/v1/ai-tasks/${id}`, OPTIONS);
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const { id } = await params;
  return proxyToBackend(request, `/api/v1/ai-tasks/${id}`, {
    ...OPTIONS,
    keep204: true,
  });
}
