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

  if (node.kind === "condition") {
    // Both ways out get room, including the empty one — the "+" that adds to
    // it has to be somewhere, and a branch that appears only once it is used
    // is a branch nobody discovers.
    return spread(node.next, by, seen) + spread(node.nextElse, by, seen);
  }
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

    if (node.kind === "condition") {
      const yesWide = spread(node.next, by, new Set());
      const yesCentre = place(node.next, left, depth + 1);
      const noCentre = place(node.nextElse, left + yesWide * column, depth + 1);

      const centre = (yesCentre + noCentre) / 2;
      placed.push({ id, x: centre - NODE_WIDTH / 2, y });
      edges.push(elbow(id, node.next, "next", centre, y, yesCentre, (depth + 1) * row));
      edges.push(elbow(id, node.nextElse, "nextElse", centre, y, noCentre, (depth + 1) * row));
      return centre;
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
  const endY = to ? toY : startY + GAP_Y - 18;
  const bendY = startY + (endY - startY) / 2;

  const path =
    Math.abs(toX - fromX) < 1
      ? `M ${fromX} ${startY} L ${fromX} ${endY}`
      : `M ${fromX} ${startY} L ${fromX} ${bendY - 10} Q ${fromX} ${bendY} ${fromX + Math.sign(toX - fromX) * 10} ${bendY} L ${toX - Math.sign(toX - fromX) * 10} ${bendY} Q ${toX} ${bendY} ${toX} ${bendY + 10} L ${toX} ${endY}`;

  return { from, to, branch, x: to ? fromX : toX, y: to ? bendY : endY, path };
}

/**
 * What one box says, in two lines.
 *
 * The title is the thing that differs between two boxes of the same kind —
 * the subject, the length of the wait, the question being asked. The note
 * underneath is only there when it adds something; a card that says "WAIT /
 * 1 day / 1 day" has spent three lines saying one thing.
 */
export function summarise(node: FlowNode): { title: string; note?: string } {
  switch (node.kind) {
    case "email":
      return {
        title: node.subject?.trim() || "Untitled",
        note: node.empty ? "Nothing written yet" : undefined,
      };
    case "wait":
      return {
        title: node.delayMinutes === 0 ? "No pause" : humanDelay(node.delayMinutes),
        note: node.delayMinutes === 0 ? "Straight on to the next box" : undefined,
      };
    case "condition":
      return { title: describeTest(node.config) };
    case "field":
      return node.config.field
        ? { title: `${node.config.field} → ${node.config.value || "(empty)"}` }
        : { title: "Pick a field", note: "Nothing set yet" };
    case "unsubscribe":
      return { title: "Off the list", note: "Their journey ends here" };
    default:
      return { title: "" };
  }
}

export function describeTest(config: NodeConfig): string {
  if (config.test === "opened") return "Opened the last email?";
  if (config.test === "clicked") return "Clicked the last email?";
  if (!config.field) return "Pick something to check";
  const op = config.op ?? "is";
  if (op === "set") return `${config.field} is set`;
  if (op === "not_set") return `${config.field} is empty`;
  const word = op === "is" ? "is" : op === "is_not" ? "is not" : "contains";
  return `${config.field} ${word} ${config.value || "…"}`;
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
