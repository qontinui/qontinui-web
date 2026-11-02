#!/usr/bin/env node
/**
 * Docs-to-code reference checker.
 *
 * Scans the developer docs (`docs/**`, `frontend/docs/**`,
 * `frontend/public/docs/**`, relative to the repo root) and reports, per
 * file:line, every reference the docs make to code that does not exist:
 *
 *   unresolved-module  an `@/…` import in a code fence that resolves to no
 *                      module under frontend/src
 *   missing-export     an `@/…` import of a name the module does not export
 *   missing-member     `<binding>.<member>(` in a code fence, where the binding
 *                      was imported from an `@/…` module and the export has no
 *                      such member (class / instance methods and properties,
 *                      inherited ones included; object-literal keys)
 *   unresolved-shape   as above, but the export's shape could not be
 *                      determined — never counted as a pass
 *   missing-symbol     a PascalCase or `useX` name in backticks in
 *                      architecture-doc prose that nothing in frontend/src
 *                      exports (string-literal union members and backend
 *                      `class` names are also accepted, since those docs
 *                      describe both tiers)
 *   dead-link          a relative link to a `.md` file in this repo that does
 *                      not exist, or to an `#anchor` whose heading does not
 *                      exist
 *
 * Calls on un-imported `xService` / `xManager` / `xAnalyzer` singletons are
 * resolved against the imports other docs make, then against frontend/src
 * exports; a name found in neither is reported as unresolved-module.
 *
 * Imports are scoped per doc file: a binding imported in one fence is
 * checked in every later fence of the same file.
 *
 * Parsing is textual (no TypeScript compiler); it is deliberately simple and
 * reports what it cannot settle as unresolved-shape rather than passing it.
 *
 * What a 0 does NOT mean: the check is about NAMES, not accuracy. It does
 * not check relative or package imports, members of destructured hook
 * results, argument or property shapes, or prose outside the two
 * architecture dirs. A local binding is checked only when its type can be
 * read (an import, `new X(...)`, `X.getInstance()`, or a `getX()` whose
 * declared return type resolves); any other local, and any undeclared name
 * not spelled `xService` / `xManager` / `xAnalyzer`, is not checked. A doc can
 * pass and still be wrong about how a real API behaves.
 *
 * Exit: 0 nothing unresolved, 1 something unresolved, 2 internal error.
 * Run: `npm run check:doc-refs` from frontend/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const REPO = path.resolve(FRONTEND, "..");
const SRC = path.join(FRONTEND, "src");

const DOC_ROOTS = ["docs", "frontend/docs", "frontend/public/docs"];
const PROSE_SYMBOL_DIRS = [
  "docs/architecture",
  "frontend/public/docs/architecture",
];
const MODULE_EXTS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs"];
const CATEGORIES = [
  "unresolved-module",
  "missing-export",
  "missing-member",
  "unresolved-shape",
  "missing-symbol",
  "dead-link",
];

const findings = [];
function report(category, file, line, message) {
  findings.push({ category, file: path.relative(REPO, file), line, message });
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function* walk(dir, accept) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, accept);
    else if (accept(entry.name)) yield full;
  }
}

const textCache = new Map();
function readText(file) {
  if (!textCache.has(file)) textCache.set(file, fs.readFileSync(file, "utf8"));
  return textCache.get(file);
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve `@/x` or a relative specifier to a source file, or null. */
function resolveModule(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".") && fromFile)
    base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  if (isFile(base)) return base;
  for (const ext of MODULE_EXTS) if (isFile(base + ext)) return base + ext;
  for (const ext of MODULE_EXTS) {
    const idx = path.join(base, "index" + ext);
    if (isFile(idx)) return idx;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Light JS/TS scanning: comments, strings, balanced brackets
// ---------------------------------------------------------------------------

const OPEN = { "{": "}", "(": ")", "[": "]" };

/** Index just past the string/template literal that starts at i. */
function skipString(text, i) {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (quote === "`" && c === "$" && text[i + 1] === "{") {
      i = scanBalanced(text, i + 1).end;
      continue;
    }
    if (quote !== "`" && c === "\n") return i;
    i++;
  }
  return i;
}

/**
 * From an opening bracket at `start`, return the index just past its match and
 * the "flat" body: the characters at nesting depth 1 only (nested brackets are
 * kept as empty pairs, strings as ""), which is enough to read member lists.
 */
function scanBalanced(text, start) {
  const stack = [OPEN[text[start]]];
  let flat = "";
  let i = start + 1;
  while (i < text.length && stack.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const endC = text.indexOf("*/", i + 2);
      i = endC === -1 ? text.length : endC + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      if (stack.length === 1) flat += '""';
      continue;
    }
    if (OPEN[c]) {
      if (stack.length === 1) flat += c + OPEN[c];
      stack.push(OPEN[c]);
    } else if (c === stack[stack.length - 1]) {
      stack.pop();
    } else if (stack.length === 1) {
      flat += c;
    }
    i++;
  }
  return { end: i, flat };
}

/** Replace comments with spaces (newlines kept) so regexes skip them. */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const endC = text.indexOf("*/", i + 2);
      const stop = endC === -1 ? text.length : endC + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const stop = skipString(text, i);
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const codeCache = new Map();
function code(file) {
  if (!codeCache.has(file)) codeCache.set(file, stripComments(readText(file)));
  return codeCache.get(file);
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

const DECL_RE =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function\*?|class|type|interface|enum|namespace)\s+([\w$]+)/g;

/** Parse `a, b as c, type d` into [{local, exported}]. */
function parseSpecifierList(list) {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
      return m ? { local: m[1], exported: m[2] || m[1] } : null;
    })
    .filter(Boolean);
}

const exportsCache = new Map();
/** Map of exported name -> { file, local, from? } for one module. */
function moduleExports(file, seen = new Set()) {
  if (exportsCache.has(file)) return exportsCache.get(file);
  if (seen.has(file)) return new Map();
  seen.add(file);
  const text = code(file);
  const out = new Map();
  for (const m of text.matchAll(DECL_RE)) {
    // `export default function X` exports "default", not a named `X`.
    if (/\bdefault\b/.test(m[0])) continue;
    out.set(m[1], { file, local: m[1] });
  }
  if (/\bexport\s+default\b/.test(text)) {
    const d = text.match(
      /\bexport\s+default\s+(?:class|function\*?)?\s*([\w$]+)?/
    );
    out.set("default", {
      file,
      local: d && d[1] ? d[1] : null,
      isDefault: true,
    });
  }
  for (const m of text.matchAll(
    /\bexport\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g
  )) {
    for (const s of parseSpecifierList(m[1])) {
      out.set(s.exported, { file, local: s.local, from: m[2] || null });
    }
  }
  for (const m of text.matchAll(
    /\bexport\s+\*\s+as\s+([\w$]+)\s+from\s*["']([^"']+)["']/g
  )) {
    out.set(m[1], { file, namespace: m[2] });
  }
  for (const m of text.matchAll(/\bexport\s+\*\s+from\s*["']([^"']+)["']/g)) {
    const target = resolveModule(m[1], file);
    if (!target) continue;
    for (const [name, info] of moduleExports(target, seen)) {
      if (name !== "default" && !out.has(name)) out.set(name, info);
    }
  }
  exportsCache.set(file, out);
  return out;
}

// ---------------------------------------------------------------------------
// Shapes: members of a class / interface / object literal / instance
// ---------------------------------------------------------------------------

const MEMBER_LINE_RE =
  /^\s*(?:@[\w.]+(?:\(\))?\s*)*((?:(?:public|private|protected|static|readonly|async|override|abstract|declare|get|set|accessor)\s+)*)\*?\s*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*[(<:=;]/;

function classLikeMembers(flat) {
  const members = new Set();
  for (const line of flat.split(/[\n;]|\}(?=\s)/)) {
    const m = line.match(MEMBER_LINE_RE);
    if (!m) continue;
    if (
      /\bprivate\b/.test(m[1]) ||
      m[2].startsWith("#") ||
      m[2] === "constructor"
    )
      continue;
    members.add(m[2]);
  }
  return members;
}

function objectLiteralMembers(flat) {
  const members = new Set();
  let open = false;
  for (const part of flat.split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p.startsWith("...")) {
      open = true;
      continue;
    }
    const m = p.match(
      /^(?:async\s+)?(?:get\s+|set\s+)?\*?\s*([\w$]+|"[^"]*"|'[^']*')\s*(?:[:(]|$)/
    );
    if (m) members.add(m[1].replace(/^["']|["']$/g, ""));
  }
  return { members, open };
}

/** Find a top-level declaration of `name` visible in `file` (local, re-exported or imported). */
function findDeclaration(file, name, depth = 0) {
  if (depth > 8 || !file) return null;
  const text = code(file);
  const decl = new RegExp(
    String.raw`(?:^|[\s;])(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+|async\s+)?(class|interface|const|let|var|function)\s+` +
      name.replace(/\$/g, "\\$") +
      String.raw`\b`,
    "m"
  );
  const m = decl.exec(text);
  if (m) return { file, kind: m[1], index: m.index + m[0].length };
  const exp = moduleExports(file).get(name);
  if (exp && exp.file !== file)
    return findDeclaration(exp.file, exp.local || name, depth + 1);
  if (exp && exp.from)
    return findDeclaration(resolveModule(exp.from, file), exp.local, depth + 1);
  for (const im of text.matchAll(
    /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
  )) {
    const s = parseSpecifierList(im[1]).find((x) => x.exported === name);
    if (s)
      return findDeclaration(resolveModule(im[2], file), s.local, depth + 1);
  }
  return null;
}

/** Members of a class or interface declaration (with `extends` followed). */
function typeMembers(decl, depth = 0) {
  if (!decl || depth > 8) return null;
  const text = code(decl.file);
  const brace = text.indexOf("{", decl.index);
  if (brace === -1) return null;
  const header = text.slice(decl.index, brace);
  const { flat } = scanBalanced(text, brace);
  const members = classLikeMembers(flat);
  const ext = header.match(
    /\bextends\s+([\w$.]+(?:<[^{]*?>)?(?:\s*,\s*[\w$.]+(?:<[^{]*?>)?)*)/
  );
  if (ext) {
    for (const parent of ext[1]
      .split(",")
      .map((s) => s.trim().replace(/<.*$/, ""))) {
      const parentMembers = typeMembers(
        findDeclaration(decl.file, parent),
        depth + 1
      );
      if (!parentMembers) return null; // inherited members unknown
      for (const x of parentMembers) members.add(x);
    }
  }
  return members;
}

/** The declared type of property `prop` in a class/interface body, as a declaration. */
function propertyTypeDecl(decl, prop) {
  if (!decl) return null;
  const text = code(decl.file);
  const brace = text.indexOf("{", decl.index);
  if (brace === -1) return null;
  const { flat } = scanBalanced(text, brace);
  const m = flat.match(
    new RegExp(
      String.raw`(?:^|[\s;])` + prop + String.raw`\s*[?!]?\s*:\s*([\w$]+)`,
      "m"
    )
  );
  return m ? findDeclaration(decl.file, m[1]) : null;
}

/**
 * The class/interface declaration describing the value bound to `name` in
 * `file`, or { members } for an object literal, or null when undeterminable.
 * Handles classes, interfaces, `new X(...)`, `X.getInstance()`, a `: Type`
 * annotation, `obj.prop` (via the property's declared type), and object
 * literals.
 */
function valueShape(file, name, depth = 0, called = false) {
  if (depth > 8) return null;
  const decl = findDeclaration(file, name);
  if (!decl) return null;
  const text = code(decl.file);
  if (decl.kind === "function") {
    // Only the value a call returns has a shape we can name: `fn(): Type`.
    if (!called) return null;
    const paren = text.indexOf("(", decl.index);
    if (paren === -1) return null;
    const ret = text
      .slice(scanBalanced(text, paren).end)
      .match(/^\s*:\s*([\w$]+)\s*\{/);
    return ret ? findDeclaration(decl.file, ret[1]) : null;
  }
  if (decl.kind === "class" || decl.kind === "interface") return decl;
  const rest = text.slice(decl.index);
  const annotated = rest.match(/^\s*:\s*([\w$]+)\s*=/);
  if (annotated) return findDeclaration(decl.file, annotated[1]);
  const init = rest.match(/^\s*=\s*/);
  if (!init) return null;
  const at = decl.index + init[0].length;
  const expr = text.slice(at, at + 200);
  let m =
    expr.match(/^new\s+([\w$]+)/) || expr.match(/^([\w$]+)\.getInstance\s*\(/);
  if (m) return findDeclaration(decl.file, m[1]);
  m = expr.match(/^([\w$]+)\.([\w$]+)\s*;/);
  if (m) return propertyTypeDecl(valueShape(decl.file, m[1], depth + 1), m[2]);
  if (expr.startsWith("{")) {
    const { members, open } = objectLiteralMembers(scanBalanced(text, at).flat);
    return open ? null : { members };
  }
  return null;
}

/** Members of an exported value (or of what calling it returns), or null when undeterminable. */
function valueMembers(file, name, called = false) {
  const shape = valueShape(file, name, 0, called);
  if (!shape) return null;
  return shape.members || typeMembers(shape);
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

/** Split a markdown file into fences (with start line) and prose lines. */
function parseMarkdown(text) {
  const lines = text.split("\n");
  const fences = [];
  const prose = []; // [lineNo, text]
  let fence = null;
  lines.forEach((line, idx) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.char &&
        marker[1].length >= fence.len &&
        !line.trim().slice(marker[1].length).trim()
      ) {
        fences.push(fence);
        fence = null;
      } else fence.lines.push(line);
      return;
    }
    if (marker) {
      fence = {
        char: marker[1][0],
        len: marker[1].length,
        start: idx + 2,
        lines: [],
      };
      return;
    }
    prose.push([idx + 1, line]);
  });
  if (fence) fences.push(fence);
  return { fences, prose };
}

/** GitHub-style heading slug. */
function slugify(heading) {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/ /g, "-");
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const anchors = new Set();
  const counts = new Map();
  for (const [, line] of parseMarkdown(readText(file)).prose) {
    const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (h) {
      const base = slugify(h[1]);
      const n = counts.get(base) || 0;
      anchors.add(n ? `${base}-${n}` : base);
      counts.set(base, n + 1);
    }
    for (const a of line.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/g))
      anchors.add(a[1]);
  }
  anchorCache.set(file, anchors);
  return anchors;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const IMPORT_RE =
  /\bimport\s+(?:type\s+)?([\w$]+\s*,?\s*)?(\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s*["'](@\/[^"']+)["']/g;

function lineAt(textBlock, index, startLine) {
  return startLine + textBlock.slice(0, index).split("\n").length - 1;
}

/**
 * Pass 1 for one doc: its `@/…` imports. Reports unresolved modules and
 * missing exports; returns local name -> binding. A binding whose import is
 * broken is kept as { phantom } so calls on it are not mistaken for passes.
 */
function collectImports(file, fences, reportIt) {
  const bindings = new Map();
  for (const fence of fences) {
    const body = fence.lines.join("\n");
    for (const m of body.matchAll(IMPORT_RE)) {
      const line = lineAt(body, m.index, fence.start);
      const spec = m[3];
      const wanted = [];
      if (m[1])
        wanted.push({ local: m[1].replace(/[\s,]/g, ""), exported: "default" });
      if (m[2] && m[2].startsWith("{")) {
        for (const s of parseSpecifierList(m[2].slice(1, -1)))
          wanted.push({ local: s.exported, exported: s.local });
      }
      const target = resolveModule(spec, null);
      if (!target) {
        if (reportIt)
          report(
            "unresolved-module",
            file,
            line,
            `import from "${spec}" resolves to no module under frontend/src`
          );
        for (const w of wanted)
          bindings.set(w.local, { phantom: `"${spec}" does not exist`, spec });
        continue;
      }
      if (m[2] && m[2].startsWith("*")) {
        bindings.set(m[2].split(/\s+/).pop(), {
          module: target,
          namespace: true,
          spec,
        });
      }
      const exported = moduleExports(target);
      for (const w of wanted) {
        if (!exported.has(w.exported)) {
          const what =
            w.exported === "default" ? "a default" : `"${w.exported}"`;
          if (reportIt)
            report(
              "missing-export",
              file,
              line,
              `"${spec}" does not export ${what}`
            );
          bindings.set(w.local, {
            phantom: `"${spec}" does not export ${what}`,
            spec,
          });
          continue;
        }
        bindings.set(w.local, { module: target, exported: w.exported, spec });
      }
    }
  }
  return bindings;
}

const label = (b) => (b.called ? `${b.exported}()` : b.exported);

/** Members available on a binding, or null when the shape is undeterminable. */
function bindingMembers(b) {
  if (b.namespace) return new Set(moduleExports(b.module).keys());
  const info = moduleExports(b.module).get(b.exported);
  if (info && info.namespace) {
    return new Set(
      moduleExports(resolveModule(info.namespace, info.file) || b.module).keys()
    );
  }
  return valueMembers(
    b.module,
    info && info.local ? info.local : b.exported,
    Boolean(b.called)
  );
}

// Un-imported `xService.foo(` style singletons are resolved too: snippets
// routinely call a service without repeating its import.
const SINGLETON_RE =
  /(?<![\w$.])([a-z][A-Za-z0-9]*(?:Service|Manager|Analyzer))\s*\??\.\s*([\w$]+)\s*\(/g;

/** Pass 2: every `<binding>.<member>(` call in the doc's fences. */
function checkMemberCalls(file, fences, importedBindings, docsBindings) {
  const allCode = fences.map((f) => f.lines.join("\n")).join("\n");
  const declared = new Set(
    [...allCode.matchAll(/\b(?:const|let|var|function|class)\s+([\w$]+)/g)].map(
      (m) => m[1]
    )
  );
  // Bindings declared IN the docs (`const x = getX()`, `new X(...)`,
  // `X.getInstance()`) are scoped: they take effect from the fence that
  // declares them until the name is declared again, so two unrelated `ws`
  // in different fences are never confused.
  const localBindings = new Map(importedBindings);
  const resolveName = (name) =>
    localBindings.get(name) || docsBindings.get(name) || srcBinding(name);
  /** The binding a declaration's initialiser yields, or null if unknown. */
  const deriveBinding = (init) => {
    let m = init.match(/^(?:await\s+)?([\w$]+)\s*\(\s*\)/);
    if (m) {
      // `getX()`: checked against the type getX is declared to return, and
      // only when that shape resolves (a derived binding is a bonus check).
      const fn = resolveName(m[1]);
      if (!fn || fn.phantom || fn.namespace || fn.called) return null;
      const derived = { ...fn, called: true };
      return bindingMembers(derived) ? derived : null;
    }
    m =
      init.match(/^(?:await\s+)?new\s+([\w$]+)\s*\(/) ||
      init.match(/^(?:await\s+)?([\w$]+)\.getInstance\s*\(\s*\)/);
    if (m) {
      // An instance of an imported (or src-exported) class.
      const cls = resolveName(m[1]);
      if (!cls || cls.phantom || cls.namespace) return null;
      return bindingMembers(cls) ? { ...cls } : null;
    }
    return null;
  };
  for (const fence of fences) {
    const body = fence.lines.join("\n");
    for (const d of body.matchAll(
      /\b(?:const|let|var)\s+([\w$]+)\s*=\s*([^\n;]*)/g
    )) {
      const derived = deriveBinding(d[2].trim());
      if (derived) {
        localBindings.set(d[1], derived);
        declared.delete(d[1]);
      } else {
        // Re-declared as something we cannot type: stop checking the name.
        localBindings.delete(d[1]);
      }
    }
    const seen = new Set();
    const check = (local, b, member, index) => {
      if (seen.has(index)) return;
      seen.add(index);
      const line = lineAt(body, index, fence.start);
      if (b.phantom) {
        report(
          "missing-export",
          file,
          line,
          `${local}.${member}() — ${b.phantom}`
        );
        return;
      }
      const members = bindingMembers(b);
      if (!members) {
        report(
          "unresolved-shape",
          file,
          line,
          `cannot determine the shape of "${label(b)}" from "${b.spec}" to check .${member}()`
        );
      } else if (!members.has(member)) {
        report(
          "missing-member",
          file,
          line,
          `${local}.${member}() — "${label(b)}" from "${b.spec}" has no member "${member}"`
        );
      }
    };
    for (const [local, b] of localBindings) {
      const callRe = new RegExp(
        String.raw`(?<![\w$.])` +
          local.replace(/\$/g, "\\$") +
          String.raw`\s*\??\.\s*([\w$]+)\s*\(`,
        "g"
      );
      for (const c of body.matchAll(callRe)) check(local, b, c[1], c.index);
    }
    // `X.getInstance().member(`: checked against X's members.
    for (const c of body.matchAll(
      /(?<![\w$.])([\w$]+)\.getInstance\s*\(\s*\)\s*\??\.\s*([\w$]+)\s*\(/g
    )) {
      const b =
        localBindings.get(c[1]) || docsBindings.get(c[1]) || srcBinding(c[1]);
      if (b && !b.phantom && !b.namespace) check(c[1], b, c[2], c.index + 1);
    }
    for (const c of body.matchAll(SINGLETON_RE)) {
      const local = c[1];
      if (localBindings.has(local) || declared.has(local)) continue;
      const b = docsBindings.get(local) || srcBinding(local);
      if (b) check(local, b, c[2], c.index);
      else {
        report(
          "unresolved-module",
          file,
          lineAt(body, c.index, fence.start),
          `"${local}" is used but is neither imported nor exported anywhere in frontend/src`
        );
      }
    }
  }
}

let symbolIndex = null;
const srcExporters = new Map(); // exported name -> first module exporting it
/** Names exported anywhere in frontend/src, names it imports from packages, and backend classes. */
function knownSymbols() {
  if (symbolIndex) return symbolIndex;
  symbolIndex = new Set();
  for (const file of [...walk(SRC, (n) => /\.(tsx?|jsx?)$/.test(n))].sort()) {
    for (const name of moduleExports(file).keys()) {
      symbolIndex.add(name);
      if (!srcExporters.has(name)) srcExporters.set(name, file);
    }
    // String-literal union members (`| "KeepLocal"`) name real values too.
    for (const m of code(file).matchAll(/[|=]\s*["']([A-Z][A-Za-z0-9]*)["']/g))
      symbolIndex.add(m[1]);
    for (const m of code(file).matchAll(
      /\bimport\s+(?:type\s+)?([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"'.@][^"']*|@[^/"'][^"']*)["']/g
    )) {
      if (m[1]) symbolIndex.add(m[1]);
      if (m[2])
        for (const s of parseSpecifierList(m[2])) symbolIndex.add(s.exported);
    }
  }
  for (const file of walk(path.join(REPO, "backend"), (n) =>
    n.endsWith(".py")
  )) {
    for (const m of readText(file).matchAll(/^class\s+([\w]+)/gm))
      symbolIndex.add(m[1]);
  }
  return symbolIndex;
}

/** A binding for a name exported somewhere in frontend/src, or null. */
function srcBinding(name) {
  knownSymbols();
  const file = srcExporters.get(name);
  if (!file) return null;
  return {
    module: file,
    exported: name,
    spec:
      "@/" +
      path
        .relative(SRC, file)
        .replace(/\\/g, "/")
        .replace(/(\/index)?\.(tsx?|jsx?)$/, ""),
  };
}

const PROSE_SYMBOL_RE =
  /`<?\s*([A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|use[A-Z][A-Za-z0-9]*)\s*(?:\/?>|\([^`]*\))?`/g;

function checkProseSymbols(file, prose) {
  const known = knownSymbols();
  for (const [lineNo, line] of prose) {
    for (const m of line.matchAll(PROSE_SYMBOL_RE)) {
      if (!known.has(m[1])) {
        report(
          "missing-symbol",
          file,
          lineNo,
          `\`${m[1]}\` is not exported anywhere in frontend/src`
        );
      }
    }
  }
}

function checkLinks(file, prose) {
  for (const [lineNo, rawLine] of prose) {
    const line = rawLine.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(
      /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
    )) {
      const href = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) continue;
      const [target, anchor] = href.split("#");
      let targetFile = file;
      if (target) {
        targetFile = path.resolve(
          path.dirname(file),
          decodeURIComponent(target)
        );
        // Only links between markdown files inside this repo are checked;
        // source-file and cross-repo links are out of scope.
        if (
          !targetFile.endsWith(".md") ||
          path.relative(REPO, targetFile).startsWith("..")
        )
          continue;
        if (!fs.existsSync(targetFile)) {
          report(
            "dead-link",
            file,
            lineNo,
            `link target "${target}" does not exist`
          );
          continue;
        }
      }
      if (
        anchor !== undefined &&
        anchor !== "" &&
        !anchorsOf(targetFile).has(decodeURIComponent(anchor).toLowerCase())
      ) {
        report(
          "dead-link",
          file,
          lineNo,
          `anchor "#${anchor}" has no heading in ${path.relative(REPO, targetFile)}`
        );
      }
    }
  }
}

function main() {
  const docs = DOC_ROOTS.flatMap((root) => [
    ...walk(path.join(REPO, root), (n) => n.endsWith(".md")),
  ]).sort();
  const proseDirs = PROSE_SYMBOL_DIRS.map((d) => path.join(REPO, d));
  const parsed = new Map(
    docs.map((file) => [file, parseMarkdown(readText(file))])
  );
  const docsBindings = new Map(); // every `@/…` import any doc makes
  for (const [file, { fences }] of parsed) {
    for (const [name, b] of collectImports(file, fences, false)) {
      if (
        !docsBindings.has(name) ||
        (docsBindings.get(name).phantom && !b.phantom)
      )
        docsBindings.set(name, b);
    }
  }
  for (const [file, { fences, prose }] of parsed) {
    checkMemberCalls(
      file,
      fences,
      collectImports(file, fences, true),
      docsBindings
    );
    checkLinks(file, prose);
    if (proseDirs.includes(path.dirname(file))) checkProseSymbols(file, prose);
  }

  const out = [];
  for (const f of findings)
    out.push(`${f.file}:${f.line}: [${f.category}] ${f.message}`);
  if (findings.length) out.push("");
  out.push(
    `Scanned ${docs.length} markdown files under ${DOC_ROOTS.join(", ")}.`
  );
  for (const c of CATEGORIES)
    out.push(
      `  ${c.padEnd(18)} ${findings.filter((f) => f.category === c).length}`
    );
  out.push(`  ${"TOTAL".padEnd(18)} ${findings.length}`);
  process.stdout.write(out.join("\n") + "\n");
  return findings.length ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(
    `check-doc-code-refs: internal error: ${err && err.stack ? err.stack : err}\n`
  );
  process.exitCode = 2;
}
