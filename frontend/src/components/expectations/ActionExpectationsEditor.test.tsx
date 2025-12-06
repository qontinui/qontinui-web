/**
 * ActionExpectationsEditor Integration Tests
 *
 * Tests the action-level expectations editor component
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionExpectationsEditor } from "./ActionExpectationsEditor";
import type { ActionExpectations } from "@/lib/expectations/types";

describe("ActionExpectationsEditor", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  describe("Rendering", () => {
    it("should render all fields", () => {
      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("Action Expectations")).toBeInTheDocument();
      expect(screen.getByText("Terminal on Failure")).toBeInTheDocument();
      expect(screen.getByText("Capture on Failure")).toBeInTheDocument();
      expect(screen.getByText("Capture After Action")).toBeInTheDocument();
      expect(screen.getByText("Max Retries")).toBeInTheDocument();
      expect(screen.getByText("Retry Delay (ms)")).toBeInTheDocument();
      expect(screen.getByText("Max Duration (ms)")).toBeInTheDocument();
      expect(screen.getByText("Expected State After")).toBeInTheDocument();
    });

    it("should render with undefined expectations", () => {
      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      expect(switches).toHaveLength(3); // terminal, capture on failure, capture after
    });

    it("should render with existing expectations", () => {
      const expectations: ActionExpectations = {
        is_terminal_on_failure: false,
        capture_checkpoint_on_failure: true,
        capture_checkpoint_after: true,
        checkpoint_name: "test-checkpoint",
        max_retries: 3,
        retry_delay_ms: 2000,
        max_duration_ms: 10000,
        expected_state_after: "logged-in",
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByDisplayValue("test-checkpoint")).toBeInTheDocument();
      expect(screen.getByDisplayValue("3")).toBeInTheDocument();
      expect(screen.getByDisplayValue("2000")).toBeInTheDocument();
      expect(screen.getByDisplayValue("10000")).toBeInTheDocument();
      expect(screen.getByDisplayValue("logged-in")).toBeInTheDocument();
    });
  });

  describe("Terminal on Failure", () => {
    it("should toggle is_terminal_on_failure", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const terminalSwitch = switches[0];

      await user.click(terminalSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            is_terminal_on_failure: true, // Default is false, so clicking toggles to true
          })
        );
      });
    });

    it("should default to false", () => {
      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const terminalSwitch = switches[0] as HTMLInputElement;

      // Default should be unchecked (false)
      expect(terminalSwitch.getAttribute("data-state")).toBe("unchecked");
    });
  });

  describe("Capture on Failure", () => {
    it("should toggle capture_checkpoint_on_failure", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const captureFailureSwitch = switches[1];

      await user.click(captureFailureSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            capture_checkpoint_on_failure: true,
          })
        );
      });
    });

    it("should default to false", () => {
      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const captureFailureSwitch = switches[1] as HTMLInputElement;

      expect(captureFailureSwitch.getAttribute("data-state")).toBe("unchecked");
    });
  });

  describe("Capture After Action", () => {
    it("should toggle capture_checkpoint_after", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const captureAfterSwitch = switches[2];

      await user.click(captureAfterSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            capture_checkpoint_after: true,
          })
        );
      });
    });

    it("should show checkpoint name field when enabled", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      // Initially checkpoint name should not be visible
      expect(
        screen.queryByPlaceholderText("Enter checkpoint name")
      ).not.toBeInTheDocument();

      // Enable capture after action
      const switches = screen.getAllByRole("switch");
      await user.click(switches[2]);

      // Checkpoint name field should now be visible
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter checkpoint name")
        ).toBeInTheDocument();
      });
    });

    it("should hide checkpoint name field when disabled", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        capture_checkpoint_after: true,
        checkpoint_name: "test-checkpoint",
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      // Checkpoint name should be visible
      expect(screen.getByDisplayValue("test-checkpoint")).toBeInTheDocument();

      // Disable capture after action
      const switches = screen.getAllByRole("switch");
      await user.click(switches[2]);

      // Checkpoint name should be hidden
      await waitFor(() => {
        expect(
          screen.queryByDisplayValue("test-checkpoint")
        ).not.toBeInTheDocument();
      });
    });

    it("should update checkpoint_name", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        capture_checkpoint_after: true,
        checkpoint_name: "",
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "my-checkpoint");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            checkpoint_name: "my-checkpoint",
          })
        );
      });
    });
  });

  describe("Retry Configuration", () => {
    it("should update max_retries", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("0");
      await user.clear(input);
      await user.type(input, "5");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_retries: 5,
          })
        );
      });
    });

    it("should clear max_retries when input is cleared", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        max_retries: 3,
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("3");
      await user.clear(input);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_retries: undefined,
          })
        );
      });
    });

    it("should update retry_delay_ms", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("1000");
      await user.clear(input);
      await user.type(input, "3000");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            retry_delay_ms: 3000,
          })
        );
      });
    });

    it("should clear retry_delay_ms when input is cleared", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        retry_delay_ms: 2000,
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("2000");
      await user.clear(input);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            retry_delay_ms: undefined,
          })
        );
      });
    });
  });

  describe("Max Duration", () => {
    it("should update max_duration_ms", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("Inherit from global");
      await user.type(input, "15000");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_duration_ms: 15000,
          })
        );
      });
    });

    it("should clear max_duration_ms when input is cleared", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        max_duration_ms: 10000,
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("10000");
      await user.clear(input);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_duration_ms: undefined,
          })
        );
      });
    });
  });

  describe("Expected State After", () => {
    it("should update expected_state_after", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("State name");
      await user.type(input, "dashboard");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            expected_state_after: "dashboard",
          })
        );
      });
    });

    it("should clear expected_state_after", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        expected_state_after: "logged-in",
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("logged-in");
      await user.clear(input);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            expected_state_after: "",
          })
        );
      });
    });
  });

  describe("Integration Tests", () => {
    it("should handle multiple field updates", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      // Toggle terminal on failure
      const switches = screen.getAllByRole("switch");
      await user.click(switches[0]);

      // Set max retries
      const retriesInput = screen.getByPlaceholderText("0");
      await user.type(retriesInput, "3");

      // Set expected state
      const stateInput = screen.getByPlaceholderText("State name");
      await user.type(stateInput, "logged-in");

      // All changes should have been called
      expect(mockOnChange.mock.calls.length).toBeGreaterThan(2);
    });

    it("should preserve all fields across updates", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        is_terminal_on_failure: false,
        max_retries: 3,
        retry_delay_ms: 2000,
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      // Update capture on failure
      const switches = screen.getAllByRole("switch");
      await user.click(switches[1]);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            is_terminal_on_failure: false,
            max_retries: 3,
            retry_delay_ms: 2000,
            capture_checkpoint_on_failure: true,
          })
        );
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero values for numeric inputs", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const retriesInput = screen.getByPlaceholderText("0");
      await user.type(retriesInput, "0");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_retries: 0,
          })
        );
      });
    });

    it("should handle very large numeric values", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const durationInput = screen.getByPlaceholderText("Inherit from global");
      await user.type(durationInput, "9999999");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_duration_ms: 9999999,
          })
        );
      });
    });

    it("should handle all switches being enabled", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");

      // Enable all switches
      for (const switchEl of switches) {
        if (
          (switchEl as HTMLInputElement).getAttribute("data-state") ===
          "unchecked"
        ) {
          await user.click(switchEl);
        }
      }

      await waitFor(() => {
        const lastCall =
          mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
        expect(lastCall[0]).toMatchObject({
          capture_checkpoint_on_failure: true,
          capture_checkpoint_after: true,
        });
      });
    });

    it("should handle empty string for expected state", async () => {
      const user = userEvent.setup();
      const expectations: ActionExpectations = {
        expected_state_after: "some-state",
      };

      render(
        <ActionExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("some-state");
      await user.clear(input);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            expected_state_after: "",
          })
        );
      });
    });

    it("should handle checkpoint name when capture is toggled on and off", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const captureAfterSwitch = switches[2];

      // Enable capture
      await user.click(captureAfterSwitch);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Enter checkpoint name")
        ).toBeInTheDocument();
      });

      // Type checkpoint name
      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "test");

      // Disable capture
      await user.click(captureAfterSwitch);

      // Field should be hidden but value preserved in state
      await waitFor(() => {
        expect(screen.queryByDisplayValue("test")).not.toBeInTheDocument();
      });
    });

    it("should handle invalid numeric inputs gracefully", async () => {
      const user = userEvent.setup();

      render(
        <ActionExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const retriesInput = screen.getByPlaceholderText("0");
      await user.type(retriesInput, "abc");

      // Should not call onChange with NaN
      const hasNaN = mockOnChange.mock.calls.some(
        (call) => call[0].max_retries && isNaN(call[0].max_retries)
      );
      expect(hasNaN).toBe(false);
    });
  });
});
