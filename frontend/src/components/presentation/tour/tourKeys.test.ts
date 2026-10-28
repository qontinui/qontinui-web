/**
 * Which arrow-key presses move the tour (plan
 * `2026-10-23-console-presentation-spaces` D5): ArrowLeft and ArrowRight,
 * and only when the page is not already using the key — not handled first,
 * no modifier, not a repeat or a composition, and focus not in an editable
 * control or a composite widget (the digital twin's tabs move on arrows).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  ARROW_KEY_WIDGET_ROLES,
  focusKeepsArrowKeys,
  tourKeyDirection,
  type TourKeyEvent,
} from "./tourKeys";

afterEach(() => {
  document.body.innerHTML = "";
});

function press(over: Partial<TourKeyEvent> = {}): TourKeyEvent {
  return {
    key: "ArrowRight",
    defaultPrevented: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    target: document.body,
    ...over,
  };
}

/** Mount `html` in the document and return its element marked `data-target`. */
function mount(html: string): Element {
  document.body.innerHTML = html;
  const target = document.body.querySelector("[data-target]");
  if (!target) throw new Error("no [data-target] in the fixture");
  return target;
}

describe("tourKeyDirection", () => {
  it("moves on the two arrow keys, and on nothing else", () => {
    expect(tourKeyDirection(press({ key: "ArrowLeft" }))).toBe("previous");
    expect(tourKeyDirection(press({ key: "ArrowRight" }))).toBe("next");
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "PageDown", "n"]) {
      expect(tourKeyDirection(press({ key })), key).toBeNull();
    }
  });

  it("leaves a press something already handled", () => {
    expect(tourKeyDirection(press({ defaultPrevented: true }))).toBeNull();
  });

  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey"] as const)(
    "leaves a press with %s held",
    (modifier) => {
      expect(tourKeyDirection(press({ [modifier]: true }))).toBeNull();
    }
  );

  it("leaves a held key's repeats and an IME composition", () => {
    expect(tourKeyDirection(press({ repeat: true }))).toBeNull();
    expect(tourKeyDirection(press({ isComposing: true }))).toBeNull();
  });

  it("moves with focus on the page itself or on a link", () => {
    expect(tourKeyDirection(press({ target: document.body }))).toBe("next");
    const link = mount('<a href="/x" data-target>Next</a>');
    expect(tourKeyDirection(press({ target: link }))).toBe("next");
    const button = mount('<button type="button" data-target>End tour</button>');
    expect(tourKeyDirection(press({ target: button }))).toBe("next");
  });
});

describe("focus that keeps the arrow keys", () => {
  it.each([
    ['<input data-target type="text" />', "a text input"],
    ['<input data-target type="range" />', "a range input"],
    ["<textarea data-target></textarea>", "a textarea"],
    ["<select data-target><option>a</option></select>", "a select"],
    ['<div contenteditable="true" data-target></div>', "editable content"],
    ['<div contenteditable data-target></div>', "bare contenteditable"],
    ['<div contenteditable="true"><p data-target>x</p></div>', "inside editable content"],
  ])("keeps them in %s (%s)", (html) => {
    const target = mount(html);
    expect(tourKeyDirection(press({ target }))).toBeNull();
  });

  it("does not keep them in content that is explicitly not editable", () => {
    const target = mount('<div contenteditable="false" data-target>x</div>');
    expect(tourKeyDirection(press({ target }))).toBe("next");
  });

  it.each([...ARROW_KEY_WIDGET_ROLES])(
    "keeps them inside role=%s",
    (role) => {
      const target = mount(
        `<div role="${role}"><span tabindex="0" data-target>x</span></div>`
      );
      expect(tourKeyDirection(press({ target }))).toBeNull();
    }
  );

  it("names every role the tour leaves the arrow keys to", () => {
    expect([...ARROW_KEY_WIDGET_ROLES].sort()).toEqual(
      [
        "application",
        "combobox",
        "grid",
        "gridcell",
        "listbox",
        "menu",
        "menubar",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "radio",
        "radiogroup",
        "searchbox",
        "slider",
        "spinbutton",
        "tab",
        "tablist",
        "textbox",
        "toolbar",
        "tree",
        "treegrid",
        "treeitem",
      ].sort()
    );
  });

  it("reads the focused element when the event's target is not an element", () => {
    const input = mount('<input data-target type="text" />') as HTMLInputElement;
    input.focus();
    expect(focusKeepsArrowKeys(window)).toBe(true);
    input.blur();
    expect(focusKeepsArrowKeys(window)).toBe(false);
  });
});
