/**
 * A page guard for a unit test that mounts one piece of the prompt-documents
 * page on its own: a settings section, or the clause manager. A test fixture,
 * imported by tests only. `PromptDocumentsCrossTab.test.tsx` must not import
 * it: that suite drives the real provider through `PromptDocumentList`.
 *
 * The section hooks and `useClauses` read the page's guard from
 * `PageWriteGuardProvider`, and throw without one. Production mounts them only
 * under the page. A unit test of a section's own logic provides a guard of its
 * own here. (`usePublishAll` reads no guard: its caller hands it one, so its
 * suite passes its own.)
 *
 * By default the guard answers as the real provider does: a write is refused
 * while there is no pin to send it in, and allowed once there is. A suite
 * whose writes go out with no pin, so that its requests are asserted exactly
 * as the section builds them, opts in by name to `UNPINNED_WRITES_ALLOWED`,
 * the one answer the real provider never gives. What the real provider does
 * is proven by the page-level suites (`PromptDocumentsCrossTab`,
 * `PromptDocumentsPageCrossTab`, `PromptDocumentsPageSettingsCrossTab`,
 * `usePageWriteGuard.test.tsx`).
 */

import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import {
  PageWriteGuardContext,
  type PageWriteGuardValue,
} from "../_hooks/usePageWriteGuardContext";

/**
 * A page guard answering as the real provider does, unless `overrides` say
 * otherwise: nothing stored differs from the page's project, and a write is
 * allowed only while there is a pin (`overrides.pin`, which `resolvePin` also
 * answers).
 */
export function testPageGuard(
  overrides: Partial<PageWriteGuardValue> = {}
): PageWriteGuardValue {
  const pin = overrides.pin;
  return {
    pageTenant: undefined,
    mountTenant: null,
    tenantContext: null,
    locked: null,
    writeAllowed: () => pin !== undefined,
    projectUnchanged: () => true,
    crossTabInEffect: () => false,
    pin,
    resolvePin: () => pin,
    ...overrides,
  };
}

/**
 * Every write allowed, and nothing pinned: the answer the real provider never
 * gives, since it refuses a write it cannot pin. For a suite that tests a
 * section's own writes, sent with no pin so its requests are asserted exactly
 * as the section builds them. Opted into by name.
 */
export const UNPINNED_WRITES_ALLOWED: PageWriteGuardValue = testPageGuard({
  writeAllowed: () => true,
});

/** A wrapper rendering its children under `guard`. */
export function withPageGuard(
  guard: PageWriteGuardValue
): (props: { children: ReactNode }) => ReactElement {
  return function TestPageWriteGuard({ children }) {
    return (
      <PageWriteGuardContext.Provider value={guard}>
        {children}
      </PageWriteGuardContext.Provider>
    );
  };
}

/**
 * `render`, mounting `ui` as one section of a page under `guard`. Made once
 * per suite: `const renderSection = sectionRenderer(guard)`, so the guard a
 * suite runs under is stated where the suite starts.
 */
export function sectionRenderer(
  guard: PageWriteGuardValue
): (
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => ReturnType<typeof render> {
  const wrapper = withPageGuard(guard);
  return (ui, options = {}) => render(ui, { wrapper, ...options });
}
