/**
 * Loader-liveness guard for the cloud-control extension surface.
 *
 * This is the regression test the extension surface never had. Between the
 * surface being introduced and this file, `@qontinui/cloud-control`
 * registered nothing at all in any deployment — the loader was a
 * `webpackIgnore` dynamic import that could not resolve, wrapped in
 * `.catch(() => {})`, and it sat in a Server Component so even a working
 * load would have filled the server's module instance of
 * `extension-slots.ts` while every consumer read the browser's. Both
 * failures were silent; a test asserting "no error was thrown" would have
 * passed throughout.
 *
 * So the assertions here are about slot CONTENT, in a DOM environment
 * (vitest runs jsdom), reached through the same `@/lib/extension-slots`
 * module instance that `services/service-factory.ts` and the sidebar's
 * `getComponent` calls read.
 *
 * The suite covers both build shapes and picks by inspecting the tree, so
 * it is never vacuously green: with the overlay installed the composed
 * expectations run and the OSS one is skipped, and vice versa. See
 * `docs/composed-cloud-build.md`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every slot cloud-control fills, by kind. Listed in full so the OSS case can
 * assert the absence of each one by name: `getSlots()` used to expose the
 * backing Maps and let that case check `.size === 0`, but phase 5 deleted it
 * along with the four slot kinds nothing could read. Enumerating is the
 * honest replacement — a slot added to cloud-control's `index.ts` and not
 * added here is covered by neither case, so keep the two in step.
 */
const CLOUD_SERVICES = ["billingService", "organizationService"] as const;
const CLOUD_COMPONENTS = [
  "organizationSwitcher",
  "createOrganizationDialog",
  "teamMemberList",
  "inviteMemberDialog",
  "betaBanner",
  "subscriptionBadge",
] as const;

const OVERLAY_MANIFEST = path.resolve(
  process.cwd(),
  "node_modules/@qontinui/cloud-control/package.json"
);
const composed = fs.existsSync(OVERLAY_MANIFEST);

describe("cloud-control extension registration", () => {
  it.skipIf(!composed)(
    "fills the client-side service and component slots (composed build)",
    async () => {
      const slots = await import("@/lib/extension-slots");

      // Nothing has imported the boot module in this test file's module
      // registry yet, so the registry starts empty. Asserting that first
      // is what makes the post-import assertion meaningful rather than a
      // reading of some other file's side effect.
      expect(slots.getService("billingService")).toBeUndefined();
      expect(slots.getComponent("organizationSwitcher")).toBeUndefined();

      await import("@/components/cloud-extensions-boot");

      for (const name of CLOUD_SERVICES) {
        expect(slots.getService(name), `service slot ${name}`).toBeDefined();
      }
      for (const name of CLOUD_COMPONENTS) {
        expect(slots.getComponent(name), `component slot ${name}`).toBeDefined();
      }
    },
    // This import pulls cloud-control's whole module graph (~45 raw .ts/.tsx
    // files) through vite's transform on demand. That is ~20s on a warm run
    // and more under full-suite CPU contention, so the file-wide 20s default
    // is not enough — the composed cases get their own ceiling rather than
    // raising it for all 2500 tests.
    120_000
  );

  it.skipIf(!composed)(
    "makes the service-factory cloud-only proxies live (composed build)",
    async () => {
      await import("@/components/cloud-extensions-boot");
      const { billingService, organizationService } = await import(
        "@/services/service-factory"
      );

      // `cloudOnlySlot` proxies resolve `getService(name)` on every property
      // access and hand back a throwing stub for EVERY property when the slot
      // is empty — so `typeof x.someMethod === "function"` passes either way
      // and proves nothing. `constructor.name` is the discriminating read:
      // it is cloud-control's real class through a filled slot, and the
      // anonymous throwing stub ("Function") through an empty one. This is
      // the exact access path the live call sites use.
      expect(billingService.constructor.name).toBe("BillingService");
      expect(organizationService.constructor.name).toBe("OrganizationService");
      expect(typeof billingService.getSubscription).toBe("function");
      expect(typeof organizationService.getOrganizations).toBe("function");
    },
    120_000
  );

  it.skipIf(composed)(
    "registers nothing and throws nothing (OSS-only build)",
    async () => {
      const slots = await import("@/lib/extension-slots");
      await import("@/components/cloud-extensions-boot");

      for (const name of CLOUD_SERVICES) {
        expect(slots.getService(name), `service slot ${name}`).toBeUndefined();
      }
      for (const name of CLOUD_COMPONENTS) {
        expect(
          slots.getComponent(name),
          `component slot ${name}`
        ).toBeUndefined();
      }
    }
  );
});
