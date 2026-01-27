/**
 * UI Bridge Command Queue API
 *
 * This endpoint allows the browser to poll for pending commands
 * that need to be executed in the browser context.
 *
 * Flow:
 * 1. External client (runner/Python) calls API endpoint
 * 2. Handler queues command and waits for response
 * 3. Browser polls this endpoint for pending commands
 * 4. Browser executes command and POSTs response
 * 5. Handler resolves with response
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getPendingCommands,
  resolveCommand,
  rejectCommand,
} from "@/lib/ui-bridge/handlers";

/**
 * GET /api/ui-bridge/commands
 *
 * Poll for pending commands. The browser calls this endpoint
 * to get commands that need to be executed.
 */
export async function GET(): Promise<NextResponse> {
  const commands = getPendingCommands();

  return NextResponse.json({
    success: true,
    commands,
    timestamp: Date.now(),
  });
}

/**
 * POST /api/ui-bridge/commands
 *
 * Submit command response. The browser calls this endpoint
 * after executing a command to return the result.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { commandId, success: cmdSuccess, result, error: cmdError } = body;

    if (!commandId) {
      return NextResponse.json(
        { success: false, error: "commandId is required" },
        { status: 400 }
      );
    }

    let resolved = false;
    if (cmdSuccess) {
      resolved = resolveCommand(commandId, result);
    } else {
      resolved = rejectCommand(commandId, cmdError || "Command failed");
    }

    if (!resolved) {
      return NextResponse.json(
        {
          success: false,
          error: "Command not found or already resolved",
          commandId,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      commandId,
      timestamp: Date.now(),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: (e as Error).message },
      { status: 500 }
    );
  }
}

/**
 * Configure route segment
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
