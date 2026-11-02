/**
 * The site's social card — the image link previews show for qontinui.io.
 *
 * One card, served from four file-based metadata routes:
 * `app/{opengraph,twitter}-image.tsx` for the root tree (`/`) and
 * `app/(marketing)/{opengraph,twitter}-image.tsx` for the marketing tree
 * (`/runner`, `/docs`, ...). The marketing tree needs its own pair because
 * its layout declares its own `openGraph` / `twitter` objects, and those
 * replace the inherited ones, cards included.
 *
 * Rendered in code with `next/og`, never generated: the mark is the identity
 * asset `public/q-logo.png`, placed at its own 152×177 pixel size. It is
 * never scaled up, because there is no vector master to scale. Colours come
 * from `@qontinui/design-tokens`, dark-first like the product. The type is
 * Geist, the face the site renders with, read from the `geist` dependency.
 * Satori reads TTF, not the WOFF2 that `next/font` serves.
 *
 * Size. 1200×630 (1.91:1) is the link-preview size Meta recommends
 * (developers.facebook.com/docs/sharing/webmasters/images). X documents
 * `summary_large_image` images as 2:1 and does not say how it fits a 1.91:1
 * one, so nothing load-bearing sits in the 15 px a 2:1 centre crop would cut
 * from the top or the bottom. That is why the accent is a full-height bar at
 * the left edge.
 *
 * Cache-busting. Next names each card route `…?<hash>`, where the hash is of
 * the route file's own source, not of this module. A new look — this file,
 * the logo, the fonts, the tokens — would otherwise ship under the old URL,
 * and platforms that cache previews by URL would keep the old card. So each
 * route file carries a `// card-inputs: <digest>` line, and
 * `social-card.test.ts` fails until that digest matches these inputs.
 * Updating the line changes the route file, and with it the card's URL.
 *
 * Server-only: reads files relative to the Next project root. The routes are
 * `force-static`, so `next build` performs the reads once and the card is
 * served as a prerendered asset.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { colors } from "@qontinui/design-tokens";

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

export const SOCIAL_CARD_CONTENT_TYPE = "image/png";

export const SOCIAL_CARD_ALT =
  "Qontinui — open-source software factory. A fleet of AI agents that plans, implements, tests and lands changes on your own codebase.";

/** `public/q-logo.png`'s own pixel size; the card never scales the mark up. */
const MARK = { path: "public/q-logo.png", width: 152, height: 177 } as const;

const GEIST_REGULAR =
  "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf";
const GEIST_BOLD = "node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf";

/**
 * The files the card is drawn from, relative to the Next project root. They
 * feed the `card-inputs` digest the route files carry (see Cache-busting).
 */
export const SOCIAL_CARD_INPUT_FILES = [
  MARK.path,
  GEIST_REGULAR,
  GEIST_BOLD,
] as const;

/**
 * Satori sizes a word by adding up its glyphs measured one at a time, which
 * applies no kerning, but draws the word as one kerned run. A word whose
 * kerning pulls it in is drawn narrower than its box, so the gap after it
 * widens: about 6 px at 42 px after "development". Drawing every glyph as its
 * own span draws exactly what was measured, so the word gaps are even and the
 * text is unkerned. Words stay whole for wrapping, set `WORDS` apart.
 */
function evenlySpaced(text: string) {
  return text.split(" ").map((word, i) => (
    <div key={i} style={{ display: "flex" }}>
      {Array.from(word).map((glyph, j) => (
        <span key={j}>{glyph}</span>
      ))}
    </div>
  ));
}

/** A line of `evenlySpaced` words, Geist's own space (0.25em) apart. */
const WORDS = {
  display: "flex",
  flexWrap: "wrap",
  columnGap: "0.25em",
} as const;

export async function renderSocialCard(): Promise<ImageResponse> {
  const read = (file: string) => readFile(join(process.cwd(), file));
  const [mark, geistRegular, geistBold] = await Promise.all([
    read(MARK.path),
    read(GEIST_REGULAR),
    read(GEIST_BOLD),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundColor: colors.surface.canvas,
        backgroundImage: `radial-gradient(circle at 16% 38%, ${colors.glow.primary} 0%, transparent 42%), radial-gradient(circle at 92% 8%, ${colors.glow.secondary} 0%, transparent 38%)`,
        fontFamily: "Geist",
        color: colors.text.primary,
      }}
    >
      <div
        style={{
          width: 12,
          backgroundImage: `linear-gradient(180deg, ${colors.brand.primary}, ${colors.brand.secondary})`,
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 88px 0 76px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- satori (next/og) renders a plain <img>; next/image does not exist inside ImageResponse */}
            <img src={markSrc} width={MARK.width} height={MARK.height} alt="" />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginLeft: 52,
              }}
            >
              <div
                style={{
                  fontSize: 108,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                Qontinui
              </div>
              <div
                style={{
                  ...WORDS,
                  marginTop: 18,
                  fontSize: 42,
                  color: colors.text.secondary,
                }}
              >
                {evenlySpaced("Open-source software factory")}
              </div>
            </div>
          </div>
          <div
            style={{
              ...WORDS,
              marginTop: 56,
              maxWidth: 940,
              fontSize: 30,
              lineHeight: 1.4,
              color: colors.text.muted,
            }}
          >
            {evenlySpaced(
              "A fleet of AI agents that plans, implements, tests and lands changes on your own codebase, against a digital twin of your development process."
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0 88px 40px 76px",
            fontSize: 28,
            color: colors.text.muted,
          }}
        >
          <div style={{ color: colors.text.secondary }}>qontinui.io</div>
          <div style={WORDS}>
            {evenlySpaced("Claude · Gemini · open source")}
          </div>
        </div>
      </div>
    </div>,
    {
      ...SOCIAL_CARD_SIZE,
      fonts: [
        { name: "Geist", data: geistRegular, weight: 400, style: "normal" },
        { name: "Geist", data: geistBold, weight: 700, style: "normal" },
      ],
    }
  );
}
