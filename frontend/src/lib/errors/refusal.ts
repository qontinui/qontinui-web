/**
 * The next-action contract, read and rendered on the web side.
 *
 * Plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * Phase D3. The envelope is the schemas `Refusal`
 * (`qontinui-schemas/rust/src/refusal.rs`, types from
 * `@qontinui/shared-types/refusal`); its human sentence is `Refusal::render()`.
 * This module is a MIRROR of that function and of the envelope's lenient
 * decoder, table for table, so the operator reads the same sentence here that
 * every other surface renders for the same refusal. The mirror is pinned by
 * `refusal.test.ts`, whose expected sentences are copied from the Rust render
 * tests and from a dump of `Refusal::render()` over every kind × target ×
 * delay shape — edit the Rust tables and this file in step, never one alone.
 *
 * Why a mirror rather than a request: the sentence has to render when the
 * producer that refused is the thing that is down, so it is computed from the
 * body in hand with no call anywhere.
 *
 * ## The two decode rules this keeps from the Rust side
 *
 * - **Lenient toward a newer producer.** A `code`, `next_action.kind`,
 *   `source` or glossary id this build does not know decodes as `unknown` /
 *   `unrecognised` with the raw string kept, never as a parse failure — a
 *   refusal that fails to parse is a refusal nobody sees. A relay from an
 *   older reader (`unknown` plus the raw string) is UPGRADED when this build
 *   knows the raw value.
 * - **Strict about the envelope's own shape.** `next_action` is required and
 *   must be an object with a string `kind`; `observed_at` and `source` are
 *   required strings; `retry_after_s` is a whole number of seconds that fits a
 *   `u32`. A body that fails any of these is not an envelope and the caller
 *   reads it the way it read every body before this contract existed.
 *   (`{code, next_action: "Set X…"}` — a string `next_action`, the shape
 *   `endpoint-unresolved.ts` answers today — is therefore NOT an envelope.)
 */

import {
  isGlossaryTerm,
  type GlossaryTerm,
} from "@qontinui/shared-types/glossary";
import type {
  NextActionKind,
  RefusalCode,
  RefusalSource,
} from "@qontinui/shared-types/refusal";

/** A kind a producer may emit (`unrecognised` is reader-side only). */
export type ProducerNextActionKind = Exclude<NextActionKind, "unrecognised">;
/** A source a producer may emit (`unrecognised` is reader-side only). */
export type ProducerRefusalSource = Exclude<RefusalSource, "unrecognised">;

/**
 * The first clause of the sentence — `RefusalCode::headline()`. A `Record`
 * over the generated union, so a code added to the schemas without a row here
 * is a type error, the same totality the Rust `match` has.
 */
const HEADLINES: Readonly<Record<RefusalCode, string>> = {
  workspace_root_unresolved:
    "No workspace folder could be found for this operation",
  sibling_checkout_absent:
    "Source code this operation depends on is not available on this machine",
  endpoint_unresolved:
    "The address of a service this operation needs is not configured",
  glossary_term_unknown: "That term is not in this version's glossary",
  unknown:
    "The request was refused for a reason this version does not recognise",
};

/** `RefusalCode::ALL`, as the keys of the headline table. */
const REFUSAL_CODES = Object.keys(HEADLINES) as RefusalCode[];

/** `NextActionKind::ALL`: every producer kind, total over the union. */
const PRODUCER_KINDS_TABLE: Readonly<Record<ProducerNextActionKind, true>> = {
  retry_later: true,
  run_command: true,
  open_page: true,
  sign_in: true,
  pair_device: true,
  set_setting: true,
  wait_for_gate: true,
  none_terminal: true,
  report_defect: true,
  fix_request: true,
  resnapshot: true,
  scroll_into_view: true,
  wait_for_enabled: true,
  broaden_selector: true,
};
const PRODUCER_KINDS = Object.keys(
  PRODUCER_KINDS_TABLE
) as ProducerNextActionKind[];

/** `RefusalSource::ALL`: every producer source, total over the union. */
const PRODUCER_SOURCES_TABLE: Readonly<Record<ProducerRefusalSource, true>> = {
  runner: true,
  coord: true,
  web_backend: true,
  web_frontend: true,
};
const PRODUCER_SOURCES = Object.keys(
  PRODUCER_SOURCES_TABLE
) as ProducerRefusalSource[];

/** The typed next step, decoded. */
export interface DecodedNextAction {
  kind: NextActionKind;
  target: string | null;
  retry_after_s: number | null;
  /** The raw `kind` when this build did not recognise it. */
  unrecognised_kind: string | null;
}

/** A refusal envelope, decoded the way the Rust reader decodes it. */
export interface DecodedRefusal {
  code: RefusalCode;
  discriminator: string | null;
  next_action: DecodedNextAction;
  glossary_terms: GlossaryTerm[];
  detail: string | null;
  observed_at: string;
  source: RefusalSource;
  unrecognised_code: string | null;
  unrecognised_source: string | null;
  unrecognised_glossary_terms: string[];
}

/** `classify` in `refusal.rs`: `[known value, raw string still unrecognised]`. */
function classify<T extends string>(
  wire: string,
  relayedRaw: string | null,
  placeholder: T,
  known: readonly T[]
): [T, string | null] {
  const fromWire = (s: string): T | null =>
    (known as readonly string[]).includes(s) ? (s as T) : null;
  if (wire === placeholder) {
    // The placeholder, possibly a relay of an older reader's classification:
    // upgrade when this build knows the relayed raw value.
    if (relayedRaw === null) return [placeholder, null];
    const upgraded = fromWire(relayedRaw);
    if (upgraded !== null && relayedRaw !== placeholder)
      return [upgraded, null];
    return [placeholder, relayedRaw];
  }
  const v = fromWire(wire);
  if (v !== null) return [v, null];
  return [placeholder, wire];
}

/** Sentinel for "the field is present but the wrong type": decode fails. */
const INVALID = Symbol("invalid");

/** serde's `Option<String>` with `#[serde(default)]`: absent or `null` is
 * `None`; anything but a string fails the decode. */
function optString(v: unknown): string | null | typeof INVALID {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : INVALID;
}

/** serde's `Option<Vec<String>>`. */
function optStringList(v: unknown): string[] | null | typeof INVALID {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return INVALID;
  return v as string[];
}

const U32_MAX = 4_294_967_295;

/** serde's `Option<u32>`. */
function optU32(v: unknown): number | null | typeof INVALID {
  if (v === undefined || v === null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= U32_MAX
    ? v
    : INVALID;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function decodeNextAction(v: unknown): DecodedNextAction | null {
  if (!isPlainObject(v) || typeof v.kind !== "string") return null;
  const target = optString(v.target);
  const retry = optU32(v.retry_after_s);
  const relayed = optString(v.unrecognised_kind);
  if (target === INVALID || retry === INVALID || relayed === INVALID) {
    return null;
  }
  const [kind, unrecognised_kind] = classify<NextActionKind>(
    v.kind,
    relayed,
    "unrecognised",
    PRODUCER_KINDS
  );
  return { kind, target, retry_after_s: retry, unrecognised_kind };
}

/**
 * The refusal envelope in `value`, or `null` when `value` is not one.
 *
 * Mirrors `impl Deserialize for Refusal` (see the module doc for which
 * failures are leniency and which are "not an envelope").
 */
export function decodeRefusal(value: unknown): DecodedRefusal | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.code !== "string") return null;
  const next_action = decodeNextAction(value.next_action);
  if (next_action === null) return null;
  if (typeof value.observed_at !== "string") return null;
  if (typeof value.source !== "string") return null;
  const discriminator = optString(value.discriminator);
  const detail = optString(value.detail);
  const relayedCode = optString(value.unrecognised_code);
  const relayedSource = optString(value.unrecognised_source);
  const terms = optStringList(value.glossary_terms);
  const relayedTerms = optStringList(value.unrecognised_glossary_terms);
  if (
    discriminator === INVALID ||
    detail === INVALID ||
    relayedCode === INVALID ||
    relayedSource === INVALID ||
    terms === INVALID ||
    relayedTerms === INVALID
  ) {
    return null;
  }
  const [code, unrecognised_code] = classify<RefusalCode>(
    value.code,
    relayedCode,
    "unknown",
    REFUSAL_CODES
  );
  const [source, unrecognised_source] = classify<RefusalSource>(
    value.source,
    relayedSource,
    "unrecognised",
    PRODUCER_SOURCES
  );
  // Relayed unrecognised ids are re-classified: this build may know them.
  const glossary_terms: GlossaryTerm[] = [];
  const unrecognised_glossary_terms: string[] = [];
  for (const id of [...(terms ?? []), ...(relayedTerms ?? [])]) {
    if (isGlossaryTerm(id)) glossary_terms.push(id);
    else unrecognised_glossary_terms.push(id);
  }
  return {
    code,
    discriminator,
    next_action,
    glossary_terms,
    detail,
    observed_at: value.observed_at,
    source,
    unrecognised_code,
    unrecognised_source,
    unrecognised_glossary_terms,
  };
}

/**
 * Rust's `char::is_whitespace` (the Unicode `White_Space` property) minus the
 * control characters, which `quotable` has already turned into spaces. Spelled
 * out rather than `\s`, which also matches U+FEFF — not whitespace to Rust.
 */
const RUST_WHITESPACE =
  /[ \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/u;

/** Rust's `char::is_control`: general category Cc. */
const RUST_CONTROL = /\p{Cc}/u;

/**
 * `quotable` in `refusal.rs`: a caller-supplied value made safe to quote in
 * one line of prose. Control characters become spaces, whitespace runs
 * collapse, double quotes become single quotes. `null` when nothing printable
 * is left.
 */
export function quotable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let cleaned = "";
  for (const c of value) {
    cleaned += c === '"' ? "'" : RUST_CONTROL.test(c) ? " " : c;
  }
  const collapsed = cleaned
    .split(RUST_WHITESPACE)
    .filter((w) => w !== "")
    .join(" ");
  return collapsed === "" ? null : collapsed;
}

/** A delay beyond this is not rendered as a count (`RETRY_RENDER_CEILING_S`). */
export const RETRY_RENDER_CEILING_S = 2 * 24 * 60 * 60;

/** `humanise_delay`: whole units, always rounded UP. */
function humaniseDelay(s: number): string {
  const plural = (n: number, unit: string) =>
    n === 1 ? `1 ${unit}` : `${n} ${unit}s`;
  if (s < 120) return plural(s, "second");
  if (s < 2 * 60 * 60) return plural(Math.ceil(s / 60), "minute");
  return plural(Math.ceil(s / (60 * 60)), "hour");
}

const UNNAMED =
  "(it did not name one, which is itself a defect worth reporting)";

/**
 * `NextAction::render`: the second clause, an imperative sentence without its
 * closing full stop. Never empty.
 */
export function renderNextAction(
  na: Pick<DecodedNextAction, "kind" | "target" | "retry_after_s">
): string {
  const t = quotable(na.target);
  switch (na.kind) {
    case "retry_later": {
      const s = na.retry_after_s;
      if (s === null) return "Try again later";
      if (s === 0) return "Try again now";
      if (s > RETRY_RENDER_CEILING_S) {
        return "Try again later; the suggested wait is more than two days";
      }
      return `Try again in ${humaniseDelay(s)}`;
    }
    case "run_command":
      return t !== null
        ? `Run the command "${t}"`
        : `Run the command this refusal refers to ${UNNAMED}`;
    case "open_page":
      return t !== null
        ? `Open "${t}"`
        : `Open the page this refusal refers to ${UNNAMED}`;
    case "sign_in":
      return t !== null
        ? `Sign in at "${t}", then try again`
        : "Sign in, then try again";
    case "pair_device":
      return t !== null
        ? `Pair this device with your account at "${t}", then try again`
        : "Pair this device with your account, then try again";
    case "set_setting":
      return t !== null
        ? `Set the "${t}" setting, then try again`
        : `Set the setting this refusal refers to ${UNNAMED}`;
    case "wait_for_gate":
      return t !== null
        ? `Wait for gate "${t}" to clear; the work resumes on its own`
        : "Wait for the blocking gate to clear; the work resumes on its own";
    case "none_terminal":
      return "Nothing you can do will change this outcome";
    case "report_defect":
      return t !== null
        ? `This is a defect in the product; report it at "${t}"`
        : "This is a defect in the product; please report it";
    case "fix_request":
      return t !== null
        ? `Correct "${t}" in the request and send it again; sending it unchanged fails the same way`
        : "Correct the request and send it again; sending it unchanged fails the same way";
    case "resnapshot":
      return "Take a fresh snapshot of the page, then retry";
    case "scroll_into_view":
      return "Scroll or navigate until the element is visible, then retry";
    case "wait_for_enabled":
      return "Wait for the element to become enabled, then retry";
    case "broaden_selector":
      return "Use a different or broader selector";
    case "unrecognised":
      return "This version cannot show the suggested next step; update the application to see it";
    default: {
      // Exhaustive over the generated union: a kind added to the schemas
      // without a sentence here fails to compile. A value outside the union
      // at run time cannot reach this — `decodeRefusal` classifies it as
      // `unrecognised` first.
      const unreachable: never = na.kind;
      return unreachable;
    }
  }
}

/**
 * `Refusal::render`: `<headline>[ (<discriminator>)]. <next action>.` — a
 * projection of `code`, `discriminator` and `next_action` only. `detail` and
 * `glossary_terms` are rendered BESIDE it by the consumer, never inside it.
 */
export function renderRefusal(
  r: Pick<DecodedRefusal, "code" | "discriminator" | "next_action">
): string {
  const d = quotable(r.discriminator);
  const disc = d !== null ? ` (${d})` : "";
  return `${HEADLINES[r.code]}${disc}. ${renderNextAction(r.next_action)}.`;
}
