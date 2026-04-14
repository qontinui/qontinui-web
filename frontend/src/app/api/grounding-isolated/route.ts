/**
 * API route that serves the isolated component renderer as standalone HTML.
 *
 * Bypasses the Next.js App Router layout (and its UIBridgeProvider /
 * RenderLogWrapper / AutoRegisterProvider) to avoid the circular-JSON
 * serialisation crash in Next.js's InnerScrollAndFocusHandler.
 *
 * The capture script navigates a browser tab to this URL; the UI Bridge
 * SDK is loaded as a standalone script so element discovery still works.
 *
 * Usage:
 *   /api/grounding-isolated?component=Button&variant=destructive&theme=dark&bg=solid-blue&left=45&top=30
 */

import { type NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Background map (mirrors the client-side page)
// ---------------------------------------------------------------------------

const BG_MAP: Record<string, string> = {
  "solid-blue": "#3b82f6",
  "solid-red": "#ef4444",
  "solid-green": "#22c55e",
  "solid-purple": "#a855f7",
  "solid-orange": "#f97316",
  "solid-yellow": "#eab308",
  "solid-pink": "#ec4899",
  "solid-teal": "#14b8a6",
  "solid-gray": "#6b7280",
  "solid-white": "#ffffff",
  "solid-black": "#000000",
  "solid-slate": "#64748b",
  "solid-zinc": "#71717a",
  "solid-stone": "#78716c",
  "solid-neutral": "#737373",
  "solid-indigo": "#6366f1",
  "solid-violet": "#8b5cf6",
  "solid-fuchsia": "#d946ef",
  "solid-rose": "#f43f5e",
  "solid-cyan": "#06b6d4",
  "solid-emerald": "#10b981",
  "solid-lime": "#84cc16",
  "solid-amber": "#f59e0b",
  "solid-sky": "#0ea5e9",
  "gradient-purple-blue":
    "linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)",
  "gradient-red-orange":
    "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
  "gradient-green-teal":
    "linear-gradient(135deg, #22c55e 0%, #14b8a6 100%)",
  "gradient-pink-purple":
    "linear-gradient(135deg, #ec4899 0%, #a855f7 100%)",
  "gradient-blue-cyan":
    "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)",
  "gradient-dark":
    "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
};

function resolveBg(bg: string): string {
  if (bg === "noise") {
    return 'background-color:#1e293b;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix type=\'saturate\' values=\'0\'/%3E%3C/filter%3E%3Crect width=\'200\' height=\'200\' filter=\'url(%23n)\' opacity=\'0.4\'/%3E%3C/svg%3E");background-repeat:repeat';
  }
  const resolved = BG_MAP[bg];
  if (!resolved) return "background-color:#f1f5f9";
  if (resolved.startsWith("linear-gradient")) return `background-image:${resolved}`;
  return `background-color:${resolved}`;
}

// ---------------------------------------------------------------------------
// Component HTML generators
// ---------------------------------------------------------------------------

function componentHtml(
  component: string,
  variant: string,
  state: string,
  size: string,
): string {
  const disabled = state === "disabled" ? " disabled" : "";
  const disabledClass = state === "disabled" ? " opacity-50 pointer-events-none" : "";
  const label = variant.charAt(0).toUpperCase() + variant.slice(1);

  switch (component) {
    case "Button":
      return `<button class="inline-flex items-center justify-center rounded-md font-medium transition-colors px-4 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90${disabledClass}"${disabled} data-variant="${variant}" data-size="${size}">${label} Button</button>`;
    case "Badge":
      return `<span class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-primary text-primary-foreground${disabledClass}" data-variant="${variant}">${label}</span>`;
    case "Input":
      return `<input type="${variant === "password" ? "password" : "text"}" placeholder="${state === "disabled" ? "Disabled input" : "Sample input"}" class="flex h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm${disabledClass}"${disabled}${variant === "invalid" ? ' aria-invalid="true"' : ""} />`;
    case "Textarea":
      return `<textarea placeholder="${state === "disabled" ? "Disabled textarea" : "Enter text here..."}" class="flex min-h-[80px] w-64 rounded-md border border-input bg-background px-3 py-2 text-sm${disabledClass}"${disabled}></textarea>`;
    case "Checkbox":
      return `<div class="flex items-center gap-2"><input type="checkbox" id="cb" class="h-4 w-4 rounded border"${state === "checked" ? " checked" : ""}${disabled} /><label for="cb" class="text-sm">${state === "checked" ? "Checked" : "Unchecked"}</label></div>`;
    case "Switch":
      return `<div class="flex items-center gap-2"><button role="switch" aria-checked="${state === "checked" || state === "on" ? "true" : "false"}" class="inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors bg-input${disabledClass}"${disabled}><span class="pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${state === "checked" || state === "on" ? "translate-x-5" : "translate-x-0"}"></span></button><label class="text-sm">${state === "on" || state === "checked" ? "On" : "Off"}</label></div>`;
    case "Toggle":
      return `<button class="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors h-10 px-3 bg-transparent hover:bg-muted${state === "pressed" ? " bg-accent text-accent-foreground" : ""}${disabledClass}"${disabled} aria-pressed="${state === "pressed"}">Toggle</button>`;
    case "Slider":
      return `<div class="relative flex w-64 touch-none select-none items-center"><div class="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"><div class="absolute h-full bg-primary" style="width:50%"></div></div><div class="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background" style="position:absolute;left:50%;transform:translateX(-50%)"></div></div>`;
    case "Progress":
      return `<div class="relative h-4 w-64 overflow-hidden rounded-full bg-secondary"><div class="h-full bg-primary transition-all" style="width:${variant === "empty" ? 0 : variant === "full" ? 100 : 45}%"></div></div>`;
    case "Tabs":
      return `<div class="w-72"><div class="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"><button class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium bg-background text-foreground shadow-sm">Account</button><button class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium">Settings</button><button class="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium">Billing</button></div><div class="mt-2 text-sm text-muted-foreground">Account content.</div></div>`;
    case "Card":
      return `<div class="w-72 rounded-lg border bg-card text-card-foreground shadow-sm"><div class="flex flex-col space-y-1.5 p-6"><h3 class="text-2xl font-semibold leading-none tracking-tight">Card Title</h3><p class="text-sm text-muted-foreground">Card description text.</p></div><div class="p-6 pt-0"><p class="text-sm">Card body content.</p></div><div class="flex items-center justify-end gap-2 p-6 pt-0"><button class="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1 text-sm hover:bg-accent">Cancel</button><button class="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-1 text-sm hover:bg-primary/90">Save</button></div></div>`;
    case "Separator":
      return `<div class="w-64 space-y-2"><p class="text-sm">Above</p><div class="shrink-0 bg-border h-[1px] w-full"></div><p class="text-sm">Below</p></div>`;
    case "Label":
      return `<div class="space-y-1"><label for="lbl-input" class="text-sm font-medium leading-none">Form Label</label><input id="lbl-input" placeholder="Associated input" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></div>`;
    default:
      return `<div class="rounded border p-3 text-sm text-muted-foreground">Unknown: ${component}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const component = sp.get("component") ?? "Button";
  const variant = sp.get("variant") ?? "default";
  const state = sp.get("state") ?? "enabled";
  const size = sp.get("size") ?? "default";
  const theme = sp.get("theme") ?? "light";
  const bg = sp.get("bg") ?? "solid-white";
  const left = Math.max(0, Math.min(100, parseFloat(sp.get("left") ?? "50")));
  const top = Math.max(0, Math.min(100, parseFloat(sp.get("top") ?? "50")));

  const bgStyle = resolveBg(bg);
  const isDark = theme === "dark";

  const html = `<!DOCTYPE html>
<html lang="en" class="${isDark ? "dark" : ""}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grounding Isolated: ${component}</title>
  <link rel="stylesheet" href="/_next/static/css/app/layout.css" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body class="${isDark ? "dark bg-background text-foreground" : "bg-background text-foreground"}">
  <div
    id="grounding-backdrop"
    style="position:fixed;inset:0;width:100vw;height:100vh;overflow:hidden;${bgStyle}"
  >
    <div
      data-grounding-target="true"
      data-component-type="${component}"
      data-component-variant="${variant}"
      style="position:absolute;left:${left}%;top:${top}%;transform:translate(-50%,-50%)"
    >
      ${componentHtml(component, variant, state, size)}
    </div>
  </div>
  <script>
    // Measure the grounding target element after render and expose the bbox
    // so the capture script can read it via /api/grounding-isolated/bbox polling.
    requestAnimationFrame(function() {
      var el = document.querySelector('[data-grounding-target="true"]');
      if (!el) return;
      var r = el.getBoundingClientRect();
      window.__GROUNDING_BBOX__ = {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        component: el.getAttribute('data-component-type'),
        variant: el.getAttribute('data-component-variant'),
        ready: true
      };
      // Also set it as a data attribute on body for easy extraction
      document.body.setAttribute('data-grounding-bbox',
        JSON.stringify(window.__GROUNDING_BBOX__));
    });
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
