import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { useFocusAfterRender } from "./focus";

function Renamer({ save }: { save: () => Promise<void> }) {
  const [editing, setEditing] = useState(true);
  const opener = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useFocusAfterRender();
  return editing ? (
    <button
      onClick={async () => {
        await save();
        // The opener mounts only in the render this update causes.
        setEditing(false);
        focusAfterRender(opener);
      }}
    >
      Save name
    </button>
  ) : (
    <button ref={opener} onClick={() => setEditing(true)}>
      Rename
    </button>
  );
}

describe("useFocusAfterRender", () => {
  it("focuses an element that the update after an await mounts", async () => {
    let finish: () => void = () => {};
    render(<Renamer save={() => new Promise<void>((r) => (finish = r))} />);
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await act(async () => finish());
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rename" })
    );
  });
});
