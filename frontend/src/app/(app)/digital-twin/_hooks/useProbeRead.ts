"use client";

import { useMemo } from "react";
import { probeReadOf, type ProbeRead } from "../_lib/probe-read";
import { useDigitalTwinSubspaces } from "./useDigitalTwinSubspaces";
import { useTwinCatalog } from "./useTwinCatalog";

/**
 * The live sub-space probe joined with coord's catalog, as every view of it
 * reads it (`probeReadOf`): the Twin map, the Completeness matrix and the
 * Lifecycle view make the same read and apply the same silence rule, so they
 * cannot disagree about whether the probe holds a reading.
 */
export function useProbeRead(): ProbeRead {
  const { data, isLoading, isError, error, dataUpdatedAt, errorUpdatedAt } =
    useDigitalTwinSubspaces();
  const { data: catalog } = useTwinCatalog();
  return useMemo(
    () =>
      probeReadOf(
        { data, isLoading, isError, error, dataUpdatedAt, errorUpdatedAt },
        catalog
      ),
    [data, isLoading, isError, error, dataUpdatedAt, errorUpdatedAt, catalog]
  );
}
