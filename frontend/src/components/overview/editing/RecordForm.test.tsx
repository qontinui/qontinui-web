import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordForm } from "./RecordForm";
import { RECURRING_COST_FORM, blankRecurringCost } from "./registry";

/**
 * The single-record form: a submit that throws still ends the "Saving…"
 * state and says what went wrong, and a choice the served schema does not
 * accept is refused before any write.
 */

afterEach(cleanup);

function fill() {
  fireEvent.change(screen.getByLabelText("What it is"), {
    target: { value: "Domain" },
  });
  fireEvent.change(screen.getByLabelText("Amount per charge"), {
    target: { value: "15" },
  });
  fireEvent.change(screen.getByLabelText("Charged"), {
    target: { value: "annual" },
  });
  fireEvent.change(screen.getByLabelText("First charged on"), {
    target: { value: "2026-01-02" },
  });
}

describe("RecordForm", () => {
  it("resets saving when the submit throws", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("network down"));
    render(
      <RecordForm
        form={RECURRING_COST_FORM}
        initial={blankRecurringCost("v1", "USD")}
        schema={undefined}
        onSubmit={onSubmit}
        onDone={() => undefined}
        uiBridgeId="t"
        currencyLocked
      />
    );
    fill();
    fireEvent.click(screen.getByText("Add recurring cost"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("network down")
    );
    const save = screen.getByText("Add recurring cost").closest("button")!;
    expect(save.disabled).toBe(false);
  });

  it("refuses a choice the served schema does not accept", () => {
    const onSubmit = vi.fn();
    render(
      <RecordForm
        form={RECURRING_COST_FORM}
        initial={blankRecurringCost("v1", "USD")}
        schema={{
          type: "object",
          properties: {
            cadence: { type: "string", enum: ["monthly"] },
          },
        }}
        onSubmit={onSubmit}
        onDone={() => undefined}
        uiBridgeId="t"
        currencyLocked
      />
    );
    fill();
    fireEvent.click(screen.getByText("Add recurring cost"));
    expect(
      document.querySelector('[data-ui-bridge-id="t.cadence.error"]')
        ?.textContent
    ).toBe("Charged isn't one of the allowed values.");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
