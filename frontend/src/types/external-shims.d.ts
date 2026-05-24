/**
 * @qontinui/shared-types module augmentation for the coord MemorySummary
 * projection that the Rust schemas crate already defines
 * (qontinui-schemas/rust/src/memory.rs::MemorySummary) but which hasn't
 * been promoted to ts/src/memory.ts + index.ts re-export yet.
 *
 * Module-augmentation files MUST be modules themselves (have a top-level
 * import/export), hence the `export {}` below. Ambient `declare module`
 * blocks for OTHER packages (the @qontinui/ui-bridge-auto subpath shims)
 * live in `ui-bridge-auto-subpath-shims.d.ts` next door — that file is
 * intentionally NOT a module so the ambient declarations register
 * globally.
 *
 * TODO(qontinui-schemas): add ts/src/memory.ts mirroring the Rust struct
 * and re-export `MemorySummary` from ts/src/index.ts. Then bump
 * @qontinui/shared-types in qontinui-web/frontend/package.json and
 * delete this augmentation.
 */
export {};

declare module "@qontinui/shared-types" {
  /**
   * Lighter-weight projection for `GET /coord/memory/list` — strips the
   * (potentially-large) `content` blob so a list-all scan stays cheap.
   * Mirror of `qontinui-schemas/rust/src/memory.rs::MemorySummary`.
   */
  export interface MemorySummary {
    name: string;
    version: number;
    description?: string | null;
    type?: string | null;
    /** ISO-8601 timestamp. */
    written_at: string;
  }
}
