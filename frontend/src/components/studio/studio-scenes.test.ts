/**
 * The vendored studio scene package and its public copies (see
 * frontend/vendor/README.md). Fails when the tarball no longer matches its
 * pin, when public/studio/ drifts from the tarball's own files, or when a scene
 * the site shows is not what the page claims it is (plan D2: illustrative).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { FACTORY_SCENES, HERO_SCENE, posterSrc } from "./scenes";

const FRONTEND = join(__dirname, "../../..");
const PACKAGE = join(FRONTEND, "node_modules/@qontinui/studio-scenes");
const pin = JSON.parse(
  readFileSync(join(FRONTEND, "vendor/studio-scenes.pin.json"), "utf8")
) as { tarball: string; sha256: string };
const sha256Of = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const sha256 = (file: string) => sha256Of(readFileSync(file));

/** The regular files in an npm tarball (ustar), by path under `package/`. */
function tarballFiles(file: string): Map<string, Buffer> {
  const tar = gunzipSync(readFileSync(file));
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
    if (!name) break;
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/s, "");
    const size = parseInt(header.toString("utf8", 124, 136).trim() || "0", 8);
    const type = header.toString("utf8", 156, 157);
    const path = prefix ? `${prefix}/${name}` : name;
    if (type === "0" || type === "\0") {
      files.set(
        path.replace(/^package\//, ""),
        tar.subarray(offset + 512, offset + 512 + size)
      );
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

describe("vendored @qontinui/studio-scenes", () => {
  it("is the tarball the pin names", () => {
    expect(sha256(join(FRONTEND, "vendor", pin.tarball))).toBe(pin.sha256);
  });

  it("is installed from that tarball", () => {
    const lock = JSON.parse(
      readFileSync(join(FRONTEND, "package-lock.json"), "utf8")
    ) as { packages: Record<string, { resolved?: string }> };
    expect(
      lock.packages["node_modules/@qontinui/studio-scenes"]?.resolved
    ).toBe(`file:vendor/${pin.tarball}`);
  });

  it.each(["fonts", "posters"])(
    "public/studio/%s is a byte-identical copy of the vendored tarball's",
    (dir) => {
      const shipped = [
        ...tarballFiles(join(FRONTEND, "vendor", pin.tarball)),
      ].filter(([path]) => path.startsWith(`${dir}/`));
      const served = join(FRONTEND, "public/studio", dir);
      expect(readdirSync(served).sort()).toEqual(
        shipped.map(([path]) => path.slice(dir.length + 1)).sort()
      );
      for (const [path, bytes] of shipped) {
        expect(sha256(join(FRONTEND, "public/studio", path)), path).toBe(
          sha256Of(bytes)
        );
      }
    }
  );

  it("shows S1–S6, each illustrative, each with a served poster", () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, "manifest.json"), "utf8")
    ) as {
      scenes: Record<string, { mode: string; poster: { file: string } }>;
    };
    expect(FACTORY_SCENES.map((s) => s.id)).toEqual([
      "s1-plan-lifecycle",
      "s2-digital-twin",
      "s3-gates-continuations",
      "s4-merge-train",
      "s5-fleet",
      "s6-self-correction",
    ]);
    expect(HERO_SCENE.id).toBe("s1-plan-lifecycle");
    for (const scene of FACTORY_SCENES) {
      const entry = manifest.scenes[scene.id];
      expect(entry, scene.id).toBeDefined();
      expect(entry!.mode).toBe(scene.mode);
      expect(posterSrc(scene.id)).toBe(`/studio/${entry!.poster.file}`);
    }
  });
});
