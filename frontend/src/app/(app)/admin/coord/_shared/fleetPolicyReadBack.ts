import { toast } from "sonner";
import type { FleetPolicyView } from "@/lib/api/operations/tenantPolicy";

/**
 * What a dial says when what resolves is not the level it wrote: a write that
 * landed and a value that resolves are different facts. `resolvers` names who
 * resolves it, with its verb ("devices resolve", "the worker resolves"). One
 * sentence for every dial that reads its level back, so the copies cannot
 * drift.
 */
export function resolvedOtherwise(
  level: string,
  resolvers: string,
  view: FleetPolicyView
): string {
  return (
    `Wrote "${level}", but ${resolvers} ` +
    `"${view.effective_level}" ` +
    `(from the ${view.resolved_scope} scope).`
  );
}

/** What a dial's re-read after a failed read-back says, and how it reads. */
export interface RereadAfterWrite {
  /**
   * The dial's read: the view it applied, or `null` when it failed, sent
   * nothing, or was discarded because a newer write landed. It reports its
   * own failure.
   */
  read: () => Promise<FleetPolicyView | null>;
  /** The level the write sent. */
  level: string;
  /** The read-back's success sentence for `level` ("… now \"on\" …"). */
  confirmed: string;
  /** Who resolves the level, with its verb, for `resolvedOtherwise`. */
  resolvers: string;
  /** Say that the re-read itself went wrong, as the dial's read error. */
  onError: (err: unknown) => void;
}

/**
 * After a write whose read-back failed: read the level again, so what the
 * dial shows becomes coord's, and say what a read-back would have said —
 * `confirmed` when coord resolves the level written, `resolvedOtherwise` when
 * it does not. A read that failed or was discarded says nothing here: its own
 * error, or the newer write's read-back, speaks for it.
 */
export async function rereadAfterFailedReadBack({
  read,
  level,
  confirmed,
  resolvers,
  onError,
}: RereadAfterWrite): Promise<void> {
  try {
    const view = await read();
    if (view === null) return;
    if (view.effective_level === level) {
      toast.success(confirmed);
    } else {
      toast.warning(resolvedOtherwise(level, resolvers, view));
    }
  } catch (err) {
    onError(err);
  }
}
