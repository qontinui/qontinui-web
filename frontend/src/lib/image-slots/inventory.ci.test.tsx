/**
 * The image-slot inventory over THIS app: every declared slot, what it renders
 * where it is placed, and any defect in the inventory's inputs.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14 step 4. Runs
 * in every `npm test`, where only a DEFECT fails it. Frontend CI also runs it
 * alone as `npm run image-slots:inventory` with `IMAGE_SLOT_INVENTORY_REPORT=1`,
 * which writes the listing to the job's step summary and one `::notice` per
 * placement still shipping a placeholder. A placeholder is a finding, never a
 * failure.
 */

import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlotImage } from "@/components/image-slot/SlotImage";
import {
  buildInventory,
  findPlacements,
  renderAnnotations,
  renderMarkdown,
  type SlotPlacement,
} from "./inventory";
import { SLOT_MANIFEST } from "./manifest";
import { IMAGE_SLOT_SPECS, type ImageSlotId } from "./specs.generated";

const FRONTEND = path.resolve(__dirname, "../../..");

/** Every shipped `.tsx` under `src/`: tests and test helpers are not
 *  placements. */
function shippedSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : shippedSources(full);
    }
    return entry.name.endsWith(".tsx") &&
      !/\.(test|spec)\.tsx$/.test(entry.name)
      ? [full]
      : [];
  });
}

function realInventory() {
  const placements: SlotPlacement[] = shippedSources(
    path.join(FRONTEND, "src")
  ).flatMap((file) =>
    findPlacements(
      path.relative(FRONTEND, file).split(path.sep).join("/"),
      fs.readFileSync(file, "utf8")
    )
  );
  const publishDir = path.join(FRONTEND, "public", "image-slots");
  return buildInventory({
    specs: IMAGE_SLOT_SPECS,
    manifest: SLOT_MANIFEST,
    placements,
    publishedFiles: new Set(fs.readdirSync(publishDir)),
    render: (slot) =>
      renderToStaticMarkup(<SlotImage slot={slot as ImageSlotId} />),
  });
}

describe("image-slot inventory of this app", () => {
  const inventory = realInventory();

  it("finds no defect in its inputs", () => {
    expect(inventory.defects).toEqual([]);
  });

  it("lists every declared slot", () => {
    expect(inventory.rows.map((row) => row.slot)).toEqual(
      Object.keys(IMAGE_SLOT_SPECS).sort()
    );
    // An empty registry would make every other assertion here vacuous.
    expect(inventory.rows.length).toBeGreaterThan(0);
  });

  it("finds the placements the app ships", () => {
    expect(
      inventory.rows.flatMap((row) => row.placements).length
    ).toBeGreaterThan(0);
  });

  it("reports the listing when CI asks for it", () => {
    const markdown = renderMarkdown(inventory);
    expect(markdown).toContain(
      "| Slot | Role | Renders | Reason | Placed at |"
    );
    if (process.env.IMAGE_SLOT_INVENTORY_REPORT !== "1") {
      return;
    }
    process.stdout.write(`${markdown}\n`);
    for (const line of renderAnnotations(inventory)) {
      process.stdout.write(`${line}\n`);
    }
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      fs.appendFileSync(summary, markdown);
    }
  });
});
