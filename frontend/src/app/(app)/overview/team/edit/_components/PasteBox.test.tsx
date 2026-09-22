import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasteBox } from "./PasteBox";

/**
 * The three-step contract this component exists to enforce — paste, see what
 * was read, then decide — and the `busy` guard, which had no test at all
 * until a review pointed out that "each fix was confirmed red" could not be
 * true of a fix with nothing to run against it.
 */

const parse = (text: string) => ({
  rows: text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== ""),
  issues: text.includes("bad")
    ? [
        {
          line: 1,
          text,
          message: "that row could not be read",
          severity: "error" as const,
        },
      ]
    : [],
});

function renderBox(
  props: Partial<React.ComponentProps<typeof PasteBox<string>>> = {}
) {
  const onApply = vi.fn();
  render(
    <PasteBox<string>
      id="test.paste"
      label="Paste the table"
      help="One row per line."
      placeholder="a,b,c"
      parse={parse}
      describe={(rows) => `${rows.length} row${rows.length === 1 ? "" : "s"}`}
      onApply={onApply}
      {...props}
    />
  );
  return { onApply };
}

const input = () => screen.getByLabelText("Paste the table");
const readButton = () => screen.getByRole("button", { name: "Read it" });
const applyButton = () => screen.getByRole("button", { name: "Use this" });

describe("PasteBox", () => {
  it("does not offer to apply anything until the text has been read", () => {
    renderBox();
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull();
    fireEvent.change(input(), { target: { value: "one\ntwo" } });
    // Typing alone is not reading.
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull();
    fireEvent.click(readButton());
    expect(applyButton()).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Read 2 rows");
  });

  it("applies only on the explicit button, and hands over what was read", () => {
    const { onApply } = renderBox();
    fireEvent.change(input(), { target: { value: "one\ntwo" } });
    fireEvent.click(readButton());
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith(["one", "two"]);
  });

  it("shows what could not be read, and still offers the rest", () => {
    renderBox();
    fireEvent.change(input(), { target: { value: "bad row" } });
    fireEvent.click(readButton());
    expect(screen.getByText("that row could not be read")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "1 row could not be read"
    );
  });

  it("forgets a previous reading as soon as the text changes", () => {
    renderBox();
    fireEvent.change(input(), { target: { value: "one" } });
    fireEvent.click(readButton());
    expect(applyButton()).toBeTruthy();
    fireEvent.change(input(), { target: { value: "one\ntwo" } });
    // The old result described text that is no longer there.
    expect(screen.queryByRole("button", { name: "Use this" })).toBeNull();
  });

  it("cannot apply while a save is in flight", () => {
    // Applying during an open save changes the working copy the request is
    // NOT carrying, and the reload that follows discards the change with no
    // trace. This is the guard that had no test.
    const { onApply } = renderBox({ busy: true });
    fireEvent.change(input(), { target: { value: "one" } });
    fireEvent.click(readButton());
    const apply = applyButton();
    expect(apply).toHaveProperty("disabled", true);
    fireEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("can apply again once the save has finished", () => {
    const { onApply } = renderBox({ busy: false });
    fireEvent.change(input(), { target: { value: "one" } });
    fireEvent.click(readButton());
    expect(applyButton()).toHaveProperty("disabled", false);
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("refuses to read an empty box", () => {
    renderBox();
    expect(readButton()).toHaveProperty("disabled", true);
  });
});
