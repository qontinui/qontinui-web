"use client";

/**
 * The studio's web player, loaded ONLY through `next/dynamic` from
 * `scene-embed.tsx`, so that it and Remotion form their own lazy chunk and
 * never reach the page's first-load JavaScript. Remotion is not AGPL. This
 * site combines with it under the AGPL section 7 permission in the repo's
 * NOTICE file.
 */
import {
  StudioPlayer,
  illustrativeTraces,
  type SceneId,
} from "@qontinui/studio-scenes/player";

import { STUDIO_ASSET_BASE } from "./scenes";

export type StudioScenePlayerProps = {
  scene: SceneId;
  autoPlay: boolean;
  loop: boolean;
};

export default function StudioScenePlayer({
  scene,
  autoPlay,
  loop,
}: StudioScenePlayerProps) {
  return (
    <StudioPlayer
      scene={scene}
      trace={illustrativeTraces[scene]}
      aspect="16:9"
      assetBaseUrl={STUDIO_ASSET_BASE}
      autoPlay={autoPlay}
      loop={loop}
      controls
      style={{ width: "100%", height: "100%" }}
    />
  );
}
