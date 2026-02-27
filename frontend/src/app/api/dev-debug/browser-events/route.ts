/**
 * Browser Event Persistence
 *
 * Accepts batched browser events from the UI Bridge BrowserEventCapture
 * and appends them as JSONL to .dev-logs/browser-events.jsonl.
 * Dev-only — returns 404 in production.
 */

import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";

/** Path to .dev-logs directory (frontend runs from qontinui-web/frontend) */
const DEV_LOGS_DIR = join(process.cwd(), "..", "..", ".dev-logs");
const JSONL_PATH = join(DEV_LOGS_DIR, "browser-events.jsonl");

/** Cache whether directory exists to avoid repeated mkdir calls */
let dirEnsured = false;

async function ensureDir() {
  if (!dirEnsured) {
    await mkdir(DEV_LOGS_DIR, { recursive: true });
    dirEnsured = true;
  }
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  try {
    const text = await request.text();
    if (!text || text.trim() === "") {
      return NextResponse.json(
        { error: "Empty request body" },
        { status: 400 }
      );
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Ensure .dev-logs directory exists (async, cached after first call)
    await ensureDir();

    // Clear mode: truncate file on session start
    if (body.clear === true) {
      await writeFile(JSONL_PATH, "");
      return NextResponse.json({ success: true, cleared: true });
    }

    const { events } = body;
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: "Invalid or empty events array" },
        { status: 400 }
      );
    }

    // Append each event as a JSON line (async to avoid blocking event loop)
    const lines =
      events.map((e: unknown) => JSON.stringify(e)).join("\n") + "\n";
    await appendFile(JSONL_PATH, lines);

    return NextResponse.json({ success: true, written: events.length });
  } catch (error) {
    console.error("[browser-events] Failed to write:", error);
    return NextResponse.json({ error: "Failed to write" }, { status: 500 });
  }
}
