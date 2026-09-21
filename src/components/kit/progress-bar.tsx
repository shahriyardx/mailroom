"use client";

import { ProgressProvider } from "@bprogress/next/app";

/**
 * The thin line across the top of the window while a page is being fetched.
 *
 * Server components mean a click on a link can sit for a moment with nothing
 * to show for it — no spinner, no skeleton, the old page still on screen. The
 * line is the only thing that says the click was heard.
 *
 * It covers every anchor and the browser's own back and forward. It does not
 * cover `router.refresh()` after a server action: those already have a button
 * that says it is working, and two things claiming the same moment reads as a
 * glitch.
 *
 * Styling is in globals.css with the rest of the design system, which is what
 * `disableStyle` is for — otherwise the library injects a `:root` block at the
 * end of the body that nothing in a stylesheet can outrank.
 */
export function ProgressBar({ children }: { children: React.ReactNode }) {
  return (
    <ProgressProvider
      disableStyle
      options={{ showSpinner: false }}
      // Most screens here resolve faster than the eye registers. A bar that
      // appears and vanishes inside two frames reads as a flicker, so nothing
      // is shown until a navigation has actually taken a moment.
      delay={120}
      // Starting from zero looks like nothing happened for the first stretch.
      startPosition={0.08}
      // Opening a thread is `?t=`, and searching is `?q=`; both fetch on the
      // server, so a query-only change is a real navigation here.
      shallowRouting={false}
      disableSameURL
    >
      {children}
    </ProgressProvider>
  );
}
