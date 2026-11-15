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
  /** Say that the re-read itself threw, as the dial's read error. */
  onError: (err: unknown) => void;
}

/**
 * After a write whose read-back failed: read the level again, so what the
 * dial shows becomes coord's, and say what a read-back would have said —
 * `confirmed` when coord resolves the level written, `resolvedOtherwise` when
 * it does not. A read that failed or was discarded says nothing here: its own
 * error, or the newer write's read-back, speaks for it. Only the read is
 * guarded: a read that throws is reported through the dial and settles,
 * while what is said after it is not mistaken for a failed read beside a
 * level that read has just confirmed.
 */
export async function rereadAfterFailedReadBack({
  read,
  level,
  confirmed,
  resolvers,
  onError,
}: RereadAfterWrite): Promise<void> {
  let view: FleetPolicyView | null;
  try {
    view = await read();
  } catch (err) {
    onError(err);
    return;
  }
  if (view === null) return;
  if (view.effective_level === level) {
    toast.success(confirmed);
  } else {
    toast.warning(resolvedOtherwise(level, resolvers, view));
  }
}
