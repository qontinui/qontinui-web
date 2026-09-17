/**
 * Recognise and describe the runner's origin-guard refusal.
 *
 * The runner's loopback API classifies each browser caller by its `Origin`
 * (plan `2026-09-17-runner-loopback-api-accepts-any-origin`, Design step 2).
 * A page on a Trusted origin — the qontinui-web dev frontend on `:3001` —
 * that calls a route not on the runner's `TRUSTED_ROUTES` allowlist gets a
 * typed 403 in the runner's canonical `ApiResponse` envelope:
 *
 *   { success: false, code: "CROSS_ORIGIN_REFUSED", error: "...",
 *     context: { origin, class, method, route_pattern, ...admit hints } }
 *
 * For a Trusted (or FirstParty) origin the guard echoes that origin in
 * `Access-Control-Allow-Origin` on its own 403, so this page CAN read the
 * body. A Foreign origin's refusal carries no CORS header, so the browser
 * hides it and the fetch rejects as a network error — nothing here can
 * improve that case, by design.
 *
 * Before this module a refusal rendered as "Runner API error: 403 Forbidden",
 * which reads as a broken runner. The typed message instead names the route,
 * the origin and the two ways to admit that origin (the runner's
 * `QONTINUI_RUNNER_ALLOWED_ORIGINS` env var, or its `api.allowed_origins`
 * setting) — and that a NEW route needs adding to the runner's allowlist.
 *
 * The body shape is the plan's documented one; when this was written the
 * runner's `origin_guard.rs` had not landed on `origin/main`, and the
 * `ApiResponse` envelope has no `context` field yet. So the parser is
 * tolerant about WHERE the context sits (`context`, `data`, `hint`,
 * `error_detail.context`) and where the code sits (top-level `code` or
 * `error_detail.code`), and every context field is optional. It is strict
 * about the one thing that decides it: the code must be exactly
 * `CROSS_ORIGIN_REFUSED`.
 */

export const CROSS_ORIGIN_REFUSED = "CROSS_ORIGIN_REFUSED";

/** Runner env var that admits an extra browser origin (headless path). */
export const RUNNER_ALLOWED_ORIGINS_ENV = "QONTINUI_RUNNER_ALLOWED_ORIGINS";
/** Runner setting that admits an extra browser origin (Settings → Runner). */
export const RUNNER_ALLOWED_ORIGINS_SETTING = "api.allowed_origins";

export interface RunnerOriginRefusal {
  code: typeof CROSS_ORIGIN_REFUSED;
  /** The runner's own human-readable message, when it sent one. */
  message?: string;
  /** The origin the runner classified. */
  origin?: string;
  /** The origin class: `first_party` | `trusted` | `foreign`. */
  originClass?: string;
  method?: string;
  /** The router pattern that was refused, e.g. `/terminals/{id}/ws`. */
  routePattern?: string;
  /** Env var that would admit the origin (defaults to the plan's name). */
  envVar: string;
  /** Settings field that would admit the origin (defaults to the plan's name). */
  settingsField: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

function firstString(ctx: Obj, keys: string[]): string | undefined {
  for (const k of keys) {
    const s = str(ctx[k]);
    if (s) return s;
  }
  return undefined;
}

/**
 * Parse an already-decoded response body. Returns `null` for anything that
 * is not a `CROSS_ORIGIN_REFUSED` envelope — including non-objects, other
 * error codes and a success body.
 */
export function parseRunnerOriginRefusal(
  body: unknown
): RunnerOriginRefusal | null {
  if (!isObj(body)) return null;
  const detail = isObj(body.error_detail) ? body.error_detail : undefined;
  const code = str(body.code) ?? (detail ? str(detail.code) : undefined);
  if (code !== CROSS_ORIGIN_REFUSED) return null;

  const ctx: Obj =
    [body.context, detail?.context, body.data, body.hint].find(isObj) ?? {};

  return {
    code: CROSS_ORIGIN_REFUSED,
    message:
      str(body.error) ??
      str(body.message) ??
      (detail ? str(detail.message) : undefined),
    origin: firstString(ctx, ["origin"]),
    originClass: firstString(ctx, ["class", "origin_class", "originClass"]),
    method: firstString(ctx, ["method"]),
    routePattern: firstString(ctx, ["route_pattern", "routePattern", "route"]),
    envVar:
      firstString(ctx, ["env_var", "envVar", "env"]) ??
      RUNNER_ALLOWED_ORIGINS_ENV,
    settingsField:
      firstString(ctx, ["settings_field", "settingsField", "setting"]) ??
      RUNNER_ALLOWED_ORIGINS_SETTING,
  };
}

/** Parse a raw response text (as `response.text()` returns it). */
export function parseRunnerOriginRefusalText(
  text: string
): RunnerOriginRefusal | null {
  if (!text) return null;
  try {
    return parseRunnerOriginRefusal(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Read a runner `Response` and return the refusal if it is one. Only a 403
 * is inspected; the body is read from a clone, so the caller's response
 * stays consumable either way.
 */
export async function readRunnerOriginRefusal(
  response: Response
): Promise<RunnerOriginRefusal | null> {
  if (response.status !== 403) return null;
  try {
    return parseRunnerOriginRefusalText(await response.clone().text());
  } catch {
    return null;
  }
}

/** One operator-facing sentence (two, with the admit hint). */
export function describeRunnerOriginRefusal(r: RunnerOriginRefusal): string {
  const route =
    r.method && r.routePattern
      ? `${r.method} ${r.routePattern}`
      : (r.routePattern ?? "this route");
  const origin = r.origin ?? "this page's origin";
  const cls = r.originClass ? ` (${r.originClass} origin)` : "";
  return (
    `Runner refused ${route} from ${origin}${cls}: CROSS_ORIGIN_REFUSED. ` +
    `The runner only admits browser origins listed in ${r.envVar} or its ` +
    `${r.settingsField} setting, and only for routes on its allowlist for ` +
    `that origin class — a new runner call needs its route added there.`
  );
}
