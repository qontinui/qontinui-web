"use client";

/**
 * What the viewer may edit on the overview, for the project ON SCREEN.
 *
 * The answer comes from the server's resource catalog (`GET
 * /api/v1/overview/resources`), which decides it with the same function the
 * write routes enforce. It replaces `isCoordAdmin`, which is a union across
 * every project the viewer belongs to — administer project A and you saw edit
 * controls on project B, then had the save refused (plan
 * `2026-09-20-overview-authoring-layer` §4a). No overview surface may gate an
 * edit control on `isCoordAdmin`.
 *
 * Until the catalog has answered — and if it fails — nothing is editable:
 * showing a control is an authorisation claim, and an unknown answer must not
 * make one.
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  fetchCatalog,
  type ResourceCatalog,
  type ResourceDescriptor,
} from "./api";

export type CatalogState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; catalog: ResourceCatalog };

const CatalogContext = createContext<CatalogState>({ state: "loading" });

/**
 * Loads the catalog for `tenantId` and re-loads when the project changes.
 * `hold` defers the read until the project list has resolved, for the same
 * reason every overview read does: the active-project header comes from that
 * selection, and an earlier read could answer for the wrong project.
 */
export function OverviewPermissionsProvider({
  tenantId,
  hold,
  children,
}: {
  tenantId: string | null;
  hold: boolean;
  children: React.ReactNode;
}) {
  const [value, setValue] = useState<CatalogState>({ state: "loading" });

  useEffect(() => {
    if (hold) return;
    let live = true;
    setValue({ state: "loading" });
    fetchCatalog().then(
      (catalog) => live && setValue({ state: "ready", catalog }),
      (err: unknown) =>
        live &&
        setValue({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        })
    );
    return () => {
      live = false;
    };
  }, [tenantId, hold]);

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useOverviewCatalog(): CatalogState {
  return useContext(CatalogContext);
}

/** The descriptor for one resource, once the catalog has loaded. */
export function useResourceDescriptor(name: string): ResourceDescriptor | null {
  const catalog = useOverviewCatalog();
  if (catalog.state !== "ready") return null;
  return catalog.catalog.resources.find((r) => r.name === name) ?? null;
}

/** True only when the server has said this viewer may edit `name` here. */
export function useCanEdit(name: string): boolean {
  return useResourceDescriptor(name)?.can_edit === true;
}

/**
 * Renders its children only when the viewer may edit `resource` in this
 * project. Controls are ABSENT otherwise — never disabled-and-teasing.
 */
export function EditGate({
  resource,
  children,
}: {
  resource: string;
  children: React.ReactNode;
}) {
  return useCanEdit(resource) ? <>{children}</> : null;
}
