/**
 * The sequence arithmetic behind R6's stale arm.
 *
 * Every case here is a state that was actually shipped and reverted while this
 * logic lived inline in two surfaces — which is the argument for it being one
 * tested module rather than a predicate each caller re-spells.
 */

import { describe, expect, it } from "vitest";

import { createReadSequence } from "./readSequence";

describe("createReadSequence", () => {
  it("is neither stale nor delivered before anything has been read", () => {
    const seq = createReadSequence();
    expect(seq.isStale()).toBe(false);
    expect(seq.hasDelivered()).toBe(false);
  });

  it("does not call a NEVER-read value stale", () => {
    // "Stale" means "from an earlier read". A first read that finishes without
    // delivering leaves nothing on screen to BE from an earlier read, and the
    // surface owes UNKNOWN instead — a different claim with a different
    // remedy. Shipped once on an ungated badge before this was a rule.
    const seq = createReadSequence();
    seq.settle(seq.issue(), false);
    expect(seq.isStale()).toBe(false);
    expect(seq.hasDelivered()).toBe(false);
  });

  it("goes stale when a newer read finishes without delivering", () => {
    const seq = createReadSequence();
    expect(seq.settle(seq.issue(), true)).toBe(true);
    expect(seq.isStale()).toBe(false);

    seq.settle(seq.issue(), false);
    expect(seq.isStale()).toBe(true);
    // The value is still there to be qualified.
    expect(seq.hasDelivered()).toBe(true);
  });

  it("recovers on the next delivery rather than latching", () => {
    const seq = createReadSequence();
    seq.settle(seq.issue(), true);
    seq.settle(seq.issue(), false);
    expect(seq.isStale()).toBe(true);

    expect(seq.settle(seq.issue(), true)).toBe(true);
    expect(seq.isStale()).toBe(false);
  });

  it("lets a superseded FAILURE say nothing about the read that overtook it", () => {
    // A hangs, B delivers, A then fails. Under a flag set in a `catch`, A's
    // rejection re-stales a number B refreshed a moment earlier.
    const seq = createReadSequence();
    const a = seq.issue();
    const b = seq.issue();

    seq.settle(b, true);
    expect(seq.isStale()).toBe(false);

    seq.settle(a, false);
    expect(seq.isStale()).toBe(false);
  });

  it("KEEPS a superseded delivery's value while still calling it uncurrent", () => {
    // The mirror, and the one the obvious guard gets wrong. A hangs, B fails,
    // A then answers with a real number. "Ignore anything but the newest
    // request issued" discards it and renders nothing; the number is real and
    // is the only one there is.
    const seq = createReadSequence();
    const a = seq.issue();
    const b = seq.issue();

    seq.settle(b, false);
    expect(seq.hasDelivered()).toBe(false);

    expect(seq.settle(a, true)).toBe(true);
    expect(seq.hasDelivered()).toBe(true);
    // ...and uncurrent, because a newer read finished without replacing it.
    expect(seq.isStale()).toBe(true);
  });

  it("does not let an older delivery overwrite a newer one", () => {
    const seq = createReadSequence();
    const a = seq.issue();
    const b = seq.issue();

    expect(seq.settle(b, true)).toBe(true);
    // Declined: `settle` returns false, so the caller keeps B's value.
    expect(seq.settle(a, true)).toBe(false);
    expect(seq.isStale()).toBe(false);
  });

  it("lets a non-counting delivery un-stale without ever staling", () => {
    // `counts: false` is for a reply that can carry the value without its
    // SILENCE meaning anything — a write's response, which returns the scalar
    // as a courtesy and is not a read of the feed.
    const seq = createReadSequence();
    seq.settle(seq.issue(), true);
    seq.settle(seq.issue(), false);
    expect(seq.isStale()).toBe(true);

    expect(seq.settle(seq.issue(), true, false)).toBe(true);
    expect(seq.isStale()).toBe(false);

    // ...and a non-counting reply that carries nothing changes nothing at all.
    const before = seq.isStale();
    seq.settle(seq.issue(), false, false);
    expect(seq.isStale()).toBe(before);
  });

  it("does not let a SUPERSEDED non-counting delivery claim currency", () => {
    // The window that made this module shared rather than inlined: a write's
    // reply hangs, a newer read finishes carrying nothing, then the write's
    // reply lands. Its number is honest — but a newer read has since said it
    // could not confirm one, so the surface must not go green.
    const seq = createReadSequence();
    seq.settle(seq.issue(), true);

    const post = seq.issue();
    const head = seq.issue();

    seq.settle(head, false);
    expect(seq.isStale()).toBe(true);

    expect(seq.settle(post, true, false)).toBe(true);
    expect(seq.isStale()).toBe(true);
  });
});
