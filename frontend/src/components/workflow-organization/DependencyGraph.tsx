/**
 * Dependency Graph - Re-export shim
 *
 * The implementation has been split into focused sub-modules under ./dependency-graph/.
 * This file re-exports the component for backward compatibility with existing imports.
 *
 * Canonical location: ./dependency-graph/
 */

export { DependencyGraph } from "./dependency-graph";
export type { DependencyGraphProps } from "./dependency-graph";
