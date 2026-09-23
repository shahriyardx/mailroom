"use client";

import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  Note,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import type { AutomationNodeKind, NodeConfig } from "@/db/schema";
import {
  type FlowNode,
  GAP_Y,
  NODE_HEIGHT,
  NODE_WIDTH,
  TRIGGER_ID,
  humanDelay,
  layout,
  summarise,
} from "@/lib/automation-flow";
import { cn } from "@/lib/utils";
import { addNodeAction, removeNodeAction, updateNodeAction } from "@/server/actions";
import {
  Clock,
  GitBranch,
  Mail,
  PanelRightClose,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserMinus,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * The automation, drawn.
 *
 * Every box is placed by the layout rather than by hand. That is the one
 * decision this editor is built on: dragging boxes around looks powerful for
 * ten minutes and then somebody inserts a step above a branch and spends the
 * afternoon untangling arrows. Here the picture is a consequence of the flow,
 * so it is always readable and there is nothing to keep tidy.
 *
 * What you can do instead is insert, which is the thing people actually want:
 * every arrow carries a "+", and whatever it pointed at becomes the new box's
 * own next. Nothing is ever left unattached.
 */

interface Kind {
  key: AutomationNodeKind;
  label: string;
  /** The eyebrow on the card, where the long form would wrap. */
  short: string;
  /** Ends the journey, so nothing can follow it. */
  ends?: boolean;
  hint: string;
  icon: LucideIcon;
  group: "Messages" | "Flow" | "People";
  /** The accent this kind is drawn in. */
  tone: string;
}

const KINDS: Kind[] = [
  {
    key: "email",
    short: "Email",
    label: "Send an email",
    hint: "Written in the same builder as everything else",
    icon: Mail,
    group: "Messages",
    tone: "text-primary",
  },
  {
    key: "wait",
    short: "Wait",
    label: "Wait",
    hint: "Hold them here for a while",
    icon: Clock,
    group: "Flow",
    tone: "text-muted-foreground",
  },
  {
    key: "condition",
    short: "Condition",
    label: "Split on a condition",
    hint: "Two ways on: one for yes, one for no",
    icon: GitBranch,
    group: "Flow",
    tone: "text-warn",
  },
  {
    key: "field",
    short: "Set a field",
    label: "Set a field",
    hint: "Write something you can segment on later",
    icon: SlidersHorizontal,
    group: "People",
    tone: "text-muted-foreground",
  },
  {
    key: "unsubscribe",
    ends: true,
    short: "Unsubscribe",
    label: "Take them off the list",
    hint: "Ends their journey here",
    icon: UserMinus,
    group: "People",
    tone: "text-destructive",
  },
];

const BY_KIND = new Map(KINDS.map((kind) => [kind.key, kind]));

/** Room around the drawing, so a branch on the edge is not against the frame. */
const PAD = 48;

export function AutomationCanvas({
  automationId,
  nodes,
  entryNodeId,
  listName,
  templates,
  live,
}: {
  automationId: string;
  nodes: FlowNode[];
  entryNodeId: string | null;
  listName: string;
  /** Saved templates an email box can be started from. */
  templates: { id: string; name: string }[];
  /** Running: the canvas says so, because edits reach real people. */
  live: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<{
    after: string | null;
    branch: "next" | "nextElse";
    /** True at the end of a chain, where a box that ends the journey can go. */
    terminal: boolean;
    at: { x: number; y: number };
  } | null>(null);
  const [removing, setRemoving] = useState<FlowNode | null>(null);
  /** Which box the inspector is showing. An id, so it survives a refresh. */
  const [editing, setEditing] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const frame = useRef<HTMLDivElement>(null);

  const plan = useMemo(() => layout(nodes, entryNodeId), [nodes, entryNodeId]);
  const by = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  /*
   * Escape backs out of whatever is open, innermost first.
   *
   * The menu is a popover over the canvas and the inspector is a pane beside
   * it, so one key has to know which of the two the reader means — and they
   * mean the one they opened last.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (adding) setAdding(null);
      else setEditing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);

  /*
   * Dragging the background moves the canvas.
   *
   * Every diagram tool works this way and it is the first thing anybody tries
   * on a flow too big for the window. Only from the background: starting a
   * drag on a card would fight with clicking it.
   */
  useEffect(() => {
    const pane = frame.current;
    if (!pane) return;

    let from: { x: number; y: number; left: number; top: number } | null = null;

    const down = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (event.button !== 0) return;
      // Cards, buttons and the SVG all sit above the ground; only the ground
      // and the sized wrapper inside it are draggable.
      if (target.closest("button, a, aside, [role='button']")) return;
      from = { x: event.clientX, y: event.clientY, left: pane.scrollLeft, top: pane.scrollTop };
      pane.setPointerCapture(event.pointerId);
      pane.style.cursor = "grabbing";
    };

    const move = (event: PointerEvent) => {
      if (!from) return;
      pane.scrollLeft = from.left - (event.clientX - from.x);
      pane.scrollTop = from.top - (event.clientY - from.y);
    };

    const up = (event: PointerEvent) => {
      if (!from) return;
      from = null;
      pane.releasePointerCapture(event.pointerId);
      pane.style.cursor = "";
    };

    pane.addEventListener("pointerdown", down);
    pane.addEventListener("pointermove", move);
    pane.addEventListener("pointerup", up);
    pane.addEventListener("pointercancel", up);
    return () => {
      pane.removeEventListener("pointerdown", down);
      pane.removeEventListener("pointermove", move);
      pane.removeEventListener("pointerup", up);
      pane.removeEventListener("pointercancel", up);
    };
  }, []);

  async function add(kind: AutomationNodeKind) {
    if (!adding) return;
    setBusy(true);
    try {
      const made = await addNodeAction(automationId, {
        kind,
        after: adding.after === TRIGGER_ID ? null : adding.after,
        branch: adding.branch,
      });
      if (!made.ok) throw new Error(made.error);
      setAdding(null);
      // An email is the only kind with anything to write, so it opens.
      if (kind === "email") router.push(`/campaigns/automations/${automationId}/steps/${made.id}`);
      else router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be added");
    } finally {
      setBusy(false);
    }
  }

  const chosen = editing ? (by.get(editing) ?? null) : null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(next) => !next && setRemoving(null)}
          title="Remove this box?"
          description={removing ? summarise(removing).title : undefined}
          consequences={
            removing?.kind === "condition" ? (
              <>
                Everything on its <strong>no</strong> branch goes with it, because that branch has
                nowhere left to hang from. The yes branch joins back onto whatever came before.
                Anybody sitting inside the deleted part stops there.
              </>
            ) : (
              "Whatever pointed at it points at what came next instead, so nothing below is cut off. Anybody sitting on it moves on."
            )
          }
          confirmLabel="Remove it"
          onConfirm={async () => {
            if (!removing) return;
            await removeNodeAction(automationId, removing.id);
            setRemoving(null);
            toast.success("Removed");
            router.refresh();
          }}
        />

        {/* The dotted ground. Drawn with a gradient rather than an image so it
          follows the theme and costs nothing to load. */}
        <div
          ref={frame}
          className="h-full w-full cursor-grab overflow-auto"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklch, var(--color-border) 90%, transparent) 1px, transparent 1px)",
            backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setAdding(null);
          }}
        >
          {/* Two boxes: the outer one is the drawing's size after zooming,
              which is what centres it and what the scrollbars measure; the
              inner one is the drawing at its own scale. One box cannot be
              both, and using one leaves dead space at every zoom but 100%. */}
          <div
            className="mx-auto"
            style={{
              width: (plan.width + PAD * 2) * zoom,
              height: (plan.height + PAD * 2) * zoom,
            }}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: plan.width + PAD * 2,
                height: plan.height + PAD * 2,
                transform: `scale(${zoom})`,
              }}
            >
              {/* Edges under the cards, so a line never crosses a title. */}
              <svg
                className="pointer-events-none absolute inset-0"
                width={plan.width + PAD * 2}
                height={plan.height + PAD * 2}
                aria-hidden="true"
              >
                <title>Connections</title>
                <g transform={`translate(${PAD}, ${PAD})`}>
                  {plan.edges.map((edge) => (
                    <path
                      key={`${edge.from}-${edge.branch}`}
                      d={edge.path}
                      fill="none"
                      strokeWidth={edge.to ? 1.75 : 1.5}
                      className={cn(
                        "stroke-muted-foreground/40",
                        // A branch with nothing on it is drawn as an
                        // invitation rather than as a connection that failed.
                        !edge.to && "stroke-muted-foreground/25 [stroke-dasharray:3_5]",
                      )}
                    />
                  ))}

                  {/* A dot where each line leaves its box. No arrowheads: the
                      flow reads downwards, so direction is not in question,
                      and a head on every edge is clutter at this density. */}
                  {plan.nodes.map((spot) => (
                    <circle
                      key={`dot-${spot.id}`}
                      cx={spot.x + NODE_WIDTH / 2}
                      cy={spot.y + NODE_HEIGHT}
                      r={2.5}
                      className="fill-muted-foreground/40"
                    />
                  ))}
                </g>
              </svg>

              {/* A "+" on every arrow, including the ones going nowhere yet: a
              branch you can only find once it is used is a branch nobody
              finds. */}
              {plan.edges.map((edge) => {
                const parent = by.get(edge.from);
                const label =
                  parent?.kind === "condition" ? (edge.branch === "next" ? "Yes" : "No") : null;

                return (
                  <span
                    key={`add-${edge.from}-${edge.branch}`}
                    className="-translate-x-1/2 -translate-y-1/2 absolute"
                    style={{ left: edge.x + PAD, top: edge.y + PAD }}
                  >
                    {/* Beside the button rather than in the same row as it: a
                      label that pushes the "+" sideways puts it off the line
                      it belongs to, which is exactly what it must sit on. */}
                    {label && (
                      <Badge
                        size="sm"
                        tone={edge.branch === "next" ? "ok" : "neutral"}
                        className="-translate-y-1/2 absolute top-1/2 right-[calc(100%+6px)]"
                      >
                        {label}
                      </Badge>
                    )}
                    <button
                      type="button"
                      aria-label="Add a box here"
                      title="Add a box here"
                      disabled={busy}
                      onClick={() =>
                        setAdding({
                          after: edge.from,
                          branch: edge.branch,
                          // A box that ends the journey can only go where
                          // nothing follows.
                          terminal: edge.to === null,
                          at: { x: edge.x + PAD, y: edge.y + PAD },
                        })
                      }
                      className="grid size-[22px] place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </span>
                );
              })}

              {/* Under the button it names, and inside the drawing so it is
                  carried by the same centring: a hint somebody has to go
                  looking for has not hinted anything. */}
              {!entryNodeId && plan.edges[0] && (
                <p
                  className="-translate-x-1/2 pointer-events-none absolute w-48 text-center text-[12.5px] text-muted-foreground"
                  style={{ left: plan.edges[0].x + PAD, top: plan.edges[0].y + PAD + 20 }}
                >
                  Start here
                </p>
              )}

              {plan.nodes.map((spot) => {
                if (spot.id === TRIGGER_ID) {
                  return (
                    <Card
                      key={spot.id}
                      x={spot.x + PAD}
                      y={spot.y + PAD}
                      eyebrow="Trigger"
                      title="Somebody joins"
                      note={listName}
                      icon={Play}
                      tone="text-ok"
                    />
                  );
                }

                const node = by.get(spot.id);
                if (!node) return null;
                const kind = BY_KIND.get(node.kind);
                const said = summarise(node);

                return (
                  <Card
                    key={spot.id}
                    x={spot.x + PAD}
                    y={spot.y + PAD}
                    eyebrow={kind?.short ?? node.kind}
                    title={said.title}
                    note={said.note}
                    icon={kind?.icon ?? Mail}
                    tone={kind?.tone ?? "text-muted-foreground"}
                    warn={node.kind === "email" && node.empty}
                    selected={editing === node.id}
                    onOpen={() => setEditing(node.id)}
                    onRemove={() => setRemoving(node)}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* The menu, anchored where the "+" was pressed. Grouped, because five
          flat options read as five equal things and they are not. */}
        {adding && (
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setAdding(null)}
            />
            <div
              className="absolute z-30 w-[268px] overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-lg"
              style={{
                left: Math.min(adding.at.x * zoom + 16, (frame.current?.clientWidth ?? 800) - 284),
                top: Math.max(
                  8,
                  Math.min(
                    adding.at.y * zoom - (frame.current?.scrollTop ?? 0) + 8,
                    (frame.current?.clientHeight ?? 600) - 360,
                  ),
                ),
              }}
            >
              {(["Messages", "Flow", "People"] as const).map((group) => (
                <div key={group} className="mb-1 last:mb-0">
                  <p className="eyebrow px-2 py-1">{group}</p>
                  {KINDS.filter(
                    (kind) =>
                      kind.group === group &&
                      /*
                       * A box that ends the journey is only offered where
                       * nothing follows. Inserted in front of other boxes it
                       * would inherit them, and since nothing after it can
                       * ever be reached they would simply vanish from the
                       * canvas — which looks exactly like losing work.
                       */
                      (!kind.ends || adding.terminal),
                  ).map((kind) => (
                    <button
                      key={kind.key}
                      type="button"
                      disabled={busy}
                      onClick={() => add(kind.key)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted">
                        <kind.icon className={cn("size-3.5", kind.tone)} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium">
                          {kind.label}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {kind.hint}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Zoom, for a flow that has outgrown the window. Buttons rather than a
          pinch gesture: this is edited on a laptop with a trackpad, and
          hijacking the scroll wheel to zoom is how a canvas becomes hostile. */}
        <div className="absolute right-4 bottom-4 flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-sm">
          <IconButton
            label="Zoom out"
            size="sm"
            onClick={() =>
              setZoom((current) => Math.max(0.5, Math.round((current - 0.1) * 10) / 10))
            }
          >
            <ZoomOut />
          </IconButton>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-w-10 text-center font-mono text-[11.5px] text-muted-foreground tabular-nums hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            label="Zoom in"
            size="sm"
            onClick={() =>
              setZoom((current) => Math.min(1.5, Math.round((current + 0.1) * 10) / 10))
            }
          >
            <ZoomIn />
          </IconButton>
        </div>

        {live && (
          <div className="absolute top-4 left-4 flex items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 py-1.5 text-[12px] text-ok">
            <span className="size-1.5 rounded-full bg-ok" />
            Running — changes reach people already part-way through
          </div>
        )}
      </div>

      {/* The inspector. A pane rather than a dialog: a box is adjusted while
          looking at where it sits in the flow, and a modal covers exactly the
          thing being reasoned about. */}
      {chosen && (
        <NodeInspector
          key={chosen.id}
          automationId={automationId}
          node={chosen}
          templates={templates}
          onClose={() => setEditing(null)}
          onRemove={() => setRemoving(chosen)}
        />
      )}
    </div>
  );
}

/** One box. */
function Card({
  x,
  y,
  eyebrow,
  title,
  note,
  icon: Icon,
  tone,
  warn,
  selected,
  onOpen,
  onRemove,
}: {
  x: number;
  y: number;
  eyebrow: string;
  title: string;
  /** Only when it adds something the title does not already say. */
  note?: string;
  icon: LucideIcon;
  tone: string;
  warn?: boolean;
  /** The one the inspector is showing. */
  selected?: boolean;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const open = onOpen;

  return (
    <div
      className={cn(
        "group absolute flex items-stretch overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
        selected
          ? "border-primary ring-2 ring-primary/25"
          : warn
            ? "border-warn/50"
            : "border-border",
        open && "cursor-pointer hover:shadow-md",
      )}
      style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
      onClick={open}
      onKeyDown={open ? (event) => event.key === "Enter" && open() : undefined}
      role={open ? "button" : undefined}
      tabIndex={open ? 0 : undefined}
    >
      <span className="grid w-11 shrink-0 place-items-center border-border border-r bg-muted/40">
        <Icon className={cn("size-4", tone)} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col justify-center px-3">
        <span className="eyebrow block truncate">{eyebrow}</span>
        <span className="block truncate font-medium text-[13px] leading-snug">{title}</span>
        {note && (
          <span
            className={cn(
              "block truncate text-[11.5px]",
              warn ? "text-warn" : "text-muted-foreground",
            )}
          >
            {note}
          </span>
        )}
      </span>

      {onRemove && (
        <span className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton
            label="Remove this box"
            size="sm"
            variant="danger"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 />
          </IconButton>
        </span>
      )}
    </div>
  );
}

/** Units a wait is offered in. Minutes are what it is stored as. */
const UNITS = [
  { key: "minutes", label: "minutes", per: 1 },
  { key: "hours", label: "hours", per: 60 },
  { key: "days", label: "days", per: 1440 },
] as const;

/** The biggest unit a delay divides into cleanly, so 2880 reads as "2 days". */
function asUnit(minutes: number) {
  for (const unit of [...UNITS].reverse()) {
    if (minutes >= unit.per && minutes % unit.per === 0) {
      return { unit: unit.key, amount: minutes / unit.per };
    }
  }
  return { unit: "minutes" as const, amount: minutes };
}

/** Common waits, because "3 days" is what almost every second email is. */
const PRESETS = [
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 1440 },
  { label: "3 days", minutes: 4320 },
  { label: "1 week", minutes: 10_080 },
];

/**
 * Everything one box needs saying about it, beside the flow it sits in.
 *
 * A pane rather than a dialog. A box is adjusted while looking at where it
 * lands — "wait three days" only means something next to what comes before
 * it — and a modal covers exactly the thing being reasoned about.
 *
 * It saves as you go rather than behind a button. There is no half-finished
 * state worth protecting here: every field is one value, and a Save button
 * on a pane like this mostly exists to be forgotten.
 */
function NodeInspector({
  automationId,
  node,
  templates,
  onClose,
  onRemove,
}: {
  automationId: string;
  node: FlowNode;
  templates: { id: string; name: string }[];
  onClose: () => void;
  onRemove: () => void;
}) {
  const router = useRouter();
  const start = asUnit(node.delayMinutes);
  const [amount, setAmount] = useState(start.amount);
  const [unit, setUnit] = useState<string>(start.unit);
  const [subject, setSubject] = useState(node.subject ?? "");
  const [config, setConfig] = useState<NodeConfig>(node.config);
  const [busy, setBusy] = useState(false);

  const kind = BY_KIND.get(node.kind);

  async function save(patch: Parameters<typeof updateNodeAction>[1]) {
    setBusy(true);
    try {
      const result = await updateNodeAction(node.id, patch);
      if (!result.ok) throw new Error(result.error);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be saved");
    } finally {
      setBusy(false);
    }
  }

  function saveWait(minutes: number) {
    const found = asUnit(minutes);
    setAmount(found.amount);
    setUnit(found.unit);
    void save({ delayMinutes: minutes });
  }

  function saveConfig(next: NodeConfig) {
    setConfig(next);
    void save({ config: next });
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-border border-l bg-card">
      <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted">
          {kind ? <kind.icon className={cn("size-3.5", kind.tone)} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-[12.5px]">
          {kind?.label ?? node.kind}
        </span>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <PanelRightClose />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-4 p-3">
        {node.kind === "email" && (
          <>
            <Field label="Subject">
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                onBlur={() => subject.trim() !== (node.subject ?? "") && save({ subject })}
                placeholder="What lands in the inbox"
              />
            </Field>

            {/* Starting from a template is copying, not linking — otherwise
                fixing a typo for something else edits a live flow. */}
            {templates.length > 0 && (
              <Field label="Start from a template" hint="Copies its subject and blocks in.">
                <Select
                  value=""
                  onValueChange={(value) => save({ templateId: value })}
                  disabled={busy}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick one…" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Button
              variant="solid"
              className="w-full"
              onClick={() => router.push(`/campaigns/automations/${automationId}/steps/${node.id}`)}
            >
              <Pencil className="size-3.5" />
              {node.empty ? "Write it" : "Edit the body"}
            </Button>

            {node.empty && (
              <Note className="text-warn">
                Nothing in it yet. An empty email still goes out — blank — so this one needs writing
                before the flow is switched on.
              </Note>
            )}
          </>
        )}

        {node.kind === "wait" && (
          <>
            <Field label="Hold them for">
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  onBlur={() =>
                    save({
                      delayMinutes: Math.max(
                        0,
                        Math.round(amount * (UNITS.find((entry) => entry.key === unit)?.per ?? 1)),
                      ),
                    })
                  }
                />
                <Select
                  value={unit}
                  onValueChange={(value) => {
                    setUnit(value);
                    void save({
                      delayMinutes: Math.max(
                        0,
                        Math.round(amount * (UNITS.find((entry) => entry.key === value)?.per ?? 1)),
                      ),
                    });
                  }}
                >
                  <SelectTrigger className="w-[104px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((entry) => (
                      <SelectItem key={entry.key} value={entry.key}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
            </Field>

            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => saveWait(preset.minutes)}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-[12px] transition-colors",
                    node.delayMinutes === preset.minutes
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <Note>
              Counted from the moment they reach this box, so it is a pause in their own journey
              rather than a date on a calendar.
            </Note>
          </>
        )}

        {node.kind === "condition" && (
          <>
            <Field label="Check">
              <Select
                value={config.test ?? "opened"}
                onValueChange={(value) =>
                  saveConfig({ ...config, test: value as NodeConfig["test"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opened">They opened the last email</SelectItem>
                  <SelectItem value="clicked">They clicked the last email</SelectItem>
                  <SelectItem value="field">A field on them</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {config.test === "field" && (
              <>
                <Field label="Field">
                  <Input
                    value={config.field ?? ""}
                    onChange={(event) => setConfig({ ...config, field: event.target.value })}
                    onBlur={() => saveConfig(config)}
                    placeholder="plan"
                    className="font-mono"
                  />
                </Field>

                <Field label="Compare">
                  <Select
                    value={config.op ?? "is"}
                    onValueChange={(value) =>
                      saveConfig({ ...config, op: value as NodeConfig["op"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="is">is</SelectItem>
                      <SelectItem value="is_not">is not</SelectItem>
                      <SelectItem value="contains">contains</SelectItem>
                      <SelectItem value="set">is set</SelectItem>
                      <SelectItem value="not_set">is empty</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {config.op !== "set" && config.op !== "not_set" && (
                  <Field label="To">
                    <Input
                      value={config.value ?? ""}
                      onChange={(event) => setConfig({ ...config, value: event.target.value })}
                      onBlur={() => saveConfig(config)}
                      placeholder="pro"
                    />
                  </Field>
                )}
              </>
            )}

            <Note>
              <strong className="text-ok">Yes</strong> goes down the left, <strong>no</strong> down
              the right. Both carry a plus, so the answer you do not act on can stay empty — those
              people simply stop here.
            </Note>
          </>
        )}

        {node.kind === "field" && (
          <>
            <Field label="Field" hint="Anything. It becomes a merge field and a segment rule.">
              <Input
                value={config.field ?? ""}
                onChange={(event) => setConfig({ ...config, field: event.target.value })}
                onBlur={() => saveConfig(config)}
                placeholder="stage"
                className="font-mono"
              />
            </Field>
            <Field label="Set it to">
              <Input
                value={config.value ?? ""}
                onChange={(event) => setConfig({ ...config, value: event.target.value })}
                onBlur={() => saveConfig(config)}
                placeholder="welcomed"
              />
            </Field>
            <Note>
              Written onto the person, so a later condition or a segment can ask about it. Use it to
              mark where somebody got to.
            </Note>
          </>
        )}

        {node.kind === "unsubscribe" && (
          <Note>
            Nothing to set. Anybody who reaches this box is taken off the list and their journey
            ends here. Use it at the end of a branch for people who have stopped reading.
          </Note>
        )}
      </div>

      <footer className="shrink-0 border-border border-t p-3">
        <Button variant="danger-ghost" className="w-full" onClick={onRemove} disabled={busy}>
          <Trash2 className="size-3.5" />
          Remove this box
        </Button>
      </footer>
    </aside>
  );
}
