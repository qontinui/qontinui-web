"use client";

import { useEffect, useState } from "react";
import { fetchForecast, type TimelineForecast } from "../_lib/timeline-api";

export type ForecastState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; forecast: TimelineForecast };

/**
 * The served forecast for `estimateId` (`GET /estimates/{id}/forecast`),
 * re-read whenever `token` moves. The Timeline moves it whenever the served
 * versions in its progress list change — after its own progress write, and
 * equally after a conflict, when the list has taken a peer's newer copy — but
 * not on the list's first arrival. Nothing is read while `hold` is true or
 * there is no estimate; the state stays `loading` until the caller can say
 * which estimate it means, and the caller tells "no estimate" apart itself.
 */
export function useForecast(
  estimateId: string | null,
  hold: boolean,
  token: number = 0
): ForecastState {
  // An error is kept with the estimate it was about, as a ready forecast
  // carries its own `estimate_id`, so neither outlives a project switch.
  const [value, setValue] = useState<
    | Exclude<ForecastState, { state: "error" }>
    | { state: "error"; message: string; about: string }
  >({ state: "loading" });
  useEffect(() => {
    if (hold || estimateId === null) return;
    let live = true;
    fetchForecast(estimateId).then(
      (forecast) => live && setValue({ state: "ready", forecast }),
      (err: unknown) =>
        live &&
        setValue({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
          about: estimateId,
        })
    );
    return () => {
      live = false;
    };
  }, [estimateId, hold, token]);
  // A re-read (the token moved) keeps the figures on screen until the new
  // ones land; another estimate's figures (the project changed) never show,
  // and neither does the error another estimate's read ended in.
  if (value.state === "ready" && value.forecast.estimate_id !== estimateId) {
    return { state: "loading" };
  }
  if (value.state === "error") {
    return value.about === estimateId
      ? { state: "error", message: value.message }
      : { state: "loading" };
  }
  return value;
}
