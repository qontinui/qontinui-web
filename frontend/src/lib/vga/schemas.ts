/**
 * Zod request-body schemas for /api/vga/* routes.
 *
 * Kept alongside the canonical-export helpers so handler files stay
 * small. The inferred TS types overlap with `@/lib/types/vga` but are
 * the *runtime* contract — we use z.infer only locally inside handlers.
 */

import { z } from "zod";

export const bboxSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().nonnegative(),
  h: z.number().int().nonnegative(),
});

export const vgaElementSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  prompt: z.string().min(1),
  bbox: bboxSchema,
  last_confirmed_at: z.string().optional(),
  correction_count: z.number().int().nonnegative().optional(),
});

export const vgaStateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  elements: z.array(vgaElementSchema),
  blocking: z.boolean(),
});

export const vgaTransitionSchema = z.object({
  id: z.string().uuid(),
  from_state_id: z.string().uuid(),
  to_state_id: z.string().uuid(),
  trigger_element_id: z.string().uuid(),
});

export const vgaStateGraphSchema = z.object({
  states: z.array(vgaStateSchema),
  transitions: z.array(vgaTransitionSchema),
});

export const groundRequestSchema = z.object({
  imageBase64: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
});

export const proposeRequestSchema = z.object({
  imageBase64: z.string().min(1),
  categories: z.array(z.string().min(1)).optional(),
});

export const createStateRequestSchema = z.object({
  name: z.string().min(1),
  targetProcess: z.string().min(1),
  targetOs: z.string().min(1),
  groundingModel: z.string().min(1).optional(),
  private: z.boolean().optional(),
  stateGraph: vgaStateGraphSchema,
});

export const patchStateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    stateGraph: vgaStateGraphSchema.optional(),
    groundingModel: z.string().min(1).optional(),
    private: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.stateGraph !== undefined ||
      v.groundingModel !== undefined ||
      v.private !== undefined,
    { message: "At least one field must be provided" }
  );

/**
 * Canonical import body — matches `VgaStateMachine.from_canonical_json`
 * tolerances (timestamps optional, legacy `correction_count` absent).
 *
 * Caller may provide an optional top-level `name` override outside the
 * canonical payload. We accept it as a sibling field on the request
 * body, not as a member of the canonical shape, so the canonical JSON
 * itself stays byte-for-byte identical across export/import pairs.
 */
export const importStateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  canonical: z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    target_process: z.string().min(1),
    target_os: z.string().min(1),
    grounding_model: z.string().min(1),
    private: z.boolean(),
    states: z.array(vgaStateSchema),
    transitions: z.array(vgaTransitionSchema),
  }),
});

export const correctionRequestSchema = z.object({
  stateMachineId: z.string().uuid(),
  imageBase64: z.string().min(1),
  prompt: z.string().min(1),
  correctedBbox: bboxSchema,
  source: z.enum(["builder", "runtime"]),
});
