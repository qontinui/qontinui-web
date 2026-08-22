/**
 * Client mirror of coord's write-time content rules for a `session_briefing`
 * body (plan `2026-08-20-runner-session-briefing-versioned-and-operator-editable`,
 * Decision 8; coord `crates/coord/src/prompt_documents.rs`
 * `validate_session_briefing_body` / `validate_body_for_kind`).
 *
 * ## Why a client copy exists at all
 *
 * `session_briefing` is the one kind coord content-checks, because it is the
 * one kind that is PUSHED into every session the tenant's runners host rather
 * than PULLED by an agent that chose to read it. Five rules apply, and each of
 * them rejects the whole write with a 400.
 *
 * The editor already mirrors coord's *change-note* requirement for exactly this
 * reason — an operator must learn a rule from the form before submitting, not
 * from a bare 400 after typing an edit. The body rules landed in the same coord
 * change and were not mirrored, so a 16 KB briefing, a pasted example UUID or a
 * quoted `${{ … }}` expression still fails only at the round-trip, with the
 * operator's edit sitting in a textarea and no statement of which token was the
 * problem. Same defect, same fix.
 *
 * Precedent for the shape: `PromptDocumentCreateDialog`'s local `isKebabCase`,
 * which mirrors coord's `is_kebab_case` so the form can explain before the
 * round-trip.
 *
 * ## Coord remains the authority
 *
 * This is a mirror, not a second source of truth. It can only ever be advisory:
 * it runs on a browser that may be older than the coord it is talking to, and
 * coord re-validates every door regardless. Where the two disagree, coord wins
 * and the operator sees its message. What this buys is that the COMMON case —
 * a rule the operator can see and fix — is answered in the form.
 *
 * Kept as a standalone pure module rather than inline in a dialog because three
 * separate write doors reach it (PATCH from the editor, create from the create
 * dialog, restore-version from the history dialog), matching coord's own reason
 * for factoring it out of its route handlers.
 */

import type { PromptDocumentKind } from "../types";

/**
 * The CLOSED placeholder vocabulary a `session_briefing` body may use — coord
 * `SESSION_BRIEFING_PLACEHOLDERS`.
 *
 * `runner_api_base` renders as `http://127.0.0.1:<port>`, `coord_http_base` as
 * the runner's resolved coord base URL. Anything else would ship into an
 * agent's system prompt as a literal `{{whatever}}`, so it is a write-time
 * refusal rather than a silent pass-through.
 */
export const SESSION_BRIEFING_PLACEHOLDERS: readonly string[] = [
  "runner_api_base",
  "coord_http_base",
];

/**
 * Size ceiling for a `session_briefing` body, in BYTES — coord
 * `SESSION_BRIEFING_MAX_BYTES` (16 KiB).
 *
 * A ceiling, not a target: this text lands in the system prompt of every
 * session the tenant's runners host, so its cost is per-session and unbounded
 * growth is not free. The briefing's contract is protocol and links, with the
 * long form in a document it points at.
 */
export const SESSION_BRIEFING_MAX_BYTES = 16 * 1024;

/**
 * coord's OPERATOR door onto this store. A briefing must never name it: it 403s
 * the device JWT a runner-hosted session holds, so a session told to use it as
 * an escape hatch has been handed a dead end at exactly the moment its MCP
 * tools are masked.
 */
const OPERATOR_DOOR_PATH = "/coord/prompt-documents";

/** The door a runner-hosted session can actually reach — the fix to suggest. */
const AGENT_DOOR_PATH = "/coord/agent-prompt-documents";

/**
 * UUID-shaped token — the identity scan's first half, both spellings this fleet
 * uses. The dashless 32-hex arm is `\b`-anchored so a 40-hex git SHA (which is
 * not an identity) does not match on one of its substrings.
 */
const UUID_SHAPED =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\b[0-9a-fA-F]{32}\b/;

/**
 * Identity-KEY shapes the scan rejects, matched case-insensitively — coord
 * `IDENTITY_KEY_SHAPES`. The briefing is tenant-WIDE; tenancy comes from the
 * device JWT the runner fetches with and from `(tenant_id, kind, name)`, never
 * from the text.
 *
 * Literal substrings rather than a regex on purpose: the question is "does this
 * text talk about an identity at all", not "is this a well-formed key". That
 * also means it fires on an API example that merely DOCUMENTS such a field,
 * which is deliberate — a request shape belongs in the linked document.
 */
const IDENTITY_KEY_SHAPES: readonly string[] = [
  "tenant_id",
  "tenantid",
  "tenant-id",
  "agent_id",
  "agentid",
  "agent-id",
  "device_id",
  "deviceid",
  "device-id",
  "session_id",
  "sessionid",
  "session-id",
];

/**
 * UTF-8 byte length — coord measures the cap in bytes (Rust `String::len`),
 * NOT in JavaScript's UTF-16 code units.
 *
 * The two disagree for every non-ASCII character, and this corpus is full of
 * them: the house prose style uses em-dashes and curly quotes throughout. A
 * `body.length` check would let a body through at 16383 "characters" that coord
 * measures as well over the cap and refuses — reintroducing the bare 400 this
 * module exists to remove, on exactly the bodies most likely to hit the ceiling.
 */
export function sessionBriefingByteLength(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** Cap a caller-supplied fragment before it goes into a message. */
function elide(token: string): string {
  const MAX = 64;
  const chars = Array.from(token);
  return chars.length <= MAX ? token : `${chars.slice(0, MAX).join("")}…`;
}

/**
 * Every `{{…}}` token in `body`, in order, as `[token, terminated]` — a port of
 * coord's `placeholder_tokens`. `terminated` is false for a dangling `{{` with
 * no closing `}}`, which coord reports separately because it is usually a typo
 * rather than an unknown name.
 */
function placeholderTokens(body: string): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  let i = 0;
  while (i + 1 < body.length) {
    if (body[i] === "{" && body[i + 1] === "{") {
      const end = body.indexOf("}}", i + 2);
      if (end === -1) {
        out.push([body.slice(i + 2).trim(), false]);
        break;
      }
      out.push([body.slice(i + 2, end).trim(), true]);
      i = end + 2;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * `null` when `body` satisfies every `session_briefing` content rule, otherwise
 * an operator-facing sentence that NAMES the offending token or measurement.
 *
 * The order matches coord's so the operator fixing one violation at a time is
 * shown the same one coord would have shown.
 */
export function validateSessionBriefingBody(body: string): string | null {
  const bytes = sessionBriefingByteLength(body);
  if (bytes > SESSION_BRIEFING_MAX_BYTES) {
    return (
      `Body is ${bytes.toLocaleString()} bytes; the ceiling is ` +
      `${SESSION_BRIEFING_MAX_BYTES.toLocaleString()}. This text lands in the system prompt of ` +
      `every session this tenant's runners host, so its cost is per-session. The briefing's ` +
      `contract is protocol and links — move the long form into a document it points at.`
    );
  }

  for (const [token, terminated] of placeholderTokens(body)) {
    if (!terminated) {
      return (
        `Unterminated placeholder \`{{${elide(token)}\`. A session briefing may use only ` +
        `${SESSION_BRIEFING_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" and ")}. There is ` +
        `deliberately no escape for a literal \`{{\` — this text is a system prompt, not a ` +
        `template.`
      );
    }
    if (!SESSION_BRIEFING_PLACEHOLDERS.includes(token)) {
      return (
        `Unknown placeholder \`{{${elide(token)}}}\`. A session briefing may use only ` +
        `${SESSION_BRIEFING_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" and ")}; anything else ` +
        `cannot be substituted and would ship into an agent's system prompt as a literal. ` +
        `Quoted syntax that uses doubled braces (a GitHub Actions \`\${{ … }}\` expression, a ` +
        `template example) belongs in a linked document.`
      );
    }
  }

  // FIRST NON-BLANK line, case-insensitively: a body opening with a newline
  // would otherwise carry a forged marker on the line a reader sees first, and
  // `[Source:` would sail past a case-sensitive compare.
  const firstLine =
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (firstLine.toLowerCase().startsWith("[source:")) {
    return (
      `The first line must not be an attributable source marker (\`[source: …]\`). That marker ` +
      `is owned by the runner build that emits it — if a document can forge one, a reader can ` +
      `no longer trace an instruction back to the code that produced it.`
    );
  }

  if (body.includes(OPERATOR_DOOR_PATH)) {
    return (
      `Body names coord's operator door \`${OPERATOR_DOOR_PATH}\`, which 403s the device JWT a ` +
      `runner-hosted session holds. Name the agent door \`${AGENT_DOOR_PATH}\` instead — a ` +
      `session whose coord MCP tools are masked has no other way in, so this is a dead end at ` +
      `exactly the moment it is needed.`
    );
  }

  const uuid = UUID_SHAPED.exec(body);
  if (uuid) {
    return (
      `Body contains the UUID-shaped token \`${uuid[0]}\`. A session briefing must carry no ` +
      `tenant, agent, device or session identity — tenancy comes from the device JWT the runner ` +
      `fetches with and from \`(kind, name)\`, never from the text. If this is an example id ` +
      `rather than a real one, put the example in a linked document: this text is injected ` +
      `verbatim into every session.`
    );
  }

  const lowered = body.toLowerCase();
  const shape = IDENTITY_KEY_SHAPES.find((s) => lowered.includes(s));
  if (shape) {
    return (
      `Body contains the identity-shaped key \`${shape}\`. A session briefing must carry no ` +
      `tenant, agent, device or session identity. This fires on the KEY NAME, so it also ` +
      `refuses an API example that merely documents such a field — that is deliberate: the ` +
      `briefing's contract is protocol and links, and a request shape belongs in the document ` +
      `it links to.`
    );
  }

  return null;
}

/**
 * Kind-dispatching wrapper — a port of coord's `validate_body_for_kind`, so
 * every call site asks one thing and a future per-kind rule lands in one place.
 * A kind with no content rules is `null` (valid).
 */
export function validateBodyForKind(
  kind: PromptDocumentKind,
  body: string
): string | null {
  if (kind === "session_briefing") return validateSessionBriefingBody(body);
  return null;
}
