/**
 * presentationModeResolution — D2 of plan
 * `2026-10-23-console-presentation-spaces`, as one pure function.
 *
 * The presentation lens (D1: same routes, same data, a different rendering)
 * has exactly one input that is not the page's own data — whether THIS browser
 * is presenting right now. D2 orders its sources, and this module is the only
 * place the order is written down:
 *
 *   1. **`?present=` on the URL wins.** A tour stop, a shared link, a presenter
 *      typing it. `?present=1` / `?present=0` are the canonical spellings.
 *   2. **The tab's last explicit choice** (sessionStorage, mirrored in memory —
 *      `presentationModeStore.ts`). This is what keeps a presentation ON when
 *      the presenter follows a link that carries no `?present=` or reloads the
 *      page. Without it every in-app link would drop the lens in front of the
 *      audience — a fail-OPEN at exactly the wrong moment.
 *   3. **The viewer's convenience** (localStorage) — the header toggle's
 *      remembered setting, for a new tab. Never authority: every read and write
 *      is guarded, and a URL always beats it.
 *   4. **Off.**
 *
 * There is no server state. The mode changes what a browser renders, not what
 * a tenant allows (D2); authorization is untouched by it.
 *
 * ## An unresolved mode fails CLOSED
 *
 * On a server render and during hydration neither store can be read. With no
 * URL answer the mode is then reported as PRESENTING, `source: "unresolved"`,
 * so every guard — `OperatorOnly`, `RedactedText`, `CostFigure`,
 * `MachineName` — protects until the client resolves (D3: "redaction fails
 * closed, by construction"). The `(app)` tree is never part of a server or
 * hydration render (`AppAuthGate` renders a loading shell there), so in
 * practice this arm is reached only by a surface rendered outside it; but a
 * guard that is correct only where it happens to be mounted today is not a
 * guard.
 *
 * ## An unrecognised `?present=` value also fails closed
 *
 * `0`, `false`, `off` and `no` turn the lens off. ANY other value of a
 * `present` key that is present — including an empty `?present` and a typo
 * such as `?present=ture` — turns it on: someone put the key on the URL to ask
 * for a presentation, and guessing "operator" would show the controls.
 */

/** The URL key D2 names. */
export const PRESENT_PARAM = "present";

/** Where the resolved mode came from. */
export type PresentationModeSource =
  | "url"
  | "session"
  | "storage"
  | "default"
  | "unresolved";

/** A choice read back from a store: `null` means nothing is stored there. */
export type StoredChoice = boolean | null;

export interface PresentationModeInputs {
  /** `parsePresentParam` of the URL's `present` value; `null` when absent. */
  readonly url: boolean | null;
  /** The tab's last explicit choice. */
  readonly session: StoredChoice;
  /** The viewer's remembered setting. */
  readonly storage: StoredChoice;
  /**
   * `false` on a server render and during hydration, where neither store can
   * be read — distinct from "read, and nothing was stored".
   */
  readonly storesReadable: boolean;
}

export interface ResolvedPresentationMode {
  readonly presenting: boolean;
  readonly source: PresentationModeSource;
}

const OFF_VALUES: ReadonlySet<string> = new Set(["0", "false", "off", "no"]);

/**
 * The URL's `present` value as a choice. `null`/`undefined` — the key is not on
 * the URL — is "no answer", never "off".
 */
export function parsePresentParam(
  raw: string | null | undefined
): boolean | null {
  if (raw === null || raw === undefined) return null;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

/** D2's order. See the module doc for why each arm exists. */
export function resolvePresentationMode(
  inputs: PresentationModeInputs
): ResolvedPresentationMode {
  if (inputs.url !== null) return { presenting: inputs.url, source: "url" };
  if (!inputs.storesReadable) return { presenting: true, source: "unresolved" };
  if (inputs.session !== null) {
    return { presenting: inputs.session, source: "session" };
  }
  if (inputs.storage !== null) {
    return { presenting: inputs.storage, source: "storage" };
  }
  return { presenting: false, source: "default" };
}

/** The canonical stored and URL spelling of a choice. */
export function encodeChoice(presenting: boolean): "1" | "0" {
  return presenting ? "1" : "0";
}

/** A stored value back to a choice. Anything but `"1"`/`"0"` is no choice. */
export function decodeChoice(raw: string | null | undefined): StoredChoice {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}
