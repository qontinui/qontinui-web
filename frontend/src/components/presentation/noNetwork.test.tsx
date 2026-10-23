/**
 * D3.4 of plan `2026-10-23-console-presentation-spaces`: "nothing new is
 * fetched for presentation mode". The lens and every primitive in this folder
 * render from what the page already holds — so mounting them, presenting,
 * toggling and re-rendering issue no request of any kind.
 *
 * The one read presentation mode is allowed is the tenant's redaction scope,
 * and it arrives through `PresentationScopeProvider`'s `state` prop: this
 * folder has no network code at all, which the source scan below holds.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import {
  Caption,
  CostFigure,
  MachineName,
  OperatorOnly,
  PresentationLens,
  PresentationModeToggle,
  Provenance,
  RedactedText,
} from "./index";

const requests: string[] = [];
const realWebSocket = globalThis.WebSocket;
const realEventSource = (globalThis as { EventSource?: unknown }).EventSource;

class RecordingSocket {
  constructor(url: string | URL) {
    requests.push(`websocket ${String(url)}`);
  }
}

beforeEach(() => {
  requests.length = 0;
  window.history.replaceState(null, "", "/admin/coord/devops?present=1");
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    requests.push(`fetch ${String(input)}`);
    return new Response(null, { status: 599 });
  });
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL
  ) {
    requests.push(`xhr ${method} ${String(url)}`);
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: RecordingSocket,
  });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: RecordingSocket,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: realWebSocket,
  });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: realEventSource,
  });
  window.history.replaceState(null, "", "/");
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function LensPage() {
  return (
    <PresentationLens>
      <PresentationModeToggle />
      <Caption id="dev-ops.page" />
      <Provenance source="coord fleet health" asOf="2026-10-23T12:00:00Z" />
      <RedactedText
        text="Ship the lens"
        repo="qontinui/qontinui-web"
        descriptor={{ kind: "Plan", status: "draft" }}
      />
      <MachineName identity={{ hostname: "build-host-1" }} />
      <CostFigure amount={1.25} source="reported" />
      <OperatorOnly>
        <button type="button">Drain this machine</button>
      </OperatorOnly>
    </PresentationLens>
  );
}

describe("the presentation lens issues no request", () => {
  it("renders, toggles both ways and re-renders without touching the network", () => {
    const { rerender } = render(<LensPage />);
    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    act(() => {
      fireEvent.click(toggle);
    });
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Presentation mode" })
      );
    });
    rerender(<LensPage />);
    expect(requests).toEqual([]);
  });
});

/**
 * Modules in this folder allowed to read the network: ONLY the loader of the
 * tenant's presentation scope, the one read D3.4 permits presentation mode.
 * Name it here, by its path relative to this folder, when it lands — and
 * nothing else.
 */
const ALLOWED_NETWORK_MODULES: ReadonlySet<string> = new Set<string>([]);

describe("the presentation folder carries no network code", () => {
  const files = readdirSync(__dirname, { recursive: true })
    .map((f) => String(f).split("\\").join("/"))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => !ALLOWED_NETWORK_MODULES.has(f));

  it("scans the folder (not vacuously)", () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files.some((f) => f.endsWith("PresentationModeProvider.tsx"))).toBe(
      true
    );
  });

  it("calls no fetch, XHR, socket, http client or query hook", () => {
    const NETWORK =
      /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|new\s+EventSource|sendBeacon|httpClient|service-factory|@tanstack\/react-query|\buseQuery\b|\baxios\b/;
    const offenders = files.filter((f) => {
      const source = readFileSync(join(__dirname, f), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        ""
      );
      return NETWORK.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
