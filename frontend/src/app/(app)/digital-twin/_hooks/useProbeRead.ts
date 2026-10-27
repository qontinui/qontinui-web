"use client";

import { useMemo } from "react";
import { probeReadOf, type ProbeRead } from "../_lib/probe-read";
import { useBrowserOnline } from "./useBrowserOnline";
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
  // Names why a probe with no answer has no read in flight, when it is
  // because react-query holds reads while this browser is offline.
  const online = useBrowserOnline();
  return useMemo(
    () =>
      probeReadOf(
        {
          data,
          isLoading,
          isError,
          error,
          dataUpdatedAt,
          errorUpdatedAt,
          online,
        },
        catalog
      ),
    [
      data,
      isLoading,
      isError,
      error,
      dataUpdatedAt,
      errorUpdatedAt,
      online,
      catalog,
    ]
  );
}
