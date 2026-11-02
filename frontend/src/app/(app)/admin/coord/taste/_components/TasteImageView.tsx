"use client";

import { useEffect, useState } from "react";
import { fetchImageBlob, type TasteImage } from "@/lib/api/taste";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * One side of a pair: the stored image, fetched through the tenant-checked
 * content route (an `<img src>` cannot carry the bearer) and shown from an
 * object URL that is revoked when the image changes or the card unmounts.
 *
 * A failed fetch says so in place of the image — never an empty frame that
 * reads as a blank picture.
 */
export function TasteImageView({
  side,
  image,
}: {
  side: "A" | "B";
  image: TasteImage;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    fetchImageBlob(image.sha256)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "unreadable");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.sha256]);

  return (
    <figure
      className="flex flex-col gap-1.5 min-w-0"
      data-testid={`taste-image-${side.toLowerCase()}`}
      data-sha256={image.sha256}
    >
      <div className="relative flex items-center justify-center rounded-md border border-border bg-muted/30 aspect-[4/3] overflow-hidden">
        <span className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-xs font-semibold">
          {side}
        </span>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL of an authenticated fetch; next/image cannot optimise it
          <img
            src={url}
            alt={`Image ${side}`}
            className="max-h-full max-w-full object-contain"
          />
        ) : error ? (
          <p
            className="px-4 text-center text-xs text-amber-200"
            data-testid={`taste-image-${side.toLowerCase()}-error`}
          >
            Image {side} could not be loaded ({error}). Do not label this pair
            from what you cannot see — skip it.
          </p>
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {image.width}×{image.height}
        </span>
        <span>{image.direction ?? "no declared direction"}</span>
      </figcaption>
    </figure>
  );
}
