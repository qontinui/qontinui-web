/**
 * `PlanSearchBox` follows an externally changed `applied` search — without
 * fighting an edit the operator is still typing.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlanSearchBox } from "./PlanSearchBox";

describe("PlanSearchBox", () => {
  it("syncs the box when applied changes from outside", () => {
    const onSearch = vi.fn();
    const { rerender } = render(
      <PlanSearchBox applied="" onSearch={onSearch} />
    );
    rerender(<PlanSearchBox applied="merge" onSearch={onSearch} />);
    expect(screen.getByTestId("coord-plans-search")).toHaveValue("merge");
  });

  it("keeps an in-progress edit when applied changes underneath it", () => {
    const onSearch = vi.fn();
    const { rerender } = render(
      <PlanSearchBox applied="" onSearch={onSearch} />
    );
    fireEvent.change(screen.getByTestId("coord-plans-search"), {
      target: { value: "half-typ" },
    });
    rerender(<PlanSearchBox applied="merge" onSearch={onSearch} />);
    expect(screen.getByTestId("coord-plans-search")).toHaveValue("half-typ");
  });
});
