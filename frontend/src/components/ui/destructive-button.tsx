"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "./button";

type ButtonProps = React.ComponentProps<typeof Button>;

export type DestructiveButtonProps = Omit<ButtonProps, "variant">;

/**
 * Returns true when the click event was NOT initiated by a real user —
 * i.e. it was dispatched programmatically (UI Bridge SDK, Selenium,
 * Playwright in jsdom mode, hand-rolled `element.click()`). Per the DOM
 * spec, `event.isTrusted` is `true` only when the user agent generated
 * the event itself, and JS cannot fake that flag.
 *
 * Exported so the gate logic can be unit-tested independently of jsdom,
 * which makes `isTrusted` non-configurable on real events.
 */
export function isSyntheticClick(event: { isTrusted: boolean }): boolean {
  return !event.isTrusted;
}

/**
 * Button for user-confirmed destructive actions (delete, drop, revoke,
 * rotate, approve, etc.).
 *
 * Visually identical to `<Button variant="destructive">`, but the onClick
 * handler is gated against synthetic (bridge-issued) clicks. A click whose
 * `event.isTrusted` is `false` — e.g. dispatched by the UI Bridge SDK or
 * any programmatic `.click()` / synthesized `MouseEvent` — is intercepted,
 * a warning is logged, and a toast surfaces the block to the user. Real
 * user clicks (`event.isTrusted === true`) pass through unchanged.
 *
 * Defense in depth: even with a future production-safe UI Bridge that
 * authenticates per-user and rate-limits, destructive operations should
 * still require a fresh human keystroke that the bridge cannot synthesize.
 *
 * Cross-link: plans/2026-05-28-production-safe-ui-bridge-design.md §4.4.
 */
export function DestructiveButton({
  onClick,
  ...props
}: DestructiveButtonProps) {
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (isSyntheticClick(event)) {
        event.preventDefault();
        event.stopPropagation();
        console.warn(
          "[DestructiveButton] blocked synthetic click; destructive actions require a real keystroke",
        );
        toast.warning("Destructive actions require a real keystroke", {
          description:
            "This action was triggered programmatically and was blocked. Click the button yourself to proceed.",
        });
        return;
      }
      onClick?.(event);
    },
    [onClick],
  );

  return <Button {...props} variant="destructive" onClick={handleClick} />;
}
