/**
 * Shared types for the VGA builder page components.
 */

import type { VgaProposal } from "@/lib/types/vga";

/** Image the canvas is currently operating on. */
export interface BuilderImage {
  /** Object URL used as the <img src>. */
  objectUrl: string;
  /** Raw base64 payload (no data URL prefix) for /propose, /ground, /correction. */
  base64: string;
  /** Pixel dimensions for overlay math. */
  naturalWidth: number;
  naturalHeight: number;
}

/** A proposal plus mutable UI state while the user reviews it. */
export interface ProposalDraft extends VgaProposal {
  /** Stable per-session id so React keys stay happy through edits. */
  draftId: string;
  /** User-editable copy of the label. */
  editedLabel: string;
  /** User-editable copy of the prompt. */
  editedPrompt: string;
  /** Current bounding box — starts as a 40x40 square centered on (x, y). */
  bbox: { x: number; y: number; w: number; h: number };
}
