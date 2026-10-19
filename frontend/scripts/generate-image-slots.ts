#!/usr/bin/env tsx

/**
 * Regenerate `src/lib/image-slots/specs.generated.ts` from
 * `image-slots/*.yaml`.
 *
 *   npm run image-slots:generate
 *
 * Run it after adding or editing a slot spec and commit the result.
 * `src/lib/image-slots/codegen.test.ts` fails `npm test` (and so Frontend CI)
 * on any drift between the specs and the committed module. The compiler
 * itself is `src/lib/image-slots/codegen.ts`; this file is only its I/O.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  REGISTRY_PATH,
  SPEC_DIR,
  renderSpecRegistry,
} from "../src/lib/image-slots/codegen";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const specDir = path.join(frontend, SPEC_DIR);
const sources = fs
  .readdirSync(specDir)
  .filter((name) => name.endsWith(".yaml"))
  .sort()
  .map((name) => ({
    name,
    text: fs.readFileSync(path.join(specDir, name), "utf8"),
  }));

const output = path.join(frontend, REGISTRY_PATH);
fs.writeFileSync(output, renderSpecRegistry(sources));
process.stdout.write(
  `wrote ${REGISTRY_PATH} (${sources.length} slot spec(s))\n`
);
