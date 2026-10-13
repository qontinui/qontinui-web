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
 * Server-only: reads files relative to the Next project root. The routes are
 * `force-static`, so `next build` performs the reads once and the card is
 * served as a prerendered asset.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { colors } from "@qontinui/design-tokens";

/** The 1.91:1 size Open Graph and X `summary_large_image` both render full-bleed. */
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

export const SOCIAL_CARD_CONTENT_TYPE = "image/png";

export const SOCIAL_CARD_ALT =
  "Qontinui — open-source AI development platform. A desktop app that orchestrates AI coding sessions with automated feedback loops, verification, and error monitoring.";

/** `public/q-logo.png`'s own pixel size; the card never scales the mark up. */
const MARK = { path: "public/q-logo.png", width: 152, height: 177 } as const;

const GEIST_DIR = "node_modules/geist/dist/fonts/geist-sans";

export async function renderSocialCard(): Promise<ImageResponse> {
  const root = process.cwd();
  const [mark, geistRegular, geistBold] = await Promise.all([
    readFile(join(root, MARK.path)),
    readFile(join(root, GEIST_DIR, "Geist-Regular.ttf")),
    readFile(join(root, GEIST_DIR, "Geist-Bold.ttf")),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: colors.surface.canvas,
        backgroundImage: `radial-gradient(circle at 16% 38%, ${colors.glow.primary} 0%, transparent 42%), radial-gradient(circle at 92% 8%, ${colors.glow.secondary} 0%, transparent 38%)`,
        fontFamily: "Geist",
        color: colors.text.primary,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
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
                marginTop: 18,
                fontSize: 42,
                color: colors.text.secondary,
              }}
            >
              Open-source AI development platform
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: 56,
            maxWidth: 940,
            fontSize: 30,
            lineHeight: 1.4,
            color: colors.text.muted,
          }}
        >
          A desktop app that orchestrates AI coding sessions with automated
          feedback loops, verification, and error monitoring.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 88px 34px",
          fontSize: 28,
          color: colors.text.muted,
        }}
      >
        <div style={{ color: colors.text.secondary }}>qontinui.io</div>
        <div>Claude · Gemini · open source</div>
      </div>
      <div
        style={{
          height: 10,
          backgroundImage: `linear-gradient(90deg, ${colors.brand.primary}, ${colors.brand.secondary})`,
        }}
      />
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
