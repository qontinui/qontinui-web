/**
 * `<SlotImage slot="…">` — every image placement in this app renders through a
 * declared slot.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14 step 3. A slot
 * is declared by `frontend/image-slots/<slot>.yaml` (qontinui-schemas'
 * `ImageSlotSpec`): what the image is for, its contexts, its aspect, its
 * content and alt policy. This component renders:
 *
 * - **the chosen asset** when the slot manifest (`public/image-slots/
 *   studio-manifest.json`, written by qontinui-studio's compile step) names
 *   one: a `<picture>` of the published derivatives, served byte for byte.
 *   Deliberately NOT `next/image`: its optimizer re-encodes the file and drops
 *   the IPTC "AI-generated" marker each model-made derivative carries;
 * - **otherwise a correctly sized, explicitly marked placeholder**, reserving
 *   the spec's preferred `aspect-ratio` so the layout does not move when the
 *   asset arrives.
 *
 * Both carry `data-ui-bridge-image-slot="<slot>"` and `data-ui-bridge-id`
 * (only that attribute, or an interactive role, registers an element with the
 * UI Bridge). The placeholder alone carries `data-ui-bridge-placeholder="true"`
 * and `data-ui-bridge-placeholder-reason`. A shipped placeholder is a finding
 * the image-slot inventory (`npm run image-slots:inventory`) lists, never a
 * build failure.
 *
 * Usable from server and client components alike: it holds no state.
 */

import type { CSSProperties, ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSlotImage, SLOT_MANIFEST } from "@/lib/image-slots/manifest";
import {
  imageSlotSpec,
  type ImageSlotId,
} from "@/lib/image-slots/specs.generated";

export interface SlotImageProps {
  /** A declared slot id: a file `frontend/image-slots/<slot>.yaml`. */
  slot: ImageSlotId;
  /** Sizing and placement of the slot's box (its width; the spec's aspect
   *  ratio sets the height). */
  className?: string;
  /** What the placeholder shows inside its reserved box until an asset is
   *  chosen. Defaults to a neutral bordered box with an image glyph. */
  placeholder?: ReactNode;
  /** `eager` for an image above the fold; `lazy` otherwise. */
  loading?: "eager" | "lazy";
}

/** The UI Bridge id of a slot's element. */
export function slotUiBridgeId(slot: string): string {
  return `image-slot.${slot}`;
}

export function SlotImage({
  slot,
  className,
  placeholder,
  loading = "lazy",
}: SlotImageProps) {
  const spec = imageSlotSpec(slot);
  const resolution = resolveSlotImage(slot, spec, SLOT_MANIFEST);
  // `W/H` is the spec's spelling and CSS `aspect-ratio` syntax both.
  const box: CSSProperties = { aspectRatio: spec.aspect.preferred };

  if (resolution.kind === "placeholder") {
    return (
      <div
        data-ui-bridge-id={slotUiBridgeId(slot)}
        data-ui-bridge-image-slot={slot}
        data-ui-bridge-placeholder="true"
        data-ui-bridge-placeholder-reason={resolution.reason}
        // A placeholder carries no information for anyone, sighted or not.
        aria-hidden="true"
        style={box}
        className={cn(
          "flex items-center justify-center overflow-hidden",
          placeholder === undefined &&
            "rounded-md border border-dashed border-border-subtle bg-surface-raised text-text-muted",
          className
        )}
      >
        {placeholder ?? <ImageIcon className="size-1/4 max-h-8 max-w-8" />}
      </div>
    );
  }

  return (
    <picture style={box} className={cn("block overflow-hidden", className)}>
      {resolution.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} />
      ))}
      <img
        data-ui-bridge-id={slotUiBridgeId(slot)}
        data-ui-bridge-image-slot={slot}
        src={resolution.src}
        alt={resolution.alt}
        loading={loading}
        decoding="async"
        className="block h-full w-full object-cover"
      />
    </picture>
  );
}
