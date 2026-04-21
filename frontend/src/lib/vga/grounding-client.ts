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
  process.env.QONTINUI_LLAMA_SWAP_URL ?? "http://localhost:8100";
const DEFAULT_MODEL = "qontinui-grounding-v5";

/** Extracted point + raw response for caller logging/debugging. */
export interface GroundResult {
  /** Normalized x in [0, 1] (original model output, pre-pixel-mapping). `null` if no point parsed. */
  normX: number | null;
  normY: number | null;
  /**
   * Absolute x pixel coordinate (rounded to int) when `imageWidth` is
   * provided; `null` otherwise. `null` also if no point parsed.
   */
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

/** Dispatch one grounding call and return the parsed point.
 *
 * Coordinate normalization: v5 emits `<point>x y</point>` where x and y
 * may be either:
 *   - fractions in [0, 1]    (current v5 deployment — `<point>0.0253 0.1401</point>`)
 *   - integers in [0, 1000]  (the training prompt's claimed format)
 * We auto-detect by magnitude: if either coord is > 1.0 we assume the
 * 0–1000 convention, else the 0–1 convention. Output `normX`/`normY`
 * are always in the [0, 1] space so callers don't have to care.
 */
export async function groundOnce(args: {
  imageBase64: string;
  prompt: string;
  model?: string;
  imageWidth?: number;
  imageHeight?: number;
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
    return {
      x: null,
      y: null,
      normX: null,
      normY: null,
      rawResponse: raw,
      confidence: 0,
    };
  }

  const match = raw.match(POINT_RE);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new GroundingParseError(
      "Response did not contain a <point>x y</point> tag",
      raw
    );
  }

  const rawX = Number.parseFloat(match[1]);
  const rawY = Number.parseFloat(match[2]);

  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    throw new GroundingParseError(
      "Parsed point had non-finite coordinates",
      raw
    );
  }

  // Auto-detect coordinate convention. If either coord is above 1.0, the
  // model is using 0-1000 integers; otherwise it's emitting 0-1 fractions.
  const isThousands = Math.max(Math.abs(rawX), Math.abs(rawY)) > 1.0;
  const normX = isThousands ? rawX / 1000.0 : rawX;
  const normY = isThousands ? rawY / 1000.0 : rawY;

  const x =
    args.imageWidth !== undefined ? Math.round(normX * args.imageWidth) : null;
  const y =
    args.imageHeight !== undefined
      ? Math.round(normY * args.imageHeight)
      : null;

  return { x, y, normX, normY, rawResponse: raw, confidence: 1 };
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
