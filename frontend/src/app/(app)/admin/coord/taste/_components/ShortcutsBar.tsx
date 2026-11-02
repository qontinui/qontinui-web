"use client";

/**
 * The keyboard-shortcut toggle and its one-line hint (WCAG 2.1.4). Rendered
 * by the page whenever the viewer may label — under the pair card, or under
 * the empty / budget-spent panel, which hosts the same keys (so `u` still
 * undoes after the last pair is answered).
 */
export function ShortcutsBar({
  shortcutsOn,
  onChange,
  canUndoOwn,
  scope,
}: {
  shortcutsOn: boolean;
  onChange: (on: boolean) => void;
  /** Whether the viewer has a label of their own in the recent list. */
  canUndoOwn: boolean;
  /** What hosts the keys right now: the pair card, or the panel shown when
   *  there is no pair to answer. */
  scope: "card" | "panel";
}) {
  const where = scope === "card" ? "this card" : "the panel above";
  const hint = !shortcutsOn
    ? "Shortcuts are off: only the buttons answer."
    : scope === "card"
      ? `Keys work while ${where} has focus — click it or Tab to it. Esc leaves a text field${canUndoOwn ? "; u undoes your newest label" : ""}.`
      : canUndoOwn
        ? `No pair to answer: u undoes your newest label while ${where} has focus.`
        : "No pair to answer, and no label of yours to undo.";
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <label className="inline-flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={shortcutsOn}
          onChange={(e) => onChange(e.target.checked)}
          data-testid="taste-shortcuts-toggle"
        />
        Keyboard shortcuts
      </label>
      <span data-testid="taste-shortcuts-hint">{hint}</span>
    </div>
  );
}
