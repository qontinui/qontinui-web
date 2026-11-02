/**
 * appRoutes — which app route each page module serves, read from the source
 * tree (plan `2026-10-23-console-presentation-spaces` D3).
 *
 * One reading, three readers: the readiness reporter in vitest's main process
 * (`readinessReporter.ts`, which names each ready route's page to the test
 * workers), and the readiness test and its layout checks
 * (`presentationReadiness.test.ts`). It imports nothing but Node, so the
 * vitest config can bundle it.
 */

import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

function filesNamed(name: string, dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) filesNamed(name, path, out);
    else if (entry === name) out.push(path);
  }
  return out;
}

/** Every file named `name` under `dir`, at any depth. */
export function appFilesNamed(name: string, dir: string): string[] {
  return filesNamed(name, dir);
}

/**
 * The route an app file (a `page.tsx` or a `layout.tsx`) serves: its directory
 * under `appDir`, with route groups — `(app)` — dropped.
 */
export function routeOfAppFile(appDir: string, file: string): string {
  const segments = relative(appDir, dirname(file))
    .split(sep)
    .filter((s) => s && !/^\(.*\)$/.test(s));
  return `/${segments.join("/")}`;
}

/** Each app route's page module, `src/`-relative and without its extension. */
export function appPageModules(srcDir: string): ReadonlyMap<string, string> {
  const appDir = join(srcDir, "app");
  return new Map(
    filesNamed("page.tsx", appDir).map((page) => [
      routeOfAppFile(appDir, page),
      relative(srcDir, page)
        .split(sep)
        .join("/")
        .replace(/\.tsx$/, ""),
    ])
  );
}
