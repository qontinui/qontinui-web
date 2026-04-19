/**
 * GlobalExpectationsEditor Integration Tests
 *
 * Tests the global expectations editor component
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GlobalExpectationsEditor } from "./GlobalExpectationsEditor";
import type { GlobalExpectations } from "@/lib/expectations/types";

/**
 * Stateful harness so controlled inputs receive the accumulated value as
 * the user types characters.
 */
function Harness(props: {
  initial?: GlobalExpectations;
  onChange?: (value: GlobalExpectations) => void;
}) {
  const [value, setValue] = useState<GlobalExpectations | undefined>(
    props.initial
  );
  return (
    <GlobalExpectationsEditor
      expectations={value}
      onChange={(v) => {
        setValue(v);
        props.onChange?.(v);
      }}
    />
  );
}

describe("GlobalExpectationsEditor", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  describe("Rendering", () => {
    it("should render all sections", () => {
      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("Global Expectations")).toBeInTheDocument();
      expect(screen.getByText("Error Detection")).toBeInTheDocument();
      expect(screen.getByText("Timing Limits")).toBeInTheDocument();
      expect(screen.getByText("Pattern Matching")).toBeInTheDocument();
    });

    it("should render with undefined expectations", () => {
      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      expect(switches).toHaveLength(3); // console errors, network errors, allow partial matches
    });

    it("should render with existing expectations", () => {
      const expectations: GlobalExpectations = {
        no_console_errors: true,
        no_network_errors: false,
        max_action_duration_ms: 5000,
        max_total_duration_ms: 300000,
        allow_partial_matches: true,
        min_confidence_threshold: 0.9,
      };

      render(
        <GlobalExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByDisplayValue("5000")).toBeInTheDocument();
      expect(screen.getByDisplayValue("300000")).toBeInTheDocument();
    });
  });

  describe("Error Detection", () => {
    it("should toggle no_console_errors", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const consoleErrorsSwitch = switches[0];

      await user.click(consoleErrorsSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            no_console_errors: true,
          })
        );
      });
    });

    it("should toggle no_network_errors", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const networkErrorsSwitch = switches[1];

      await user.click(networkErrorsSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            no_network_errors: true,
          })
        );
      });
    });

    it("should preserve other fields when toggling switches", async () => {
      const user = userEvent.setup();
      const expectations: GlobalExpectations = {
        max_action_duration_ms: 5000,
      };

      render(
        <GlobalExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      await user.click(switches[0]);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_action_duration_ms: 5000,
            no_console_errors: true,
          })
        );
      });
    });
  });

  describe("Timing Limits", () => {
    it("should update max_action_duration_ms", async () => {
      const user = userEvent.setup();

      render(<Harness onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText("10000");
      await user.clear(input);
      await user.type(input, "5000");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_action_duration_ms: 5000,
          })
        );
      });
    });

    it("should update max_total_duration_ms", async () => {
      const user = userEvent.setup();

      render(<Harness onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText("300000");
      await user.clear(input);
      await user.type(input, "600000");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_total_duration_ms: 600000,
          })
        );
      });
    });

    it("should clear timing value when input is cleared", async () => {
      const user = userEvent.setup();
      const expectations: GlobalExpectations = {
        max_action_duration_ms: 5000,
      };

      render(
        <GlobalExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("5000");
      await user.clear(input);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_action_duration_ms: undefined,
          })
        );
      });
    });

    it("should handle invalid number inputs", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("10000");
      await user.type(input, "abc");

      // Should not call onChange with invalid input
      await waitFor(() => {
        const calls = mockOnChange.mock.calls;
        const hasInvalidValue = calls.some(
          (call) =>
            call[0].max_action_duration_ms &&
            isNaN(call[0].max_action_duration_ms)
        );
        expect(hasInvalidValue).toBe(false);
      });
    });
  });

  describe("Pattern Matching", () => {
    it("should toggle allow_partial_matches", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const switches = screen.getAllByRole("switch");
      const partialMatchesSwitch = switches[2]; // Third switch

      await user.click(partialMatchesSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            allow_partial_matches: false, // Default is true, so clicking toggles to false
          })
        );
      });
    });

    it("should update min_confidence_threshold", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      // Radix's slider exposes role="slider" on the thumb div (not an input)
      // so fireEvent.change is a no-op. Keyboard nudging is the supported
      // way to drive the slider in tests.
      const sliders = screen.getAllByRole("slider");
      const confidenceSlider = sliders[0];
      confidenceSlider.focus();
      await user.keyboard("{ArrowRight}");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            min_confidence_threshold: expect.any(Number),
          })
        );
      });
    });

    it("should display current confidence threshold value", () => {
      const expectations: GlobalExpectations = {
        min_confidence_threshold: 0.95,
      };

      render(
        <GlobalExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("0.95")).toBeInTheDocument();
    });

    it("should default confidence threshold to 0.8", () => {
      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("0.80")).toBeInTheDocument();
    });
  });

  describe("Integration Tests", () => {
    it("should handle multiple field updates", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      // Toggle console errors
      const switches = screen.getAllByRole("switch");
      await user.click(switches[0]);

      // Set action duration
      const actionDurationInput = screen.getByPlaceholderText("10000");
      await user.clear(actionDurationInput);
      await user.type(actionDurationInput, "5000");

      // Both changes should have been called
      expect(mockOnChange.mock.calls.length).toBeGreaterThan(1);
    });

    it("should preserve all fields across updates", async () => {
      const user = userEvent.setup();
      const expectations: GlobalExpectations = {
        no_console_errors: true,
        max_action_duration_ms: 5000,
        min_confidence_threshold: 0.9,
      };

      render(
        <GlobalExpectationsEditor
          expectations={expectations}
          onChange={mockOnChange}
        />
      );

      // Update network errors
      const switches = screen.getAllByRole("switch");
      await user.click(switches[1]); // Network errors switch

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            no_console_errors: true,
            max_action_duration_ms: 5000,
            min_confidence_threshold: 0.9,
            no_network_errors: true,
          })
        );
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero values for timing", async () => {
      const user = userEvent.setup();

      render(
        <GlobalExpectationsEditor
          expectations={undefined}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("10000");
      await user.clear(input);
      await user.type(input, "0");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_action_duration_ms: 0,
          })
        );
      });
    });

    it("should handle very large timing values", async () => {
      const user = userEvent.setup();

      render(<Harness onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText("300000");
      await user.clear(input);
      await user.type(input, "9999999");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_total_duration_ms: 9999999,
          })
        );
      });
    });

    it("should handle confidence threshold of 0", async () => {
      render(
        <GlobalExpectationsEditor
          expectations={{ min_confidence_threshold: 0 }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("0.00")).toBeInTheDocument();
    });

    it("should handle confidence threshold of 1", async () => {
      render(
        <GlobalExpectationsEditor
          expectations={{ min_confidence_threshold: 1 }}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("1.00")).toBeInTheDocument();
    });
  });
});
