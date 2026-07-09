// ============================================================================
// Session output text utilities
//
// Pure helpers shared by the twin session page's Transcript tab and Live
// tail pane (plan `2026-07-09-runner-session-history-cloud-sync`, Phases
// 2 + 6): base64 chunk decoding, ANSI-escape stripping for the <pre>
// scrollback pane, transcript-JSONL line parsing, and the rendered-size
// cap that keeps a very large session from freezing the page.
// ============================================================================

/**
 * Cap on rendered scrollback/transcript text, in UTF-16 code units
 * (~2 MB of ASCII). When exceeded we keep the TAIL — the most recent
 * output is what an operator reviewing a session wants — and surface a
 * "truncated" notice.
 */
export const MAX_RENDER_CHARS = 2 * 1024 * 1024;

/** Decode a base64 chunk payload to raw bytes. */
export function decodeBase64Bytes(payloadB64: string): Uint8Array {
  const binary = atob(payloadB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ANSI/VT escape sequences: CSI (`ESC[ … final-byte`), OSC (`ESC] … BEL`
// or `ESC] … ESC\`), and single-character escapes. Covers the sequences
// PTY output actually emits (colors, cursor movement, title sets) — the
// pane renders plain text, so styling is dropped rather than emulated.
const ANSI_PATTERN =
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-_]/g;

// Residual C0 control characters (except `\n` / `\t`) + DEL, dropped
// after escape-sequence stripping.
const CONTROL_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Strip ANSI escape sequences and normalize control characters for a
 * plain-text `<pre>` pane: CR/LF pairs and bare CRs collapse to `\n`
 * (a carriage-return progress spinner becomes successive lines rather
 * than overwriting), and remaining C0 controls other than `\n`/`\t`
 * are dropped.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL_PATTERN, "");
}

/** Keep the tail of `text` under {@link MAX_RENDER_CHARS}. */
export function capTail(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_RENDER_CHARS) {
    return { text, truncated: false };
  }
  let capped = text.slice(text.length - MAX_RENDER_CHARS);
  // Drop the (almost certainly partial) first line after the cut.
  const nl = capped.indexOf("\n");
  if (nl !== -1 && nl < capped.length - 1) {
    capped = capped.slice(nl + 1);
  }
  return { text: capped, truncated: true };
}

/** One parsed transcript line, ready to render. */
export interface TranscriptLine {
  /**
   * Best-effort role/type label from the line's JSON (`assistant`,
   * `user`, `result`, …). `null` when the line wasn't JSON or carried
   * no recognizable kind.
   */
  kind: string | null;
  /** Readable text content (or the raw line when parsing failed). */
  text: string;
  /** True when the line couldn't be parsed and `text` is the raw line. */
  raw: boolean;
}

/**
 * Flatten a message `content` value — a plain string or the
 * content-block array shape (`[{type: "text", text}, {type: "tool_use",
 * name}, …]`) — into readable text. Returns `null` when nothing
 * readable was found.
 */
function contentToText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (typeof part !== "object" || part === null) continue;
    const rec = part as Record<string, unknown>;
    if (typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (rec.type === "tool_use") {
      const name = typeof rec.name === "string" ? `: ${rec.name}` : "";
      parts.push(`[tool use${name}]`);
    } else if (rec.type === "tool_result") {
      const inner = contentToText(rec.content);
      parts.push(inner ? `[tool result] ${inner}` : "[tool result]");
    } else if (rec.type === "thinking") {
      parts.push("[thinking]");
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * Parse one transcript JSONL line into a {@link TranscriptLine}.
 *
 * Transcript chunks are AI-conversation JSONL as the runner persisted
 * them; the exact envelope varies by provider/version, so extraction is
 * best-effort over the common shapes (`{type, message: {role, content}}`
 * stream-json events, bare `{role, content}` messages, `{type: "result",
 * result}` summaries). Anything unrecognized falls back to the raw line
 * so no content is silently dropped.
 */
export function parseTranscriptLine(line: string): TranscriptLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: null, text: line, raw: true };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: null, text: line, raw: true };
  }
  const rec = parsed as Record<string, unknown>;

  const message =
    typeof rec.message === "object" && rec.message !== null
      ? (rec.message as Record<string, unknown>)
      : null;

  const kindOf = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null;
  const kind =
    kindOf(message?.role) ?? kindOf(rec.role) ?? kindOf(rec.type) ?? null;

  const text =
    contentToText(message?.content) ??
    contentToText(rec.content) ??
    (typeof rec.text === "string" ? rec.text : null) ??
    (typeof rec.result === "string" ? rec.result : null) ??
    (typeof rec.summary === "string" ? rec.summary : null) ??
    (typeof rec.error === "string" ? rec.error : null);

  if (text !== null) {
    return { kind, text, raw: false };
  }
  return { kind, text: line, raw: true };
}

/** Split decoded transcript text into parsed lines, skipping blanks. */
export function parseTranscriptText(text: string): TranscriptLine[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseTranscriptLine);
}
