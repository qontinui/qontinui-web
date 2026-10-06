import { Badge } from "@/components/ui/badge";

// ----------------------------------------------------------------------------
// Merge-enablement: pinned vs inherited
// ----------------------------------------------------------------------------
//
// coord stores a per-repo `merge_enabled_override` that is `true`, `false`, or
// `null`, and separately RESOLVES `merge_enabled` from it. Those are two
// different facts and this dashboard used to render only the second one, so
// every per-repo control read "inherit" no matter what was actually pinned —
// a switch whose position did not match the database.
//
// `PinChoice` is the raw pin as a form value; the resolved boolean is always
// carried alongside it, never in place of it.

export type PinChoice = "inherit" | "true" | "false";

/** Wire pin (`true` | `false` | `null`) → form value. */
export function pinChoice(override: boolean | null | undefined): PinChoice {
  if (override === true) return "true";
  if (override === false) return "false";
  return "inherit";
}

/** Form value → wire pin. `null` is the clear-to-inherit form. */
export function pinValue(choice: PinChoice): boolean | null {
  if (choice === "true") return true;
  if (choice === "false") return false;
  return null;
}

/**
 * One sentence stating what is STORED and what it currently resolves to.
 *
 * Inheriting is reported as inheriting — never silently as its resolved value
 * — because "off because this repo is pinned off" and "off because the tenant
 * is paused" call for different fixes.
 *
 * The pinned arms state the resolved value too **whenever it disagrees with
 * the pin**, which is exactly when the operator most needs to be told. A repo
 * pinned ON under a tenant-wide pause resolves OFF: saying only "Pinned ON"
 * there would let an operator who just stopped the fleet read the page as
 * confirmation that it is still running.
 */
export function pinSentence(
  pin: PinChoice,
  resolved: boolean,
  tenantPaused = false
): string {
  if (pin === "inherit") {
    return `Not pinned — inheriting, and currently ${
      resolved ? "enabled" : "paused"
    }.`;
  }
  const pinned = pin === "true";
  if (pinned === resolved) {
    return pinned ? "Pinned ON for this repo." : "Pinned OFF for this repo.";
  }
  // Pin and reality disagree. Name the cause when we can prove it (the tenant
  // pause is the only tier that outranks a pin); otherwise say only what is
  // observed rather than guessing at a reason.
  const because = tenantPaused ? " because the tenant is paused" : "";
  return pinned
    ? `Pinned ON — but merges are OFF here${because}.`
    : `Pinned OFF — but merges currently resolve ON${because}.`;
}

/**
 * The resolved merge posture, with the pin's provenance on it.
 *
 * Green/red is the resolved answer to "will this repo merge?"; the dashed
 * outline and the "inherited" word are the answer to "is that pinned here, or
 * is it just what the tier above says today?".
 */
export function MergeEnabledBadge({
  enabled,
  pin,
  tenantPaused = false,
  testId,
}: {
  enabled: boolean;
  pin: PinChoice;
  tenantPaused?: boolean;
  testId?: string;
}) {
  const inherited = pin === "inherit";
  const color = enabled
    ? "border-green-500/60 text-green-300"
    : "border-red-500/60 text-red-300";
  return (
    <Badge
      variant="outline"
      className={`uppercase tracking-wide ${color} ${
        inherited ? "border-dashed" : ""
      }`}
      title={pinSentence(pin, enabled, tenantPaused)}
      data-testid={testId}
      data-pin={pin}
    >
      {enabled ? "merges on" : "merges off"}
      <span className="ml-1 normal-case opacity-70">
        {inherited ? "· inherited" : "· pinned"}
      </span>
    </Badge>
  );
}
