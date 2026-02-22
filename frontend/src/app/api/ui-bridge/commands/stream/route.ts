/**
 * UI Bridge Command Stream (Server-Sent Events)
 *
 * Replaces the polling-based command delivery with event-driven push.
 * The browser connects via EventSource and receives commands instantly
 * when they are queued by external clients.
 */

import { type NextRequest } from "next/server";
import { subscribeToCommands } from "@/lib/ui-bridge/handlers";

// Heartbeat interval to keep the connection alive (30 seconds)
const HEARTBEAT_INTERVAL_MS = 30000;

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const tabId = request.nextUrl.searchParams.get("tabId") ?? undefined;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event (include tabId so client can confirm)
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", tabId, timestamp: Date.now() })}\n\n`
        )
      );

      // Subscribe to new commands — auto-unsubscribe if stream is dead
      let unsubscribed = false;
      const unsubscribe = subscribeToCommands((command) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(command)}\n\n`)
          );
        } catch {
          // Stream closed — self-clean since abort handler may not fire
          if (!unsubscribed) {
            unsubscribed = true;
            unsubscribe();
            clearInterval(heartbeat);
            console.log(
              "[ui-bridge] SSE listener self-cleaned (stream closed)"
            );
          }
        }
      }, tabId);

      // Heartbeat to keep the connection alive and detect dead connections
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Stream closed — self-clean
          clearInterval(heartbeat);
          if (!unsubscribed) {
            unsubscribed = true;
            unsubscribe();
            console.log(
              "[ui-bridge] SSE listener self-cleaned (heartbeat failed)"
            );
          }
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Clean up when the client disconnects
      request.signal.addEventListener("abort", () => {
        if (!unsubscribed) {
          unsubscribed = true;
          unsubscribe();
          clearInterval(heartbeat);
        }
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
