"use client";

import type { CommandProvenance } from "../types";

/**
 * Where the body a spawned session receives actually comes from.
 *
 * `Default` is an ABSENCE, not a stored record: the backend holds no default
 * row, so "no override" is the whole signal. The tooltip says that plainly
 * rather than implying qontinui-web knows what the default contains.
 */
export function ProvenanceBadge({
  provenance,
}: {
  provenance: CommandProvenance;
}) {
  if (provenance === "customized") {
    return (
      <span
        className="badge badge-info"
        title="This account stores an override. Spawned sessions get this body instead of the runner's embedded one."
      >
        Customized
      </span>
    );
  }
  return (
    <span
      className="badge badge-muted"
      title="No override stored for this account, so sessions get the copy embedded in the runner binary. qontinui-web holds no copy of that body."
    >
      Default
    </span>
  );
}
