/**
 * Tripwire: no emitter on the relay / rate-limiter Redis path may write the
 * Redis URL's password anywhere a log drain reads.
 *
 * Unlike the mocked redaction tests next to it, this runs the REAL `ioredis`
 * and the REAL `@qontinui/ui-bridge` SDK against a local TCP server that
 * answers every command with `-WRONGPASS`, which is the production failure
 * (finding 56d2bd32). It spies every output channel, including
 * `process.stdout/stderr.write` (what Vercel's drain captures, bypassing any
 * console spy) and the unhandled-rejection / uncaught-exception hooks, and
 * fails if a captured byte, including the `util.inspect` of any logged object,
 * carries the secret.
 *
 * Every case also asserts a CONTROL: the emitter produced at least one
 * captured line, so an empty capture can never read as "clean".
 *
 * Plan: 2026-11-15-relay-redis-password-leak-emitter-identified-and-fixed
 */
import net from "node:net";
import util from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REDIS_URL_UNPARSEABLE_MESSAGE } from "./redis-url";

const SECRET = "SECRETPW123";

// Every real ioredis client the emitters construct, so each test can tear them
// down: a surviving client reconnects and emits into the NEXT test's capture.
const created = vi.hoisted(() => ({
  clients: [] as Array<{ disconnect(): void }>,
}));
vi.mock("ioredis", async (importOriginal) => {
  const real = await importOriginal<typeof import("ioredis")>();
  class Tracked extends real.default {
    constructor(...args: ConstructorParameters<typeof real.default>) {
      // @ts-expect-error forwarding an overloaded constructor
      super(...args);
      created.clients.push(this);
    }
  }
  return { ...real, default: Tracked };
});

type Server = { port: number; close: () => Promise<void> };

/** A TCP server that answers every RESP command with -WRONGPASS. */
async function startWrongPassServer(): Promise<Server> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.on("data", (buf) => {
      const commands = (buf.toString().match(/^\*\d+/gm) ?? []).length || 1;
      for (let i = 0; i < commands; i++) {
        socket.write(
          "-WRONGPASS invalid username-password pair or user is disabled.\r\n"
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      }),
  };
}

/** Every output channel, recorded as text (inspect-expanded for objects). */
function installCapture() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(
      args
        .map((a) =>
          typeof a === "string"
            ? a
            : util.inspect(a, { depth: 10, showHidden: true })
        )
        .join(" ")
    );
  };
  const restore: Array<() => void> = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    const spy = vi.spyOn(console, m).mockImplementation(record);
    restore.push(() => spy.mockRestore());
  }
  for (const stream of [process.stdout, process.stderr]) {
    const spy = vi.spyOn(stream, "write").mockImplementation(((
      chunk: unknown
    ) => {
      record(String(chunk));
      return true;
    }) as typeof stream.write);
    restore.push(() => spy.mockRestore());
  }
  const onRejection = (reason: unknown) => record("unhandledRejection", reason);
  const onUncaught = (err: unknown) => record("uncaughtException", err);
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onUncaught);
  restore.push(() => {
    process.off("unhandledRejection", onRejection);
    process.off("uncaughtException", onUncaught);
  });
  return {
    lines,
    text: () => lines.join("\n"),
    restore: () => restore.forEach((r) => r()),
  };
}

/** Wait until something was captured (or the budget runs out), then settle. */
async function settle(lines: string[], budgetMs = 6000) {
  const start = Date.now();
  while (lines.length === 0 && Date.now() - start < budgetMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  // Late emitters (retry storms, the second connection) land after the first.
  await new Promise((r) => setTimeout(r, 600));
}

type UrlCase = {
  name: string;
  make: (port: number) => string;
  parseable: boolean;
};
const URL_CASES: UrlCase[] = [
  {
    name: "scheme-less userinfo",
    make: (p) => `default:${SECRET}@127.0.0.1:${p}`,
    parseable: true,
  },
  {
    name: "redis:// userinfo",
    make: (p) => `redis://default:${SECRET}@127.0.0.1:${p}`,
    parseable: true,
  },
  {
    // Unencoded `/` in the password: ioredis/WHATWG mis-parse it (ERR_INVALID_URL).
    name: "unencoded / in the password",
    make: (p) => `default:SEC/RET@127.0.0.1:${p}`,
    parseable: false,
  },
];

function assertNoLeak(text: string) {
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain("RET@");
  expect(text).not.toContain("SEC/RET");
}

describe.each(URL_CASES)("redis leak tripwire: $name", (urlCase) => {
  let server: Server;
  let capture: ReturnType<typeof installCapture>;

  beforeEach(async () => {
    vi.resetModules();
    server = await startWrongPassServer();
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", urlCase.make(server.port));
    vi.stubEnv("UI_BRIDGE_RELAY_REQUIRE_REDIS", "");
    capture = installCapture();
  });
  afterEach(async () => {
    created.clients.splice(0).forEach((c) => c.disconnect());
    capture.restore();
    vi.unstubAllEnvs();
    await server.close();
  });

  it("SDK createRedisRelayBus (default onError) never emits the password", async () => {
    const { createRedisRelayBus } = await import("@qontinui/ui-bridge/server");
    const bus = await createRedisRelayBus(urlCase.make(server.port)).catch(
      (e: unknown) => e
    );
    // The caller owns what it does with a rejection; the SDK must not have
    // logged the raw error either way. Let the failing AUTH replies arrive
    // (the bus resolves first, the SDK warns afterwards) before closing.
    await settle(capture.lines, urlCase.parseable ? 6000 : 300);
    if (bus && typeof (bus as { close?: unknown }).close === "function") {
      await (bus as { close: () => Promise<void> }).close();
    }
    if (urlCase.parseable) {
      // Control: a failing AUTH produced SDK output that is scanned below.
      expect(capture.text()).toMatch(/WRONGPASS/);
    } else {
      expect(bus).toBeInstanceOf(Error);
    }
    assertNoLeak(capture.text());
    if (bus instanceof Error) {
      // The rejection value itself is what relay.ts logs through safeRedisErrorText.
      const { safeRedisErrorText } = await import("./redis-redact");
      assertNoLeak(safeRedisErrorText(bus, [urlCase.make(server.port)]));
    }
  });

  it("frontend relay module import never emits the password", async () => {
    const mod = await import("./relay");
    await settle(capture.lines);
    // Control: the degraded/failure path wrote at least one line (an unparseable
    // URL writes the fixed message; a failing AUTH writes the init/onError line).
    // Control: the emitter's own marker, not merely "something was printed".
    expect(capture.text()).toMatch(
      urlCase.parseable ? /WRONGPASS/ : /not a parseable Redis URL/
    );
    if (!urlCase.parseable) {
      expect(mod.getRelayBusStatus()).toBe("in-memory-degraded");
      expect(capture.text()).toContain(REDIS_URL_UNPARSEABLE_MESSAGE);
    }
    assertNoLeak(capture.text());
  });

  it("rate limiter getClient never emits the password", async () => {
    const mod = await import("../../app/api/ui-bridge/[...path]/_rate-limit");
    const result = await mod.checkRateLimit("tripwire-user", "read");
    await settle(capture.lines);
    expect(result.redisOffline).toBe(true); // failed open
    expect(capture.text()).toMatch(
      urlCase.parseable ? /WRONGPASS/ : /not a parseable Redis URL/
    ); // control: the emitter's own marker
    if (!urlCase.parseable) {
      expect(capture.text()).toContain(REDIS_URL_UNPARSEABLE_MESSAGE);
    }
    assertNoLeak(capture.text());
  });
});
