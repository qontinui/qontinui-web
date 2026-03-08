"use client";

/**
 * Render Log Context - DOM Snapshot Capture for State Discovery
 *
 * This provider captures DOM snapshots using MutationObserver for UI Bridge state discovery.
 * It sends snapshots to the backend API where they're stored in PostgreSQL.
 *
 * Features:
 * - Automatic mutation detection (childList, attributes, characterData)
 * - Navigation-triggered captures
 * - Debounced capture to prevent flooding
 * - Comprehensive DOM tree serialization with text, position, and styles
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
} from "react";
import { usePathname } from "next/navigation";

// Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DEBOUNCE_MS = 500; // Debounce captures to prevent flooding
const MAX_TEXT_LENGTH = 500; // Max text content per element
const MAX_DEPTH = 20; // Max DOM tree depth
const MAX_CHILDREN = 100; // Max children per element

// Types
interface DOMElementSnapshot {
  tag: string;
  id?: string;
  classList: string[];
  textContent?: string;
  innerHtmlLength?: number;
  rect?: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  opacity?: number;
  display?: string;
  attributes: Record<string, string>;
  computedStyles?: Record<string, string>;
  children: DOMElementSnapshot[];
}

interface RenderSnapshot {
  root: DOMElementSnapshot | null;
  totalElements: number;
  visibleText?: string;
  forms: Array<Record<string, unknown>>;
  links: Array<{ href: string; text: string }>;
  images: Array<{ src: string; alt?: string; width?: number; height?: number }>;
  errors: string[];
  warnings: string[];
}

interface RenderLogContextType {
  isEnabled: boolean;
  sessionId: string;
  captureNow: (trigger?: string) => void;
  lastCaptureTime: number | null;
}

// Context
const RenderLogContext = createContext<RenderLogContextType>({
  isEnabled: false,
  sessionId: "",
  captureNow: () => {},
  lastCaptureTime: null,
});

// Generate a unique session ID
function generateSessionId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Styles to capture (performance-sensitive, keep minimal)
const STYLES_TO_CAPTURE = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "display",
  "visibility",
  "opacity",
];

// Serialize a single DOM element
function serializeElement(
  element: Element,
  depth: number = 0
): DOMElementSnapshot | null {
  if (depth > MAX_DEPTH) return null;

  // Skip script, style, and noscript elements
  const tagName = element.tagName.toLowerCase();
  if (["script", "style", "noscript", "svg", "path"].includes(tagName)) {
    return null;
  }

  // Get bounding rect
  let rect: DOMElementSnapshot["rect"] | undefined;
  try {
    const boundingRect = element.getBoundingClientRect();
    rect = {
      x: Math.round(boundingRect.x),
      y: Math.round(boundingRect.y),
      width: Math.round(boundingRect.width),
      height: Math.round(boundingRect.height),
    };
  } catch {
    // getBoundingClientRect may fail for some elements
  }

  // Check visibility
  const computedStyle = window.getComputedStyle(element);
  const isVisible =
    computedStyle.display !== "none" &&
    computedStyle.visibility !== "hidden" &&
    parseFloat(computedStyle.opacity || "1") > 0;

  // Get direct text content (not from children)
  let textContent: string | undefined;
  const directTextNodes = Array.from(element.childNodes).filter(
    (node) => node.nodeType === Node.TEXT_NODE
  );
  if (directTextNodes.length > 0) {
    textContent = directTextNodes
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, MAX_TEXT_LENGTH);
  }

  // Get key attributes
  const attributes: Record<string, string> = {};
  const attributesToCapture = [
    "href",
    "src",
    "alt",
    "title",
    "aria-label",
    "data-testid",
    "name",
    "type",
    "value",
    "placeholder",
  ];
  for (const attr of attributesToCapture) {
    const value = element.getAttribute(attr);
    if (value) {
      attributes[attr] = value.slice(0, 200);
    }
  }

  // Get selected computed styles
  const computedStyles: Record<string, string> = {};
  for (const prop of STYLES_TO_CAPTURE) {
    const value = computedStyle.getPropertyValue(prop);
    if (value) {
      computedStyles[prop] = value;
    }
  }

  // Serialize children
  const children: DOMElementSnapshot[] = [];
  const childElements = element.children;
  for (let i = 0; i < Math.min(childElements.length, MAX_CHILDREN); i++) {
    const childElement = childElements[i];
    if (!childElement) continue;
    const childSnapshot = serializeElement(childElement, depth + 1);
    if (childSnapshot) {
      children.push(childSnapshot);
    }
  }

  return {
    tag: tagName,
    id: element.id || undefined,
    classList: Array.from(element.classList),
    textContent: textContent || undefined,
    innerHtmlLength: element.innerHTML.length,
    rect,
    isVisible,
    opacity: parseFloat(computedStyle.opacity || "1"),
    display: computedStyle.display,
    attributes,
    computedStyles:
      Object.keys(computedStyles).length > 0 ? computedStyles : undefined,
    children,
  };
}

// Capture the full DOM snapshot
function captureSnapshot(): RenderSnapshot {
  // Serialize DOM tree starting from body
  const root = document.body ? serializeElement(document.body) : null;

  // Count total elements
  let totalElements = 0;
  function countElements(snapshot: DOMElementSnapshot | null): void {
    if (!snapshot) return;
    totalElements++;
    snapshot.children.forEach(countElements);
  }
  countElements(root);

  // Extract visible text (truncated)
  const visibleText = document.body?.innerText?.slice(0, 5000);

  // Extract forms
  const forms: Array<Record<string, unknown>> = [];
  document.querySelectorAll("form").forEach((form) => {
    const inputs: Array<Record<string, string>> = [];
    form.querySelectorAll("input, select, textarea").forEach((input) => {
      inputs.push({
        type: (input as HTMLInputElement).type || input.tagName.toLowerCase(),
        name: (input as HTMLInputElement).name || "",
        value: (input as HTMLInputElement).value?.slice(0, 100) || "",
      });
    });
    forms.push({
      id: form.id,
      action: form.action,
      method: form.method,
      inputs,
    });
  });

  // Extract links
  const links: Array<{ href: string; text: string }> = [];
  document.querySelectorAll("a[href]").forEach((link) => {
    links.push({
      href: (link as HTMLAnchorElement).href.slice(0, 500),
      text: link.textContent?.trim().slice(0, 100) || "",
    });
  });

  // Extract images
  const images: Array<{
    src: string;
    alt?: string;
    width?: number;
    height?: number;
  }> = [];
  document.querySelectorAll("img").forEach((img) => {
    images.push({
      src: img.src.slice(0, 500),
      alt: img.alt || undefined,
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  });

  return {
    root,
    totalElements,
    visibleText,
    forms,
    links: links.slice(0, 100),
    images: images.slice(0, 50),
    errors: [], // Would need console capture for this
    warnings: [],
  };
}

// Provider component
export function RenderLogProvider({ children }: { children: React.ReactNode }) {
  const [sessionId] = useState(() => generateSessionId());
  const [lastCaptureTime, setLastCaptureTime] = useState<number | null>(null);
  const pathname = usePathname();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const lastMutationTypeRef = useRef<string | null>(null);
  const lastTargetSelectorRef = useRef<string | null>(null);

  // Get CSS selector for an element
  const getSelector = useCallback((element: Element): string => {
    if (element.id) return `#${element.id}`;
    if (element.className && typeof element.className === "string") {
      return `${element.tagName.toLowerCase()}.${element.className.split(" ").join(".")}`;
    }
    return element.tagName.toLowerCase();
  }, []);

  // Send snapshot to backend
  const sendSnapshot = useCallback(
    async (trigger: string, mutationType?: string, targetSelector?: string) => {
      try {
        const snapshot = captureSnapshot();

        const payload = {
          session_id: sessionId,
          page_url: window.location.href,
          page_title: document.title,
          trigger,
          mutation_type: mutationType || null,
          target_selector: targetSelector || null,
          snapshot: {
            root: snapshot.root,
            total_elements: snapshot.totalElements,
            visible_text: snapshot.visibleText,
            forms: snapshot.forms,
            links: snapshot.links,
            images: snapshot.images,
            errors: snapshot.errors,
            warnings: snapshot.warnings,
          },
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight,
          scroll_x: window.scrollX,
          scroll_y: window.scrollY,
          element_count: snapshot.totalElements,
        };

        const response = await fetch(`${API_BASE_URL}/api/v1/render-logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          setLastCaptureTime(Date.now());
        } else {
          // Silently fail - render logging is non-critical
          console.debug(
            "[RenderLog] Failed to send snapshot:",
            response.status
          );
        }
      } catch (error) {
        // Silently fail
        console.debug("[RenderLog] Error sending snapshot:", error);
      }
    },
    [sessionId]
  );

  // Debounced capture
  const debouncedCapture = useCallback(
    (trigger: string, mutationType?: string, targetSelector?: string) => {
      // Store mutation info for when the debounce fires
      if (mutationType) lastMutationTypeRef.current = mutationType;
      if (targetSelector) lastTargetSelectorRef.current = targetSelector;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        sendSnapshot(
          trigger,
          lastMutationTypeRef.current || undefined,
          lastTargetSelectorRef.current || undefined
        );
        lastMutationTypeRef.current = null;
        lastTargetSelectorRef.current = null;
      }, DEBOUNCE_MS);
    },
    [sendSnapshot]
  );

  // Manual capture (immediate, no debounce)
  const captureNow = useCallback(
    (trigger: string = "manual") => {
      sendSnapshot(trigger);
    },
    [sendSnapshot]
  );

  // Setup MutationObserver
  useEffect(() => {
    observerRef.current = new MutationObserver((mutations) => {
      // Find the most significant mutation
      let significantMutation: MutationRecord | null = null;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          significantMutation = mutation;
          break;
        }
        if (!significantMutation) {
          significantMutation = mutation;
        }
      }

      if (significantMutation) {
        const targetElement = significantMutation.target as Element;
        const selector =
          targetElement.nodeType === Node.ELEMENT_NODE
            ? getSelector(targetElement)
            : undefined;

        debouncedCapture("mutation", significantMutation.type, selector);
      }
    });

    observerRef.current.observe(document.body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [debouncedCapture, getSelector]);

  // Capture on navigation
  useEffect(() => {
    // Small delay to allow page to render
    const timer = setTimeout(() => {
      sendSnapshot("navigation");
    }, 100);

    return () => clearTimeout(timer);
  }, [pathname, sendSnapshot]);

  // Initial capture on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      sendSnapshot("mount");
    }, 500);

    return () => clearTimeout(timer);
  }, [sendSnapshot]);

  const value: RenderLogContextType = {
    isEnabled: true,
    sessionId,
    captureNow,
    lastCaptureTime,
  };

  return (
    <RenderLogContext.Provider value={value}>
      {children}
    </RenderLogContext.Provider>
  );
}

// Hook to use render log context
export function useRenderLog() {
  return useContext(RenderLogContext);
}

// Hook to manually trigger a capture
export function useRenderLogCapture() {
  const { captureNow, isEnabled } = useRenderLog();

  return useCallback(
    (trigger?: string) => {
      if (isEnabled) {
        captureNow(trigger);
      }
    },
    [captureNow, isEnabled]
  );
}
