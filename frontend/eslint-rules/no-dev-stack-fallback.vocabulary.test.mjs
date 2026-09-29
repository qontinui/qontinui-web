/**
 * The rule's hard-coded port list IS the fleet-noun vocabulary — asserted.
 *
 * `no-dev-stack-fallback` cannot read `qontinui-schemas/fleet-nouns.toml` at
 * lint time, so it carries `VOCABULARY_PORTS`. This suite reads the PINNED
 * vocabulary (`../fleet-nouns.pin.toml`: a schemas commit + the file's
 * sha256) and fails unless:
 *
 *   1. the file resolves and its digest equals the pin (absent or different
 *      is a RED with the reason — never a skip: an absent vocabulary is
 *      UNKNOWN, not "no fleet nouns");
 *   2. `VOCABULARY_PORTS.dev_ports` / `.supervisor_dependency` are EXACTLY
 *      the ports the vocabulary's `dev_ports` / `supervisor_dependency`
 *      patterns match on a loopback URL (evaluated with `new RegExp(pattern)`,
 *      no flags, per the vocabulary's consumer contract);
 *   3. the web-only ports are disjoint from the vocabulary's and from every
 *      product constant;
 *   4. the rule's matcher hits every loopback-URL example of those two
 *      classes, and no look-alike or product constant.
 *
 * Resolution: $QONTINUI_FLEET_NOUNS_FILE, else
 * `<repo>/../qontinui-schemas/fleet-nouns.toml`. CI sets the variable to a
 * sparse checkout at the pinned ref (.github/actions/fleet-nouns-vocab).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VOCABULARY_PORTS,
  WEB_DEV_STACK_PORTS,
  devStackPortIn,
} from "./no-dev-stack-fallback.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const PIN_PATH = resolve(REPO_ROOT, "fleet-nouns.pin.toml");

// --- a minimal TOML reader: exactly the subset the two files use -----------
// (tables, arrays of tables, literal '...' and basic "..." strings, arrays of
// strings across lines, integers, `#` comments). Anything else throws, so a
// vocabulary shape change is a loud red here rather than a misread.

function parseToml(src) {
  const root = {};
  let table = root;
  let i = 0;
  const n = src.length;

  const skipWsComments = (allowNewlines) => {
    for (;;) {
      while (i < n && (src[i] === " " || src[i] === "\t" || (allowNewlines && (src[i] === "\n" || src[i] === "\r")))) i++;
      if (src[i] === "#") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      return;
    }
  };

  const parseValue = () => {
    const c = src[i];
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new Error(`unterminated literal string at ${i}`);
      const v = src.slice(i + 1, end);
      i = end + 1;
      return v;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      if (j >= n) throw new Error(`unterminated basic string at ${i}`);
      const v = JSON.parse(src.slice(i, j + 1));
      i = j + 1;
      return v;
    }
    if (c === "[") {
      i++;
      const arr = [];
      for (;;) {
        skipWsComments(true);
        if (src[i] === "]") {
          i++;
          return arr;
        }
        arr.push(parseValue());
        skipWsComments(true);
        if (src[i] === ",") i++;
        else if (src[i] !== "]") throw new Error(`expected , or ] at ${i}`);
      }
    }
    const m = /^-?[0-9]+/.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    throw new Error(`unsupported TOML value at ${i}: ${src.slice(i, i + 20)}`);
  };

  while (i < n) {
    skipWsComments(true);
    if (i >= n) break;
    if (src.startsWith("[[", i)) {
      const end = src.indexOf("]]", i);
      const name = src.slice(i + 2, end).trim();
      (root[name] ??= []).push((table = {}));
      i = end + 2;
    } else if (src[i] === "[") {
      const end = src.indexOf("]", i);
      const name = src.slice(i + 1, end).trim();
      table = root[name] = {};
      i = end + 1;
    } else {
      const m = /^([A-Za-z0-9_-]+)[ \t]*=[ \t]*/.exec(src.slice(i));
      if (!m) throw new Error(`unparseable TOML at ${i}: ${src.slice(i, i + 30)}`);
      i += m[0].length;
      table[m[1]] = parseValue();
    }
  }
  return root;
}

function readPin() {
  const pin = parseToml(readFileSync(PIN_PATH, "utf8")).fleet_nouns;
  if (!pin || !/^[0-9a-f]{40}$/.test(pin.ref ?? "") || !/^[0-9a-f]{64}$/.test(pin.sha256 ?? "")) {
    throw new Error(`${PIN_PATH}: [fleet_nouns] needs ref (40 hex) and sha256 (64 hex)`);
  }
  return pin;
}

function resolveVocabulary() {
  const pin = readPin();
  const fromEnv = process.env.QONTINUI_FLEET_NOUNS_FILE;
  const path = fromEnv || resolve(REPO_ROOT, "..", "qontinui-schemas", "fleet-nouns.toml");
  if (!existsSync(path)) {
    throw new Error(
      `fleet-noun vocabulary not found at ${path} (${fromEnv ? "$QONTINUI_FLEET_NOUNS_FILE" : "the default sibling path"}). ` +
        `Check out qontinui-schemas at ${pin.ref} beside this repo, or set QONTINUI_FLEET_NOUNS_FILE. ` +
        "An absent vocabulary is UNKNOWN, not 'no fleet nouns' — this is a red, never a skip.",
    );
  }
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256) {
    throw new Error(
      `${path} has sha256 ${digest}, but fleet-nouns.pin.toml pins ${pin.sha256} (schemas ${pin.ref}). ` +
        `Check out qontinui-schemas at the pinned ref, or bump the pin in a reviewed PR.`,
    );
  }
  return parseToml(bytes.toString("utf8"));
}

/** Ports whose loopback URL the class pattern matches, from the numbers in it. */
function portsMatchedBy(pattern) {
  const re = new RegExp(pattern);
  const candidates = new Set((pattern.match(/[0-9]{3,5}/g) ?? []).map(Number));
  return [...candidates]
    .filter((p) => p > 0 && p < 65536)
    .filter((p) => re.test(`http://localhost:${p}/`) && re.test(`http://127.0.0.1:${p}`))
    .sort((a, b) => a - b);
}

describe("no-dev-stack-fallback port list == pinned fleet-noun vocabulary", () => {
  const vocab = resolveVocabulary();
  const classes = Object.fromEntries((vocab.class ?? []).map((c) => [c.id, c]));

  it("the vocabulary carries both classes the rule mirrors", () => {
    expect(classes.dev_ports?.pattern).toBeTypeOf("string");
    expect(classes.supervisor_dependency?.pattern).toBeTypeOf("string");
  });

  it.each(["dev_ports", "supervisor_dependency"])(
    "VOCABULARY_PORTS.%s equals what the pinned pattern matches",
    (id) => {
      const derived = portsMatchedBy(classes[id].pattern);
      expect(derived.length).toBeGreaterThan(0); // scanned=0 is a failure
      expect([...VOCABULARY_PORTS[id]].sort((a, b) => a - b)).toEqual(derived);
    },
  );

  it("the web-only ports are not vocabulary ports and not product constants", () => {
    const vocabPorts = new Set([
      ...VOCABULARY_PORTS.dev_ports,
      ...VOCABULARY_PORTS.supervisor_dependency,
    ]);
    const constants = (vocab.product_constant ?? []).map((c) => c.value);
    for (const p of Object.keys(WEB_DEV_STACK_PORTS).map(Number)) {
      expect(vocabPorts.has(p)).toBe(false);
      for (const re of ["dev_ports", "supervisor_dependency"].map((id) => new RegExp(classes[id].pattern))) {
        expect(re.test(`http://localhost:${p}`)).toBe(false);
      }
      for (const c of constants) expect(c.includes(`:${p}`)).toBe(false);
    }
  });

  it("the rule's matcher hits every loopback example of both classes", () => {
    const loopback = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal):[0-9]/;
    const examples = ["dev_ports", "supervisor_dependency"]
      .flatMap((id) => classes[id].examples ?? [])
      .filter((e) => loopback.test(e));
    expect(examples.length).toBeGreaterThan(0);
    for (const e of examples) expect([e, devStackPortIn(e)]).not.toEqual([e, null]);
  });

  it("the rule's matcher hits no look-alike and no product constant", () => {
    const texts = [
      ...(vocab.lookalikes ?? []),
      ...(vocab.product_constant ?? []).map((c) => c.value),
    ];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect([t, devStackPortIn(t)]).toEqual([t, null]);
  });
});
