import { describe, expect, it } from "vitest";

import {
  envelopeEndpoint,
  parseDsn,
  toSentryEnvelope,
} from "./sentry-envelope";
import type { ClientTelemetryEvent } from "./types";

const DSN =
  "https://abc123def456@o4509.ingest.de.sentry.io/1234567";

function makeEvent(
  overrides: Partial<ClientTelemetryEvent> = {}
): ClientTelemetryEvent {
  return {
    event_id: "11111111-2222-3333-4444-555555555555",
    client_ts: "2026-06-03T12:00:00.000Z",
    kind: "cors_failure",
    release: "build-abc",
    surface: "web",
    origin: "https://qontinui.io",
    route_template: "/users/:id",
    request_host: "web.staging.qontinui.io",
    request_path_tmpl: "/api/v1/users/:id",
    failure_class: "cors",
    http_status: 503,
    error_name: "TypeError",
    error_message_norm: "TypeError:failed_to_fetch",
    // top-first (innermost/crashing first), as scrubStack emits.
    stack_top: [
      { symbol: "getCurrentUser", file: "/_next/app.js", line: 10, column: 5 },
      { symbol: "fetch", file: "/_next/app.js", line: 20, column: 3 },
    ],
    browser_family: "Chrome",
    session_hash: "deadbeef",
    count: 3,
    opt_out: false,
    ...overrides,
  };
}

describe("parseDsn", () => {
  it("parses a valid Sentry DSN", () => {
    const parsed = parseDsn(DSN);
    expect(parsed).toEqual({
      publicKey: "abc123def456",
      host: "o4509.ingest.de.sentry.io",
      projectId: "1234567",
    });
  });

  it("rejects a non-DSN URL (no user-info key)", () => {
    expect(parseDsn("https://telemetry.qontinui.example/ingest")).toBeNull();
  });

  it("rejects a URL with a non-numeric project id", () => {
    expect(
      parseDsn("https://key@o0.ingest.de.sentry.io/not-a-number")
    ).toBeNull();
  });

  it("rejects a URL with no path (no project id)", () => {
    expect(parseDsn("https://key@o0.ingest.de.sentry.io")).toBeNull();
  });

  it("rejects empty / garbage input", () => {
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("   ")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
  });
});

describe("envelopeEndpoint", () => {
  it("derives https://<host>/api/<projectId>/envelope/", () => {
    expect(envelopeEndpoint(DSN)).toBe(
      "https://o4509.ingest.de.sentry.io/api/1234567/envelope/"
    );
  });

  it("returns null for a non-DSN URL", () => {
    expect(envelopeEndpoint("https://example.com/ingest")).toBeNull();
  });
});

describe("toSentryEnvelope structure", () => {
  it("emits exactly three newline-delimited lines, each valid JSON", () => {
    const env = toSentryEnvelope(makeEvent(), DSN);
    const lines = env.split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("envelope header carries 32-hex event_id (dashes stripped), dsn, sent_at", () => {
    const env = toSentryEnvelope(makeEvent(), DSN);
    const header = JSON.parse(env.split("\n")[0]);
    expect(header.event_id).toBe("11111111222233334444555555555555");
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(header.event_id).not.toContain("-");
    expect(header.dsn).toBe(DSN);
    expect(typeof header.sent_at).toBe("string");
    expect(() => new Date(header.sent_at).toISOString()).not.toThrow();
  });

  it("item header is {type:event}", () => {
    const env = toSentryEnvelope(makeEvent(), DSN);
    expect(JSON.parse(env.split("\n")[1])).toEqual({ type: "event" });
  });

  it("event payload carries our dimensions as tags + scrubbed fields", () => {
    const env = toSentryEnvelope(makeEvent(), DSN);
    const ev = JSON.parse(env.split("\n")[2]);
    expect(ev.event_id).toBe("11111111222233334444555555555555");
    expect(ev.timestamp).toBe("2026-06-03T12:00:00.000Z");
    expect(ev.platform).toBe("javascript");
    expect(ev.level).toBe("error");
    expect(ev.release).toBe("build-abc");
    expect(ev.environment).toBe("production");
    expect(ev.logger).toBe("qontinui-beacon");
    expect(ev.message.formatted).toBe("TypeError: TypeError:failed_to_fetch");
    expect(ev.extra).toEqual({ count: 3 });
    expect(ev.tags).toEqual({
      kind: "cors_failure",
      origin: "https://qontinui.io",
      route_template: "/users/:id",
      request_host: "web.staging.qontinui.io",
      request_path_tmpl: "/api/v1/users/:id",
      failure_class: "cors",
      http_status: "503", // stringified
      browser_family: "Chrome",
      session_hash: "deadbeef",
    });
    // exception mirrors error_name/value only
    expect(ev.exception.values[0].type).toBe("TypeError");
    expect(ev.exception.values[0].value).toBe("TypeError:failed_to_fetch");
  });

  it("omits absent optional tags (no request_host / status when missing)", () => {
    const env = toSentryEnvelope(
      makeEvent({
        request_host: undefined,
        request_path_tmpl: undefined,
        failure_class: undefined,
        http_status: undefined,
      }),
      DSN
    );
    const ev = JSON.parse(env.split("\n")[2]);
    expect(ev.tags.request_host).toBeUndefined();
    expect(ev.tags.request_path_tmpl).toBeUndefined();
    expect(ev.tags.failure_class).toBeUndefined();
    expect(ev.tags.http_status).toBeUndefined();
  });

  it("adds NO fields beyond the scrubbed set — no user/ip/request/contexts/ua keys", () => {
    const env = toSentryEnvelope(makeEvent(), DSN);
    const ev = JSON.parse(env.split("\n")[2]);
    // The whole serialized envelope must not contain identity/transport keys.
    expect(env).not.toMatch(/"user"/);
    expect(env).not.toMatch(/"ip_address"/);
    expect(env).not.toMatch(/"contexts"/);
    expect(env).not.toMatch(/"request"/);
    expect(env).not.toMatch(/"headers"/);
    expect(env).not.toMatch(/user[_-]?agent/i);
    expect(env).not.toMatch(/"sdk"/);
    // And specifically the event object has none of them.
    expect(ev.user).toBeUndefined();
    expect(ev.contexts).toBeUndefined();
    expect(ev.request).toBeUndefined();
    expect(ev.server_name).toBeUndefined();
    // Allowed top-level keys are exactly the projected set.
    expect(Object.keys(ev).sort()).toEqual(
      [
        "environment",
        "event_id",
        "exception",
        "extra",
        "level",
        "logger",
        "message",
        "platform",
        "release",
        "tags",
        "timestamp",
      ].sort()
    );
  });
});

describe("toSentryEnvelope frame ordering", () => {
  it("reverses our top-first frames to Sentry's oldest-first", () => {
    const env = toSentryEnvelope(makeEvent(), DSN);
    const ev = JSON.parse(env.split("\n")[2]);
    const frames = ev.exception.values[0].stacktrace.frames;
    // Our stack_top is [getCurrentUser (top), fetch]. Sentry wants oldest-first,
    // so the crashing frame (getCurrentUser) must be LAST.
    expect(frames.map((f: { function: string }) => f.function)).toEqual([
      "fetch",
      "getCurrentUser",
    ]);
    // Frame fields are mapped: symbol→function, file→filename, line→lineno, column→colno.
    expect(frames[1]).toEqual({
      function: "getCurrentUser",
      filename: "/_next/app.js",
      lineno: 10,
      colno: 5,
    });
  });

  it("does not mutate the source event's stack_top array", () => {
    const event = makeEvent();
    const before = event.stack_top.map((f) => f.symbol);
    toSentryEnvelope(event, DSN);
    expect(event.stack_top.map((f) => f.symbol)).toEqual(before);
  });

  it("handles an empty stack", () => {
    const env = toSentryEnvelope(makeEvent({ stack_top: [] }), DSN);
    const ev = JSON.parse(env.split("\n")[2]);
    expect(ev.exception.values[0].stacktrace.frames).toEqual([]);
  });
});
