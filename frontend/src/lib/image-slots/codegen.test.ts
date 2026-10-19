import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";
import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  REGISTRY_PATH,
  SPEC_DIR,
  SpecSourceError,
  compileAuthoredSvg,
  lucideComponentExports,
  renderSpecRegistry as render,
  specContentSha256,
  type SpecSource,
} from "./codegen";
import { DIGITAL_SOURCE_TYPE, SVG_NS } from "./svg-allowlist";

const parse = (text: string) =>
  new DOMParser().parseFromString(text, "image/svg+xml");
const LUCIDE_EXPORTS = lucideComponentExports(lucide);
const EMPTY_MANIFEST = { generated_by: "qontinui-studio", slots: {} };
const renderSpecRegistry = (
  sources: readonly SpecSource[],
  manifest: unknown = EMPTY_MANIFEST
) => render(sources, { parse, manifest, lucideExports: LUCIDE_EXPORTS });

const FRONTEND = path.resolve(__dirname, "../../..");

const MINIMAL = (slot: string, extra = "") =>
  `slot: ${slot}\nrole: feature\n${extra}`;

describe("specs.generated.ts", () => {
  it("is what the committed specs compile to (run `npm run image-slots:generate`)", () => {
    const dir = path.join(FRONTEND, SPEC_DIR);
    const sources = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".yaml") || name.endsWith(".svg"))
      .map((name) => ({
        name,
        text: fs.readFileSync(path.join(dir, name), "utf8"),
      }));
    expect(sources.length).toBeGreaterThan(0);
    const committed = fs.readFileSync(
      path.join(FRONTEND, REGISTRY_PATH),
      "utf8"
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(FRONTEND, "public/image-slots/studio-manifest.json"),
        "utf8"
      )
    );
    expect(committed).toBe(renderSpecRegistry(sources, manifest));
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

describe("specContentSha256", () => {
  const dir = path.join(FRONTEND, "test-fixtures/image-slots/schemas-golden");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"));

  it("has golden vectors to check against", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  // qontinui-schemas rust/tests/fixtures/image_slot/valid/: each pins the
  // hash Rust's ImageSlotSpec::content_sha256 computes, on a header line.
  it.each(files)("matches the hash Rust pinned on %s", (file) => {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const pinned = /^# content-sha256: ([0-9a-f]{64})$/m.exec(text)?.[1];
    expect(pinned).toBeDefined();
    const spec = parseYaml(text, { version: "1.2" }) as Record<string, unknown>;
    expect(specContentSha256(spec)).toBe(pinned);
  });
});

describe("authored inline SVGs", () => {
  const SPEC = MINIMAL("a", "text_in_image: {kind: forbidden}\n");
  const spec = parseYaml(SPEC, { version: "1.2" }) as Record<string, unknown>;
  const HASH = specContentSha256(spec);
  const MARKER =
    '<metadata><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}"/>` +
    "</rdf:RDF></x:xmpmeta></metadata>";
  const svg = (hash: string, marker = MARKER) =>
    `<?xml version="1.0"?>\n<svg xmlns="${SVG_NS}" viewBox="0 0 4 3" data-slot-spec-sha256="${hash}">${marker}<!-- a note --><path d="M0 0 L4 3" stroke="currentColor" fill="none"/></svg>\n`;

  it("compiles a current one, re-serialised from the parsed tree", () => {
    const out = compileAuthoredSvg("a.svg", svg(HASH), spec, parse);
    expect(out.status).toBe("current");
    expect(out.markup).toBe(
      `<svg xmlns="${SVG_NS}" viewBox="0 0 4 3" data-slot-spec-sha256="${HASH}">` +
        '<metadata><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}"></rdf:Description>` +
        "</rdf:RDF></x:xmpmeta></metadata>" +
        '<path d="M0 0 L4 3" stroke="currentColor" fill="none"></path></svg>'
    );
  });

  it("calls one drawn for another spec version stale", () => {
    expect(
      compileAuthoredSvg("a.svg", svg("0".repeat(64)), spec, parse).status
    ).toBe("stale");
    const noHash = svg(HASH).replace(` data-slot-spec-sha256="${HASH}"`, "");
    expect(compileAuthoredSvg("a.svg", noHash, spec, parse).status).toBe(
      "stale"
    );
  });

  it("calls one without the IPTC marker unmarked, and invents none", () => {
    const out = compileAuthoredSvg("a.svg", svg(HASH, ""), spec, parse);
    expect(out.status).toBe("unmarked");
    expect(out.markup).not.toContain("metadata");
  });

  it("puts the compiled record in the registry", () => {
    const text = renderSpecRegistry([
      { name: "a.yaml", text: SPEC },
      { name: "a.svg", text: svg(HASH) },
    ]);
    const record = compileAuthoredSvg("a.svg", svg(HASH), spec, parse);
    expect(text).toContain(`"a": ${JSON.stringify(record)},`);
  });

  it("emits an empty map when no slot is authored", () => {
    expect(
      renderSpecRegistry([{ name: "a.yaml", text: MINIMAL("a") }])
    ).toContain(
      "IMAGE_SLOT_AUTHORED_SVG: Readonly<Record<string, AuthoredSvg>> = {};"
    );
  });

  it("refuses an SVG no spec declares", () => {
    expect(() =>
      renderSpecRegistry([
        { name: "a.yaml", text: MINIMAL("a") },
        { name: "b.svg", text: svg(HASH) },
      ])
    ).toThrow(/no b\.yaml declares this slot/);
  });

  it("refuses one the allowlist refuses, naming the file", () => {
    expect(() =>
      renderSpecRegistry([
        { name: "a.yaml", text: SPEC },
        {
          name: "a.svg",
          text: svg(HASH).replace("<path", '<path onclick="x()"'),
        },
      ])
    ).toThrow(
      /a\.svg: is rendered inline and is refused: <path> attribute onclick/
    );
  });
});

describe("lucide components", () => {
  const lucideEntry = (component: string) => ({
    route: "lucide",
    files: {},
    sha256: {},
    lucide: { package: "lucide-react", icon: "x", component },
  });
  const manifest = (...components: string[]) => ({
    generated_by: "qontinui-studio",
    slots: Object.fromEntries(
      components.map((c, i) => [`s.${i}`, lucideEntry(c)])
    ),
  });

  it("reads the installed lucide-react's icon components, not its helpers", () => {
    expect(LUCIDE_EXPORTS.has("CircleUser")).toBe(true);
    expect(LUCIDE_EXPORTS.has("Inbox")).toBe(true);
    for (const helper of ["Icon", "icons", "createLucideIcon", "DynamicIcon"]) {
      expect(LUCIDE_EXPORTS.has(helper)).toBe(false);
    }
  });

  it("imports exactly the components the manifest names, once, sorted", () => {
    const text = renderSpecRegistry(
      [{ name: "a.yaml", text: MINIMAL("a") }],
      manifest("Inbox", "CircleUser", "Inbox")
    );
    expect(text).toContain('import { CircleUser, Inbox } from "lucide-react";');
    expect(text).toContain(
      "IMAGE_SLOT_LUCIDE: Readonly<Record<string, LucideIcon>> = { CircleUser, Inbox };"
    );
  });

  it("leaves out a component the installed lucide-react does not export", () => {
    const text = renderSpecRegistry(
      [{ name: "a.yaml", text: MINIMAL("a") }],
      manifest("NotAnIcon", "Inbox")
    );
    expect(text).toContain("= { Inbox };");
    expect(text).not.toContain("NotAnIcon");
  });

  it("imports nothing when no entry is a lucide one", () => {
    const text = renderSpecRegistry([{ name: "a.yaml", text: MINIMAL("a") }]);
    expect(text).toContain(
      "IMAGE_SLOT_LUCIDE: Readonly<Record<string, LucideIcon>> = {};"
    );
    expect(text).not.toMatch(/^import \{ .* \} from "lucide-react";$/m);
  });
});
