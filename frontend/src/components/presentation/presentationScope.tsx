"use client";

/**
 * presentationScope — the tenant data presentation-mode redaction reads (plan
 * `2026-10-23-console-presentation-spaces` D3.3).
 *
 * Two lists, both tenant data, both editable in operator mode only:
 *
 * - **first-party owners** — the GitHub owners whose repositories are the
 *   tenant's own. Free text about an item renders in presentation mode only
 *   when EVERY repository the item belongs to has one of these owners.
 * - **confidential terms** — words that withhold free text wherever they
 *   appear (customer and partner names, by default the names of the viewer's
 *   other organisations).
 *
 * This module is the seam between the data and its readers. It defines the
 * state shape and a context; `RedactedText` and `useRedactor` consume it, and
 * whatever loads the tenant's lists hands its state to
 * `PresentationScopeProvider`. **Until a provider says `ready`, the scope is
 * UNKNOWN and every redaction decision withholds**
 * — the context default is `{ status: "unknown" }`, so a lens page rendered
 * with no provider at all is fully redacted rather than fully revealed. A
 * blocklist that fails open shows a client's name to a prospective client;
 * over-redaction costs a descriptor instead of a title (D3).
 *
 * Field names are camelCase here; the wire shape is the provider's to map.
 */

import { createContext, useContext, type ReactNode } from "react";

export interface PresentationScope {
  /** GitHub owners whose repositories are first-party, matched case-insensitively. */
  readonly firstPartyOwners: readonly string[];
  /**
   * Terms that withhold free text, matched ignoring case, accents, spacing and
   * punctuation ("Acme Corp" matches "ACME-corp").
   */
  readonly confidentialTerms: readonly string[];
}

/**
 * The scope as its reader sees it. Only `ready` carries lists; the other three
 * are reasons the lists are not known, and every one of them redacts.
 */
export type PresentationScopeState =
  | { readonly status: "unknown" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly reason: string }
  | { readonly status: "ready"; readonly scope: PresentationScope };

/** The context default: nobody has said what the scope is. */
export const PRESENTATION_SCOPE_UNKNOWN: PresentationScopeState = {
  status: "unknown",
};

const PresentationScopeContext = createContext<PresentationScopeState>(
  PRESENTATION_SCOPE_UNKNOWN
);

export interface PresentationScopeProviderProps {
  state: PresentationScopeState;
  children: ReactNode;
}

/** Supplies the scope state to every `RedactedText` below it. */
export function PresentationScopeProvider({
  state,
  children,
}: PresentationScopeProviderProps) {
  return (
    <PresentationScopeContext.Provider value={state}>
      {children}
    </PresentationScopeContext.Provider>
  );
}

/** The scope as the nearest provider states it — `unknown` with none. */
export function usePresentationScopeState(): PresentationScopeState {
  return useContext(PresentationScopeContext);
}
