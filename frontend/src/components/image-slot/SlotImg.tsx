"use client";

/**
 * The `<img>` of a `<SlotImage>` asset: the one part that must read the URL.
 *
 * Studio's D7 gate (plan 2026-10-13-image-generation-and-visual-judgment,
 * Phase 19) loads a preview with `?studio_batch=<id>&studio_attempt=<n>` and
 * refuses a slot image whose `loading` is `lazy`. The query string is read
 * with `useSearchParams`, which on this app's dynamically rendered routes
 * (the root layout is `force-dynamic`) answers during the SERVER render: the
 * SSR HTML already says `eager` on a preview and the caller's `loading`
 * (default `lazy`) everywhere else, so lazy loading takes effect from the
 * first byte rather than after hydration.
 *
 * Where the query string cannot be read (no router context, or a static
 * render that suspends into the fallback below) the answer is UNKNOWN, and
 * an unknown page is never lazy: the image is eager.
 *
 * A client component holding only this, so `<SlotImage>`'s spec data and
 * authored SVGs need not ship to the client with it.
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

/** The query parameter that marks a studio preview load. */
export const STUDIO_BATCH_PARAM = "studio_batch";

export interface SlotImgProps {
  src: string;
  alt: string;
  /** What the caller asked for off a preview. */
  loading: "eager" | "lazy";
  /** Studio's D7 id, `studio-img-<slot>`. */
  mediaId: string;
  /** The UI Bridge id, `image-slot.<slot>`. */
  uiBridgeId: string;
  slot: string;
}

/** The `loading` an image renders with, given what the URL says. */
export function slotImgLoading(
  params: Pick<URLSearchParams, "has"> | null,
  requested: "eager" | "lazy"
): "eager" | "lazy" {
  if (params === null || params.has(STUDIO_BATCH_PARAM)) {
    return "eager";
  }
  return requested;
}

function Img(props: SlotImgProps & { resolvedLoading: "eager" | "lazy" }) {
  return (
    // Always rendered inside <SlotImage>'s <picture>. Not next/image: its
    // optimizer re-encodes the derivative and strips its IPTC AI-generated
    // marker; the slot's files are already compiled per format.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-media-id={props.mediaId}
      data-ui-bridge-id={props.uiBridgeId}
      data-ui-bridge-image-slot={props.slot}
      src={props.src}
      alt={props.alt}
      loading={props.resolvedLoading}
      decoding="async"
      className="block h-full w-full object-cover"
    />
  );
}

function ParamsAwareImg(props: SlotImgProps) {
  const params = useSearchParams();
  return (
    <Img {...props} resolvedLoading={slotImgLoading(params, props.loading)} />
  );
}

export function SlotImg(props: SlotImgProps) {
  return (
    <Suspense fallback={<Img {...props} resolvedLoading="eager" />}>
      <ParamsAwareImg {...props} />
    </Suspense>
  );
}
