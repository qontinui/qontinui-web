#!/usr/bin/env tsx

/**
 * Regenerate `src/lib/image-slots/specs.generated.ts` from
 * `image-slots/*.yaml` and `image-slots/*.svg`.
 *
 *   npm run image-slots:generate
 *
 * Run it after adding or editing a slot spec or an authored SVG, and commit
 * the result. `src/lib/image-slots/codegen.test.ts` fails `npm test` (and so
 * Frontend CI) on any drift between the sources and the committed module.
 * The compiler itself is `src/lib/image-slots/codegen.ts`; this file is only
 * its I/O, plus the XML parser it checks authored SVGs with (jsdom's
 * `DOMParser`; `.mjs` because jsdom ships no type declarations).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";

import {
  REGISTRY_PATH,
  SPEC_DIR,
  renderSpecRegistry,
} from "../src/lib/image-slots/codegen.ts";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const specDir = path.join(frontend, SPEC_DIR);
const sources = fs
  .readdirSync(specDir)
  .filter((name) => name.endsWith(".yaml") || name.endsWith(".svg"))
  .sort()
  .map((name) => ({
    name,
    text: fs.readFileSync(path.join(specDir, name), "utf8"),
  }));

const { DOMParser } = new JSDOM("").window;
const parse = (text) => new DOMParser().parseFromString(text, "image/svg+xml");

const output = path.join(frontend, REGISTRY_PATH);
fs.writeFileSync(output, renderSpecRegistry(sources, parse));
process.stdout.write(
  `wrote ${REGISTRY_PATH} (${sources.length} slot source file(s))\n`
);
