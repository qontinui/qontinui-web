/**
 * machineAliases — stable "Machine A, B…" names for presentation mode (plan
 * `2026-10-23-console-presentation-spaces` D3.3: "machine names, device ids
 * and hostnames render as stable aliases on every lens surface").
 *
 * Hostnames are internal names and device ids are internal identifiers, and
 * an external evaluator may see neither. A presentation still has to say "this
 * machine is busy, that one is idle", so each machine gets a letter, and the
 * SAME machine keeps the SAME letter on every panel and every page of the
 * session — the spawn matrix (Phase 4), the UI Bridge dashboard (Phase 6) and
 * the Dev Ops machine rows (Phase 7) all name a machine by whichever
 * identifier they happen to hold, and they must agree.
 *
 * ## How identities are linked
 *
 * A caller passes every identifier it has (`MachineIdentity`). Aliases key on
 * the STRONG identifiers — the device id and the hostname — and every strong
 * identifier an identity carries is linked to one alias. So a panel that knows
 * only a hostname and a panel that knows the device id and the hostname land
 * on one letter. Two coord devices on one host share their host's letter: a
 * machine here is a computer.
 *
 * Panels discover a machine in any order. A device-id-only panel (Machine A)
 * and a hostname-only panel (Machine B) can meet the same computer before any
 * panel holding both has linked them; when one does, the two letters are
 * MERGED: the machine keeps the earlier letter on every panel, the later one is
 * retired and never reissued, and the registry notifies its subscribers so a
 * panel that already rendered the retired letter re-renders with the kept one.
 * One computer must never read as two machines to an audience.
 *
 * A display name is a label someone typed, and two computers may both be
 * called "Workstation", so it is used ONLY when an identity carries no strong
 * identifier at all — it never links two strong identities together, which
 * would give two machines one letter.
 *
 * Otherwise aliases are assigned in first-seen order and never change once
 * assigned; an identity with nothing to key on gets
 * {@link UNIDENTIFIED_MACHINE}, never a letter it might share.
 *
 * ## Two devices on one machine
 *
 * The letter is the computer's, so two coord devices registered from one host
 * read as the same "Machine B". A surface that lists DEVICES (one line per
 * device id) still has to tell them apart, so the registry also numbers device
 * ids in first-seen order ({@link MachineAliasRegistry.deviceOrdinalFor}),
 * keyed on the device id alone and never merged. A surface ranks the devices
 * that share a letter by that number ("Machine B, device 1", "…, device 2"),
 * so the letter every other panel shows is untouched and the two lines are
 * still two.
 *
 * ## Persistence
 *
 * The session registry persists to sessionStorage, so a reload mid-
 * presentation keeps every letter; it falls back to memory when storage is
 * unavailable. Keys are stored HASHED — the store never holds a hostname or a
 * device id — and nothing leaves the browser.
 */

export interface MachineIdentity {
  readonly deviceId?: string | null;
  readonly hostname?: string | null;
  readonly displayName?: string | null;
}

/** For an identity with no identifier at all. Never shares a letter. */
export const UNIDENTIFIED_MACHINE = "Unidentified machine";

/** The sessionStorage key of the session registry. */
export const MACHINE_ALIAS_STORAGE_KEY =
  "qontinui.presentation.machine-aliases";

const PERSISTED_VERSION = 1;

interface PersistedRegistry {
  v: number;
  next: number;
  keys: Record<string, number>;
  /** Device ordinals by hashed device id (absent in a store written before them). */
  devices?: Record<string, number>;
  nextDevice?: number;
}

function ordinalEntries(raw: unknown): Array<[string, number]> {
  if (typeof raw !== "object" || raw === null) return [];
  return Object.entries(raw).filter(
    (e): e is [string, number] =>
      typeof e[1] === "number" && Number.isInteger(e[1]) && e[1] >= 0
  );
}

/** 0 → A, 25 → Z, 26 → AA, 27 → AB … (bijective base 26). */
export function aliasLetters(index: number): string {
  let n = Math.floor(index) + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** The display alias for an index. */
export function aliasLabel(index: number): string {
  return `Machine ${aliasLetters(index)}`;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The identity's lookup keys, strongest first. Strong keys (device id,
 * hostname) when there are any; otherwise the display name; otherwise none.
 */
export function machineIdentityKeys(identity: MachineIdentity): string[] {
  const strong: string[] = [];
  const deviceId = clean(identity.deviceId);
  if (deviceId) strong.push(`device:${deviceId.toLowerCase()}`);
  const hostname = clean(identity.hostname);
  if (hostname) strong.push(`host:${hostname.toLowerCase()}`);
  if (strong.length > 0) return strong;
  const displayName = clean(identity.displayName);
  return displayName ? [`name:${displayName.toLowerCase()}`] : [];
}

/**
 * cyrb53 — a fast 53-bit string hash. Not cryptographic, and it does not need
 * to be: it keeps identifiers out of storage, and a collision between two of a
 * tenant's machines is a 1-in-2^53 event.
 */
function hashKey(key: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface MachineAliasRegistryOptions {
  /** Where the registry persists. Omit for a memory-only registry. */
  readonly storage?: () => Storage | null;
  readonly storageKey?: string;
}

export class MachineAliasRegistry {
  private readonly getStorage: (() => Storage | null) | null;
  private readonly storageKey: string;
  private byKey = new Map<string, number>();
  private next = 0;
  private byDevice = new Map<string, number>();
  private nextDevice = 0;
  private loaded = false;
  private readonly listeners = new Set<() => void>();
  /** Bumped on every merge — the snapshot a subscriber compares. */
  private merges = 0;
  private notifyScheduled = false;

  constructor(options: MachineAliasRegistryOptions = {}) {
    this.getStorage = options.storage ?? null;
    this.storageKey = options.storageKey ?? MACHINE_ALIAS_STORAGE_KEY;
  }

  /**
   * Be told when two letters merge (see the module doc). Shaped for
   * `useSyncExternalStore`, with {@link mergeCount} as the snapshot.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** How many merges this registry has made — changes exactly when one does. */
  mergeCount = (): number => this.merges;

  /**
   * Notify AFTER the render that caused the merge: a merge is found while some
   * component renders an alias, and React must not be told to update another
   * component in the middle of that render.
   */
  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      for (const listener of [...this.listeners]) listener();
    });
  }

  /** The machine's alias, assigning the next letter on first sight. */
  aliasFor(identity: MachineIdentity): string {
    const index = this.indexFor(identity);
    return index === null ? UNIDENTIFIED_MACHINE : aliasLabel(index);
  }

  /** The machine's alias index, or `null` for an unidentifiable machine. */
  indexFor(identity: MachineIdentity): number | null {
    const keys = machineIdentityKeys(identity).map(hashKey);
    if (keys.length === 0) return null;
    this.load();
    const known = keys
      .map((key) => this.byKey.get(key))
      .filter((i): i is number => i !== undefined);
    let changed = false;
    let index: number;
    if (known.length === 0) {
      index = this.next++;
      changed = true;
    } else {
      index = Math.min(...known);
      // This identity proves the letters its keys carry are ONE machine: keep
      // the earliest, retire the rest everywhere they were given.
      const retired = new Set(known.filter((i) => i !== index));
      if (retired.size > 0) {
        for (const [key, i] of this.byKey) {
          if (retired.has(i)) this.byKey.set(key, index);
        }
        this.merges += 1;
        changed = true;
        this.scheduleNotify();
      }
    }
    for (const key of keys) {
      if (this.byKey.get(key) !== index) {
        this.byKey.set(key, index);
        changed = true;
      }
    }
    if (changed) this.persist();
    return index;
  }

  /**
   * The device's first-seen number in this session (0, 1, 2 …), keyed on the
   * device id alone — `null` for a blank id. It never changes once given, and
   * it is not the machine's letter: it only orders devices that share one.
   */
  deviceOrdinalFor(deviceId: string | null | undefined): number | null {
    const id = clean(deviceId);
    if (!id) return null;
    this.load();
    const key = hashKey(`device:${id.toLowerCase()}`);
    const known = this.byDevice.get(key);
    if (known !== undefined) return known;
    const ordinal = this.nextDevice++;
    this.byDevice.set(key, ordinal);
    this.persist();
    return ordinal;
  }

  /** Forget every alias, including the persisted copy. */
  reset(): void {
    this.byKey = new Map();
    this.next = 0;
    this.byDevice = new Map();
    this.nextDevice = 0;
    this.loaded = true;
    try {
      this.getStorage?.()?.removeItem(this.storageKey);
    } catch {
      // Nothing persisted, or storage refused: memory is reset either way.
    }
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.getStorage?.()?.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedRegistry>;
      if (parsed.v !== PERSISTED_VERSION || typeof parsed.next !== "number") {
        return;
      }
      const keys = parsed.keys ?? {};
      const entries = Object.entries(keys).filter(
        (e): e is [string, number] =>
          typeof e[1] === "number" && Number.isInteger(e[1]) && e[1] >= 0
      );
      this.byKey = new Map(entries);
      // Never re-issue a letter already handed out, whatever `next` says.
      const highest = entries.reduce((max, [, i]) => Math.max(max, i + 1), 0);
      this.next = Math.max(Math.floor(parsed.next), highest);
      const devices = ordinalEntries(parsed.devices);
      this.byDevice = new Map(devices);
      const highestDevice = devices.reduce(
        (max, [, i]) => Math.max(max, i + 1),
        0
      );
      this.nextDevice = Math.max(
        typeof parsed.nextDevice === "number"
          ? Math.floor(parsed.nextDevice)
          : 0,
        highestDevice
      );
    } catch {
      // Unreadable or corrupt: start empty. Letters assigned from here on are
      // still stable for the rest of the session.
    }
  }

  private persist(): void {
    if (!this.getStorage) return;
    try {
      const body: PersistedRegistry = {
        v: PERSISTED_VERSION,
        next: this.next,
        keys: Object.fromEntries(this.byKey),
        devices: Object.fromEntries(this.byDevice),
        nextDevice: this.nextDevice,
      };
      this.getStorage()?.setItem(this.storageKey, JSON.stringify(body));
    } catch {
      // Refused: memory keeps the letters for this page's lifetime.
    }
  }
}

function sessionStorageGetter(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The registry every lens surface in the tab shares. Persisted to
 * sessionStorage. Client-only: neither `useMachineName` nor
 * `useMachineAliaser` consults it during a server or hydration render, so no
 * server-side module state is mutated.
 */
export const sessionMachineAliases = new MachineAliasRegistry({
  storage: sessionStorageGetter,
});
