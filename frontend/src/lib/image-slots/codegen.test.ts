import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  REGISTRY_PATH,
  SPEC_DIR,
  SpecSourceError,
  renderSpecRegistry,
} from "./codegen";

const FRONTEND = path.resolve(__dirname, "../../..");

const MINIMAL = (slot: string, extra = "") =>
  `slot: ${slot}\nrole: feature\n${extra}`;

describe("specs.generated.ts", () => {
  it("is what the committed specs compile to (run `npm run image-slots:generate`)", () => {
    const dir = path.join(FRONTEND, SPEC_DIR);
    const sources = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => ({
        name,
        text: fs.readFileSync(path.join(dir, name), "utf8"),
      }));
    expect(sources.length).toBeGreaterThan(0);
    const committed = fs.readFileSync(
      path.join(FRONTEND, REGISTRY_PATH),
      "utf8"
    );
    expect(committed).toBe(renderSpecRegistry(sources));
  });
});

describe("renderSpecRegistry", () => {
  it("keys the registry by slot, sorted, whatever the file order", () => {
    const text = renderSpecRegistry([
      { name: "b.yaml", text: MINIMAL("b") },
      { name: "a.yaml", text: MINIMAL("a") },
    ]);
    expect(text.indexOf('"a": {')).toBeLessThan(text.indexOf('"b": {'));
    expect(text).toContain("} satisfies Record<string, ImageSlotSpec>;");
  });

  it("reads YAML 1.2: `yes` is a string and `4/3` is not arithmetic", () => {
    const text = renderSpecRegistry([
      {
        name: "a.yaml",
        text: MINIMAL("a", "job: yes\naspect: {preferred: 4/3, allowed: []}\n"),
      },
    ]);
    expect(text).toContain('"job": "yes"');
    expect(text).toContain('"preferred": "4/3"');
  });

  it("refuses a file not named after its slot", () => {
    expect(() =>
      renderSpecRegistry([{ name: "a.yaml", text: MINIMAL("b") }])
    ).toThrow(SpecSourceError);
  });

  it("refuses a duplicate key", () => {
    expect(() =>
      renderSpecRegistry([{ name: "a.yaml", text: "slot: a\nslot: a\n" }])
    ).toThrow(/not valid YAML 1.2/);
  });

  it("refuses a document that is not a mapping", () => {
    expect(() =>
      renderSpecRegistry([{ name: "a.yaml", text: "- a\n" }])
    ).toThrow(/one YAML mapping/);
  });

  it("refuses a file that is not <slot>.yaml", () => {
    expect(() =>
      renderSpecRegistry([{ name: "a.yml", text: MINIMAL("a") }])
    ).toThrow(/named <slot>\.yaml/);
  });
});
