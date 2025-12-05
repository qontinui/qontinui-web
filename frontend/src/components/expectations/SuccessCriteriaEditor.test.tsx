/**
 * SuccessCriteriaEditor Integration Tests
 *
 * Tests the success criteria editor with all criteria types
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuccessCriteriaEditor } from "./SuccessCriteriaEditor";
import type { SuccessCriteria } from "@/lib/expectations/types";

describe("SuccessCriteriaEditor", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  describe("Rendering", () => {
    it("should render with default all_actions_pass criteria", () => {
      render(
        <SuccessCriteriaEditor
          criteria={undefined}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("Success Criteria")).toBeInTheDocument();
      expect(screen.getByText("Criteria Type")).toBeInTheDocument();
    });

    it("should render with existing criteria", () => {
      const criteria: SuccessCriteria = {
        type: "min_matches",
        min_matches: 5,
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByDisplayValue("5")).toBeInTheDocument();
    });

    it("should show criteria type description", () => {
      render(
        <SuccessCriteriaEditor
          criteria={{ type: "all_actions_pass" }}
          onChange={mockOnChange}
        />
      );

      expect(
        screen.getByText(/All workflow actions must complete successfully/i)
      ).toBeInTheDocument();
    });
  });

  describe("Criteria Type Selection", () => {
    it("should change to min_matches type", async () => {
      const user = userEvent.setup();

      render(
        <SuccessCriteriaEditor
          criteria={undefined}
          onChange={mockOnChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.click(select);

      const minMatchesOption = screen.getByText("Minimum Matches");
      await user.click(minMatchesOption);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "min_matches",
            min_matches: 1,
          })
        );
      });
    });

    it("should change to max_failures type", async () => {
      const user = userEvent.setup();

      render(
        <SuccessCriteriaEditor
          criteria={undefined}
          onChange={mockOnChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.click(select);

      const maxFailuresOption = screen.getByText("Maximum Failures");
      await user.click(maxFailuresOption);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "max_failures",
            max_failures: 0,
          })
        );
      });
    });

    it("should change to checkpoint_passed type", async () => {
      const user = userEvent.setup();

      render(
        <SuccessCriteriaEditor
          criteria={undefined}
          onChange={mockOnChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.click(select);

      const checkpointOption = screen.getByText("Checkpoint Passed");
      await user.click(checkpointOption);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "checkpoint_passed",
            checkpoint_name: "",
          })
        );
      });
    });

    it("should change to required_states type", async () => {
      const user = userEvent.setup();

      render(
        <SuccessCriteriaEditor
          criteria={undefined}
          onChange={mockOnChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.click(select);

      const requiredStatesOption = screen.getByText("Required States");
      await user.click(requiredStatesOption);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "required_states",
            required_states: [],
          })
        );
      });
    });

    it("should change to custom type", async () => {
      const user = userEvent.setup();

      render(
        <SuccessCriteriaEditor
          criteria={undefined}
          onChange={mockOnChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.click(select);

      const customOption = screen.getByText("Custom Expression");
      await user.click(customOption);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "custom",
            custom_expression: "",
          })
        );
      });
    });
  });

  describe("Min Matches Criteria", () => {
    it("should update min_matches value", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "min_matches",
        min_matches: 1,
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("1");
      await user.clear(input);
      await user.type(input, "10");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "min_matches",
            min_matches: 10,
          })
        );
      });
    });

    it("should reject negative min_matches", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "min_matches",
        min_matches: 5,
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("5");
      await user.clear(input);
      await user.type(input, "-1");

      // Should not call onChange with negative value
      const hasNegativeValue = mockOnChange.mock.calls.some(
        (call) => call[0].min_matches < 0
      );
      expect(hasNegativeValue).toBe(false);
    });
  });

  describe("Max Failures Criteria", () => {
    it("should update max_failures value", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "max_failures",
        max_failures: 0,
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("0");
      await user.clear(input);
      await user.type(input, "3");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "max_failures",
            max_failures: 3,
          })
        );
      });
    });
  });

  describe("Checkpoint Passed Criteria", () => {
    it("should update checkpoint_name with text input when no checkpoints available", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "checkpoint_passed",
        checkpoint_name: "",
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableCheckpoints={[]}
        />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "my-checkpoint");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "checkpoint_passed",
            checkpoint_name: "my-checkpoint",
          })
        );
      });
    });

    it("should show select dropdown when checkpoints are available", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "checkpoint_passed",
        checkpoint_name: "",
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableCheckpoints={["checkpoint-1", "checkpoint-2"]}
        />
      );

      const select = screen.getAllByRole("combobox")[1]; // Second combobox (first is type)
      await user.click(select);

      expect(screen.getByText("checkpoint-1")).toBeInTheDocument();
      expect(screen.getByText("checkpoint-2")).toBeInTheDocument();
    });

    it("should select checkpoint from dropdown", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "checkpoint_passed",
        checkpoint_name: "",
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableCheckpoints={["checkpoint-1", "checkpoint-2"]}
        />
      );

      const select = screen.getAllByRole("combobox")[1];
      await user.click(select);

      const option = screen.getByText("checkpoint-1");
      await user.click(option);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "checkpoint_passed",
            checkpoint_name: "checkpoint-1",
          })
        );
      });
    });
  });

  describe("Required States Criteria", () => {
    it("should add state with text input when no states available", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: [],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={[]}
        />
      );

      const input = screen.getByPlaceholderText("Enter state name");
      await user.type(input, "state-1");

      const addButton = screen.getByRole("button", { name: /add/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "required_states",
            required_states: ["state-1"],
          })
        );
      });
    });

    it("should add state by pressing Enter", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: [],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={[]}
        />
      );

      const input = screen.getByPlaceholderText("Enter state name");
      await user.type(input, "state-2{Enter}");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "required_states",
            required_states: ["state-2"],
          })
        );
      });
    });

    it("should remove state", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: ["state-1", "state-2"],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      // Find the X button for state-1
      const badge = screen.getByText("state-1").closest("div");
      const removeButton = within(badge as HTMLElement).getByRole("button");
      await user.click(removeButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "required_states",
            required_states: ["state-2"],
          })
        );
      });
    });

    it("should not add duplicate states", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: ["state-1"],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={[]}
        />
      );

      const input = screen.getByPlaceholderText("Enter state name");
      await user.type(input, "state-1");

      const addButton = screen.getByRole("button", { name: /add/i });
      await user.click(addButton);

      // Should not add duplicate - states should still be ["state-1"]
      await waitFor(() => {
        const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
        if (lastCall) {
          expect(lastCall[0].required_states).toEqual(["state-1"]);
        }
      });
    });

    it("should show select dropdown when states are available", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: [],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={["state-1", "state-2"]}
        />
      );

      const select = screen.getAllByRole("combobox")[1];
      await user.click(select);

      expect(screen.getByText("state-1")).toBeInTheDocument();
      expect(screen.getByText("state-2")).toBeInTheDocument();
    });

    it("should add state from dropdown", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: [],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={["state-1", "state-2"]}
        />
      );

      const select = screen.getAllByRole("combobox")[1];
      await user.click(select);

      const option = screen.getByText("state-1");
      await user.click(option);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "required_states",
            required_states: ["state-1"],
          })
        );
      });
    });

    it("should filter out already selected states from dropdown", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: ["state-1"],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={["state-1", "state-2"]}
        />
      );

      const select = screen.getAllByRole("combobox")[1];
      await user.click(select);

      // state-1 should not be in the dropdown
      expect(screen.queryByText("state-1")).not.toBeInTheDocument();
      expect(screen.getByText("state-2")).toBeInTheDocument();
    });
  });

  describe("Custom Criteria", () => {
    it("should update custom_expression", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "custom",
        custom_expression: "",
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const textarea = screen.getByPlaceholderText(/Enter Python expression/i);
      await user.type(textarea, "len(matches) > 5");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "custom",
            custom_expression: "len(matches) > 5",
          })
        );
      });
    });
  });

  describe("Description Field", () => {
    it("should update description for all types", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "all_actions_pass",
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const textarea = screen.getByPlaceholderText(/Add a description/i);
      await user.type(textarea, "Test description");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            description: "Test description",
          })
        );
      });
    });

    it("should preserve description when changing types", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "all_actions_pass",
        description: "My description",
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const select = screen.getByRole("combobox");
      await user.click(select);

      const minMatchesOption = screen.getByText("Minimum Matches");
      await user.click(minMatchesOption);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "min_matches",
            description: "My description",
          })
        );
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string inputs gracefully", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "required_states",
        required_states: [],
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
          availableStates={[]}
        />
      );

      const input = screen.getByPlaceholderText("Enter state name");
      await user.type(input, "   ");

      const addButton = screen.getByRole("button", { name: /add/i });
      await user.click(addButton);

      // Should not add whitespace-only state
      const wasCalledWithWhitespace = mockOnChange.mock.calls.some(
        (call) => call[0].required_states?.includes("   ")
      );
      expect(wasCalledWithWhitespace).toBe(false);
    });

    it("should handle zero values for numeric inputs", async () => {
      const user = userEvent.setup();
      const criteria: SuccessCriteria = {
        type: "max_failures",
        max_failures: 5,
      };

      render(
        <SuccessCriteriaEditor
          criteria={criteria}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByDisplayValue("5");
      await user.clear(input);
      await user.type(input, "0");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            max_failures: 0,
          })
        );
      });
    });
  });
});
