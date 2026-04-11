/**
 * Static grounding-data capture pipeline.
 *
 * Navigates qontinui-web component routes at multiple viewport sizes,
 * captures screenshots, extracts element bounding boxes via
 * getBoundingClientRect(), and writes GroundingRecord JSONL for
 * grounding-model fine-tuning.
 *
 * Run:
 *   npx playwright test scripts/capture-grounding-data.ts \
 *     --config=playwright.grounding.config.ts
 *
 * Output:  QONTINUI_EXPORT_DIR  (default: ./dataset)
 */

import { test } from "@playwright/test";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OUTPUT_DIR = process.env.QONTINUI_EXPORT_DIR || path.resolve("dataset");
const IMAGES_DIR = path.join(OUTPUT_DIR, "images");
const JSONL_PATH = path.join(OUTPUT_DIR, "grounding.jsonl");

const ROUTES = ["/dev/grounding", "/visual"];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
];

/** Tags that never contain meaningful interactive elements. */
const SKIP_TAGS = new Set([
  "HTML",
  "HEAD",
  "BODY",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "META",
  "LINK",
  "BR",
  "HR",
]);

// ---------------------------------------------------------------------------
// Types (mirror GroundingRecord from Python schema)
// ---------------------------------------------------------------------------

interface GroundingElement {
  role: string;
  text: string | null;
  bbox: [number, number, number, number]; // x, y, w, h
}

interface GroundingRecord {
  image_hash: string;
  image_path: string;
  viewport_width: number;
  viewport_height: number;
  elements: GroundingElement[];
  source: "static";
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256_16(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function ensureDirs() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

const seenHashes = new Set<string>();

function writeRecord(record: GroundingRecord) {
  const line = JSON.stringify(record);
  fs.appendFileSync(JSONL_PATH, line + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Element extraction (runs in the browser via page.evaluate)
// ---------------------------------------------------------------------------

type ExtractedElement = {
  role: string;
  text: string | null;
  bbox: [number, number, number, number];
};

const INTERACTIVE_TAGS: Record<string, string> = {
  BUTTON: "button",
  INPUT: "textbox",
  TEXTAREA: "textarea",
  SELECT: "combobox",
  A: "link",
  LABEL: "label",
  IMG: "image",
  VIDEO: "video",
  AUDIO: "audio",
  DETAILS: "group",
  SUMMARY: "button",
};

async function extractElements(
  page: import("@playwright/test").Page,
  vpWidth: number,
  vpHeight: number,
): Promise<ExtractedElement[]> {
  return page.evaluate(
    ({ skipTags, interactiveTags, vpW, vpH }) => {
      const results: ExtractedElement[] = [];
      const skipSet = new Set(skipTags);
      const els = document.querySelectorAll("*");

      for (const el of els) {
        const tag = el.tagName;
        if (skipSet.has(tag)) continue;

        const htmlEl = el as HTMLElement;
        // Only visible elements
        if (htmlEl.offsetWidth === 0 || htmlEl.offsetHeight === 0) continue;

        const rect = el.getBoundingClientRect();

        // Clip to viewport
        const x = Math.max(0, Math.round(rect.x));
        const y = Math.max(0, Math.round(rect.y));
        const w = Math.min(Math.round(rect.width), vpW - x);
        const h = Math.min(Math.round(rect.height), vpH - y);
        if (w <= 0 || h <= 0) continue;

        // Determine role: explicit role attr wins, then tag mapping, then tag name
        const explicitRole = el.getAttribute("role");
        const role =
          explicitRole ||
          interactiveTags[tag] ||
          tag.toLowerCase();

        // Text: direct text content, trimmed, capped
        const text =
          htmlEl.textContent?.trim().slice(0, 200) || null;

        results.push({ role, text, bbox: [x, y, w, h] });
      }

      return results;
    },
    {
      skipTags: [...SKIP_TAGS],
      interactiveTags: INTERACTIVE_TAGS,
      vpW: vpWidth,
      vpH: vpHeight,
    },
  );
}

// ---------------------------------------------------------------------------
// Test (Playwright entry point)
// ---------------------------------------------------------------------------

test.describe("Grounding data capture", () => {
  test.beforeAll(() => {
    ensureDirs();
  });

  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`capture ${route} @ ${vp.width}x${vp.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(vp);
        await page.goto(route, { waitUntil: "networkidle" });

        // Wait a beat for any animations to settle
        await page.waitForTimeout(500);

        // Capture screenshot
        const screenshotBuf = await page.screenshot({ fullPage: false });
        const hash = sha256_16(screenshotBuf);

        // Dedup
        if (seenHashes.has(hash)) {
          return;
        }
        seenHashes.add(hash);

        // Save image
        const imagePath = path.join("images", `${hash}.png`);
        const imageAbsPath = path.join(OUTPUT_DIR, imagePath);
        if (!fs.existsSync(imageAbsPath)) {
          fs.writeFileSync(imageAbsPath, screenshotBuf);
        }

        // Extract elements
        const elements = await extractElements(page, vp.width, vp.height);

        // Write record
        const record: GroundingRecord = {
          image_hash: hash,
          image_path: imagePath,
          viewport_width: vp.width,
          viewport_height: vp.height,
          elements,
          source: "static",
          timestamp: new Date().toISOString(),
        };

        writeRecord(record);
      });
    }
  }
});
