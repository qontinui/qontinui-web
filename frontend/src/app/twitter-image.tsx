/**
 * X/Twitter (`twitter:image`) card for the root tree (`/`).
 * The card itself is shared: `@/lib/server/social-card`.
 */
// Next names this route after this file's own source: the line below moves
// with the card's look ("Cache-busting" in @/lib/server/social-card).
// card-inputs: 12bcfd98c627f356
import {
  renderSocialCard,
  SOCIAL_CARD_ALT,
  SOCIAL_CARD_CONTENT_TYPE,
  SOCIAL_CARD_SIZE,
} from "@/lib/server/social-card";

export const alt = SOCIAL_CARD_ALT;
export const size = SOCIAL_CARD_SIZE;
export const contentType = SOCIAL_CARD_CONTENT_TYPE;

// Prerendered by `next build`: the card's file reads happen once, at build,
// and the route is served as a static asset.
export const dynamic = "force-static";

export default function Image() {
  return renderSocialCard();
}
