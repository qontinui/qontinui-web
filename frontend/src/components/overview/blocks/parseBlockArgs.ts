/**
 * A live block's arguments, read from its fence (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D2).
 *
 * Two places carry them:
 *
 * - the fence's info-string META, after the block's name — space-separated
 *   `key=value` pairs, plus at most one bare value for a block that names a
 *   positional key (Phase 9's ` ```overview-kpi forecast-finish `,
 *   ` ```overview-risks top=5 `);
 * - `key: value` lines in the fence BODY, one per line; blank lines are
 *   skipped.
 *
 * A body line wins over the meta for the same key, so a writer can override
 * the one-line form without rewriting it.
 *
 * The grammar is a small strict parser, deliberately not YAML: a key is
 * `[a-z][a-z0-9-]*`; a value is a bare token (letters and digits of any
 * script, `.`, `_` and `-`) or a double-quoted string (`\"` and `\\` are its
 * only escapes). Anything else — an unknown key, a key given twice in one
 * place, a stray token, a line that is not `key: value` — is an error that
 * names what failed, so a block never renders silently wrong. No value is
 * ever read as a URL, HTML or script here; what a value may BE is each
 * block's own schema (`registry.ts`).
 */

/** Where an argument came from, for the error a writer reads. */
export type ArgSource = "meta" | "body";

export interface BlockArgsError {
  /** The key that failed, when the failure belongs to one. */
  key: string | null;
  /** A plain sentence saying what is wrong. */
  message: string;
}

export type ParsedBlockArgs =
  | { ok: true; args: Record<string, string> }
  | { ok: false; error: BlockArgsError };

export interface BlockArgsSpec {
  /** Every key the block accepts. Any other key is an error. */
  keys: readonly string[];
  /** The key a bare value in the meta is read as, when the block has one. */
  positional?: string;
}

const KEY = /^[a-z][a-z0-9-]*$/;
/** A bare value: letters and digits of any script, then `.`, `_` or `-`. */
const BARE = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

type Token =
  | { kind: "value"; value: string }
  | { kind: "pair"; key: string; value: string };

/** A double-quoted string starting at `text[start]`: its value and the index
 *  just past its closing quote, or `null` when it is not well formed. */
function readQuoted(
  text: string,
  start: number
): { value: string; end: number } | null {
  let value = "";
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') return { value, end: i + 1 };
    if (ch === "\n" || ch === "\r") return null;
    if (ch === "\\") {
      const next = text[i + 1];
      if (next !== '"' && next !== "\\") return null;
      value += next;
      i += 1;
      continue;
    }
    value += ch;
  }
  return null;
}

/** One value — bare or quoted — that must make up the whole of `text`. */
function readValue(text: string): string | null {
  if (text.startsWith('"')) {
    const quoted = readQuoted(text, 0);
    return quoted && quoted.end === text.length ? quoted.value : null;
  }
  return BARE.test(text) ? text : null;
}

/** Split the meta into tokens, keeping a quoted value (spaces and all) whole. */
function tokenizeMeta(meta: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < meta.length) {
    if (/\s/.test(meta[i]!)) {
      i += 1;
      continue;
    }
    let token = "";
    while (i < meta.length && !/\s/.test(meta[i]!)) {
      if (meta[i] === '"') {
        const quoted = readQuoted(meta, i);
        if (!quoted) return null;
        token += meta.slice(i, quoted.end);
        i = quoted.end;
      } else {
        token += meta[i];
        i += 1;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

function metaToken(raw: string): Token | null {
  const eq = raw.indexOf("=");
  // A quoted bare value may itself hold an `=`; only an `=` before any quote
  // separates a key.
  const quote = raw.indexOf('"');
  if (eq > 0 && (quote === -1 || eq < quote)) {
    const key = raw.slice(0, eq);
    const value = readValue(raw.slice(eq + 1));
    if (!KEY.test(key) || value === null) return null;
    return { kind: "pair", key, value };
  }
  const value = readValue(raw);
  return value === null ? null : { kind: "value", value };
}

function quote(text: string): string {
  return `\`${text}\``;
}

/**
 * Read a block's arguments from its fence's meta and body, against the keys
 * the block accepts. Values are returned as written; each block's schema
 * decides what they may be.
 */
export function parseBlockArgs(
  meta: string | null | undefined,
  body: string,
  spec: BlockArgsSpec
): ParsedBlockArgs {
  const allowed = new Set(spec.keys);
  const fail = (key: string | null, message: string): ParsedBlockArgs => ({
    ok: false,
    error: { key, message },
  });

  const fromMeta: Record<string, string> = {};
  const tokens = tokenizeMeta(meta ?? "");
  if (tokens === null) {
    return fail(
      null,
      "A quoted value on the block's first line is not closed."
    );
  }
  for (const raw of tokens) {
    const token = metaToken(raw);
    if (token === null) {
      return fail(
        null,
        `${quote(raw)} on the block's first line is not a setting. Write it as key=value.`
      );
    }
    let key: string;
    if (token.kind === "pair") {
      key = token.key;
    } else if (spec.positional) {
      key = spec.positional;
    } else {
      return fail(
        null,
        `${quote(token.value)} on the block's first line needs a name. Write it as key=value.`
      );
    }
    if (!allowed.has(key)) {
      return fail(key, `This block has no setting called ${quote(key)}.`);
    }
    if (key in fromMeta) {
      return fail(
        key,
        `${quote(key)} is given twice on the block's first line.`
      );
    }
    fromMeta[key] = token.value;
  }

  const fromBody: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") continue;
    const colon = text.indexOf(":");
    const key = colon > 0 ? text.slice(0, colon).trim() : "";
    if (!KEY.test(key)) {
      return fail(
        null,
        `${quote(text)} is not a setting. Write each setting on its own line as key: value.`
      );
    }
    if (!allowed.has(key)) {
      return fail(key, `This block has no setting called ${quote(key)}.`);
    }
    const value = readValue(text.slice(colon + 1).trim());
    if (value === null) {
      return fail(
        key,
        `The value of ${quote(key)} is not one word, and not a "quoted" phrase.`
      );
    }
    if (key in fromBody) {
      return fail(key, `${quote(key)} is given on more than one line.`);
    }
    fromBody[key] = value;
  }

  return { ok: true, args: { ...fromMeta, ...fromBody } };
}
