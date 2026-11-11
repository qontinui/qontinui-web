/**
 * An in-memory ioredis stand-in for the UI Bridge relay's rate limiter
 * (`src/app/api/ui-bridge/[...path]/_rate-limit.ts`), shared by every suite
 * that drives the limiter, directly or through the route handler. Install it
 * with the limiter's `__setRedisClientForTest(mock.client)`.
 *
 * # It records every command
 *
 * The provider bills per command, so what a counted request costs in commands
 * is part of the limiter's contract: one INCR, plus one EXPIRE on the INCR
 * that answers 1 (plan
 * 2026-11-09-webpack-bundles-the-relay-sdks-ioredis-import-so-the-deployed-relay-bus-never-starts,
 * D5). `commands` lists every command the client received, in order, whether
 * it was called directly or queued on a `pipeline()` and sent by `exec()`. A
 * pipelined command is still a billed command, so it is listed like any
 * other, marked `via: "pipeline"`.
 *
 * # Not ready, as measured
 *
 * `notReadyRedis()` is a client whose connection is not ready (`connecting`
 * or `reconnecting`) under the limiter's `enableOfflineQueue: false`. In
 * ioredis 5.11.1 (the lockfile's resolution) `Redis.prototype.sendCommand`
 * REJECTS such a command with "Stream isn't writeable and enableOfflineQueue
 * options is false" (`node_modules/ioredis/built/Redis.js:374-377`), while a
 * pipeline's `exec()` RESOLVES with that error once per command. Both were
 * measured on 2026-11-10, in both states, with a client built with the
 * limiter's options and dialling a port nothing listens on.
 *
 * It lives under `src/test/`, the app's home for test helpers. That keeps it
 * out of vitest's suite include (`vitest.config.ts` collects only
 * `*.{test,spec}.{ts,tsx}` files under `src/`) and out of the app type-check,
 * like the rest of this directory (`tsconfig.json` `exclude`).
 */

import type { Redis } from "ioredis";

/** The two commands `_rate-limit.ts` sends. */
export type RecordedCommandName = "incr" | "expire";

/** One Redis command the client received. */
export interface RecordedCommand {
  readonly name: RecordedCommandName;
  readonly key: string;
  /** EXPIRE's TTL in seconds; absent on an INCR. */
  readonly seconds?: number;
  /** `pipeline` when it was queued on a `pipeline()`, `direct` otherwise. */
  readonly via: "direct" | "pipeline";
  /** Its answer (INCR: the count; EXPIRE: 1, or 0 for no such key). */
  readonly reply?: unknown;
  /** The message it failed with, when it failed; it then has no `reply`. */
  readonly error?: string;
}

export interface MockRedisOptions {
  /** Every command on a key containing this text fails. */
  readonly failOn?: string;
  /** EXPIRE fails with this error: a TTL write lost after its INCR answered. */
  readonly expireError?: Error;
  /**
   * What INCR answers in place of its count, given the count: a reply that is
   * not a count. The store still counts.
   */
  readonly incrReply?: (count: number) => unknown;
}

/** A recording client, and what it recorded. */
export interface RecordingRedis {
  /** The client, typed as `__setRedisClientForTest` takes it. */
  readonly client: Redis;
  /** Every command the client received, in the order it received them. */
  readonly commands: RecordedCommand[];
}

/** A counting client: `makeMockRedis()`. */
export interface MockRedis extends RecordingRedis {
  /** Each key's counter. */
  readonly store: Map<string, number>;
}

/** What one command came to: an answer or an error. */
type Outcome = { readonly reply: unknown } | { readonly error: Error };

/** Runs one command against the stand-in's state. */
type Execute = (name: RecordedCommandName, key: string) => Outcome;

/** The pipeline surface `_rate-limit.ts` has used: queue, then `exec()`. */
interface MockPipeline {
  incr(key: string): MockPipeline;
  expire(key: string, seconds: number): MockPipeline;
  exec(): Promise<Array<[Error | null, unknown]>>;
}

/**
 * A client reporting `status` whose every command goes through `execute` and
 * is recorded. A direct call resolves with the command's answer or rejects
 * with its error. A pipeline's `exec()` resolves `[error, reply]` per command,
 * as ioredis's does.
 */
function recordingClient(execute: Execute, status: string): RecordingRedis {
  const commands: RecordedCommand[] = [];

  function run(
    via: RecordedCommand["via"],
    name: RecordedCommandName,
    key: string,
    seconds: number | undefined
  ): Outcome {
    const outcome = execute(name, key);
    commands.push({
      name,
      key,
      ...(seconds === undefined ? {} : { seconds }),
      via,
      ...("error" in outcome
        ? { error: outcome.error.message }
        : { reply: outcome.reply }),
    });
    return outcome;
  }

  function direct(
    name: RecordedCommandName,
    key: string,
    seconds?: number
  ): Promise<unknown> {
    const outcome = run("direct", name, key, seconds);
    return "error" in outcome
      ? Promise.reject(outcome.error)
      : Promise.resolve(outcome.reply);
  }

  function pipeline(): MockPipeline {
    const queued: Array<[RecordedCommandName, string, number | undefined]> = [];
    const chain: MockPipeline = {
      incr(key) {
        queued.push(["incr", key, undefined]);
        return chain;
      },
      expire(key, seconds) {
        queued.push(["expire", key, seconds]);
        return chain;
      },
      async exec() {
        return queued.splice(0).map(([name, key, seconds]) => {
          const outcome = run("pipeline", name, key, seconds);
          return "error" in outcome
            ? [outcome.error, null]
            : [null, outcome.reply];
        });
      },
    };
    return chain;
  }

  const client = {
    status,
    incr: (key: string) => direct("incr", key),
    expire: (key: string, seconds: number) => direct("expire", key, seconds),
    pipeline,
  };
  return { client: client as unknown as Redis, commands };
}

/**
 * A ready client counting INCRs per key in `store`, recording every command.
 * By default every command answers as Redis would; `options` makes some fail
 * or answer something else.
 */
export function makeMockRedis(options: MockRedisOptions = {}): MockRedis {
  const { failOn, expireError, incrReply } = options;
  const store = new Map<string, number>();
  const execute: Execute = (name, key) => {
    if (failOn !== undefined && key.includes(failOn)) {
      return { error: new Error("simulated redis op failure") };
    }
    if (name === "incr") {
      const count = (store.get(key) ?? 0) + 1;
      store.set(key, count);
      return { reply: incrReply ? incrReply(count) : count };
    }
    if (expireError) {
      return { error: expireError };
    }
    return { reply: store.has(key) ? 1 : 0 };
  };
  return { ...recordingClient(execute, "ready"), store };
}

/**
 * A client whose connection is not ready, as ioredis 5.11.1 behaves under
 * `enableOfflineQueue: false` (this module's header): every direct command
 * rejects, and a pipeline resolves with the same error per command. Each
 * command is still recorded, as one the client received.
 */
export function notReadyRedis(
  status: "connecting" | "reconnecting" = "connecting"
): RecordingRedis {
  return recordingClient(
    () => ({
      error: new Error(
        "Stream isn't writeable and enableOfflineQueue options is false"
      ),
    }),
    status
  );
}
