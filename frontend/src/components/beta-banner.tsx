"use client";

/**
 * OSS-side stub for the beta banner.
 *
 * The cloud-control deployment ships the real beta banner that announces
 * `qontinui.cloud` rollout state. OSS self-host installs render nothing —
 * there is no "beta" status to announce on a self-hosted deployment.
 *
 * When/if cloud-control's frontend bundle is loaded and the operator
 * wants the banner, it will be wired through the
 * `registerCloudExtensions({ ... })` slot pattern (M2.5 follow-up).
 */
export function BetaBanner(): null {
  return null;
}
