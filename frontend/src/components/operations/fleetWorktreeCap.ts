/**
 * Per-device worktree cap — the pure half: the wire contract, its parse, and
 * the resolution one device row needs.
 *
 * Amendment A3 / Phase 4 of plan
 * `2026-09-18-coord-allocation-budgets-ignore-the-machine-they-gate`. Coord
 * owns the state; this file owns nothing but the reading of it, so every rule
 * below is unit-testable without a DOM or a network.
 *
 * ## What the cap is, and the one thing it is NOT
 *
 * Coord decides how many agent worktrees a device may hold by DERIVING it from
 * that machine's memory: `max(MIN_DEVICE_WORKTREES, derive_max_agents(memory_gb))`.
 * That is a model, and a model is sometimes wrong about a particular box — one
 * being wound down, one whose disk is smaller than its RAM suggests, one an
 * operator wants held low while a sweep runs. The override is the escape hatch,
 * and it beats the derivation outright.
 *
 * **It is not a drain, and this UI must never let it read as one.** A drain
 * stops coord sending a machine new work and carries a MANDATORY deadline,
 * because a drain without one is how a machine silently leaves the fleet
 * forever. A cap is a standing capacity decision: it has no deadline (an expiry
 * would make it revert at a moment nobody chose), it does not remove the device
 * from dispatch, and it stops nothing already running. The two controls sit on
 * the same row and the labels are the only thing keeping them apart.
 *
 * ## Why zero is refused rather than offered
 *
 * A cap of 0 would refuse EVERY allocation on that device — including the
 * `qontinui-dev-notes` worktree an operator would need in order to set it back.
 * Plan A3 puts a `>= 1` floor on coord's write door; the web proxy mirrors the
 * bound and {@link validateWorktreeCap} refuses it here, so the operator is told
 * WHY before a round trip rather than after one. An operator who wants a machine
 * to take no work wants the drain.
 *
 * ## Absence is UNKNOWN, three ways
 *
 * The read this console requires answers `state: "known" | "unknown"`, and the
 * two are different facts: `known` with an empty list means the read succeeded and no device is
 * capped; `unknown` means coord could not look. This module keeps them apart at
 * every hop, and adds a third source of the same UNKNOWN — a 404 from a coord
 * that predates the route, which for this feature is a GUARANTEED deploy window
 * (the alembic revision lands first, this console second, coord third). All
 * three render UNKNOWN, never "no cap is set"
 * [policy: `verification-and-evidence` `unknown-must-not-render-as-a-default`].
 */

/** One device's override, as coord's read serves it. */
export interface WorktreeCapEntry {
  /**
   * The cap in force. This console only ever holds a value `>= 1`: see
   * {@link parseWorktreeCapEntry} for why a smaller one is refused HERE rather
   * than trusted to have been refused upstream.
   */
  maxWorktrees: number;
  reason: string;
  /** Operator email, an `agent:<uuid>` principal, or coord's redaction. */
  setBy: string;
  /** RFC 3339, verbatim from coord — parsed only for display. */
  setAt: string;
}

/** The whole read, in the three states coord distinguishes plus `loading`. */
export type FleetWorktreeCapRead =
  | { state: "loading" }
  | {
      state: "known";
      /** Keyed by NORMALIZED device id — see {@link normalizeDeviceId}. */
      entries: Map<string, WorktreeCapEntry>;
      /**
       * Devices coord named but whose entry this build could not read. They are
       * NOT "uncapped": a row that cannot be parsed is one whose cap is
       * unknown, and collapsing it into the uncapped set is the silent-empty
       * failure this module exists to prevent.
       */
      unreadableDevices: Set<string>;
    }
  | { state: "unknown"; reason: string };

/** One device's cap state, as a row renders it. */
export type DeviceWorktreeCapState =
  | { state: "unknown"; reason: string }
  | { state: "derived" }
  | { state: "capped"; entry: WorktreeCapEntry };

/**
 * Device ids are compared case-insensitively and trimmed.
 *
 * Coord emits canonical lowercase UUIDs, but the ids this console holds come
 * from several joins, and a case mismatch would render a capped machine as
 * uncapped — a false negative on the one surface whose job is to say what the
 * cap is.
 */
export function normalizeDeviceId(id: string): string {
  return id.trim().toLowerCase();
}

/**
 * The floor plan A3 specifies, and which coord's write door enforces once the
 * coord half of A3 lands. Named here rather than inherited, so the operator is
 * told what a zero would DO before a round trip rather than after one.
 */
export const MIN_WORKTREE_CAP = 1;

/**
 * What a below-the-floor cap would DO, rather than a restatement of the bound.
 *
 * `must be >= 1` does not tell an operator that the value they typed would lock
 * them out of undoing it, which is the only reason the floor exists.
 */
function belowFloorMessage(n: number): string {
  return (
    // `n`, not the raw spelling. `-0`, `+0` and `0e0` are all zero, and
    // "A cap of -0" is a sentence no operator should have to parse.
    `A cap of ${n} refuses every allocation on this device — including ` +
    "the worktree you would need in order to set it back. To stop sending " +
    "this machine work, drain it instead: a drain carries a deadline and " +
    "this does not."
  );
}

/**
 * A decimal numeric literal: optional sign, digits with an optional fractional
 * part, optional exponent.
 *
 * This gate exists so `Number()` below is only ever handed something that
 * MEANS a decimal number. Without it `Number("0x10")` is 16 and `Number("
 * Infinity")` is `Infinity`, so a hex literal would be silently accepted as a
 * cap of 16 — a value the operator did not type in a base this field never
 * uses.
 */
const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Past what this page can hold exactly — which is an ARITHMETIC limit, and says
 * so.
 *
 * Shared by the non-finite arm and the unsafe-integer arm, because they are the
 * same fact at two magnitudes. A bare "too large" would leave an operator unable
 * to tell this from a policy ceiling, and there deliberately is no policy
 * ceiling: disk is carried by coord's own disk gate, not by this count.
 */
const TOO_LARGE_MESSAGE =
  `That number is larger than ${Number.MAX_SAFE_INTEGER}, the largest whole ` +
  "number this page can hold exactly. That is a limit of the arithmetic, not " +
  "a ceiling on the cap — there is deliberately no upper bound on how many " +
  "worktrees a machine may carry.";

/** A proposed cap, parsed once. */
export type WorktreeCapInput =
  | { ok: true; n: number }
  | { ok: false; message: string };

/**
 * Parse and validate a proposed cap, returning the NUMBER on success. PURE, and
 * the message is the point.
 *
 * ## Why this returns the number rather than just a verdict
 *
 * Because the caller needs the same value twice — once to POST and once to tell
 * the operator what was sent — and deriving it twice is how those two drift. An
 * earlier revision validated the string here and re-derived the number at the
 * call site with `Number(value.trim())`, which was correct arithmetic and a
 * wrong message: typing `1e3` POSTed `1000` while the toast said "capped at
 * 1e3", naming a spelling coord never stored. One parse, one number, carried.
 *
 * ## Which spellings are accepted, and why that is not leniency for its own sake
 *
 * `<input type="number">` hands back whatever the user typed, so `+5`, `1e3`,
 * `1E3`, `5.0` and `1.5e3` all really do arrive here, and every one of them
 * denotes a whole number (`1.5e3` is 1500). Refusing them with "coord stores a
 * count, not a fraction" would describe a mistake the operator did not make,
 * and an operator who reads a correct description of a different mistake looks
 * for a different mistake. So the rule is about the VALUE, not the spelling:
 * anything that denotes a non-negative whole number inside the safe-integer
 * range is accepted and normalised, and each refusal names the thing that is
 * actually wrong.
 *
 * The order of the checks is the message quality: `1.5` is a fraction, `-1e3`
 * is under the floor (not "not a whole number" — it is −1000, a whole number),
 * and `1e21` is past the arithmetic this page can hold exactly rather than past
 * a policy ceiling, which deliberately does not exist.
 */
export function parseWorktreeCapInput(raw: string): WorktreeCapInput {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "Enter a number of worktrees." };
  }
  if (!DECIMAL_LITERAL.test(trimmed)) {
    return {
      ok: false,
      message: "That is not a number — enter a count of worktrees.",
    };
  }
  const n = Number(trimmed);
  // FIRST, and before the integer check. `Number("1e400")` is `Infinity`, and
  // `Number.isInteger(Infinity)` is false — so without this arm every spelling
  // from about `1e309` up got "coord stores a count, not a fraction", which is
  // the one message this module's doctrine forbids: `1e400` is a whole-number
  // spelling, and an operator told they typed a fraction looks for a decimal
  // point that is not there. It also made the arithmetic-limit message below
  // unreachable for exactly the inputs most likely to want it.
  if (!Number.isFinite(n)) {
    return { ok: false, message: TOO_LARGE_MESSAGE };
  }
  if (!Number.isInteger(n)) {
    return {
      ok: false,
      message: "Enter a whole number — coord stores a count, not a fraction.",
    };
  }
  // Before the safe-integer check, so a merely-large NEGATIVE is reported as
  // being under the floor — it is both, and the floor is the fact the operator
  // can act on. (`-1e400` does not reach here: it is not finite, and is reported
  // as an arithmetic limit above. An earlier revision of this comment claimed it
  // did, which was simply wrong.)
  if (n < MIN_WORKTREE_CAP) return { ok: false, message: belowFloorMessage(n) };
  // Names the bound, and says which KIND of bound it is. The doctrine above
  // cuts both ways: a bare "too large" leaves an operator unable to tell a
  // policy ceiling — which does not exist — from the integer range this build
  // can represent exactly. Checked on the NUMBER, so every spelling of a huge
  // value lands here; an earlier revision tested the re-stringified form and so
  // missed everything from `1e21` up, where JS switches to exponent notation.
  if (!Number.isSafeInteger(n)) {
    return { ok: false, message: TOO_LARGE_MESSAGE };
  }
  return { ok: true, n };
}

/**
 * The verdict alone, for the render path that only needs to know whether to
 * show a message. [`parseWorktreeCapInput`] is what a WRITE path must use, so
 * the number it sends is the number it reports.
 */
export function validateWorktreeCap(raw: string): string | null {
  const parsed = parseWorktreeCapInput(raw);
  return parsed.ok ? null : parsed.message;
}

function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Parse one entry. `null` for anything this build cannot read as a cap.
 *
 * Strict on `max_worktrees` and lenient on the provenance: a missing `reason`
 * or `set_by` costs the operator context, while a missing or unusable
 * `max_worktrees` means there is no cap to report at all. A non-integer or
 * sub-1 value is rejected rather than rounded, and the justification is from
 * THIS side rather than a claim about what coord did: a value below the floor
 * means this build and coord disagree about the contract, and UNKNOWN is the
 * honest reading of a disagreement. Rounding it, or trusting that it cannot
 * arrive, is how a 0 would end up rendered as a real cap of 0 — a machine
 * shown as deliberately refusing everything.
 */
export function parseWorktreeCapEntry(value: unknown): WorktreeCapEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  const n = o["max_worktrees"];
  if (
    typeof n !== "number" ||
    !Number.isSafeInteger(n) ||
    n < MIN_WORKTREE_CAP
  ) {
    return null;
  }
  return {
    maxWorktrees: n,
    reason: readString(o, "reason") ?? "(no reason recorded)",
    setBy: readString(o, "set_by") ?? "(unrecorded)",
    setAt: readString(o, "set_at") ?? "",
  };
}

/**
 * Parse coord's `GET /coord/fleet/worktree-cap` body.
 *
 * **This is the contract this console REQUIRES of that route, not a report of
 * one coord already serves** — the coord half of A3 is a separate PR and is not
 * landed, so until it deploys this read 404s and every arm below lands on
 * UNKNOWN:
 *
 * ```json
 * { "state": "known",   "count": 1, "overrides": [ {device_id, max_worktrees, reason, set_by, set_at} ] }
 * { "state": "unknown", "count": null, "overrides": null, "detail": "…" }
 * ```
 *
 * **The wire field is `max_worktrees`; the STORED one is `n`.** Coord keeps a
 * device-keyed JSONB map `{"<uuid>": {"n", "reason", "set_by", "set_at"}}` on
 * its policy row and renders `n` as `max_worktrees` on this read and on the
 * write body. Reading the STORED spelling off the wire would fail every row.
 *
 * **Both containers are accepted: a LIST and the device-keyed MAP.** The list is
 * the declared contract; the map is tolerated because it is the shape coord
 * STORES, and the cost of guessing wrong is total. `actable` in the control
 * requires a known read, so a container mismatch would leave every device
 * UNKNOWN *and* disable both write levers — a wholly inert feature, with nothing
 * in the console to distinguish it from the expected 404 window. The sibling
 * drain reader does the same (`collectEntries` in `./fleetDrain`, whose Shape A
 * is the device-keyed map, "which is how the column stores it"); an earlier
 * revision of this comment claimed the opposite — that `drain` reshapes its map
 * into a list — and cited that as grounds for admitting one shape only. It does
 * not, and the citation argued against the strictness it was supporting.
 *
 * `overrides` is `null` — never `[]` — in the unknown state, deliberately, so a
 * consumer that ignores `state` and iterates gets nothing rather than a silent
 * "no device is capped". This parser reads `state` first anyway, and treats a
 * body it does not recognise as UNKNOWN rather than as an empty list.
 */
/**
 * The `overrides` payload as a row list, from either accepted container.
 *
 * `null` means "neither shape", which the caller reads as UNKNOWN. An empty
 * list and an empty map both mean a successful read of an uncapped fleet and
 * come back as `[]` — the one non-UNKNOWN absence on this surface.
 *
 * A map's KEY is folded into each row as `device_id` when the row does not
 * carry one, which is what lets the attribution and duplicate checks downstream
 * treat both shapes identically.
 */
function coerceOverrideRows(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return null;
  return Object.entries(raw as Record<string, unknown>).map(([key, value]) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? // The KEY last, so it WINS. Spreading it first let any `device_id` in
        // the value override it — including a `null` or `""`, which then fails
        // attribution and degrades the WHOLE read to UNKNOWN even though the map
        // key was perfectly good. In a map the key IS the identity.
        { ...(value as Record<string, unknown>), device_id: key }
      : value
  );
}

export function parseFleetWorktreeCap(payload: unknown): FleetWorktreeCapRead {
  if (typeof payload !== "object" || payload === null) {
    return {
      state: "unknown",
      reason:
        "Coord's worktree-cap read returned a body this build does not " +
        "recognise, so no device's cap could be determined from it.",
    };
  }
  const o = payload as Record<string, unknown>;
  const state = o["state"];

  if (state === "unknown") {
    const detail = readString(o, "detail");
    return {
      state: "unknown",
      reason:
        detail ??
        "Coord could not read the per-device worktree caps. They are UNKNOWN, " +
          "not absent.",
    };
  }

  if (state !== "known") {
    return {
      state: "unknown",
      reason:
        `Coord's worktree-cap read reported state ${JSON.stringify(state)}, ` +
        "which this build does not understand. Treating it as UNKNOWN rather " +
        "than as 'no device is capped'.",
    };
  }

  const rows = coerceOverrideRows(o["overrides"]);
  if (rows === null) {
    // `state: "known"` with neither a list nor a device-keyed map is a
    // contradiction in coord's own contract. UNKNOWN is the only honest
    // reading: the one thing it cannot be is the empty list the missing field
    // superficially resembles.
    return {
      state: "unknown",
      reason:
        "Coord reported a successful worktree-cap read but served no list of " +
        "overrides, so this build cannot tell an uncapped fleet from an " +
        "unreadable one.",
    };
  }

  // `count` is served beside the list, and a disagreement between the two is
  // the one silent-empty route neither `unreadableDevices` nor the
  // unattributable-row arm below can cover: a device dropped from a TRUNCATED
  // list is simply absent, and absence resolves `derived` — the page would then
  // state "no operator cap" for a machine coord says is capped. Compared
  // rather than ignored [policy: verification-and-evidence silent-empty-is-unknown].
  const count = o["count"];
  if (
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count !== rows.length
  ) {
    return {
      state: "unknown",
      reason:
        `Coord reported ${count} worktree-cap override(s) but served ` +
        `${rows.length}, so this build cannot tell which devices are missing ` +
        "from the list. A cap may be in force on a device shown here as " +
        "uncapped.",
    };
  }

  const entries = new Map<string, WorktreeCapEntry>();
  const unreadableDevices = new Set<string>();
  for (const row of rows) {
    const deviceId =
      typeof row === "object" && row !== null
        ? readString(row as Record<string, unknown>, "device_id")
        : null;
    if (!deviceId) {
      // An override coord served but this build cannot ATTRIBUTE to a device.
      // Skipping it would leave the read `known` and every device resolving
      // `derived`, so the page would state "no operator cap" while coord's own
      // answer contained one — the exact silent-empty failure this module
      // exists to prevent, reached by the one route `unreadableDevices` cannot
      // cover (that set is keyed by the very id that is missing). The whole
      // read therefore degrades: an unattributable override makes EVERY
      // device's cap unknown, because any of them could be the one it belongs
      // to [policy: verification-and-evidence silent-empty-is-unknown].
      return {
        state: "unknown",
        reason:
          "Coord's worktree-cap read named an override this build could not " +
          "attribute to a device, so no device's cap can be reported from it. " +
          "A cap may be in force here.",
      };
    }
    const key = normalizeDeviceId(deviceId);
    // TWO rows for one device is a contract violation, and letting the last one
    // win would pick a cap by list order — silently, and differently from any
    // other reader of the same body. Which of the two is in force is exactly
    // what this build cannot determine, so that device's cap is UNKNOWN. Not the
    // whole read: the other devices' rows are unaffected and still say something
    // true [policy: verification-and-evidence silent-empty-is-unknown].
    if (entries.has(key) || unreadableDevices.has(key)) {
      entries.delete(key);
      unreadableDevices.add(key);
      continue;
    }
    const entry = parseWorktreeCapEntry(row);
    if (entry) entries.set(key, entry);
    else unreadableDevices.add(key);
  }
  return { state: "known", entries, unreadableDevices };
}

/**
 * What one device's row should render.
 *
 * Every arm that is not a positive answer carries its own reason, because the
 * three UNKNOWNs have three different remediations: no device id (this row has
 * no identity to look up), coord unreadable (wait or check coord), and an
 * unparseable entry (this build and coord disagree about the shape).
 */
export function resolveDeviceWorktreeCap(
  read: FleetWorktreeCapRead,
  deviceId: string | undefined
): DeviceWorktreeCapState {
  if (!deviceId) {
    return {
      state: "unknown",
      reason:
        "This row carries no coord device id, so there is nothing to look up " +
        "in the worktree-cap map.",
    };
  }
  if (read.state === "loading") {
    return {
      state: "unknown",
      reason: "Coord's per-device worktree caps are still being read.",
    };
  }
  if (read.state === "unknown") {
    return { state: "unknown", reason: read.reason };
  }
  const key = normalizeDeviceId(deviceId);
  if (read.unreadableDevices.has(key)) {
    return {
      state: "unknown",
      reason:
        "Coord named this device in its worktree-cap map, but this build " +
        "could not read the entry (no usable max_worktrees), so whether it is " +
        "capped is unknown.",
    };
  }
  const entry = read.entries.get(key);
  if (!entry) return { state: "derived" };
  return { state: "capped", entry };
}
