/**
 * D2's resolution order (plan `2026-10-23-console-presentation-spaces`):
 * `?present=` wins, then the tab's choice, then the viewer's setting, then
 * off — and an unreadable store with no URL answer fails CLOSED.
 */

import { describe, expect, it } from "vitest";
import {
  decodeChoice,
  encodeChoice,
  parsePresentParam,
  resolvePresentationMode,
  type PresentationModeInputs,
} from "./presentationModeResolution";

const NOTHING: PresentationModeInputs = {
  url: null,
  session: null,
  storage: null,
  storesReadable: true,
};

describe("parsePresentParam", () => {
  it("reads an absent key as no answer, never as off", () => {
    expect(parsePresentParam(null)).toBeNull();
    expect(parsePresentParam(undefined)).toBeNull();
  });

  it("reads the canonical spellings", () => {
    expect(parsePresentParam("1")).toBe(true);
    expect(parsePresentParam("0")).toBe(false);
  });

  it("reads every off-word, in any case, trimmed", () => {
    for (const off of ["0", "false", "OFF", " no ", "False"]) {
      expect(parsePresentParam(off), off).toBe(false);
    }
  });

  it("fails CLOSED on an empty or unrecognised value", () => {
    // Someone put the key on the URL to ask for a presentation; guessing
    // "operator" would show the controls.
    for (const on of ["", "true", "yes", "ture", "2"]) {
      expect(parsePresentParam(on), JSON.stringify(on)).toBe(true);
    }
  });
});

describe("resolvePresentationMode", () => {
  it("lets the URL win over both stores", () => {
    expect(
      resolvePresentationMode({
        ...NOTHING,
        url: true,
        session: false,
        storage: false,
      })
    ).toEqual({ presenting: true, source: "url" });
    expect(
      resolvePresentationMode({
        ...NOTHING,
        url: false,
        session: true,
        storage: true,
      })
    ).toEqual({ presenting: false, source: "url" });
  });

  it("lets the URL decide even before the stores are readable", () => {
    expect(
      resolvePresentationMode({ ...NOTHING, url: false, storesReadable: false })
    ).toEqual({ presenting: false, source: "url" });
  });

  it("fails CLOSED when the stores cannot be read and the URL says nothing", () => {
    expect(
      resolvePresentationMode({ ...NOTHING, storesReadable: false })
    ).toEqual({ presenting: true, source: "unresolved" });
  });

  it("prefers the tab's choice over the viewer's remembered setting", () => {
    expect(
      resolvePresentationMode({ ...NOTHING, session: false, storage: true })
    ).toEqual({ presenting: false, source: "session" });
    expect(
      resolvePresentationMode({ ...NOTHING, session: true, storage: false })
    ).toEqual({ presenting: true, source: "session" });
  });

  it("falls back to the viewer's setting, then to off", () => {
    expect(resolvePresentationMode({ ...NOTHING, storage: true })).toEqual({
      presenting: true,
      source: "storage",
    });
    expect(resolvePresentationMode(NOTHING)).toEqual({
      presenting: false,
      source: "default",
    });
  });
});

describe("encodeChoice / decodeChoice", () => {
  it("round-trips, and reads anything else as no choice", () => {
    expect(decodeChoice(encodeChoice(true))).toBe(true);
    expect(decodeChoice(encodeChoice(false))).toBe(false);
    for (const junk of [null, undefined, "", "true", "on", "11"]) {
      expect(decodeChoice(junk), String(junk)).toBeNull();
    }
  });
});
