/**
 * The shared "start work" controls disable themselves while coord refuses new
 * work and show coord's message (plan
 * 2026-09-20-runner-selector-drives-a-transport-not-a-target, Phase 3):
 * predictability over click-to-discover.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExecutionPanel } from "./editors/ExecutionPanel";
import { AiGeneratorPanel } from "./AiGeneratorPanel";

const MESSAGE =
  "All your runners are drained — taken out of service for new work.";

describe("ExecutionPanel", () => {
  it("refused: Run is disabled, never called, and coord's message is shown", () => {
    const onRun = vi.fn();
    render(<ExecutionPanel onRun={onRun} refusal={MESSAGE} />);
    const run = screen.getByRole("button", { name: /run/i });
    expect(run).toBeDisabled();
    fireEvent.click(run);
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId("execution-run-refusal").textContent).toBe(
      MESSAGE
    );
  });

  it("allowed: Run is enabled and no refusal is shown", () => {
    render(<ExecutionPanel onRun={vi.fn()} refusal={null} />);
    expect(screen.getByRole("button", { name: /run/i })).toBeEnabled();
    expect(screen.queryByTestId("execution-run-refusal")).toBeNull();
  });
});

describe("AiGeneratorPanel", () => {
  function openWithPrompt(refusal: string | null, onGenerate = vi.fn()) {
    render(
      <AiGeneratorPanel
        title="Generate with AI"
        generating={false}
        refusal={refusal}
        onGenerate={onGenerate}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a macro that logs in" },
    });
    return onGenerate;
  }

  it("refused: Generate is disabled, never called, and coord's message is shown", () => {
    const onGenerate = openWithPrompt(MESSAGE);
    const generate = screen.getByRole("button", { name: /^generate$/i });
    expect(generate).toBeDisabled();
    fireEvent.click(generate);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByTestId("ai-generate-refusal").textContent).toBe(MESSAGE);
  });

  it("allowed: Generate runs", () => {
    const onGenerate = openWithPrompt(null);
    fireEvent.click(screen.getByRole("button", { name: /^generate$/i }));
    expect(onGenerate).toHaveBeenCalledWith("a macro that logs in");
  });
});
