/**
 * GET /api/vga/corrections/stats
 *
 * Summarize the corrections JSONL without loading it all into memory.
 * Returns:
 *   {
 *     totalCorrections: number,
 *     sinceV5: number,               // currently === totalCorrections
 *     perTargetProcess: Record<string, number>,
 *     samplesReadyForV6: {
 *       triggered: boolean,
 *       perDomainCounts: Record<string, number>,
 *       aggregateCount: number
 *     }
 *   }
 *
 * v6-ready gate (plan §13): any single `target_process` ≥ 200
 * corrections OR aggregate ≥ 500.
 */

import { existsSync, createReadStream } from "node:fs";
import readline from "node:readline";

import { NextResponse } from "next/server";

import { jsonlPath as getJsonlPath } from "@/lib/vga/corrections-dir";

const PER_DOMAIN_THRESHOLD = 200;
const AGGREGATE_THRESHOLD = 500;

export async function GET() {
  const jsonlPath = getJsonlPath();
  const perTargetProcess: Record<string, number> = {};
  let totalCorrections = 0;

  if (existsSync(jsonlPath)) {
    const rl = readline.createInterface({
      input: createReadStream(jsonlPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (line.length === 0) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof entry !== "object" || entry === null) continue;
      totalCorrections += 1;
      const tp =
        typeof (entry as { target_process?: unknown }).target_process ===
        "string"
          ? (entry as { target_process: string }).target_process
          : "unknown";
      perTargetProcess[tp] = (perTargetProcess[tp] ?? 0) + 1;
    }
  }

  const maxPerDomain = Object.values(perTargetProcess).reduce(
    (max, v) => Math.max(max, v),
    0
  );
  const triggered =
    maxPerDomain >= PER_DOMAIN_THRESHOLD ||
    totalCorrections >= AGGREGATE_THRESHOLD;

  return NextResponse.json({
    totalCorrections,
    sinceV5: totalCorrections,
    perTargetProcess,
    samplesReadyForV6: {
      triggered,
      perDomainCounts: perTargetProcess,
      aggregateCount: totalCorrections,
    },
  });
}
