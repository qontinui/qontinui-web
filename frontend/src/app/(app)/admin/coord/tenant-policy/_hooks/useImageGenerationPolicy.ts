"use client";

import { useCallback, useMemo, useRef } from "react";
import { useRepoFleetPolicyWrite } from "../../_shared/useRepoFleetPolicyWrite";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import {
  knownLevel,
  readRepoOverrides,
  readTenantImageGeneration,
} from "../_lib/imageGenerationStatus";
import {
  IMAGE_GENERATION_DOMAIN,
  type ImageGenerationLevel,
  type ImageGenerationRepoChoice,
} from "../types";

/**
 * The `image_generation` fleet-policy dial: a tenant level
 * (`on` | `local_only` | `off`) plus per-repo overrides.
 *
 * Plan `2026-10-13-image-generation-and-visual-judgment` Phase 12 step 2. The
 * tenant band binds the shared `useTenantFleetPolicyDial`, whose read-back
 * honesty properties live — and are documented — there. Unlike the other
 * dials on this page, studio decides image generation WITH a repo in hand, so
 * the repo band is real: it binds the sibling `useRepoFleetPolicyWrite`, and a
 * repo write whose read-back succeeded re-reads the tenant view — the one
 * source of the override list (`repo_overrides`).
 *
 * What this binding adds over the shared dial:
 *
 * * **`tenant`** — the tenant reading, UNKNOWN-aware
 *   (`readTenantImageGeneration`): a no-row answer is `on` only when coord
 *   serves this domain's declared default, so a coord that predates the
 *   domain never reads as `on`.
 * * **`displayLevel`** — the level in force, `null` whenever it is UNKNOWN.
 * * **`overrides`** — the repos carrying their own row; `null` when the read
 *   carried no list.
 * * **`refresh`** — a re-read that also retires every repo's "read-back
 *   failed" marker, but only when it landed AND was issued after every repo
 *   write that had started: a fresh override list is then the confirmed state
 *   of every repo, while a read that began before a write says nothing about
 *   what that write did.
 */
export function useImageGenerationPolicy() {
  const dial = useTenantFleetPolicyDial<ImageGenerationLevel>(
    IMAGE_GENERATION_DOMAIN,
    "image generation",
    "studio"
  );
  const { policy, reload } = dial;
  const repoWrite = useRepoFleetPolicyWrite<ImageGenerationRepoChoice>(
    IMAGE_GENERATION_DOMAIN,
    "image generation",
    reload
  );
  const { write, clearReadbackErrors } = repoWrite;

  /** Bumped when a repo write STARTS, so a refresh can tell it raced one. */
  const repoWriteMark = useRef(0);

  const writeRepo = useCallback(
    (repo: string, choice: ImageGenerationRepoChoice) => {
      repoWriteMark.current += 1;
      return write(repo, choice);
    },
    [write]
  );

  const refresh = useCallback(async () => {
    const mark = repoWriteMark.current;
    const applied = await reload();
    if (applied && mark === repoWriteMark.current) clearReadbackErrors();
    return applied;
  }, [reload, clearReadbackErrors]);

  const tenant = useMemo(
    () => (policy ? readTenantImageGeneration(policy) : null),
    [policy]
  );
  const overrides = useMemo(() => readRepoOverrides(policy), [policy]);

  return {
    ...dial,
    refresh,
    /** The tenant reading; `null` before any read succeeded. */
    tenant,
    /** The tenant level in force, or `null` when it is UNKNOWN. */
    displayLevel: knownLevel(tenant),
    /** The repos carrying an override; `null` = UNKNOWN, never "none". */
    overrides,
    /** Write one repo's override (`inherit` clears it). */
    writeRepo,
    /** The repo whose write is in flight. */
    savingRepo: repoWrite.savingRepo,
    /** Per repo: the write landed but its read-back failed — UNKNOWN. */
    repoReadbackErrors: repoWrite.readbackErrors,
    /** Per repo: why the last write was refused, in operator words. */
    repoWriteErrors: repoWrite.writeErrors,
  };
}
