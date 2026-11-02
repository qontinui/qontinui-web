/**
 * tourKeys — which arrow-key presses move the tour (plan
 * `2026-10-23-console-presentation-spaces` D5: "previous/next, arrow
 * keys"), as one pure decision.
 *
 * ArrowLeft goes to the previous stop and ArrowRight to the next, but a key
 * the page is already using is never taken from it. A press moves the tour
 * only when ALL of these hold:
 *
 * - nothing handled it first (`defaultPrevented` is false) — a widget that
 *   consumes an arrow key says so by preventing its default;
 * - no modifier is held (Alt+Left is the browser's Back, Shift+Arrow extends
 *   a selection, Ctrl/Cmd+Arrow move by word or line);
 * - it is not a key repeat (holding the key would fly through every stop)
 *   and not part of an IME composition;
 * - focus is not inside an editable control or a composite widget, which
 *   uses the arrow keys itself: an input, a textarea, a select, editable
 *   content, or anything with one of {@link ARROW_KEY_WIDGET_ROLES} — the
 *   digital twin's own tabs among them, which move between tabs on the
 *   arrows.
 */

/** The roles of widgets that use the arrow keys themselves. */
export const ARROW_KEY_WIDGET_ROLES: readonly string[] = [
  "tab",
  "tablist",
  "slider",
  "listbox",
  "option",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "grid",
  "gridcell",
  "treegrid",
  "radiogroup",
  "radio",
  "spinbutton",
  "combobox",
  "tree",
  "treeitem",
  "textbox",
  "searchbox",
  "toolbar",
  "application",
];

/** Focus inside any of these keeps the arrow keys for the page. */
export const ARROW_KEY_WIDGET_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  ...ARROW_KEY_WIDGET_ROLES.map((role) => `[role="${role}"]`),
].join(",");

export type TourDirection = "previous" | "next";

/** The parts of a `keydown` the decision reads. */
export interface TourKeyEvent {
  readonly key: string;
  readonly defaultPrevented: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly target: EventTarget | null;
}

/** Whether the element that has focus keeps the arrow keys for itself. */
export function focusKeepsArrowKeys(target: EventTarget | null): boolean {
  const focused =
    target instanceof Element
      ? target
      : typeof document === "undefined"
        ? null
        : document.activeElement;
  return focused !== null && focused.closest(ARROW_KEY_WIDGET_SELECTOR) !== null;
}

/** Where a key press moves the tour, or `null` when it is not the tour's. */
export function tourKeyDirection(event: TourKeyEvent): TourDirection | null {
  const direction =
    event.key === "ArrowLeft"
      ? "previous"
      : event.key === "ArrowRight"
        ? "next"
        : null;
  if (direction === null) return null;
  if (event.defaultPrevented) return null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }
  if (event.repeat || event.isComposing) return null;
  if (focusKeepsArrowKeys(event.target)) return null;
  return direction;
}
