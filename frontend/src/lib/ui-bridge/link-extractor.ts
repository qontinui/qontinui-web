/**
 * link-extractor.ts
 *
 * Pure functions for transforming SDK element responses into typed elements
 * and extracting navigable links. Extracted from use-inspector.ts.
 */

import type { ExternalElement } from "@/hooks/use-inspector";
import type { DiscoveredLink } from "@/lib/ui-bridge/types";

// =============================================================================
// Response unwrapping
// =============================================================================

/**
 * Unwrap an SDK proxy element response envelope.
 * Handles: wrapped.data.elements, wrapped.data (array), wrapped.elements, raw array.
 */
export function unwrapElementResponse(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];

  const wrapped = raw as Record<string, unknown>;

  if (
    wrapped.data &&
    typeof wrapped.data === "object" &&
    !Array.isArray(wrapped.data)
  ) {
    const inner = wrapped.data as Record<string, unknown>;
    return (inner.elements ?? []) as unknown[];
  }
  if (Array.isArray(wrapped.data)) return wrapped.data;
  if (wrapped.elements) return wrapped.elements as unknown[];

  return [];
}

// =============================================================================
// Element transform
// =============================================================================

/**
 * Transform raw SDK elements into ExternalElement shape.
 * SDK elements have: { id, type, label, state: { visible, enabled, rect, textContent }, actions, category }
 */
export function transformSdkElements(rawElems: unknown[]): ExternalElement[] {
  return rawElems.map((raw) => {
    const el = raw as Record<string, unknown>;
    const state = (el.state ?? {}) as Record<string, unknown>;
    const rect = (state.rect ?? {}) as Record<string, number>;
    const identifier = (el.identifier ?? {}) as Record<string, unknown>;

    return {
      id: (el.id as string) ?? "",
      tagName: (el.tagName as string) ?? (el.type as string) ?? "",
      type: (el.type as string) ?? "",
      bounds: {
        x: rect.x ?? rect.left ?? 0,
        y: rect.y ?? rect.top ?? 0,
        width: rect.width ?? 0,
        height: rect.height ?? 0,
      },
      visible: (state.visible as boolean) ?? true,
      enabled: (state.enabled as boolean) ?? true,
      focused: (state.focused as boolean) ?? false,
      value: state.value as string | undefined,
      text: (el.label as string) ?? (state.textContent as string) ?? undefined,
      label: (el.label as string) ?? undefined,
      actions: (el.actions as string[]) ?? [],
      role: (el.role as string) ?? undefined,
      accessibleName: (el.accessibleName as string) ?? undefined,
      is_interactive: el.category === "interactive",
      interactive: el.category === "interactive",
      ref: (identifier.uiId as string) ?? undefined,
      selector: (identifier.selector as string) ?? undefined,
      href: (el.href as string) ?? (state.href as string) ?? undefined,
      dataRoute: (state.dataRoute as string) ?? undefined,
    } as ExternalElement;
  });
}

// =============================================================================
// Link extraction
// =============================================================================

/**
 * Extract navigable links from discovered elements.
 * Looks for: elements with data-route, anchor elements with href.
 *
 * @param elems - Transformed elements
 * @param appOrigin - Origin URL of the connected app (e.g. "http://localhost:3001")
 *                    Used to filter internal-only links. If omitted, only relative paths are kept.
 */
export function extractLinks(
  elems: ExternalElement[],
  appOrigin?: string
): DiscoveredLink[] {
  const links: DiscoveredLink[] = [];
  const seenUrls = new Set<string>();

  const addLink = (url: string, text: string) => {
    if (!seenUrls.has(url)) {
      seenUrls.add(url);
      links.push({ url, text });
    }
  };

  for (const el of elems) {
    const id = el.id || "";
    const label =
      el.text?.replace(/hidden$/i, "").trim() ||
      el.label?.replace(/hidden$/i, "").trim() ||
      "";

    // 1. Elements with data-route (nav items, route buttons)
    if (el.dataRoute && !el.dataRoute.includes(":")) {
      addLink(el.dataRoute, label || id);
      continue;
    }

    // 2. Anchor/link elements with href
    if (
      (el.tagName === "a" || el.tagName === "A" || el.role === "link") &&
      el.href
    ) {
      try {
        const href = el.href;
        if (
          href.startsWith("/") ||
          (appOrigin && href.startsWith(new URL(appOrigin).origin))
        ) {
          const normalizedUrl = href.startsWith("/")
            ? href
            : new URL(href).pathname;
          addLink(normalizedUrl, label || el.accessibleName || normalizedUrl);
        }
      } catch {
        // Invalid URL — skip
      }
    }
  }

  return links.sort((a, b) => a.url.localeCompare(b.url));
}
