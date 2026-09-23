/**
 * Screens that want the whole frame.
 *
 * Almost everything in the app is a column of panels on a page that scrolls,
 * and a width cap is what keeps that readable. A builder is the other kind of
 * screen: three panes that scroll independently, sized to the window. Capping
 * one puts a canvas in a letterbox and leaves the room it needed empty on
 * either side.
 *
 * These screens also lose the navigation down the side. A builder and a flow
 * canvas are places somebody works for half an hour at a stretch, and giving
 * a canvas the whole window is the difference between drawing on a desk and
 * drawing on a tray. Every one of them carries its own arrow back, which is
 * what makes hiding the sidebar an offer rather than a trap.
 *
 * Kept here rather than in either shell because both of them render the same
 * builder, and a rule that lives in one place cannot be true in only one half
 * of the app.
 */
const FULL_BLEED = [
  // A single template, or a new one: /settings/templates/x, /campaigns/templates/x
  /^\/(?:settings|campaigns)\/templates\/[^/]+$/,
  // One broadcast, in the same builder.
  /^\/campaigns\/broadcasts\/[^/]+$/,
  // An automation: the canvas, and the builder for one email on it.
  /^\/campaigns\/automations\/[^/]+(?:\/steps\/[^/]+)?$/,
];

export function isFullBleed(pathname: string) {
  return FULL_BLEED.some((pattern) => pattern.test(pathname));
}
