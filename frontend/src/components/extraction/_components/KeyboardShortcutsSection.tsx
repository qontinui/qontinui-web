/**
 * Keyboard Shortcuts guideline section content.
 */

import { GuidelineSection } from "./GuidelineSection";
import { KEYBOARD_SHORTCUTS } from "./annotation-guidelines-data";

export function KeyboardShortcutsSection() {
  return (
    <GuidelineSection title="5. Keyboard Shortcuts">
      <div className="grid grid-cols-2 gap-2 text-sm">
        {KEYBOARD_SHORTCUTS.map((shortcut) => (
          <div
            key={shortcut.shortcut}
            className="flex justify-between p-2 bg-surface-canvas rounded"
          >
            <span className="text-text-secondary">{shortcut.label}</span>
            <kbd className="px-2 py-0.5 bg-surface-raised rounded text-xs font-mono">
              {shortcut.shortcut}
            </kbd>
          </div>
        ))}
      </div>
    </GuidelineSection>
  );
}
