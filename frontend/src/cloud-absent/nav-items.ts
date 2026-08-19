import type { NavItem } from "@/components/navigation/sidebar/types";

/**
 * OSS stand-in for `@cloud/nav-items`.
 *
 * The composed cloud build resolves `@cloud/nav-items` to
 * `qontinui-cloud-control/frontend/src/nav-items.ts`, which contributes the
 * Organizations and Billing sidebar entries. A self-hosted build has neither
 * feature, so it contributes nothing — and because the alias is resolved at
 * build time, the empty array is what webpack sees and there is no runtime
 * check to get wrong. See `docs/composed-cloud-build.md`.
 */
export const cloudNavItems: NavItem[] = [];
