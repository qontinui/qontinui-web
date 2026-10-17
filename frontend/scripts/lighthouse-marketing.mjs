#!/usr/bin/env node
/**
 * Lighthouse measurement of the public marketing pages (plan
 * 2026-10-09-qontinui-marketing-studio-animated-process-explainers, Phase 4:
 * "Lighthouse performance not regressed against the recorded baseline").
 *
 *   node scripts/lighthouse-marketing.mjs --base http://127.0.0.1:3101 \
 *     --label baseline --out docs/lighthouse/baseline.json [--runs 5] [--path / --path /how-it-works]
 *
 * Run it against a PRODUCTION build (`npm run build && npx next start -p 3101`),
 * never `next dev`. For each path and each form factor (mobile = Lighthouse's
 * default throttled Moto G profile; desktop = `--preset=desktop`) it runs
 * Lighthouse `--runs` times. Each run starts a fresh headless Chrome, and the
 * script records the MEDIAN of every metric plus the per-run performance
 * scores, so one noisy run does not set the number. Chrome is `$CHROME_PATH`
 * (e.g. Playwright's chromium). The Lighthouse version is pinned below, and
 * the summary records it with the Chrome version and the commit measured.
 *
 * Full JSON reports are written next to the summary under `<out>.reports/`
 * (git-ignored); only the summary is meant to be committed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const LIGHTHOUSE = "lighthouse@13.5.0";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    label: { type: "string" },
    out: { type: "string" },
    runs: { type: "string", default: "5" },
    path: { type: "string", multiple: true },
  },
});
if (!values.base || !values.label || !values.out) {
  process.stderr.write(
    "usage: lighthouse-marketing.mjs --base <url> --label <name> --out <file.json> [--runs N] [--path P]...\n"
  );
  process.exit(2);
}
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1)
  throw new Error(`--runs must be a positive integer, got ${values.runs}`);
const paths = values.path?.length ? values.path : ["/"];
const chrome = process.env.CHROME_PATH;
if (!chrome) throw new Error("set CHROME_PATH to a Chrome/Chromium binary");

const reportsDir = `${values.out}.reports`;
mkdirSync(reportsDir, { recursive: true });

const METRICS = {
  fcp_ms: "first-contentful-paint",
  lcp_ms: "largest-contentful-paint",
  tbt_ms: "total-blocking-time",
  cls: "cumulative-layout-shift",
  speed_index_ms: "speed-index",
  tti_ms: "interactive",
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function runOnce(url, formFactor, index) {
  const slug = `${url.replace(/[^a-z0-9]+/gi, "_")}-${formFactor}-${index}`;
  const file = path.join(reportsDir, `${slug}.json`);
  const args = [
    "--yes",
    LIGHTHOUSE,
    url,
    "--output=json",
    `--output-path=${file}`,
    "--quiet",
    "--only-categories=performance,accessibility,best-practices,seo",
    "--chrome-flags=--headless=new --no-sandbox",
  ];
  if (formFactor === "desktop") args.push("--preset=desktop");
  execFileSync("npx", args, {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, CHROME_PATH: chrome },
  });
  return JSON.parse(readFileSync(file, "utf8"));
}

const results = {};
let lighthouseVersion = null;
let userAgent = null;
for (const p of paths) {
  const url = new URL(p, values.base).toString();
  results[p] = {};
  for (const formFactor of ["mobile", "desktop"]) {
    const reports = [];
    for (let i = 0; i < runs; i++) reports.push(runOnce(url, formFactor, i));
    lighthouseVersion = reports[0].lighthouseVersion;
    userAgent = reports[0].environment?.hostUserAgent ?? null;
    const errors = reports.map((r) => r.runtimeError?.code).filter(Boolean);
    if (errors.length)
      throw new Error(
        `${url} (${formFactor}): Lighthouse runtime errors ${errors.join(", ")}`
      );
    const score = (r, c) => Math.round((r.categories[c]?.score ?? NaN) * 100);
    const entry = {
      performance_median: median(reports.map((r) => score(r, "performance"))),
      performance_runs: reports.map((r) => score(r, "performance")),
      accessibility: median(reports.map((r) => score(r, "accessibility"))),
      best_practices: median(reports.map((r) => score(r, "best-practices"))),
      seo: median(reports.map((r) => score(r, "seo"))),
    };
    for (const [key, audit] of Object.entries(METRICS)) {
      const v = median(
        reports.map((r) => r.audits[audit]?.numericValue ?? NaN)
      );
      entry[key] = key === "cls" ? Number(v.toFixed(4)) : Math.round(v);
    }
    entry.total_byte_weight = Math.round(
      median(
        reports.map((r) => r.audits["total-byte-weight"]?.numericValue ?? NaN)
      )
    );
    // The LCP element of the first run, as Lighthouse 13 reports it (the
    // node item of the lcp-breakdown insight).
    const lcpNode = reports[0].audits[
      "lcp-breakdown-insight"
    ]?.details?.items?.find((item) => item.type === "node");
    entry.lcp_element = lcpNode
      ? `${lcpNode.selector} (${lcpNode.nodeLabel})`
      : null;
    results[p][formFactor] = entry;
    process.stdout.write(
      `${p} ${formFactor}: performance ${entry.performance_median} (runs ${entry.performance_runs.join(",")})\n`
    );
  }
}

let commit = null;
try {
  commit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  // not a git checkout: leave it null rather than guess
}

const summary = {
  label: values.label,
  measured_at: new Date().toISOString(),
  commit,
  base_url: values.base,
  build: "production (npm run build && next start)",
  lighthouse: lighthouseVersion,
  chrome_user_agent: userAgent,
  runs_per_form_factor: runs,
  method:
    "scripts/lighthouse-marketing.mjs: median of N fresh-Chrome runs per path and form factor; mobile = Lighthouse default (simulated throttling), desktop = --preset=desktop",
  results,
};
writeFileSync(values.out, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`wrote ${values.out}\n`);
