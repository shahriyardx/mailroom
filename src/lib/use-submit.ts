"use client";

import { useState } from "react";

/**
 * Runs a form's action, with a flag for the button.
 *
 * Deliberately not a transition. React holds every state update made inside
 * one until the work that transition started has finished, and these forms
 * end by refreshing the router: a field cleared inside the transition fills
 * itself back in for as long as the server takes to answer, which reads as
 * a form that ignored you.
 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);

  function submit(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    void action().finally(() => setBusy(false));
  }

  return [busy, submit] as const;
}
