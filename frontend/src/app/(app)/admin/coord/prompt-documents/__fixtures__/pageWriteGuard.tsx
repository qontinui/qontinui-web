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
 * The two guards exported here are states the real provider reaches. By
 * default it is the page on a first visit, before it knows its project:
 * nothing stored at mount, the page's project UNKNOWN, no pin — so a write is
 * refused and a settings section reads nothing (`useFirstPinnedRead`).
 * `PINNED_PAGE` is that page once the provider has named its project: the
 * page's project and its pin are that project, so every request is pinned to
 * it and a write is allowed. A suite that tests a section's reads and writes
 * takes `PINNED_PAGE`. `testPageGuard(overrides)` can also build a state the
 * provider never reaches (a write allowed with no pin, say); a test that does
 * says what it builds and why. What the real provider does is proven by the
 * page-level suites (`PromptDocumentsCrossTab`, `PromptDocumentsPageCrossTab`,
 * `PromptDocumentsPageSettingsCrossTab`, `usePageWriteGuard.test.tsx`).
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
 * The page once its provider has named its project, on a first visit: the
 * page's project is that project, every request is pinned to it, and a write
 * is allowed. Nothing was stored at mount.
 */
export const PINNED_PAGE: PageWriteGuardValue = testPageGuard({
  pageTenant: "t-page",
  pin: { tenant: "t-page" },
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
