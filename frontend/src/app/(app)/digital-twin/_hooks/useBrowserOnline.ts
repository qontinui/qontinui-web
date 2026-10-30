"use client";

import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

function subscribe(onChange: () => void): () => void {
  return onlineManager.subscribe(onChange);
}

function read(): boolean {
  return onlineManager.isOnline();
}

/** A server render has no network state; react-query starts online. */
function readOnServer(): boolean {
  return true;
}

/**
 * Whether react-query's `onlineManager` holds this browser online — the state
 * it holds reads on. The app's queries use the default `online` network mode,
 * so while this is false no new read is made: a query with no answer is then
 * neither loading nor failed, and a view that names why it has nothing to
 * show reads the cause here.
 */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
