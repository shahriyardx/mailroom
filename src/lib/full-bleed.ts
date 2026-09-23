/**
 * Screens that want the whole frame.
 *
 * Almost everything in the app is a column of panels on a page that scrolls,
 * and a width cap is what keeps that readable. A builder is the other kind of
 * screen: three panes that scroll independently, sized to the window. Capping
 * one puts a canvas in a letterbox and leaves the room it needed empty on
 * either side.
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
];

export function isFullBleed(pathname: string) {
  return FULL_BLEED.some((pattern) => pattern.test(pathname));
}
