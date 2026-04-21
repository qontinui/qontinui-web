/**
 * Thin client for the llama-swap OpenAI-compatible endpoint.
 *
 * Server-side only. Exposes `groundOnce` which calls chat/completions
 * with a single user message (image + prompt) and returns the parsed
 * `<point>x y</point>` coordinates. Parser is tolerant of stray
 * whitespace / decimal coordinates / surrounding text.
 *
 * Mirrors the shape used by `qontinui/src/qontinui/vga/client.py` so
 * the two clients agree on prompt envelope and parsing.
 */

const LLAMA_SWAP_BASE =
  process.env.QONTINUI_LLAMA_SWAP_URL ?? "http://localhost:5800";
const DEFAULT_MODEL = "qontinui-grounding-v5";

/** Extracted point + raw response for caller logging/debugging. */
export interface GroundResult {
  /** Absolute x pixel coordinate (rounded to int). `null` if no point parsed. */
  x: number | null;
  y: number | null;
  rawResponse: string;
  /**
   * Naive confidence. 1.0 if a point parsed; 0.0 if the model said
   * `<none/>` or no parse; inherit model-reported logprobs if ever
   * surfaced (currently always 1.0/0.0).
   */
  confidence: number;
}

export class GroundingUnavailableError extends Error {
  public readonly detail: unknown;
  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "GroundingUnavailableError";
    this.detail = detail;
  }
}

export class GroundingParseError extends Error {
  constructor(
    message: string,
    public rawResponse: string
  ) {
    super(message);
    this.name = "GroundingParseError";
  }
}

const POINT_RE = /<point>\s*([-\d.]+)[\s,]+([-\d.]+)\s*<\/point>/i;
const NONE_RE = /<none\s*\/?>/i;

/** Dispatch one grounding call and return the parsed point. */
export async function groundOnce(args: {
  imageBase64: string;
  prompt: string;
  model?: string;
}): Promise<GroundResult> {
  const model = args.model ?? DEFAULT_MODEL;
  const url = `${LLAMA_SWAP_BASE}/v1/chat/completions`;

  // Ensure the base64 payload is a full data URL — vLLM's OpenAI-compat
  // server accepts either a bare b64 string or a data URI. We pick the
  // data URI because it's less error-prone if the caller forgot the
  // PNG/JPEG prefix.
  const imageUrl = args.imageBase64.startsWith("data:")
    ? args.imageBase64
    : `data:image/png;base64,${args.imageBase64}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              { type: "text", text: args.prompt },
            ],
          },
        ],
        max_tokens: 64,
        temperature: 0,
      }),
    });
  } catch (err) {
    throw new GroundingUnavailableError(
      `llama-swap unreachable at ${LLAMA_SWAP_BASE}`,
      err
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GroundingUnavailableError(
      `llama-swap returned ${response.status}: ${body.slice(0, 200)}`
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new GroundingUnavailableError(
      "llama-swap returned invalid JSON",
      err
    );
  }

  const raw = extractContent(data);
  if (raw === null) {
    throw new GroundingUnavailableError(
      "llama-swap response missing choices[0].message.content"
    );
  }

  if (NONE_RE.test(raw)) {
    return { x: null, y: null, rawResponse: raw, confidence: 0 };
  }

  const match = raw.match(POINT_RE);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new GroundingParseError(
      "Response did not contain a <point>x y</point> tag",
      raw
    );
  }

  const x = Math.round(Number.parseFloat(match[1]));
  const y = Math.round(Number.parseFloat(match[2]));

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new GroundingParseError(
      "Parsed point had non-finite coordinates",
      raw
    );
  }

  return { x, y, rawResponse: raw, confidence: 1 };
}

function extractContent(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const msg = (first as { message?: unknown }).message;
  if (typeof msg !== "object" || msg === null) return null;
  const content = (msg as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  return content;
}
