"use client";

import { ArrowRight, Code2, MessageSquare } from "lucide-react";
import { useUIElement } from "@qontinui/ui-bridge/react";
import { Button } from "@/components/ui/button";
import { NAVIGATION_ONLY_PROPS } from "@/components/presentation";

/**
 * The sub-space drawer's three buttons, each registering its UI Bridge id
 * where it renders, and only while it does.
 *
 * The SDK goes looking for a registration whose element is not on screen:
 * `useUIElement` polls the DOM for it, 3 tries 100 ms apart
 * (`pollForTaggedElement`), and unmounting does not stop the poll. The drawer
 * stays mounted while no row is open, and each button renders only for some
 * rows and modes. So a registration in the drawer itself would start up to
 * three polls on every mount of the Completeness and Lifecycle views. Each
 * would read `document` after a test's environment had gone, and each would
 * look for an element the page never meant to show.
 */

/** "Ask the Twin about this" — the caller puts it inside `OperatorOnly`. */
export function DrawerAskButton({ onClick }: { onClick: () => void }) {
  const { ref } = useUIElement({
    id: "digital-twin-drawer-ask",
    label: "Ask the Twin about this sub-space (opens the Completeness tab)",
    type: "button",
  });
  return (
    <Button
      ref={ref}
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={onClick}
    >
      <MessageSquare aria-hidden="true" className="size-3.5" />
      Ask the Twin about this
    </Button>
  );
}

/** "Open the Delivery tab" — navigation-only: it changes what is displayed. */
export function DrawerOpenDeliveryButton({ onClick }: { onClick: () => void }) {
  const { ref } = useUIElement({
    id: "digital-twin-drawer-open-delivery",
    label: "Open the Delivery tab from the sub-space drawer",
    type: "button",
  });
  return (
    <Button
      ref={ref}
      {...NAVIGATION_ONLY_PROPS}
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={onClick}
    >
      Open the Delivery tab
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

/** The raw-data toggle — the caller puts it inside `OperatorOnly`. */
export function DrawerShowRawButton({
  showRaw,
  onToggle,
}: {
  showRaw: boolean;
  onToggle: () => void;
}) {
  const { ref } = useUIElement({
    id: "digital-twin-show-raw",
    label: "Toggle the raw DriftVerdict JSON in the sub-space drawer",
    type: "button",
  });
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={onToggle}
    >
      <Code2 className="size-3.5" />
      {showRaw ? "Hide raw data" : "Show raw data"}
    </Button>
  );
}
