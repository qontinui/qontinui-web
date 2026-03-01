import { runnerApi } from "@/lib/runner-api";

/**
 * Auto-save a generation prompt to the prompt library (best-effort, fire-and-forget).
 */
export async function autoSaveGenerationPrompt(
  promptText: string
): Promise<void> {
  try {
    const existing = await runnerApi.getPrompts();
    const trimmed = promptText.trim();
    const isDuplicate = existing.some(
      (p) => p.category === "Generation" && p.content.trim() === trimmed
    );
    if (isDuplicate) return;

    const name =
      trimmed.length > 60 ? trimmed.substring(0, 57) + "..." : trimmed;

    await runnerApi.createPrompt({
      name,
      content: trimmed,
      category: "Generation",
      description: "",
      tags: ["auto-saved"],
    });
  } catch {
    // Best-effort, don't block user flow
  }
}
