import type { AutomationNodeKind, NodeConfig } from "@/db/schema";

/**
 * Where every box on the canvas goes.
 *
 * Worked out from the graph rather than stored against each node, which is
 * the decision the whole editor rests on. Saved positions mean a canvas that
 * drifts: somebody drags a box, somebody else inserts one above it, and the
 * arrows cross. Laid out from the shape, the picture is always readable and
 * there is nothing to tidy up.
 *
 * Branches never rejoin, so the graph is a tree and this is the ordinary
 * tidy-tree walk: measure how wide each subtree needs to be, then centre each
 * parent over its children.
 */

export interface FlowNode {
  id: string;
  kind: AutomationNodeKind;
  subject: string | null;
  delayMinutes: number;
  /** A moment to hold everybody until, instead of a length of time. */
  waitUntil: Date | null;
  config: NodeConfig;
  next: string | null;
  nextElse: string | null;
  /** True when the body is still empty, so the canvas can say so. */
  empty?: boolean;
}

/**
 * Card size and the room between cards, in pixels.
 *
 * The vertical gap is what a flow costs in screen: every box spends its own
 * height plus this, so a six-box welcome series with a generous gap scrolls
 * before it has said anything. Wide enough for the "+" to sit in the middle
 * of the line without touching either card, and no wider.
 */
export const NODE_WIDTH = 236;
export const NODE_HEIGHT = 68;
export const GAP_X = 28;
export const GAP_Y = 62;

/** The trigger card sits above the first node and is not part of the graph. */
export const TRIGGER_ID = "__trigger";

/**
 * Boxes with two ways out.
 *
 * A condition answers yes or no, a split sends a share of people each way,
 * and a wait for an event goes one way when it arrives and the other when
 * it does not. The canvas, the layout and deleting all treat the three the
 * same: the second way out is `nextElse`.
 */
export function forks(kind: AutomationNodeKind) {
  return kind === "condition" || kind === "split" || kind === "await";
}

/** What the two ways out of a forking box are called on the canvas. */
export function branchLabels(node: Pick<FlowNode, "kind" | "config">): [string, string] {
  if (node.kind === "split") {
    const share = splitShare(node.config);
    return [`A · ${share}%`, `B · ${100 - share}%`];
  }
  if (node.kind === "await") return ["Arrived", "Timed out"];
  return ["Yes", "No"];
}

/** The share that goes down a split's first way, kept between 1 and 99. */
export function splitShare(config: NodeConfig) {
  const raw = Number(config.percent ?? 50);
  if (!Number.isFinite(raw)) return 50;
  return Math.min(99, Math.max(1, Math.round(raw)));
}

export interface Placed {
  id: string;
  x: number;
  y: number;
}

export interface Edge {
  from: string;
  to: string | null;
  /** Which way out of the parent this is. */
  branch: "next" | "nextElse";
  /** Where the "+" and the label go. */
  x: number;
  y: number;
  /** The line itself, as an SVG path. */
  path: string;
}

export interface Layout {
  nodes: Placed[];
  edges: Edge[];
  width: number;
  height: number;
}

/** How many columns wide a subtree needs, counted in node widths. */
function spread(id: string | null, by: Map<string, FlowNode>, seen: Set<string>): number {
  if (!id || seen.has(id)) return 1;
  seen.add(id);

  const node = by.get(id);
  if (!node) return 1;

  if (forks(node.kind)) {
    // Both ways out get room, including the empty one — the "+" that adds to
    // it has to be somewhere, and a branch that appears only once it is used
    // is a branch nobody discovers.
    return spread(node.next, by, seen) + spread(node.nextElse, by, seen);
  }
  // A dead end takes one column and nothing after it.
  if (node.kind === "unsubscribe") return 1;
  return Math.max(1, spread(node.next, by, seen));
}

/**
 * Lays the whole flow out, top to bottom.
 *
 * Every parent is centred over the space its children occupy, so a condition
 * sits between its two answers rather than above one of them.
 */
export function layout(nodes: FlowNode[], entryId: string | null): Layout {
  const by = new Map(nodes.map((node) => [node.id, node]));
  const placed: Placed[] = [];
  const edges: Edge[] = [];

  const column = NODE_WIDTH + GAP_X;
  const row = NODE_HEIGHT + GAP_Y;

  /*
   * `guard` is not paranoia. A node's `next` is nulled rather than repointed
   * when its target is deleted by the database, and a graph that has been
   * edited under an old page could in principle come back pointing at
   * itself. Walking it forever would hang the tab.
   */
  const guard = new Set<string>();

  /** Places a subtree whose left edge is at `left`, and returns its centre. */
  function place(id: string | null, left: number, depth: number): number {
    if (!id || guard.has(id)) return left + NODE_WIDTH / 2;

    const node = by.get(id);
    if (!node) return left + NODE_WIDTH / 2;
    guard.add(id);

    const y = depth * row;

    if (forks(node.kind)) {
      const yesWide = spread(node.next, by, new Set());
      const yesCentre = place(node.next, left, depth + 1);
      const noCentre = place(node.nextElse, left + yesWide * column, depth + 1);

      const centre = (yesCentre + noCentre) / 2;
      placed.push({ id, x: centre - NODE_WIDTH / 2, y });
      edges.push(elbow(id, node.next, "next", centre, y, yesCentre, (depth + 1) * row));
      edges.push(elbow(id, node.nextElse, "nextElse", centre, y, noCentre, (depth + 1) * row));
      return centre;
    }

    /*
     * Taking somebody off the list ends their journey, so it has no way out.
     * Drawing one would offer a "+" under it and invite somebody to add a box
     * that could never be reached.
     */
    if (node.kind === "unsubscribe") {
      placed.push({ id, x: left, y });
      return left + NODE_WIDTH / 2;
    }

    const centre = place(node.next, left, depth + 1);
    placed.push({ id, x: centre - NODE_WIDTH / 2, y });
    edges.push(elbow(id, node.next, "next", centre, y, centre, (depth + 1) * row));
    return centre;
  }

  const rootCentre = place(entryId, 0, 1);

  // The trigger is drawn above the first node and connected to it, so the
  // canvas answers "what starts this" without anybody having to ask.
  placed.push({ id: TRIGGER_ID, x: rootCentre - NODE_WIDTH / 2, y: 0 });
  edges.push(elbow(TRIGGER_ID, entryId, "next", rootCentre, 0, rootCentre, row));

  /*
   * Shifted so the leftmost box sits at zero.
   *
   * A branch can push a subtree to a negative x — the parent is centred over
   * its children, and the first child starts at the left edge of whatever it
   * was given. Normalising here means whatever draws this never has to think
   * about negative coordinates.
   */
  const leftmost = placed.reduce((least, node) => Math.min(least, node.x), 0);
  if (leftmost < 0) {
    for (const node of placed) node.x -= leftmost;
    for (const edge of edges) edge.x -= leftmost;
  }

  /*
   * The empty branch of a condition counts towards the size.
   *
   * Its "+" hangs past the last box on that side, and a canvas measured from
   * the boxes alone puts it outside the scrollable area — where it cannot be
   * reached, which is the one thing a branch invitation must never be.
   */
  const width = Math.max(
    placed.reduce((most, node) => Math.max(most, node.x + NODE_WIDTH), NODE_WIDTH),
    edges.reduce((most, edge) => Math.max(most, edge.x + NODE_WIDTH / 2), 0),
  );
  const height = Math.max(
    placed.reduce((most, node) => Math.max(most, node.y + NODE_HEIGHT), NODE_HEIGHT),
    edges.reduce((most, edge) => Math.max(most, edge.y + 24), 0),
  );

  return { nodes: placed, edges, width, height: height + GAP_Y / 2 };
}

/**
 * One connector, drawn as a line that bends once.
 *
 * A straight diagonal between a parent and an off-centre child reads as an
 * arrow pointing somewhere else. Dropping straight down, turning once, and
 * arriving vertically is what makes a branch look like a branch.
 */
function elbow(
  from: string,
  to: string | null,
  branch: "next" | "nextElse",
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Edge {
  const startY = fromY + NODE_HEIGHT;

  /*
   * An empty branch reaches only part of the way towards where a box would
   * go, and ends in its own drop.
   *
   * Drawn the full width it looked like one long horizontal line with a
   * button at each end — a bar joining "yes" to "no" rather than two arms
   * leaving one box. Pulled in, each side is visibly its own stub going
   * down-left and down-right, and the space a real box needs is still
   * reserved because the layout, not this, decides that.
   */
  const armX = to ? toX : fromX + (toX - fromX) * 0.55;

  /*
   * Both arms turn at the same height.
   *
   * They are two answers to one question and nothing distinguishes them but
   * which way they go, so one sitting lower than the other reads as a
   * mistake rather than as meaning.
   */
  const endY = to ? toY : startY + GAP_Y - 6;
  const bendY = startY + (endY - startY) / 2;

  const bent = Math.abs(armX - fromX) >= 1;
  const turn = Math.sign(armX - fromX) * 10;

  const path = bent
    ? `M ${fromX} ${startY} L ${fromX} ${bendY - 10} Q ${fromX} ${bendY} ${fromX + turn} ${bendY} L ${armX - turn} ${bendY} Q ${armX} ${bendY} ${armX} ${bendY + 10} L ${armX} ${endY}`
    : `M ${fromX} ${startY} L ${fromX} ${endY}`;

  /*
   * The "+" goes on the child's own arm, not on the parent's centre.
   *
   * A condition's two edges leave from the same point, so anchoring there put
   * both buttons in exactly the same place — one on top of the other, with
   * the "Yes" label hidden underneath the "No". On the arm they belong to,
   * each branch has its own button and its own label.
   *
   * On an arm that goes nowhere it sits at the tip rather than half way
   * along, because there it is the end of the line rather than something
   * interrupting it.
   */
  return {
    from,
    to,
    branch,
    x: armX,
    y: to ? (bent ? (bendY + endY) / 2 : (startY + endY) / 2) : endY,
    path,
  };
}

/**
 * What one box says, in two lines.
 *
 * The title is the thing that differs between two boxes of the same kind —
 * the subject, the length of the wait, the question being asked. The note
 * underneath is only there when it adds something; a card that says "WAIT /
 * 1 day / 1 day" has spent three lines saying one thing.
 */
export function summarise(node: FlowNode, names?: FlowNames): { title: string; note?: string } {
  switch (node.kind) {
    case "email":
      return {
        title: node.subject?.trim() || "Untitled",
        note: node.empty ? "Nothing written yet" : undefined,
      };
    case "wait":
      if (node.waitUntil) {
        return {
          title: `Until ${onThe(node.waitUntil)}`,
          // Everybody reaches the next box at once, which is the whole reason
          // to use a date rather than a delay.
          note: "Everybody together",
        };
      }
      return {
        title: node.delayMinutes === 0 ? "No pause" : humanDelay(node.delayMinutes),
        note: node.delayMinutes === 0 ? "Straight on to the next box" : undefined,
      };
    case "condition":
      return { title: describeTest(node.config, names) };
    case "field":
      return node.config.field
        ? { title: `${node.config.field} → ${node.config.value || "(empty)"}` }
        : { title: "Pick a field", note: "Nothing set yet" };
    case "tag": {
      const tag = node.config.tag?.trim();
      if (!tag) return { title: "Pick a tag", note: "Nothing set yet" };
      return node.config.tagAction === "remove"
        ? { title: `Take off "${tag}"` }
        : { title: `Tag them "${tag}"` };
    }
    case "move": {
      const where = names?.lists?.[node.config.listId ?? ""];
      if (!where) return { title: "Pick a list", note: "Nothing set yet" };
      return node.config.listAction === "move"
        ? { title: `Move to ${where}`, note: "They leave this one, and this flow" }
        : { title: `Copy to ${where}`, note: "They stay on this one too" };
    }
    case "unsubscribe":
      return { title: "Off the list", note: "Their journey ends here" };
    case "split": {
      const share = splitShare(node.config);
      return { title: `${share}% / ${100 - share}%`, note: "Chosen at random, for a test" };
    }
    case "await": {
      const event = node.config.event?.trim();
      if (!event) return { title: "Pick an event", note: "Nothing set yet" };
      return {
        title: `Wait for ${event}`,
        note: `Up to ${humanDelay(Math.max(1, node.delayMinutes))}`,
      };
    }
    case "webhook": {
      const url = node.config.url?.trim();
      if (!url) return { title: "Pick a URL", note: "Nothing set yet" };
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        // Shown as typed: the inspector is where it gets corrected.
      }
      return { title: `Call ${host}`, note: "POST, signed" };
    }
    default:
      return { title: "" };
  }
}

/**
 * The trigger card, in words.
 *
 * Says what is missing rather than what is set when half of it is missing: a
 * card reading "Event received" with nothing under it is how somebody finds
 * out at switch-on time that they never picked the event.
 */
export function describeTrigger(
  trigger: "subscribed" | "event" | null,
  listName: string | null,
  eventName: string | null,
  segmentName?: string | null,
): { title: string; note?: string; warn?: boolean } {
  if (!trigger) return { title: "Nothing yet", note: "Choose what starts this", warn: true };

  // Named on the card when there is one: a flow that quietly runs for a
  // quarter of the list is the kind of surprise that is found in the numbers
  // a week later.
  const who = segmentName ? `${listName} · ${segmentName}` : listName;

  if (trigger === "event") {
    if (!eventName) return { title: "An event arrives", note: "Pick which event", warn: true };
    if (!listName) return { title: eventName, note: "Pick a list for these people", warn: true };
    return { title: eventName, note: `Your code posts it · ${who}` };
  }

  if (!listName) return { title: "Somebody joins", note: "Pick a list", warn: true };
  return { title: "Somebody joins", note: who ?? listName };
}

/**
 * Names for the things a box points at by id.
 *
 * A card has to say "In \"People who never open anything\"", not an id, and
 * nothing about a segment or a list is stored on the node itself — storing a
 * copy of the name would go stale the first time somebody renamed one.
 */
export interface FlowNames {
  lists?: Record<string, string>;
  segments?: Record<string, string>;
}

export function describeTest(config: NodeConfig, names?: FlowNames): string {
  if (config.test === "opened") return "Opened the last email?";
  if (config.test === "clicked") return "Clicked the last email?";
  if (config.test === "tag") {
    return config.tag ? `Tagged "${config.tag}"?` : "Pick a tag to check";
  }
  if (config.test === "segment") {
    // The name is the question here, so the card shows it rather than the
    // rules behind it — which would not fit and are one click away.
    const name = names?.segments?.[config.segmentId ?? ""];
    return name ? `In "${name}"?` : "Pick a segment to check";
  }
  if (config.test === "list") {
    const name = names?.lists?.[config.listId ?? ""];
    if (!name) return "Pick a list to check";
    return config.op === "is_not" ? `Not on ${name}?` : `On ${name}?`;
  }
  if (!config.field) return "Pick something to check";
  const op = config.op ?? "is";
  if (op === "set") return `${config.field} is set`;
  if (op === "not_set") return `${config.field} is empty`;
  const word = op === "is" ? "is" : op === "is_not" ? "is not" : "contains";
  return `${config.field} ${word} ${config.value || "…"}`;
}

/** A date, short enough for a card: "3 Oct, 09:00". */
export function onThe(when: Date) {
  return when.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Minutes, in the unit somebody would have said it in. */
export function humanDelay(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.round((minutes / 1440) * 10) / 10;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * What is wrong with a flow that will not stop it being switched on.
 *
 * Each of these runs without complaint and does something nobody meant, so
 * the canvas has to say so before the numbers do a week later.
 */
export function flowWarnings(nodes: FlowNode[]): Record<string, string> {
  const by = new Map(nodes.map((node) => [node.id, node]));
  const parent = new Map<string, string>();
  for (const node of nodes) {
    if (node.next) parent.set(node.next, node.id);
    if (node.nextElse) parent.set(node.nextElse, node.id);
  }

  const out: Record<string, string> = {};
  for (const node of nodes) {
    if (node.kind === "email" && node.empty) out[node.id] = "Nothing written yet";
    if (node.kind === "await" && !node.config.event?.trim()) out[node.id] = "Pick an event";
    if (node.kind === "webhook" && !node.config.url?.trim()) out[node.id] = "Pick a URL";

    const test = node.config.test ?? "opened";
    if (node.kind !== "condition" || (test !== "opened" && test !== "clicked")) continue;

    /*
     * Asked about the last email, so what matters is what lies between that
     * email and this box. With no time in between, nobody has had a chance
     * to open it and the answer is always no.
     */
    let at = parent.get(node.id);
    let waited = false;
    const seen = new Set<string>();
    while (at && !seen.has(at)) {
      seen.add(at);
      const above = by.get(at);
      if (!above) break;
      if (above.kind === "email") break;
      if (
        (above.kind === "wait" && (above.waitUntil || above.delayMinutes > 0)) ||
        above.kind === "await"
      ) {
        waited = true;
      }
      at = parent.get(at);
    }

    const found = at ? by.get(at) : undefined;
    if (!found || found.kind !== "email") {
      out[node.id] = "Nothing is sent before this, so it is always no";
    } else if (!waited) {
      out[node.id] = "No time to open it yet. Put a Wait before this";
    }
  }
  return out;
}
