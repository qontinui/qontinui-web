/**
 * A page guard for a unit test that mounts one piece of the prompt-documents
 * page on its own: a settings section, or the clause manager. Imported by
 * tests only.
 *
 * The section hooks, `useClauses` and `usePublishAll` take the page's guard
 * from `PageWriteGuardProvider` and throw without one. Production mounts them
 * only under the page, and an answer for "outside a page" would have to allow
 * every write and pin none, which reads as "allowed" exactly where nothing
 * guards (plan `2026-11-09-prompt-documents-cross-tab-write-guard`, review
 * round 1, A3). A unit test of a section's own logic opts in to that answer
 * here, explicitly. What the real provider does is proven by the page-level
 * suites (`PromptDocumentsCrossTab`, `PromptDocumentsPageCrossTab`,
 * `PromptDocumentsPageSettingsCrossTab`, `usePageWriteGuard.test.tsx`).
 */

import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import {
  PageWriteGuardContext,
  type PageWriteGuardValue,
} from "./usePageWriteGuardContext";

/**
 * A page guard that allows every write and pins none, unless `overrides` say
 * otherwise. A `pin` override is also what `resolvePin` answers.
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
    writeAllowed: () => true,
    projectUnchanged: () => true,
    crossTabInEffect: () => false,
    pin,
    resolvePin: () => pin,
    ...overrides,
  };
}

/** One value for every default mount, so its functions keep one identity. */
const ALLOW_ALL = testPageGuard();

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

/** The default wrapper: every write allowed, nothing pinned. */
export const AllowAllPageGuard = withPageGuard(ALLOW_ALL);

/** `render`, with `ui` mounted as one section of a page whose guard allows every write. */
export function renderSection(
  ui: ReactElement,
  options: Omit<RenderOptions, "wrapper"> = {}
) {
  return render(ui, { wrapper: AllowAllPageGuard, ...options });
}
