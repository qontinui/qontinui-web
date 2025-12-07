/**
 * CheckpointListEditor Integration Tests
 *
 * Tests the checkpoint list editor with add/remove/edit functionality
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckpointListEditor } from "./CheckpointListEditor";
import type { CheckpointDefinition } from "@/lib/expectations/types";

describe("CheckpointListEditor", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  describe("Rendering", () => {
    it("should render empty state when no checkpoints", () => {
      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      expect(screen.getByText("Checkpoints")).toBeInTheDocument();
      expect(screen.getByText("No checkpoints defined")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("Enter checkpoint name")
      ).toBeInTheDocument();
    });

    it("should render with existing checkpoints", () => {
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          max_wait_ms: 5000,
          retry_interval_ms: 500,
        },
        "checkpoint-2": {
          screenshot_required: false,
          max_wait_ms: 3000,
          retry_interval_ms: 300,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("checkpoint-1")).toBeInTheDocument();
      expect(screen.getByText("checkpoint-2")).toBeInTheDocument();
    });
  });

  describe("Adding Checkpoints", () => {
    it("should add checkpoint via button click", async () => {
      const user = userEvent.setup();

      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "new-checkpoint");

      const addButton = screen.getByRole("button", { name: /plus/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "new-checkpoint": expect.objectContaining({
              screenshot_required: true,
              max_wait_ms: 5000,
              retry_interval_ms: 500,
            }),
          })
        );
      });
    });

    it("should add checkpoint via Enter key", async () => {
      const user = userEvent.setup();

      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "new-checkpoint{Enter}");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "new-checkpoint": expect.any(Object),
          })
        );
      });
    });

    it("should clear input after adding checkpoint", async () => {
      const user = userEvent.setup();

      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "new-checkpoint");

      const addButton = screen.getByRole("button", { name: /plus/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(input).toHaveValue("");
      });
    });

    it("should not add checkpoint with empty name", async () => {
      const user = userEvent.setup();

      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      const addButton = screen.getByRole("button", { name: /plus/i });
      await user.click(addButton);

      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it("should not add duplicate checkpoint names", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "existing-checkpoint": {
          screenshot_required: true,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "existing-checkpoint");

      const addButton = screen.getByRole("button", { name: /plus/i });
      await user.click(addButton);

      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it("should trim whitespace from checkpoint names", async () => {
      const user = userEvent.setup();

      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, "  new-checkpoint  ");

      const addButton = screen.getByRole("button", { name: /plus/i });
      await user.click(addButton);

      // Should not add whitespace-only checkpoint
      const wasCalledWithWhitespace = mockOnChange.mock.calls.some((call) =>
        Object.keys(call[0]).includes("  new-checkpoint  ")
      );
      expect(wasCalledWithWhitespace).toBe(false);
    });
  });

  describe("Removing Checkpoints", () => {
    it("should remove checkpoint", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
        },
        "checkpoint-2": {
          screenshot_required: false,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Find and click the trash button for checkpoint-1
      const checkpoint1 = screen.getByText("checkpoint-1").closest("div");
      const deleteButtons = within(
        checkpoint1?.parentElement as HTMLElement
      ).getAllByRole("button");
      const trashButton = deleteButtons.find((btn) =>
        btn.querySelector('[class*="lucide-trash"]')
      );

      await user.click(trashButton as HTMLElement);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-2": expect.any(Object),
          })
        );

        const lastCall =
          mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
        expect(lastCall[0]).not.toHaveProperty("checkpoint-1");
      });
    });
  });

  describe("Checkpoint Expansion", () => {
    it("should expand checkpoint when clicked", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          description: "Test description",
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      const checkpoint = screen.getByText("checkpoint-1");
      await user.click(checkpoint);

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/What does this checkpoint validate/i)
        ).toBeInTheDocument();
      });
    });

    it("should collapse checkpoint when clicked again", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      const checkpoint = screen.getByText("checkpoint-1");

      // Expand
      await user.click(checkpoint);
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText(/What does this checkpoint validate/i)
        ).toBeInTheDocument();
      });

      // Collapse
      await user.click(checkpoint);
      await waitFor(() => {
        expect(
          screen.queryByPlaceholderText(/What does this checkpoint validate/i)
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("Editing Checkpoint Properties", () => {
    it("should update checkpoint description", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      const descriptionInput = await screen.findByPlaceholderText(
        /What does this checkpoint validate/i
      );
      await user.type(descriptionInput, "Test description");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              description: "Test description",
            }),
          })
        );
      });
    });

    it("should toggle screenshot_required", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      const screenshotSwitch = await screen.findByRole("switch");
      await user.click(screenshotSwitch);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              screenshot_required: false,
            }),
          })
        );
      });
    });

    it("should update max_wait_ms", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          max_wait_ms: 5000,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      const maxWaitInput = await screen.findByDisplayValue("5000");
      await user.clear(maxWaitInput);
      await user.type(maxWaitInput, "10000");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              max_wait_ms: 10000,
            }),
          })
        );
      });
    });

    it("should update retry_interval_ms", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          retry_interval_ms: 500,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      const retryIntervalInput = await screen.findByDisplayValue("500");
      await user.clear(retryIntervalInput);
      await user.type(retryIntervalInput, "1000");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              retry_interval_ms: 1000,
            }),
          })
        );
      });
    });
  });

  describe("Claude Review Instructions", () => {
    it("should add claude review instruction", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      // Find and click "Add" button for Claude Review
      const addButtons = await screen.findAllByRole("button", { name: /add/i });
      const claudeReviewAddButton = addButtons[addButtons.length - 1]; // Last "Add" button
      await user.click(claudeReviewAddButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              claude_review: [""],
            }),
          })
        );
      });
    });

    it("should update claude review instruction", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          claude_review: [""],
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      const instructionInput = await screen.findByPlaceholderText(
        /Instruction for Claude/i
      );
      await user.type(instructionInput, "Check if login succeeded");

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              claude_review: ["Check if login succeeded"],
            }),
          })
        );
      });
    });

    it("should remove claude review instruction", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          claude_review: ["Review instruction 1", "Review instruction 2"],
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      // Find and click trash button for first instruction
      const instructionTextarea = await screen.findByDisplayValue(
        "Review instruction 1"
      );
      const instructionContainer = instructionTextarea.closest("div");
      const trashButton = within(
        instructionContainer?.parentElement as HTMLElement
      ).getByRole("button");
      await user.click(trashButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              claude_review: ["Review instruction 2"],
            }),
          })
        );
      });
    });

    it("should add multiple claude review instructions", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          claude_review: [],
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      // Add first instruction
      const addButtons = await screen.findAllByRole("button", { name: /add/i });
      await user.click(addButtons[addButtons.length - 1]);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              claude_review: [""],
            }),
          })
        );
      });

      // Add second instruction
      await user.click(addButtons[addButtons.length - 1]);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            "checkpoint-1": expect.objectContaining({
              claude_review: ["", ""],
            }),
          })
        );
      });
    });
  });

  describe("Badges Display", () => {
    it("should display Screenshot badge when screenshot_required is true", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("Screenshot")).toBeInTheDocument();
    });

    it("should display Claude Review badge when claude_review has items", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          claude_review: ["Review instruction"],
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("Claude Review")).toBeInTheDocument();
    });

    it("should not display badges when features are disabled", () => {
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: false,
          claude_review: [],
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      expect(screen.queryByText("Screenshot")).not.toBeInTheDocument();
      expect(screen.queryByText("Claude Review")).not.toBeInTheDocument();
    });
  });

  describe("Multiple Checkpoints", () => {
    it("should handle multiple checkpoints independently", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": {
          screenshot_required: true,
          description: "First checkpoint",
        },
        "checkpoint-2": {
          screenshot_required: false,
          description: "Second checkpoint",
        },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Expand first checkpoint
      await user.click(screen.getByText("checkpoint-1"));

      const description1 = await screen.findByDisplayValue("First checkpoint");
      expect(description1).toBeInTheDocument();

      // Expand second checkpoint (first should still be expanded)
      await user.click(screen.getByText("checkpoint-2"));

      const description2 = await screen.findByDisplayValue("Second checkpoint");
      expect(description2).toBeInTheDocument();
      expect(description1).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("should handle checkpoints with all optional fields empty", () => {
      const checkpoints: Record<string, CheckpointDefinition> = {
        "minimal-checkpoint": {},
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      expect(screen.getByText("minimal-checkpoint")).toBeInTheDocument();
    });

    it("should handle very long checkpoint names", async () => {
      const user = userEvent.setup();
      const longName =
        "very-long-checkpoint-name-that-should-still-work-correctly";

      render(
        <CheckpointListEditor checkpoints={undefined} onChange={mockOnChange} />
      );

      const input = screen.getByPlaceholderText("Enter checkpoint name");
      await user.type(input, longName);

      const addButton = screen.getByRole("button", { name: /plus/i });
      await user.click(addButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalledWith(
          expect.objectContaining({
            [longName]: expect.any(Object),
          })
        );
      });
    });

    it("should preserve other checkpoints when removing one", async () => {
      const user = userEvent.setup();
      const checkpoints: Record<string, CheckpointDefinition> = {
        "checkpoint-1": { screenshot_required: true },
        "checkpoint-2": { screenshot_required: true },
        "checkpoint-3": { screenshot_required: true },
      };

      render(
        <CheckpointListEditor
          checkpoints={checkpoints}
          onChange={mockOnChange}
        />
      );

      // Remove checkpoint-2
      const checkpoint2 = screen.getByText("checkpoint-2").closest("div");
      const deleteButtons = within(
        checkpoint2?.parentElement as HTMLElement
      ).getAllByRole("button");
      const trashButton = deleteButtons.find((btn) =>
        btn.querySelector('[class*="lucide-trash"]')
      );

      await user.click(trashButton as HTMLElement);

      await waitFor(() => {
        const lastCall =
          mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
        expect(lastCall[0]).toHaveProperty("checkpoint-1");
        expect(lastCall[0]).not.toHaveProperty("checkpoint-2");
        expect(lastCall[0]).toHaveProperty("checkpoint-3");
      });
    });
  });
});
