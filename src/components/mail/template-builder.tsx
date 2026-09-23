"use client";

import {
  Button,
  ColorInput,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  Note,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/kit";
import type { AutomationNode, Broadcast, Template } from "@/db/schema";
import {
  type Align,
  type Block,
  type BlockKind,
  type BlockStyle,
  type ColumnsBlock,
  type EmailDesign,
  type EmailTheme,
  FONTS,
  HEADING_DEFAULTS,
  NETWORKS,
  type Network,
  type Padding,
  type Where,
  designToText,
  emptyDesign,
  findBlock,
  insertBlock,
  networkIcon,
  networkLabel,
  networkOf,
  newBlock,
  nudgeBlock,
  patchBlock,
  readDesign,
  relocateBlock,
  removeBlock,
  renderDesign,
  whereIs,
  youtubeId,
  youtubeThumb,
} from "@/lib/email-blocks";
import { slugify, templateVariables } from "@/lib/template";
import { useSubmit } from "@/lib/use-submit";
import { cn, newId } from "@/lib/utils";
import {
  audienceSizeAction,
  createTemplateAction,
  deleteTemplateAction,
  sendTemplateTestAction,
  sendableMailboxesAction,
  startBroadcastAction,
  updateBroadcastAction,
  updateNodeAction,
  updateTemplateAction,
} from "@/server/actions";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  BarChart3,
  Blocks,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Columns2,
  Copy,
  CornerDownRight,
  Eye,
  FileCode2,
  GripVertical,
  Heading as HeadingIcon,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Link2,
  List as ListIcon,
  Menu,
  Minus,
  Monitor,
  Moon,
  MousePointerClick,
  Plus,
  Quote as QuoteIcon,
  Redo2,
  Send,
  Smartphone,
  Table2,
  Trash2,
  Type,
  Undo2,
  UnfoldVertical,
  UserMinus,
  Youtube,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmailFrame } from "./email-frame";
import { MediaPicker } from "./media-panel";
import { RichEditor } from "./rich-editor";

/**
 * The template builder: a palette, a canvas and an inspector.
 *
 * The canvas draws each block in React rather than in the iframe the email
 * will actually arrive in, because a block has to be clickable to be edited
 * and nothing inside an iframe is. The styles here stay deliberately close to
 * the ones {@link renderDesign} writes, and Preview shows the real compiled
 * HTML — so the approximation is never the last word on how something looks.
 */

const CodeEditor = dynamic(() => import("./code-editor").then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] rounded-[10px]" />,
});

const PALETTE: { group: string; items: { kind: BlockKind; label: string; icon: typeof Type }[] }[] =
  [
    {
      group: "Content",
      items: [
        { kind: "heading", label: "Heading", icon: HeadingIcon },
        { kind: "text", label: "Text", icon: Type },
        { kind: "list", label: "List", icon: ListIcon },
        { kind: "callout", label: "Callout", icon: Info },
        { kind: "quote", label: "Quote", icon: QuoteIcon },
        { kind: "code", label: "Code", icon: Code2 },
        { kind: "image", label: "Image", icon: ImageIcon },
        { kind: "gallery", label: "Gallery", icon: LayoutGrid },
        { kind: "youtube", label: "YouTube", icon: Youtube },
      ],
    },
    {
      group: "Layout",
      items: [
        { kind: "button", label: "Button", icon: MousePointerClick },
        { kind: "menu", label: "Menu bar", icon: Menu },
        { kind: "stat", label: "Numbers", icon: BarChart3 },
        { kind: "columns", label: "Columns", icon: Columns2 },
        { kind: "table", label: "Table", icon: Table2 },
        { kind: "divider", label: "Divider", icon: Minus },
        { kind: "spacer", label: "Spacer", icon: UnfoldVertical },
      ],
    },
    {
      group: "Mailing",
      items: [
        { kind: "social", label: "Social links", icon: Link2 },
        { kind: "footer", label: "Unsubscribe", icon: UserMinus },
        { kind: "html", label: "Raw HTML", icon: FileCode2 },
      ],
    },
  ];

/**
 * Ready-made arrangements, made of the blocks that already exist.
 *
 * The palette is a box of parts, and a box of parts is not a template. The
 * difference between a builder people finish something in and one they give
 * up on is whether "picture on the left, words on the right, button under
 * them" is one press or four blocks and a padding argument.
 *
 * Every one of these is built from `newBlock`, so nothing here has its own
 * renderer to keep in step — a section is an opinion about which blocks go
 * together, not a new kind of thing.
 */
interface SectionPreset {
  key: string;
  label: string;
  /** A rough drawing of the result. Boxes on a grid, no pictures to load. */
  sketch: React.ReactNode;
  build: (fresh: (kind: BlockKind) => Block) => Block[];
}

/** One grey bar in a sketch. */
function Bar({ w = "100%", h = 5, dark = false }: { w?: string; h?: number; dark?: boolean }) {
  return (
    <span
      className={cn(
        "block rounded-[2px]",
        dark ? "bg-muted-foreground/70" : "bg-muted-foreground/25",
      )}
      style={{ width: w, height: h }}
    />
  );
}

/** The grey square that stands in for a picture. */
function Pic({ h = 30 }: { h?: number }) {
  return (
    <span
      className="block rounded-[3px] bg-muted-foreground/20"
      style={{ height: h, width: "100%" }}
    />
  );
}

/** Words, then a button: the half of a section that is not the picture. */
function Words({ button = true }: { button?: boolean }) {
  return (
    <span className="flex flex-1 flex-col gap-1">
      <Bar w="70%" h={5} />
      <Bar w="100%" h={3} />
      <Bar w="85%" h={3} />
      {button && <Bar w="40%" h={7} dark />}
    </span>
  );
}

/** Fill in a block's fields without losing what `newBlock` decided. */
function made<T extends Block>(block: Block, changes: Partial<T>): Block {
  return { ...block, ...changes } as Block;
}

const SECTIONS: SectionPreset[] = [
  {
    key: "hero",
    label: "Hero",
    sketch: (
      <span className="flex flex-col gap-1">
        <Pic h={26} />
        <Bar w="60%" h={6} />
        <Bar w="90%" h={3} />
        <Bar w="35%" h={7} dark />
      </span>
    ),
    build: (fresh) => [
      made(fresh("image"), { align: "center", width: 100 }),
      made(fresh("heading"), { text: "A headline worth the picture", level: 1, align: "center" }),
      made(fresh("text"), { html: "One sentence saying what this is about.", align: "center" }),
      made(fresh("button"), { text: "Read it", align: "center" }),
    ],
  },
  {
    key: "image-left",
    label: "Picture left",
    sketch: (
      <span className="flex items-start gap-1.5">
        <span className="w-[38%]">
          <Pic h={34} />
        </span>
        <Words />
      </span>
    ),
    build: (fresh) => [
      made<ColumnsBlock>(fresh("columns"), {
        gap: 20,
        columns: [
          { blocks: [made(fresh("image"), { align: "left", width: 100 })] },
          {
            blocks: [
              made(fresh("heading"), { text: "What this is", level: 3, align: "left" }),
              made(fresh("text"), { html: "A couple of lines about it.", align: "left" }),
              made(fresh("button"), { text: "Have a look", align: "left" }),
            ],
          },
        ],
      }),
    ],
  },
  {
    key: "image-right",
    label: "Picture right",
    sketch: (
      <span className="flex items-start gap-1.5">
        <Words />
        <span className="w-[38%]">
          <Pic h={34} />
        </span>
      </span>
    ),
    build: (fresh) => [
      made<ColumnsBlock>(fresh("columns"), {
        gap: 20,
        columns: [
          {
            blocks: [
              made(fresh("heading"), { text: "What this is", level: 3, align: "left" }),
              made(fresh("text"), { html: "A couple of lines about it.", align: "left" }),
              made(fresh("button"), { text: "Have a look", align: "left" }),
            ],
          },
          { blocks: [made(fresh("image"), { align: "right", width: 100 })] },
        ],
      }),
    ],
  },
  {
    key: "image-over",
    label: "Picture over",
    sketch: (
      <span className="flex flex-col gap-1">
        <Pic h={24} />
        <Bar w="55%" h={5} />
        <Bar w="100%" h={3} />
        <Bar w="35%" h={7} dark />
      </span>
    ),
    build: (fresh) => [
      made(fresh("image"), { align: "center", width: 100 }),
      made(fresh("heading"), { text: "What this is", level: 3, align: "left" }),
      made(fresh("text"), { html: "A couple of lines about it.", align: "left" }),
      made(fresh("button"), { text: "Have a look", align: "left" }),
    ],
  },
  {
    key: "two-up",
    label: "Two up",
    sketch: (
      <span className="flex gap-1.5">
        {[0, 1].map((at) => (
          <span key={at} className="flex flex-1 flex-col gap-1">
            <Pic h={20} />
            <Bar w="80%" h={4} />
            <Bar w="100%" h={3} />
            <Bar w="55%" h={6} dark />
          </span>
        ))}
      </span>
    ),
    build: (fresh) => [
      made<ColumnsBlock>(fresh("columns"), {
        gap: 20,
        columns: [0, 1].map(() => ({
          blocks: [
            made(fresh("image"), { align: "center", width: 100 }),
            made(fresh("heading"), { text: "One of them", level: 3, align: "left" }),
            made(fresh("text"), { html: "A line about it.", align: "left" }),
            made(fresh("button"), { text: "Open", align: "left" }),
          ],
        })),
      }),
    ],
  },
  {
    key: "three-up",
    label: "Three features",
    sketch: (
      <span className="flex gap-1.5">
        {[0, 1, 2].map((at) => (
          <span key={at} className="flex flex-1 flex-col gap-1">
            <Pic h={16} />
            <Bar w="90%" h={4} />
            <Bar w="100%" h={3} />
          </span>
        ))}
      </span>
    ),
    build: (fresh) => [
      made<ColumnsBlock>(fresh("columns"), {
        gap: 16,
        columns: [0, 1, 2].map(() => ({
          blocks: [
            made(fresh("image"), { align: "center", width: 100 }),
            made(fresh("heading"), { text: "A feature", level: 3, align: "center" }),
            made(fresh("text"), { html: "What it does.", align: "center" }),
          ],
        })),
      }),
    ],
  },
  {
    key: "numbers",
    label: "Numbers",
    sketch: (
      <span className="flex gap-2">
        {[0, 1, 2].map((at) => (
          <span key={at} className="flex flex-1 flex-col items-center gap-1">
            <Bar w="60%" h={10} dark />
            <Bar w="80%" h={3} />
          </span>
        ))}
      </span>
    ),
    build: (fresh) => [
      made(fresh("heading"), { text: "The month in numbers", level: 3, align: "center" }),
      fresh("stat"),
    ],
  },
  {
    key: "list",
    label: "Headline and list",
    sketch: (
      <span className="flex flex-col gap-1.5">
        <Bar w="65%" h={6} />
        {[0, 1, 2].map((at) => (
          <span key={at} className="flex items-center gap-1.5">
            <span className="size-1 rounded-full bg-muted-foreground/60" />
            <Bar w="85%" h={3} />
          </span>
        ))}
      </span>
    ),
    build: (fresh) => [
      made(fresh("heading"), { text: "What changed", level: 3, align: "left" }),
      fresh("list"),
    ],
  },
  {
    key: "callout",
    label: "Notice",
    sketch: (
      <span className="flex gap-1.5 rounded-[3px] bg-muted-foreground/10 p-1.5">
        <span className="w-[3px] shrink-0 rounded-full bg-muted-foreground/60" />
        <span className="flex flex-1 flex-col gap-1">
          <Bar w="80%" h={3} />
          <Bar w="60%" h={3} />
        </span>
      </span>
    ),
    build: (fresh) => [fresh("callout")],
  },
  {
    key: "cta",
    label: "Call to action",
    sketch: (
      <span className="flex flex-col items-center gap-1.5">
        <Bar w="60%" h={6} />
        <Bar w="85%" h={3} />
        <Bar w="40%" h={8} dark />
      </span>
    ),
    build: (fresh) => [
      made(fresh("heading"), { text: "Ready when you are", level: 2, align: "center" }),
      made(fresh("text"), { html: "One line saying why now.", align: "center" }),
      made(fresh("button"), { text: "Get started", align: "center" }),
    ],
  },
  {
    key: "gallery",
    label: "Gallery",
    sketch: (
      <span className="flex gap-1.5">
        {[0, 1, 2].map((at) => (
          <span key={at} className="flex-1">
            <Pic h={26} />
          </span>
        ))}
      </span>
    ),
    build: (fresh) => [
      made(fresh("gallery"), {
        perRow: 3,
        images: [
          { src: "", alt: "", href: "" },
          { src: "", alt: "", href: "" },
          { src: "", alt: "", href: "" },
        ],
      }),
    ],
  },
  {
    key: "sign-off",
    label: "Sign-off",
    sketch: (
      <span className="flex flex-col items-center gap-1.5">
        <Bar w="70%" h={3} />
        <span className="flex gap-1">
          {[0, 1, 2].map((at) => (
            <span key={at} className="size-2 rounded-full bg-muted-foreground/40" />
          ))}
        </span>
        <Bar w="50%" h={3} />
      </span>
    ),
    build: (fresh) => [fresh("divider"), fresh("social"), fresh("footer")],
  },
];

/** One of the two halves of the palette. */
function PalettePick({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-[12px] transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      {label}
    </button>
  );
}

/** What a palette drag carries. A custom type, so nothing else is mistaken for one. */
const NEW_BLOCK = "application/x-mailroom-block";

const LABELS: Record<BlockKind, string> = {
  heading: "Heading",
  text: "Text",
  button: "Button",
  image: "Image",
  divider: "Divider",
  spacer: "Spacer",
  columns: "Columns",
  quote: "Quote",
  code: "Code",
  youtube: "YouTube",
  table: "Table",
  social: "Social links",
  footer: "Unsubscribe footer",
  list: "List",
  callout: "Callout",
  stat: "Numbers",
  menu: "Menu bar",
  gallery: "Gallery",
  html: "Raw HTML",
};

interface Details {
  name: string;
  slug: string;
  description: string;
  subject: string;
  /** Campaign-only, and ignored by a template. */
  subjectB: string;
  listId: string;
  mailboxId: string;
  segmentId: string;
}

/**
 * What this screen is editing.
 *
 * A template and a broadcast are the same document with different paperwork
 * around it: a name and a slug on one, a list and a send button on the other.
 * Everything between the palette and the inspector is identical, so it is one
 * screen that knows which of the two it has rather than two screens that will
 * drift.
 */
/**
 * Everything a campaign needs that a template does not.
 *
 * Passed in whole rather than fetched here: this is a client component, and a
 * builder that went looking for its own lists would flash an empty picker on
 * every open. The page already knows all of it.
 */
export interface CampaignContext {
  /** `fields` is the merge fields the people on that list actually carry. */
  lists: { id: string; name: string; subscribed: number; fields: string[] }[];
  segments: { id: string; listId: string; name: string; size: number }[];
  mailboxes: { id: string; address: string }[];
  /** Null means the footer of this send will have no address in it. */
  postalAddress: string | null;
}

export type BuilderTarget =
  | { kind: "template"; template: Template | null }
  | { kind: "broadcast"; broadcast: Broadcast; campaign: CampaignContext }
  /** One email out of an automation's flow. */
  | { kind: "step"; step: AutomationNode; automationName: string; mergeFields: string[] };

export function TemplateBuilder({
  template,
  basePath,
}: {
  template: Template | null;
  basePath: string;
}) {
  return <Builder target={{ kind: "template", template }} basePath={basePath} />;
}

/**
 * One email out of an automation, in the same builder.
 *
 * An automation's email is a template with a flow around it. Giving it a
 * worse editor than a one-off campaign would be a strange thing to decide on
 * purpose.
 */
export function StepBuilder({
  step,
  automationName,
  mergeFields,
  basePath,
}: {
  step: AutomationNode;
  automationName: string;
  /** What the people this flow writes to actually carry, for the chips. */
  mergeFields: string[];
  basePath: string;
}) {
  return (
    <Builder target={{ kind: "step", step, automationName, mergeFields }} basePath={basePath} />
  );
}

export function BroadcastBuilder({
  broadcast,
  campaign,
  basePath,
}: {
  broadcast: Broadcast;
  campaign: CampaignContext;
  basePath: string;
}) {
  return <Builder target={{ kind: "broadcast", broadcast, campaign }} basePath={basePath} />;
}

/** How many steps back the builder remembers. */
const HISTORY = 60;

/** Edits closer together than this are one step, not two. Milliseconds. */
const COALESCE = 700;

interface Past {
  past: EmailDesign[];
  present: EmailDesign;
  future: EmailDesign[];
}

/**
 * The design, and the versions of it that came before.
 *
 * Every edit here is small and reversible on its own — a colour, a word, a
 * block moved one place — which is exactly the kind of edit people make forty
 * of before noticing the one they did not mean. Without an undo the only way
 * back is to remember what the colour used to be.
 *
 * Typing is coalesced, because a keystroke is not a step: a sentence typed
 * into a text block would otherwise fill the whole stack, and the undo that
 * was wanted is thirty presses away.
 */
function useHistory(initial: () => EmailDesign) {
  const [state, setState] = useState<Past>(() => ({
    past: [],
    present: initial(),
    future: [],
  }));
  const stamp = useRef(0);

  const set = useCallback((update: (current: EmailDesign) => EmailDesign) => {
    const now = Date.now();
    const merge = now - stamp.current < COALESCE;
    stamp.current = now;

    setState((current) => {
      const next = update(current.present);
      if (next === current.present) return current;
      return {
        past:
          merge && current.past.length > 0
            ? current.past
            : [...current.past, current.present].slice(-HISTORY),
        present: next,
        future: [],
      };
    });
  }, []);

  // A step across the line ends whatever was being coalesced, so the edit
  // after an undo is a step of its own rather than joining the one before it.
  const undo = useCallback(() => {
    stamp.current = 0;
    setState((current) => {
      const previous = current.past.at(-1);
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY),
      };
    });
  }, []);

  const redo = useCallback(() => {
    stamp.current = 0;
    setState((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY),
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

  return {
    design: state.present,
    setDesign: set,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}

function Builder({ target, basePath }: { target: BuilderTarget; basePath: string }) {
  const router = useRouter();
  const [busy, submit] = useSubmit();

  const template = target.kind === "template" ? target.template : null;
  const step = target.kind === "step" ? target.step : null;
  const source =
    target.kind === "template"
      ? target.template
      : target.kind === "step"
        ? target.step
        : target.broadcast;
  // A broadcast that has gone is a record of what went, not a draft.
  const locked = target.kind === "broadcast" && target.broadcast.status !== "draft";

  const campaign = target.kind === "broadcast" ? target.broadcast : null;

  const [details, setDetails] = useState<Details>({
    name: template?.name ?? "",
    slug: template?.slug ?? "",
    description: template?.description ?? "",
    subject: source?.subject ?? "",
    subjectB: campaign?.subjectB ?? "",
    listId: campaign?.listId ?? "",
    mailboxId: campaign?.mailboxId ?? "",
    segmentId: campaign?.segmentId ?? "",
  });

  const { design, setDesign, undo, redo, canUndo, canRedo } = useHistory(
    () => readDesign(source?.design) ?? emptyDesign(),
  );
  const [html, setHtml] = useState(source?.html ?? "");

  /*
   * The builder is the document; the HTML is what it compiles to. They are
   * one thing seen two ways, not two things kept in step — nothing parses
   * arbitrary email HTML back into blocks, so a two-way tab would quietly
   * throw away whichever side was edited second.
   *
   * The exception is a template that was written by hand or posted through
   * the API. It has no blocks to show, so it stays hand-written until
   * somebody says otherwise, and the builder is what is switched off.
   */
  const [handwritten, setHandwritten] = useState(Boolean(source && !source.design && source.html));
  const [pane, setPane] = useState<"design" | "html">(handwritten ? "html" : "design");
  const [converting, setConverting] = useState(false);

  /*
   * What was last saved, as a string, so "has this changed" is one comparison
   * rather than a flag every edit has to remember to set — and so undoing an
   * edit by hand leaves the page clean again, which a flag never does.
   */
  const saved = useRef(
    JSON.stringify({
      details: {
        name: template?.name ?? "",
        slug: template?.slug ?? "",
        description: template?.description ?? "",
        subject: source?.subject ?? "",
      },
      design: readDesign(source?.design) ?? emptyDesign(),
      html: source?.html ?? "",
    }),
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"block" | "page" | "details">("details");
  /** Which half of the left-hand palette is showing. */
  const [shelf, setShelf] = useState<"blocks" | "sections">("blocks");
  const [previewing, setPreviewing] = useState(false);
  /* What the preview is pretending to be: a window or a phone, in a client
     that leaves the colours alone or one that forces its own dark mode. */
  const [previewOn, setPreviewOn] = useState<"desktop" | "mobile">("desktop");
  const [previewDark, setPreviewDark] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const block = selected ? findBlock(design.blocks, selected) : null;

  const dirty = JSON.stringify({ details, design, html }) !== saved.current;

  /*
   * Undo and redo, the way every other editor spells them.
   *
   * A field with its own undo keeps it: pressing ctrl-Z inside a half-typed
   * sentence should take back the sentence, not the block it is in. So this
   * steps aside whenever the keystroke went to somewhere that can hold text.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;

      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // The browser's own warning, for the ways out this page never sees: a
  // closed tab, a typed address, a reload.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const compiled = useMemo(
    () => (handwritten ? html : renderDesign(design)),
    [handwritten, design, html],
  );

  // The subject carries variables as often as the body does.
  const variables = useMemo(
    () => templateVariables(details.subject, compiled),
    [details.subject, compiled],
  );

  /*
   * A block is either in the document or in a column of one, and every one of
   * these has to work the same either way. The walking lives in the block
   * module, so this screen only has to say what it wants done.
   */
  function patch(id: string, changes: Partial<Block>) {
    setDesign((current) => ({ ...current, blocks: patchBlock(current.blocks, id, changes) }));
  }

  function style(id: string, changes: Partial<BlockStyle>) {
    const existing = findBlock(design.blocks, id);
    patch(id, { style: { ...existing?.style, ...changes } } as Partial<Block>);
  }

  function add(kind: BlockKind, at?: number, where: Where = {}) {
    const fresh = newBlock(kind, newId("blk"));
    setDesign((current) => ({
      ...current,
      blocks: insertBlock(current.blocks, fresh, where, at ?? Number.MAX_SAFE_INTEGER),
    }));
    setSelected(fresh.id);
    setTab("block");
  }

  /**
   * A whole arrangement at once.
   *
   * Appended rather than dropped where the cursor is: a section is several
   * blocks and one of them is usually a two-column table, and working out
   * where that goes inside another one is a question nobody asked. The
   * blocks are ordinary blocks once they land, so they move like any other.
   */
  function addSection(preset: SectionPreset) {
    const blocks = preset.build((kind) => newBlock(kind, newId("blk")));
    if (blocks.length === 0) return;

    setDesign((current) => ({ ...current, blocks: [...current.blocks, ...blocks] }));
    setSelected(blocks[0]!.id);
    setTab("block");
  }

  function move(id: string, by: number) {
    setDesign((current) => ({ ...current, blocks: nudgeBlock(current.blocks, id, by) }));
  }

  function relocate(id: string, to: Where, at: number) {
    setDesign((current) => ({ ...current, blocks: relocateBlock(current.blocks, id, to, at) }));
  }

  function duplicate(id: string) {
    setDesign((current) => {
      const block = findBlock(current.blocks, id);
      if (!block) return current;
      const where = whereIs(current.blocks, id);
      const list = where.parentId
        ? ((current.blocks.find((entry) => entry.id === where.parentId) as ColumnsBlock | undefined)
            ?.columns[where.column ?? 0]?.blocks ?? [])
        : current.blocks;
      const at = list.findIndex((entry) => entry.id === id) + 1;
      return {
        ...current,
        blocks: insertBlock(current.blocks, { ...block, id: newId("blk") }, where, at),
      };
    });
  }

  function remove(id: string) {
    setDesign((current) => ({ ...current, blocks: removeBlock(current.blocks, id) }));
    setSelected((current) => (current === id ? null : current));
  }

  function save() {
    const body = handwritten ? { design: null, html, text: source?.text ?? undefined } : { design };

    if (target.kind === "step") {
      submit(async () => {
        const result = await updateNodeAction(target.step.id, {
          subject: details.subject,
          ...body,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        saved.current = JSON.stringify({ details, design, html });
        toast.success("Email saved");
        router.refresh();
      });
      return;
    }

    if (target.kind === "broadcast") {
      submit(async () => {
        const result = await updateBroadcastAction(target.broadcast.id, {
          subject: details.subject,
          subjectB: details.subjectB.trim() || null,
          listId: details.listId || undefined,
          mailboxId: details.mailboxId || undefined,
          segmentId: details.segmentId || null,
          ...body,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        saved.current = JSON.stringify({ details, design, html });
        toast.success("Campaign saved");
        router.refresh();
      });
      return;
    }

    const name = details.name.trim();
    if (!name) {
      toast.error("A template needs a name");
      setTab("details");
      return;
    }

    const payload = {
      name,
      slug: details.slug.trim() || slugify(name),
      description: details.description,
      subject: details.subject,
      // Only one of the two goes: a design compiles to the body on the server,
      // and clearing it is how a template becomes hand-written HTML.
      ...body,
    };

    submit(async () => {
      try {
        if (template) {
          await updateTemplateAction(template.id, payload);
          saved.current = JSON.stringify({ details, design, html });
          toast.success("Template saved");
          router.refresh();
        } else {
          const created = await createTemplateAction(payload);
          saved.current = JSON.stringify({ details, design, html });
          toast.success("Template created");
          router.replace(`${basePath}/${created.id}`);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save the template");
      }
    });
  }

  return (
    /* The whole frame. Three panes that scroll independently, so the palette
       and the inspector stay put while a long email is read through. */
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {/* -- the bar ------------------------------------------------------- */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (dirty ? setLeaving(true) : router.push(basePath))}
        >
          <ArrowLeft />
          {target.kind === "broadcast"
            ? "Campaigns"
            : target.kind === "step"
              ? target.automationName
              : "Templates"}
        </Button>

        <span className="h-5 w-px bg-border" />

        {target.kind !== "template" ? (
          /* A broadcast has no name of its own — the subject is what it is
             called everywhere it is listed, so that is what goes here. */
          <Input
            value={details.subject}
            onChange={(event) =>
              setDetails((current) => ({ ...current, subject: event.target.value }))
            }
            placeholder="Subject line"
            aria-label="Subject"
            readOnly={locked}
            className="h-8 w-72 border-transparent bg-transparent px-2 font-medium text-[14px] shadow-none hover:bg-muted focus:border-border focus:bg-card"
          />
        ) : (
          <Input
            value={details.name}
            onChange={(event) => {
              const name = event.target.value;
              setDetails((current) => ({
                ...current,
                name,
                // The slug follows the name until somebody gives it one of its
                // own, and never again: a program is holding onto it.
                slug:
                  template || current.slug !== slugify(current.name) ? current.slug : slugify(name),
              }));
            }}
            placeholder="Untitled template"
            aria-label="Template name"
            className="h-8 w-60 border-transparent bg-transparent px-2 font-medium text-[14px] shadow-none hover:bg-muted focus:border-border focus:bg-card"
          />
        )}

        {target.kind === "broadcast" && (
          <span className="truncate text-[12.5px] text-muted-foreground">
            to{" "}
            {target.campaign.lists.find((entry) => entry.id === details.listId)?.name ?? "a list"}
            {locked && " · already sent"}
          </span>
        )}

        {target.kind === "step" && (
          <span className="truncate text-[12.5px] text-muted-foreground">in a flow</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {pane === "design" && !previewing && !handwritten && (
            <span className="flex items-center gap-0.5">
              <IconButton label="Undo" size="sm" onClick={undo} disabled={!canUndo}>
                <Undo2 className="size-4" />
              </IconButton>
              <IconButton label="Redo" size="sm" onClick={redo} disabled={!canRedo}>
                <Redo2 className="size-4" />
              </IconButton>
            </span>
          )}

          <Tabs value={pane} onValueChange={(value) => setPane(value as "design" | "html")}>
            <TabsList variant="segmented">
              <TabsTrigger value="design" disabled={handwritten}>
                Builder
              </TabsTrigger>
              <TabsTrigger value="html">HTML</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant={previewing ? "solid" : "outline"}
            size="sm"
            pill
            onClick={() => setPreviewing((current) => !current)}
          >
            <Eye />
            Preview
          </Button>

          <Button variant="outline" size="sm" pill onClick={() => setTesting(true)}>
            <Send />
            Test send
          </Button>

          {target.kind === "template" && template && (
            <IconButton label="Delete template" size="sm" onClick={() => setRemoving(true)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}

          <Button variant="solid" size="sm" pill onClick={save} disabled={busy || !dirty || locked}>
            {busy
              ? "Saving…"
              : target.kind === "template" && !template
                ? "Create"
                : dirty
                  ? "Save"
                  : "Saved"}
          </Button>
        </div>
      </header>

      {/* -- palette, canvas, inspector ------------------------------------ */}
      <div className="flex min-h-0 flex-1">
        {pane === "design" && !previewing && (
          <aside className="flex w-[188px] shrink-0 flex-col border-border border-r bg-card">
            {/* Parts on one side, whole arrangements on the other. A palette
                of fourteen buttons is a box of parts, and most people are
                looking for a section rather than a block. */}
            <div className="flex shrink-0 gap-1 border-border border-b p-2">
              <PalettePick
                active={shelf === "blocks"}
                onClick={() => setShelf("blocks")}
                label="Blocks"
              />
              <PalettePick
                active={shelf === "sections"}
                onClick={() => setShelf("sections")}
                label="Sections"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-3">
              {shelf === "sections" ? (
                <div className="space-y-1.5 px-2">
                  {SECTIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => addSection(preset)}
                      className="w-full rounded-lg border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent"
                    >
                      <span className="block rounded-[4px] bg-muted/60 p-2">{preset.sketch}</span>
                      <span className="mt-1.5 block text-[11.5px] text-muted-foreground">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                PALETTE.map((section) => (
                  <div key={section.group} className="mb-3 px-2">
                    <p className="eyebrow mb-1 px-2">{section.group}</p>
                    {section.items.map((item) => (
                      <button
                        key={item.kind}
                        type="button"
                        draggable
                        // Dragged onto the canvas to land where it is dropped, or
                        // clicked to go on the end. Both, because a palette that
                        // only drags is unusable with a keyboard and one that
                        // only clicks makes you move every block you add.
                        onDragStart={(event) => {
                          event.dataTransfer.setData(NEW_BLOCK, item.kind);
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => add(item.kind)}
                        className="flex w-full cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent active:cursor-grabbing"
                      >
                        <item.icon className="size-4 text-muted-foreground" />
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>
        )}

        <div
          className={cn(
            "min-w-0 flex-1 overflow-y-auto",
            pane === "design" && !previewing ? "" : "bg-muted/30 px-6 py-6",
          )}
        >
          {previewing ? (
            <>
              {/* What is being pretended, said out loud and changeable. Every
                  one of these is a real way the same email arrives. */}
              <div className="mx-auto mb-4 flex w-fit items-center gap-1 rounded-full border border-border bg-card p-1">
                <PreviewPick
                  active={previewOn === "desktop"}
                  onClick={() => setPreviewOn("desktop")}
                  icon={<Monitor className="size-3.5" />}
                  label="Desktop"
                />
                <PreviewPick
                  active={previewOn === "mobile"}
                  onClick={() => setPreviewOn("mobile")}
                  icon={<Smartphone className="size-3.5" />}
                  label="Phone"
                />
                <span className="mx-1 h-4 w-px bg-border" />
                <PreviewPick
                  active={previewDark}
                  onClick={() => setPreviewDark((current) => !current)}
                  icon={<Moon className="size-3.5" />}
                  label="Dark client"
                />
              </div>

              <div
                /* As wide as the email is, rather than a fixed guess: a
                   template set to 900 was being shown through a 760 window,
                   which reads as a broken preview rather than a preview of
                   something wide. A phone is the one fixed width there is. */
                className="mx-auto overflow-hidden rounded-xl border border-border bg-card"
                style={{
                  maxWidth:
                    previewOn === "mobile" ? 390 : handwritten ? 760 : design.theme.width + 48,
                }}
              >
                <div className="border-border border-b px-4 py-2.5 text-[13px]">
                  <span className="text-muted-foreground">Subject: </span>
                  {details.subject || <span className="text-muted-foreground">(none)</span>}
                  {/* The second line of an inbox listing, shown where an
                      inbox shows it rather than described in a form. */}
                  {!handwritten && design.preheader?.trim() && (
                    <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                      {design.preheader.trim()}
                    </p>
                  )}
                </div>
                <EmailFrame
                  html={compiled || null}
                  text={handwritten ? (source?.text ?? null) : designToText(design)}
                  imagesAllowed
                  forceDark={previewDark}
                />
              </div>

              <p className="mx-auto mt-3 w-fit max-w-[420px] text-center text-[11.5px] text-muted-foreground">
                {previewOn === "mobile"
                  ? "The frame is narrow, so the email's own phone rules apply: columns stack and anything hidden on phones is gone."
                  : "A browser is not a mail client. Test send is the only way to see what Gmail and Outlook do with it."}
              </p>
            </>
          ) : pane === "html" ? (
            <HtmlPane
              handwritten={handwritten}
              html={handwritten ? html : compiled}
              onChange={setHtml}
              onTakeOver={() => {
                setHtml(compiled);
                setHandwritten(true);
              }}
              onRebuild={() => setConverting(true)}
            />
          ) : (
            <Canvas
              design={design}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setTab("block");
              }}
              onPatch={patch}
              onMove={move}
              onRelocate={relocate}
              onDuplicate={duplicate}
              onRemove={remove}
              onAdd={add}
            />
          )}
        </div>

        {!previewing && (
          <aside className="flex w-[304px] shrink-0 flex-col border-border border-l bg-card">
            <div className="flex shrink-0 border-border border-b p-3">
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as typeof tab)}
                className="w-full"
              >
                <TabsList variant="segmented" className="flex w-full">
                  <TabsTrigger value="block" className="flex-1 justify-center">
                    Block
                  </TabsTrigger>
                  <TabsTrigger value="page" className="flex-1 justify-center">
                    Page
                  </TabsTrigger>
                  <TabsTrigger value="details" className="flex-1 justify-center">
                    Details
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === "block" &&
                (block ? (
                  <Inspector
                    block={block}
                    onPatch={(changes) => patch(block.id, changes)}
                    onStyle={(changes) => style(block.id, changes)}
                  />
                ) : (
                  <p className="p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                    Nothing selected. Click a block on the canvas to edit it, or add one from the
                    left.
                  </p>
                ))}

              {tab === "page" && (
                <PageStyle
                  theme={design.theme}
                  onChange={(changes) =>
                    setDesign((current) => ({
                      ...current,
                      theme: { ...current.theme, ...changes },
                    }))
                  }
                  preheader={design.preheader ?? ""}
                  onPreheader={(preheader) => setDesign((current) => ({ ...current, preheader }))}
                />
              )}

              {tab === "details" &&
                (target.kind === "step" ? (
                  <StepDetails
                    subject={details.subject}
                    onSubject={(subject) => setDetails((current) => ({ ...current, subject }))}
                    mergeFields={target.mergeFields}
                  />
                ) : target.kind === "broadcast" ? (
                  <BroadcastDetails
                    id={target.broadcast.id}
                    details={details}
                    onChange={(changes) => setDetails((current) => ({ ...current, ...changes }))}
                    context={target.campaign}
                    status={target.broadcast.status}
                    followUp={target.broadcast.resendOfId !== null}
                    dirty={dirty}
                    onSave={save}
                    variables={variables}
                  />
                ) : (
                  <DetailsForm
                    details={details}
                    onChange={(changes) => setDetails((current) => ({ ...current, ...changes }))}
                    variables={variables}
                    locked={Boolean(template)}
                  />
                ))}
            </div>
          </aside>
        )}
      </div>

      <TestSend
        open={testing}
        onOpenChange={setTesting}
        subject={details.subject}
        html={compiled}
        text={handwritten ? (source?.text ?? null) : designToText(design)}
      />

      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave without saving?"
        description="There are changes here that have not been saved."
        consequences="They are only in this tab. Leaving loses them."
        confirmLabel="Leave"
        onConfirm={() => router.push(basePath)}
      />

      <ConfirmDialog
        open={converting}
        onOpenChange={setConverting}
        title="Build this one instead?"
        description="This template is hand-written HTML."
        consequences="Nothing reads email HTML back into blocks, so the canvas starts empty and this HTML is replaced the next time you save. Copy it somewhere first if you want it."
        confirmLabel="Start building"
        onConfirm={() => {
          setHandwritten(false);
          setPane("design");
          setConverting(false);
        }}
      />

      <ConfirmDialog
        open={removing && target.kind === "template"}
        onOpenChange={setRemoving}
        title="Delete this template?"
        description={template ? `${template.name} (${template.slug})` : undefined}
        consequences="Any send that names this template starts failing with a 404. Mail already sent from it is unaffected."
        confirmLabel="Delete template"
        onConfirm={async () => {
          if (!template) return;
          await deleteTemplateAction(template.id);
          toast.success("Template deleted");
          router.push(basePath);
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sending one to yourself                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mails the template to one address, through the ordinary send path.
 *
 * The preview is a browser rendering HTML written for mail clients, which is
 * the one thing it cannot tell you about. This is the only way to find out
 * what Gmail does with it, and it goes out through the same code a real send
 * uses, so a refused address or an unverified domain is refused here rather
 * than in front of a list.
 */
function TestSend({
  open,
  onOpenChange,
  subject,
  html,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  html: string;
  text: string | null;
}) {
  const [boxes, setBoxes] = useState<{ id: string; address: string; name: string }[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, submit] = useSubmit();

  useEffect(() => {
    if (!open || boxes) return;
    void sendableMailboxesAction().then((rows) => {
      setBoxes(rows);
      if (rows[0]) setFrom((current) => current || rows[0]!.id);
    });
  }, [open, boxes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Send yourself a copy</DialogTitle>
          <DialogDescription>
            Variables are filled with their own names, so you can see where they land.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="From">
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger>
                <SelectValue placeholder={boxes === null ? "Loading…" : "Pick a mailbox"} />
              </SelectTrigger>
              <SelectContent>
                {(boxes ?? []).map((box) => (
                  <SelectItem key={box.id} value={box.id} className="font-mono text-[12.5px]">
                    {box.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="To">
            <Input
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="you@example.com"
              type="email"
            />
          </Field>

          {boxes !== null && boxes.length === 0 && (
            <Note>There is no mailbox you can send from yet.</Note>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" pill onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="solid"
            pill
            disabled={busy || !from || !to.includes("@")}
            onClick={() =>
              submit(async () => {
                const result = await sendTemplateTestAction({
                  mailboxId: from,
                  to,
                  subject,
                  html,
                  text,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(`Sent to ${to}`);
                onOpenChange(false);
              })
            }
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* The HTML                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the builder compiles to, or the HTML somebody wrote themselves.
 *
 * Read-only in the first case on purpose. An editable copy of generated
 * output is a promise the builder cannot keep: the next change on the canvas
 * overwrites it, and nothing here can read the edit back into blocks.
 */
function HtmlPane({
  handwritten,
  html,
  onChange,
  onTakeOver,
  onRebuild,
}: {
  handwritten: boolean;
  html: string;
  onChange: (value: string) => void;
  onTakeOver: () => void;
  onRebuild: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mx-auto max-w-[900px] space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Note className="min-w-0 flex-1">
          {handwritten
            ? "Written by hand. The builder is switched off for this template."
            : "Compiled from the canvas, and rewritten every time it changes."}
        </Note>

        {handwritten ? (
          <Button variant="outline" size="sm" pill onClick={onRebuild}>
            <Blocks />
            Build it instead
          </Button>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              pill
              onClick={() => {
                void navigator.clipboard.writeText(html);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" pill onClick={onTakeOver}>
              <Code2 />
              Take it over
            </Button>
          </>
        )}
      </div>

      {handwritten ? (
        <CodeEditor value={html} onChange={onChange} minRows={24} />
      ) : (
        <pre className="overflow-x-auto rounded-xl border border-border bg-card p-4 font-mono text-[12px] leading-relaxed">
          {html}
        </pre>
      )}

      {!handwritten && (
        <Note>
          Taking it over copies this HTML into an editor and leaves the builder behind — nothing
          reads email HTML back into blocks, so it is a one-way door.
        </Note>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The canvas                                                                 */
/* -------------------------------------------------------------------------- */

/** One of the things the preview can pretend to be. */
function PreviewPick({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

interface Aim {
  where: Where;
  at: number;
}

function sameWhere(a: Where, b: Where) {
  return a.parentId === b.parentId && a.column === b.column;
}

function Canvas({
  design,
  selected,
  onSelect,
  onPatch,
  onMove,
  onRelocate,
  onDuplicate,
  onRemove,
  onAdd,
}: {
  design: EmailDesign;
  selected: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, changes: Partial<Block>) => void;
  onMove: (id: string, by: number) => void;
  onRelocate: (id: string, to: Where, at: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (kind: BlockKind, at?: number, where?: Where) => void;
}) {
  const theme = design.theme;
  const dragging = useRef<string | null>(null);

  /*
   * Where a drop would land, twice: state so the line is drawn, and a ref so
   * the drop handler reads what the last dragover decided rather than what
   * the render it was created in happened to close over.
   */
  const [aim, setAim] = useState<Aim | null>(null);
  const aimRef = useRef<Aim | null>(null);

  function point(next: Aim | null) {
    aimRef.current = next;
    setAim(next);
  }

  /** One handler for the whole card, because a drop bubbles and the blocks
      are full of inputs and editable regions that would otherwise eat it. */
  function drop(event: React.DragEvent) {
    event.preventDefault();
    const kind = event.dataTransfer.getData(NEW_BLOCK) as BlockKind | "";
    const target = aimRef.current ?? { where: {}, at: design.blocks.length };

    if (kind) onAdd(kind, target.at, target.where);
    else if (dragging.current) onRelocate(dragging.current, target.where, target.at);

    dragging.current = null;
    point(null);
  }

  const shared = {
    theme,
    selected,
    aim,
    dragging,
    onPoint: point,
    onSelect,
    onPatch,
    onMove,
    onDuplicate,
    onRemove,
    onAdd,
  };

  return (
    /* No frame around it. The page colour runs to the edges of the pane and
       the card sits in it at the width it will really be, so what is on
       screen is the email rather than a picture of one. */
    <div className="min-h-full w-full py-8" style={{ backgroundColor: theme.background }}>
      <div>
        {/* The card takes the drop, so a block dragged onto an empty canvas —
            or into the room under the last block — lands rather than bouncing
            back to the palette. */}
        <div
          className="mx-auto overflow-hidden"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = dragging.current === null ? "copy" : "move";
            if (event.target === event.currentTarget) {
              point({ where: {}, at: design.blocks.length });
            }
          }}
          onDragLeave={(event) => {
            if (event.target === event.currentTarget) point(null);
          }}
          onDrop={drop}
          style={{
            width: theme.width,
            maxWidth: "100%",
            backgroundColor: theme.surface,
            borderRadius: theme.radius,
            fontFamily: theme.font,
          }}
        >
          {design.blocks.length === 0 ? (
            <div
              className="px-8 py-16 text-center"
              onDragOver={(event) => {
                event.preventDefault();
                point({ where: {}, at: 0 });
              }}
            >
              <p className="text-[13px]" style={{ color: "#71717a" }}>
                Nothing here yet. Drag a block in from the left, or click one.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {PALETTE[0]!.items.slice(0, 3).map((item) => (
                  <Button
                    key={item.kind}
                    variant="outline"
                    size="sm"
                    pill
                    onClick={() => onAdd(item.kind)}
                  >
                    <item.icon />
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <BlockList blocks={design.blocks} where={{}} {...shared} />
          )}
        </div>
      </div>
    </div>
  );
}

interface ListProps {
  blocks: Block[];
  where: Where;
  theme: EmailTheme;
  selected: string | null;
  aim: Aim | null;
  dragging: React.MutableRefObject<string | null>;
  onPoint: (aim: Aim | null) => void;
  onSelect: (id: string) => void;
  onPatch: (id: string, changes: Partial<Block>) => void;
  onMove: (id: string, by: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (kind: BlockKind, at?: number, where?: Where) => void;
}

/**
 * A run of blocks, in the document or in a column of one.
 *
 * The same component either way, because a column is not a special kind of
 * place — it is the same list somewhere narrower, and anything that can be
 * put in one can be put in the other.
 */
function BlockList(props: ListProps) {
  const { blocks, where, theme, selected, aim, dragging, onPoint } = props;
  const pointing = aim && sameWhere(aim.where, where) ? aim.at : null;

  return (
    <>
      {blocks.map((block, index) => (
        <div
          key={block.id}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            dragging.current = block.id;
          }}
          onDragEnd={() => {
            dragging.current = null;
            onPoint(null);
          }}
          onDragOver={(event) => {
            // Only aims. The card does the dropping.
            event.preventDefault();
            event.stopPropagation();
            const box = event.currentTarget.getBoundingClientRect();
            onPoint({
              where,
              at: event.clientY < box.top + box.height / 2 ? index : index + 1,
            });
          }}
          onFocus={(event) => {
            event.stopPropagation();
            props.onSelect(block.id);
          }}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(block.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSelect(block.id);
          }}
          // Not a button: it is draggable and holds inputs of its own.
          // Focus selects it, so the keyboard still reaches every block.
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a canvas block is selectable by design
          tabIndex={0}
          className={cn(
            "group relative cursor-default outline-none",
            "before:pointer-events-none before:absolute before:inset-0 before:z-10 before:transition-colors",
            selected === block.id
              ? "before:border-2 before:border-primary"
              : "hover:before:border hover:before:border-primary/40",
          )}
        >
          {pointing === index && <DropLine where="top" />}
          {pointing === index + 1 && <DropLine where="bottom" />}

          <BlockView
            block={block}
            theme={theme}
            onPatch={(changes) => props.onPatch(block.id, changes)}
            column={(column) => (
              <BlockList
                {...props}
                blocks={column.blocks}
                where={{ parentId: block.id, column: column.index }}
              />
            )}
          />

          {/* The name of the thing you are about to change, where you are
              about to change it. */}
          <span
            className={cn(
              "-top-px pointer-events-none absolute left-0 z-20 rounded-br-md bg-primary px-1.5 py-0.5 font-medium text-[10px] text-primary-foreground uppercase tracking-wide",
              selected === block.id ? "block" : "hidden",
            )}
          >
            {LABELS[block.type]}
          </span>

          {/* A block that will not be there is still drawn, because it is
              still being edited. It says which half of the world misses it. */}
          {block.hideOn && (
            <span className="pointer-events-none absolute right-1.5 bottom-1.5 z-20 flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground group-focus-within:hidden group-hover:hidden">
              {block.hideOn === "mobile" ? (
                <Monitor className="size-3" />
              ) : (
                <Smartphone className="size-3" />
              )}
              {block.hideOn === "mobile" ? "Desktop only" : "Phone only"}
            </span>
          )}

          <div className="absolute top-1.5 right-1.5 z-20 hidden items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm group-focus-within:flex group-hover:flex">
            <span className="flex size-6 cursor-grab items-center justify-center text-muted-foreground">
              <GripVertical className="size-3.5" />
            </span>
            <Handle label="Move up" onClick={() => props.onMove(block.id, -1)}>
              <ChevronUp className="size-3.5" />
            </Handle>
            <Handle label="Move down" onClick={() => props.onMove(block.id, 1)}>
              <ChevronDown className="size-3.5" />
            </Handle>
            <Handle label="Duplicate" onClick={() => props.onDuplicate(block.id)}>
              <Copy className="size-3.5" />
            </Handle>
            <Handle label="Delete" onClick={() => props.onRemove(block.id)} destructive>
              <Trash2 className="size-3.5" />
            </Handle>
          </div>
        </div>
      ))}

      {/* The room after the last block, which is where a drop aimed at the
          end of a list lands. */}
      <div
        className="relative"
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onPoint({ where, at: blocks.length });
        }}
        style={where.parentId ? { minHeight: 28 } : undefined}
      >
        {pointing === blocks.length && <DropLine where="bottom" />}
        {where.parentId && blocks.length === 0 && (
          <div
            className="flex h-16 items-center justify-center rounded-md border border-dashed text-[11.5px]"
            style={{ borderColor: "#d4d4d8", color: "#a1a1aa" }}
          >
            Drop a block here
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Where a dropped block will land.
 *
 * Thick enough to be read at a glance while something is moving under the
 * cursor: a hairline is a thing you have to look for, and by then you have
 * already let go.
 */
function DropLine({ where }: { where: "top" | "bottom" }) {
  return (
    <span
      className={cn(
        // Inside the block's own bounds, not straddling the join: a line that
        // hangs over the edge sits on top of the block above it, which reads
        // as the wrong block being marked.
        "pointer-events-none absolute inset-x-0 z-30 h-[3px] bg-primary",
        where === "top" ? "top-0" : "bottom-0",
      )}
    />
  );
}

function Handle({
  label,
  onClick,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className={cn(
            "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            destructive && "hover:bg-destructive/10 hover:text-destructive",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * What a block with nothing in it yet looks like.
 *
 * Drawn in the email's own colours rather than the app's: the card is white
 * in either theme, and an app token for muted text is pale grey on white.
 */
const PLACEHOLDER =
  "flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed text-[12.5px]";
const PLACEHOLDER_STYLE = { borderColor: "#d4d4d8", color: "#a1a1aa" } as const;

/** The padding, background and border a block's cell is drawn with. */
function boxOf(block: Block): React.CSSProperties {
  const style = block.style ?? {};
  const padding = style.padding ?? [8, 32, 8, 32];
  return {
    padding: padding.map((value) => `${value}px`).join(" "),
    backgroundColor: style.background,
    border:
      style.border && style.border.width > 0
        ? `${style.border.width}px solid ${style.border.color}`
        : undefined,
    borderRadius: style.border?.radius ? `${style.border.radius}px` : undefined,
  };
}

/** The type rules a block's copy is drawn with. */
function typeOf(
  block: Block,
  theme: EmailTheme,
  fallback: { size: number; weight: number },
): React.CSSProperties {
  const style = block.style ?? {};
  return {
    fontSize: style.fontSize ?? fallback.size,
    lineHeight: (style.lineHeight ?? 155) / 100,
    fontWeight: style.weight ?? fallback.weight,
    color: style.color ?? theme.text,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
  };
}

/** One block, drawn about the way the compiled email will draw it. */
function BlockView({
  block,
  theme,
  onPatch,
  column,
}: {
  block: Block;
  theme: EmailTheme;
  onPatch: (changes: Partial<Block>) => void;
  /** How to draw what is inside a column. Only the columns block uses it. */
  column?: (column: { blocks: Block[]; index: number }) => React.ReactNode;
}) {
  const box = boxOf(block);
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  switch (block.type) {
    case "heading":
      return (
        <div style={box}>
          {/* Edited where it sits: retyping a headline in a side panel and
              watching it appear somewhere else is the thing people dislike
              about builders. */}
          <input
            value={block.text}
            onChange={(event) => onPatch({ text: event.target.value })}
            onClick={stop}
            className="w-full border-0 bg-transparent p-0 outline-none"
            style={{
              ...typeOf(block, theme, HEADING_DEFAULTS[block.level] ?? HEADING_DEFAULTS[2]),
              textAlign: block.align,
            }}
          />
        </div>
      );

    case "text":
      return (
        <div style={box} onClick={stop} onKeyDown={stop}>
          <div
            style={{ ...typeOf(block, theme, { size: 15, weight: 400 }), textAlign: block.align }}
            className="[&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
          >
            <RichEditor
              value={block.html}
              onChange={(html) => onPatch({ html })}
              placeholder="Write something…"
              className="-mx-2"
            />
          </div>
        </div>
      );

    case "button":
      return (
        <div style={{ ...box, textAlign: block.align }}>
          <span
            style={{
              display: block.fullWidth ? "block" : "inline-block",
              padding: "12px 22px",
              backgroundColor: block.fill,
              borderRadius: block.radius,
              ...typeOf(block, theme, { size: 15, weight: 600 }),
              color: block.style?.color ?? "#ffffff",
            }}
          >
            {block.text || "Button"}
          </span>
        </div>
      );

    case "image":
      return (
        <div style={{ ...box, textAlign: block.align }}>
          {block.src ? (
            // The canvas mirrors an email, where next/image does not exist.
            <img
              src={block.src}
              alt={block.alt}
              style={{
                width: `${block.width}%`,
                borderRadius: block.radius,
                display: "inline-block",
                height: "auto",
              }}
            />
          ) : (
            <div className={PLACEHOLDER} style={PLACEHOLDER_STYLE}>
              <ImageIcon className="size-4" />
              Add an image URL on the right
            </div>
          )}
        </div>
      );

    case "divider":
      return (
        <div style={box}>
          <div style={{ borderTop: `${block.thickness}px solid ${block.color}` }} />
        </div>
      );

    case "spacer":
      return (
        <div
          className="flex items-center justify-center border-y border-dashed text-[10.5px]"
          style={{ height: block.size, borderColor: "#e4e4e7", color: "#a1a1aa" }}
        >
          {block.size}px
        </div>
      );

    case "columns":
      return (
        <div style={{ ...box, display: "flex", gap: block.gap }}>
          {block.columns.map((entry, index) => (
            <div key={`${block.id}-${index}`} className="relative min-w-0 flex-1">
              {column?.({ blocks: entry.blocks, index })}
            </div>
          ))}
        </div>
      );

    case "quote":
      return (
        <div style={box} onClick={stop} onKeyDown={stop}>
          <div
            style={{
              borderLeft: `3px solid ${block.accent}`,
              paddingLeft: 14,
              fontStyle: "italic",
            }}
          >
            <div style={typeOf(block, theme, { size: 15, weight: 400 })}>
              <RichEditor
                value={block.html}
                onChange={(html) => onPatch({ html })}
                placeholder="Something worth repeating…"
                className="-mx-2"
              />
            </div>
          </div>
        </div>
      );

    case "code":
      return (
        <div style={box}>
          <pre
            className="overflow-x-auto rounded-lg px-3.5 py-3 font-mono text-[13px]"
            style={{ backgroundColor: "#f4f4f5", color: "#18181b" }}
          >
            {block.code}
          </pre>
        </div>
      );

    case "youtube": {
      const id = youtubeId(block.url);
      return (
        <div style={{ ...box, textAlign: block.align }}>
          {id ? (
            <>
              <span className="relative inline-block" style={{ width: `${block.width}%` }}>
                {/* The canvas mirrors an email, where next/image does not exist. */}
                <img
                  src={youtubeThumb(id)}
                  alt={block.caption}
                  style={{ width: "100%", borderRadius: block.radius, display: "block" }}
                />
                {block.playButton && (
                  <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex h-12 w-[68px] items-center justify-center rounded-xl bg-[#ff0000] text-[22px] text-white">
                    ▶
                  </span>
                )}
              </span>
              {block.caption && (
                <div style={{ ...typeOf(block, theme, { size: 13, weight: 500 }), paddingTop: 8 }}>
                  {block.caption}
                </div>
              )}
            </>
          ) : (
            <div className={PLACEHOLDER} style={PLACEHOLDER_STYLE}>
              <Youtube className="size-4" />
              Paste a YouTube link on the right
            </div>
          )}
        </div>
      );
    }

    case "table":
      return (
        <div style={box} onClick={stop} onKeyDown={stop}>
          <table
            className="w-full border-collapse"
            style={typeOf(block, theme, { size: 14, weight: 400 })}
          >
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${block.id}-r${rowIndex}`}>
                  {row.map((value, cellIndex) => (
                    <td
                      key={`${block.id}-r${rowIndex}c${cellIndex}`}
                      style={{
                        border: `1px solid ${block.borderColor}`,
                        padding: "8px 10px",
                        backgroundColor:
                          block.header && rowIndex === 0 ? block.headerBackground : undefined,
                        fontWeight: block.header && rowIndex === 0 ? 600 : undefined,
                      }}
                    >
                      {/* Typed in place: a table edited through a side panel
                          is a spreadsheet with the numbers somewhere else. */}
                      <input
                        value={value}
                        onChange={(event) =>
                          onPatch({
                            rows: block.rows.map((entry, at) =>
                              at === rowIndex
                                ? entry.map((cell, index) =>
                                    index === cellIndex ? event.target.value : cell,
                                  )
                                : entry,
                            ),
                          })
                        }
                        className="w-full border-0 bg-transparent p-0 outline-none"
                        style={{ font: "inherit", color: "inherit" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "social":
      return (
        <div style={{ ...box, textAlign: block.align, fontSize: 0, lineHeight: 0 }}>
          {block.links.map((link, index) => (
            // The same files the email will ask for, at a relative address,
            // which the page this is drawn in supplies.
            <img
              key={`${block.id}-${index}`}
              src={networkIcon(link.network, block.tone ?? "dark")}
              alt={networkLabel(link.network)}
              title={networkLabel(link.network)}
              style={{
                display: "inline-block",
                margin: "0 6px",
                width: block.size ?? 24,
                height: block.size ?? 24,
              }}
            />
          ))}
        </div>
      );

    case "footer":
      return (
        <div style={{ ...box, textAlign: block.align }}>
          <div style={typeOf(block, theme, { size: 12, weight: 400 })}>
            {block.text}
            <br />
            <span className="underline">{block.unsubscribeLabel}</span>
          </div>
        </div>
      );

    case "list":
      return (
        <div style={box} onClick={stop} onKeyDown={stop}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {block.items.map((item, index) => (
                <tr key={`${block.id}-${index}`}>
                  <td
                    valign="top"
                    style={{
                      width: 24,
                      paddingBottom: index === block.items.length - 1 ? 0 : block.gap,
                      ...typeOf(block, theme, { size: 15, weight: 400 }),
                    }}
                  >
                    {block.ordered ? `${index + 1}.` : block.marker || "\u2022"}
                  </td>
                  <td
                    valign="top"
                    style={{
                      paddingBottom: index === block.items.length - 1 ? 0 : block.gap,
                      ...typeOf(block, theme, { size: 15, weight: 400 }),
                    }}
                  >
                    {/* The same editor the text block uses, so an item is
                        typed where it will appear rather than in a field on
                        the right. */}
                    <RichEditor
                      value={item}
                      onChange={(html) =>
                        onPatch({
                          items: block.items.map((entry, at) => (at === index ? html : entry)),
                        })
                      }
                      placeholder="Another thing…"
                      className="-mx-2"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "callout":
      return (
        <div style={box} onClick={stop} onKeyDown={stop}>
          <div
            style={{
              background: block.style?.background ?? "#f4f4f5",
              borderLeft: block.accent ? `4px solid ${block.accent}` : undefined,
              borderRadius: block.style?.border?.radius ?? 8,
              padding: "14px 16px",
              display: "flex",
              gap: 10,
              textAlign: block.align,
            }}
          >
            {block.icon ? <span style={{ fontSize: 16 }}>{block.icon}</span> : null}
            <div style={{ flex: 1, ...typeOf(block, theme, { size: 15, weight: 400 }) }}>
              <RichEditor
                value={block.html}
                onChange={(html) => onPatch({ html })}
                placeholder="What is worth knowing…"
                className="-mx-2"
              />
            </div>
          </div>
        </div>
      );

    case "stat":
      return (
        <div style={box}>
          <div style={{ display: "flex", width: "100%" }}>
            {block.items.map((item, index) => (
              <div
                key={`${block.id}-${index}`}
                style={{ flex: 1, padding: "0 6px", textAlign: block.align }}
              >
                <div
                  style={{
                    ...typeOf(block, theme, { size: block.valueSize, weight: 700 }),
                    color: block.valueColor,
                    lineHeight: 1.15,
                  }}
                >
                  {item.value}
                </div>
                <div
                  style={{
                    fontFamily: theme.font,
                    fontSize: 13,
                    color: block.style?.color ?? "#71717a",
                    paddingTop: 4,
                  }}
                >
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "menu":
      return (
        <div style={{ ...box, textAlign: block.align }}>
          <span style={typeOf(block, theme, { size: 13, weight: 500 })}>
            {block.links.map((link, index) => (
              <span key={`${block.id}-${index}`}>
                {index > 0 && (
                  <span style={{ padding: "0 8px", color: "#a1a1aa" }}>
                    {block.separator || "\u00b7"}
                  </span>
                )}
                <span style={{ color: block.style?.color ?? theme.link }}>{link.label}</span>
              </span>
            ))}
          </span>
        </div>
      );

    case "gallery": {
      const shown = block.images.filter((image) => image.src);
      const perRow = Math.min(4, Math.max(2, Math.round(block.perRow)));
      return (
        <div style={box}>
          {shown.length === 0 ? (
            <div className={PLACEHOLDER} style={PLACEHOLDER_STYLE}>
              <LayoutGrid className="size-4" />
              Add pictures on the right
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${perRow}, 1fr)`,
                gap: block.gap,
              }}
            >
              {shown.map((image, index) => (
                <img
                  key={`${block.id}-${index}`}
                  src={image.src}
                  alt={image.alt}
                  style={{ width: "100%", display: "block", borderRadius: block.radius }}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    case "html":
      return (
        <div style={box}>
          <div
            className="rounded-lg border border-dashed px-3 py-2 font-mono text-[11.5px]"
            style={{ borderColor: "#d4d4d8", backgroundColor: "#fafafa", color: "#71717a" }}
          >
            Raw HTML — shown as written in Preview
          </div>
        </div>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* The inspector                                                              */
/* -------------------------------------------------------------------------- */

/** A titled group of controls, closed until it is wanted. */
function Section({
  title,
  children,
  open = true,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  const [shown, setShown] = useState(open);

  return (
    <div className="border-border border-b">
      <button
        type="button"
        onClick={() => setShown((current) => !current)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-[12.5px] font-medium hover:bg-accent/50"
      >
        {title}
        {shown ? (
          <Minus className="size-3.5 text-muted-foreground" />
        ) : (
          <Plus className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {shown && <div className="space-y-2 px-4 pt-0.5 pb-3.5">{children}</div>}
    </div>
  );
}

/** More rows, or fewer, keeping what is already typed. */
function resize(rows: string[][], count: number): string[][] {
  const width = rows[0]?.length ?? 2;
  return Array.from(
    { length: Math.max(1, count) },
    (_, index) => rows[index] ?? Array.from({ length: width }, () => ""),
  );
}

/** Label on the left, control on the right — the shape of every row here. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[86px] shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * What can be written into a subject or a body, and copied with one click.
 *
 * Merge fields are invisible otherwise: a field exists because a CSV had a
 * column named after it, and nobody is going to guess that `{{plan}}` works
 * before they have ever seen it written down. The two that are always there
 * come first, then whatever the people on this list actually carry.
 */
function MergeFields({ fields }: { fields: string[] }) {
  const all = [
    "name",
    "address",
    ...fields.filter((name) => {
      const key = name.toLowerCase().replace(/[\s_-]/g, "");
      return key !== "name" && key !== "address";
    }),
  ];

  return (
    <Row label="Merge in">
      <div className="flex flex-wrap gap-1">
        {all.map((name) => (
          <button
            key={name}
            type="button"
            title={`Copy {{${name}}}`}
            className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => {
              navigator.clipboard
                .writeText(`{{${name}}}`)
                .then(() => toast.success(`{{${name}}} copied`))
                .catch(() => toast.error("That could not be copied"));
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Empty for somebody becomes nothing. Write{" "}
        <code className="font-mono">{"{{plan|free}}"}</code> to say something else instead.
      </p>
    </Row>
  );
}

/** Pixels of travel per step. Low enough to aim, high enough not to jitter. */
const SCRUB = 3;

/** Movement under this is a click that wobbled, not a drag. */
const SLOP = 3;

/**
 * A number, typed or dragged.
 *
 * Dragging sideways over the box changes it, the way every drawing program
 * does it, because most of these are being felt out rather than known: the
 * answer to "how much padding" is however much looks right, and finding that
 * by typing 12, tabbing, looking, typing 16 is the slow way round.
 *
 * A click still puts the cursor in it, and once it is focused the drag stops
 * happening at all, so selecting the digits to retype them works as it
 * always did.
 */
function NumberField({
  value,
  onChange,
  unit = "px",
  placeholder,
  prefix,
  label,
  min,
  max,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  unit?: string;
  placeholder?: string;
  /** A letter inside the box, for fields that need saying which they are. */
  prefix?: string;
  /** What a screen reader calls it, when the box is the only label there is. */
  label?: string;
  /** Limits, applied to what is dragged as well as to what is typed. */
  min?: number;
  max?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  function hold(next: number) {
    if (min !== undefined && next < min) return min;
    if (max !== undefined && next > max) return max;
    return next;
  }

  return (
    <div
      className={cn("relative touch-none", !scrubbing && "cursor-ew-resize")}
      onPointerDown={(event) => {
        // Only the left button, and never once somebody is typing in it.
        if (event.button !== 0 || document.activeElement === input.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, from: value ?? 0, moved: false };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;

        const travelled = event.clientX - start.x;
        if (!start.moved && Math.abs(travelled) < SLOP) return;
        if (!start.moved) {
          start.moved = true;
          setScrubbing(true);
        }

        // Shift moves in tens, for the fields where one pixel at a time is a
        // long way from 0 to 200.
        const step = event.shiftKey ? 10 : 1;
        onChange(hold(start.from + Math.round(travelled / SCRUB) * step));
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        drag.current = null;
        setScrubbing(false);
        event.currentTarget.releasePointerCapture(event.pointerId);

        // A press that went nowhere was a click. The focus it was denied at
        // the start is given back here, with the digits selected to retype.
        if (start && !start.moved) {
          input.current?.focus();
          input.current?.select();
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setScrubbing(false);
      }}
    >
      {prefix && (
        <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 font-medium text-[11px] text-muted-foreground">
          {prefix}
        </span>
      )}
      <Input
        ref={input}
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        aria-label={label}
        min={min}
        max={max}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : hold(Number(event.target.value)))
        }
        className={cn(
          "h-8 pr-8 text-[12.5px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
          prefix && "pl-6",
          !scrubbing && "cursor-ew-resize focus:cursor-text",
        )}
      />
      <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 text-[11px] text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

function Swatch({
  value,
  onChange,
  fallback = "#000000",
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  fallback?: string;
}) {
  return <ColorInput value={value} onChange={onChange} fallback={fallback} align="end" />;
}

function AlignPicker({ value, onChange }: { value: Align; onChange: (value: Align) => void }) {
  const options: { value: Align; icon: typeof AlignLeft; label: string }[] = [
    { value: "left", icon: AlignLeft, label: "Left" },
    { value: "center", icon: AlignCenter, label: "Centre" },
    { value: "right", icon: AlignRight, label: "Right" },
  ];

  return (
    <div className="flex h-8 gap-0.5 rounded-full bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex flex-1 items-center justify-center rounded-full transition-colors",
            value === option.value
              ? "bg-card text-foreground shadow-raise"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

/** In the order CSS says them, which is the order they are stored in. */
const SIDES = [
  { name: "Top", letter: "T" },
  { name: "Right", letter: "R" },
  { name: "Bottom", letter: "B" },
  { name: "Left", letter: "L" },
] as const;

/**
 * Padding, either as one number or as four.
 *
 * Linked by default because that is what most blocks want, and because four
 * boxes where one would do is how an inspector starts feeling like a form.
 *
 * Opened up, the four are laid out where they are — top above, left and right
 * either side, bottom below — rather than in a grid with a caption saying
 * which order they are in. A caption is a thing you read once and then guess
 * at every time after.
 */
function PaddingField({
  value,
  onChange,
}: {
  value: Padding | undefined;
  onChange: (value: Padding) => void;
}) {
  const padding = value ?? [0, 32, 16, 32];
  const same = padding.every((entry) => entry === padding[0]);
  const [linked, setLinked] = useState(same);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-[86px] shrink-0 text-[12px] text-muted-foreground">Padding</span>
        <div className="min-w-0 flex-1">
          {linked && (
            <NumberField
              value={padding[0]}
              label="Padding on every side"
              onChange={(entry) => onChange([entry ?? 0, entry ?? 0, entry ?? 0, entry ?? 0])}
            />
          )}
        </div>
        <button
          type="button"
          aria-label={linked ? "Set each side" : "Set every side at once"}
          aria-pressed={!linked}
          onClick={() => setLinked((current) => !current)}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border transition-colors",
            linked ? "text-muted-foreground hover:bg-accent" : "bg-accent text-foreground",
          )}
        >
          <CornerDownRight className="size-3.5" />
        </button>
      </div>
      {!linked && (
        <div className="space-y-1.5">
          <div className="px-[25%]">
            <Side index={0} padding={padding} onChange={onChange} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Side index={3} padding={padding} onChange={onChange} />
            <Side index={1} padding={padding} onChange={onChange} />
          </div>
          <div className="px-[25%]">
            <Side index={2} padding={padding} onChange={onChange} />
          </div>
        </div>
      )}
    </div>
  );
}

/** One side of the padding cross. */
function Side({
  index,
  padding,
  onChange,
}: {
  index: number;
  padding: Padding;
  onChange: (value: Padding) => void;
}) {
  const side = SIDES[index]!;
  return (
    <NumberField
      value={padding[index]}
      prefix={side.letter}
      label={`${side.name} padding`}
      min={0}
      max={200}
      onChange={(entry) => {
        const next = [...padding] as Padding;
        next[index] = entry ?? 0;
        onChange(next);
      }}
    />
  );
}

function Inspector({
  block,
  onPatch,
  onStyle,
}: {
  block: Block;
  onPatch: (changes: Partial<Block>) => void;
  onStyle: (changes: Partial<BlockStyle>) => void;
}) {
  const style = block.style ?? {};
  const [picking, setPicking] = useState(false);

  /** Every block gets these; only the content section differs. */
  const shared = (
    <>
      <Section title="Typography" open={false}>
        <Row label="Colour">
          <Swatch value={style.color} onChange={(color) => onStyle({ color })} />
        </Row>
        <Row label="Font size">
          <NumberField
            value={style.fontSize}
            placeholder="auto"
            onChange={(fontSize) => onStyle({ fontSize })}
          />
        </Row>
        <Row label="Line height">
          <NumberField
            value={style.lineHeight}
            unit="%"
            placeholder="155"
            onChange={(lineHeight) => onStyle({ lineHeight })}
          />
        </Row>
        <Row label="Letter space">
          <NumberField
            value={style.letterSpacing}
            placeholder="0"
            onChange={(letterSpacing) => onStyle({ letterSpacing })}
          />
        </Row>
        <Row label="Weight">
          <Select
            value={String(style.weight ?? "")}
            onValueChange={(value) => onStyle({ weight: value ? Number(value) : undefined })}
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="400">Regular</SelectItem>
              <SelectItem value="500">Medium</SelectItem>
              <SelectItem value="600">Semibold</SelectItem>
              <SelectItem value="700">Bold</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section title="Spacing" open={false}>
        <PaddingField value={style.padding} onChange={(padding) => onStyle({ padding })} />
      </Section>

      <Section title="Background & border" open={false}>
        <Row label="Background">
          <Swatch
            value={style.background}
            fallback="transparent"
            onChange={(background) => onStyle({ background })}
          />
        </Row>
        <Row label="Border">
          <NumberField
            value={style.border?.width}
            placeholder="0"
            onChange={(width) =>
              onStyle({
                border: { color: "#e4e4e7", radius: 0, ...style.border, width: width ?? 0 },
              })
            }
          />
        </Row>
        <Row label="Border colour">
          <Swatch
            value={style.border?.color}
            fallback="#e4e4e7"
            onChange={(color) =>
              onStyle({ border: { width: 1, radius: 0, ...style.border, color } })
            }
          />
        </Row>
        <Row label="Corners">
          <NumberField
            value={style.border?.radius}
            placeholder="0"
            onChange={(radius) =>
              onStyle({
                border: { width: 0, color: "#e4e4e7", ...style.border, radius: radius ?? 0 },
              })
            }
          />
        </Row>
      </Section>

      <Section title="Visibility" open={false}>
        <Row label="Show on">
          <Select
            value={block.hideOn ?? "both"}
            onValueChange={(value) =>
              onPatch({
                hideOn: value === "both" ? undefined : (value as "mobile" | "desktop"),
              } as Partial<Block>)
            }
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Everything</SelectItem>
              <SelectItem value="mobile">Desktop only</SelectItem>
              <SelectItem value="desktop">Phone only</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Note>
          A media query does the hiding, and Outlook has none — it shows whatever a desktop would
          have seen. Use this for a wide picture a phone has no room for, not for anything the
          message needs.
        </Note>
      </Section>
    </>
  );

  return (
    <div>
      <p className="px-4 pt-3 pb-1 font-medium text-[13px]">{LABELS[block.type]}</p>

      <Section title="Content">
        {block.type === "heading" && (
          <>
            <Row label="Text">
              <Input
                value={block.text}
                onChange={(event) => onPatch({ text: event.target.value })}
                className="h-8 text-[12.5px]"
              />
            </Row>
            <Row label="Level">
              <Select
                value={String(block.level)}
                onValueChange={(value) => onPatch({ level: Number(value) as 1 | 2 | 3 })}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Title</SelectItem>
                  <SelectItem value="2">Heading</SelectItem>
                  <SelectItem value="3">Subheading</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
          </>
        )}

        {block.type === "text" && (
          <>
            <Note>Edit the words on the canvas — the toolbar there has bold, links and lists.</Note>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
          </>
        )}

        {block.type === "button" && (
          <>
            <Row label="Label">
              <Input
                value={block.text}
                onChange={(event) => onPatch({ text: event.target.value })}
                className="h-8 text-[12.5px]"
              />
            </Row>
            <Row label="Link">
              <Input
                value={block.href}
                onChange={(event) => onPatch({ href: event.target.value })}
                placeholder="https:// or {{ url }}"
                className="h-8 font-mono text-[12px]"
              />
            </Row>
            <Row label="Fill">
              <Swatch value={block.fill} onChange={(fill) => onPatch({ fill })} />
            </Row>
            <Row label="Corners">
              <NumberField
                value={block.radius}
                onChange={(radius) => onPatch({ radius: radius ?? 0 })}
              />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
            <Row label="Full width">
              <input
                type="checkbox"
                checked={block.fullWidth}
                onChange={(event) => onPatch({ fullWidth: event.target.checked })}
                className="size-4 accent-primary"
              />
            </Row>
          </>
        )}

        {block.type === "image" && (
          <>
            <Row label="Picture">
              <Button
                variant="outline"
                size="sm"
                pill
                className="w-full"
                onClick={() => setPicking(true)}
              >
                <ImageIcon />
                {block.src ? "Change" : "Choose from media"}
              </Button>
            </Row>
            <Row label="URL">
              <Input
                value={block.src}
                onChange={(event) => onPatch({ src: event.target.value })}
                placeholder="https:// or choose above"
                className="h-8 font-mono text-[12px]"
              />
            </Row>
            <MediaPicker
              open={picking}
              onOpenChange={setPicking}
              onPick={(item) =>
                onPatch({
                  src: item.url,
                  // A name is a better starting point than nothing, and it is
                  // what somebody would have typed for a logo or a header.
                  alt: block.alt || item.filename.replace(/\.[^.]+$/, ""),
                })
              }
            />
            <Row label="Alt text">
              <Input
                value={block.alt}
                onChange={(event) => onPatch({ alt: event.target.value })}
                className="h-8 text-[12.5px]"
              />
            </Row>
            <Row label="Links to">
              <Input
                value={block.href}
                onChange={(event) => onPatch({ href: event.target.value })}
                placeholder="optional"
                className="h-8 font-mono text-[12px]"
              />
            </Row>
            <Row label="Width">
              <NumberField
                value={block.width}
                unit="%"
                onChange={(width) => onPatch({ width: width ?? 100 })}
              />
            </Row>
            <Row label="Corners">
              <NumberField
                value={block.radius}
                onChange={(radius) => onPatch({ radius: radius ?? 0 })}
              />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
            <Note>Hosted somewhere public — a mail client cannot see your disk.</Note>
          </>
        )}

        {block.type === "divider" && (
          <>
            <Row label="Colour">
              <Swatch value={block.color} onChange={(color) => onPatch({ color })} />
            </Row>
            <Row label="Thickness">
              <NumberField
                value={block.thickness}
                onChange={(thickness) => onPatch({ thickness: thickness ?? 1 })}
              />
            </Row>
          </>
        )}

        {block.type === "spacer" && (
          <Row label="Height">
            <NumberField value={block.size} onChange={(size) => onPatch({ size: size ?? 24 })} />
          </Row>
        )}

        {block.type === "columns" && (
          <>
            <Row label="Columns">
              <Select
                value={String(block.columns.length)}
                onValueChange={(value) => {
                  // Fewer columns keeps the first few as they are. What was in
                  // the ones that go is gone, which is what removing a column
                  // means — and it is one press of undo away from not being.
                  const count = Number(value);
                  const columns = Array.from({ length: count }, (_, index) => ({
                    blocks: block.columns[index]?.blocks ?? [],
                  }));
                  onPatch({ columns });
                }}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">Two</SelectItem>
                  <SelectItem value="3">Three</SelectItem>
                  <SelectItem value="4">Four</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Gap">
              <NumberField value={block.gap} onChange={(gap) => onPatch({ gap: gap ?? 20 })} />
            </Row>
            <Note>
              Drop blocks into each column on the canvas. They stack on a phone in the clients that
              allow it.
            </Note>
          </>
        )}

        {block.type === "quote" && (
          <Row label="Bar colour">
            <Swatch value={block.accent} onChange={(accent) => onPatch({ accent })} />
          </Row>
        )}

        {block.type === "code" && (
          <Textarea
            value={block.code}
            onChange={(event) => onPatch({ code: event.target.value })}
            rows={6}
            className="font-mono text-[12px]"
          />
        )}

        {block.type === "youtube" && (
          <>
            <Row label="Video">
              <Input
                value={block.url}
                onChange={(event) => onPatch({ url: event.target.value })}
                placeholder="youtube.com/watch?v=…"
                className="h-8 font-mono text-[12px]"
              />
            </Row>
            <Row label="Caption">
              <Input
                value={block.caption}
                onChange={(event) => onPatch({ caption: event.target.value })}
                className="h-8 text-[12.5px]"
              />
            </Row>
            <Row label="Width">
              <NumberField
                value={block.width}
                unit="%"
                onChange={(width) => onPatch({ width: width ?? 100 })}
              />
            </Row>
            <Row label="Corners">
              <NumberField
                value={block.radius}
                onChange={(radius) => onPatch({ radius: radius ?? 0 })}
              />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
            <Row label="Play button">
              <input
                type="checkbox"
                checked={block.playButton}
                onChange={(event) => onPatch({ playButton: event.target.checked })}
                className="size-4 accent-primary"
              />
            </Row>
            <Note>
              Nothing plays inside an email — every client strips the embed. What goes out is the
              video's own thumbnail, linked to it. Outlook is shown the thumbnail without the badge,
              because it cannot put one in the right place.
            </Note>
          </>
        )}

        {block.type === "table" && (
          <>
            <Row label="Rows">
              <NumberField
                value={block.rows.length}
                unit=""
                onChange={(count) => onPatch({ rows: resize(block.rows, count ?? 1) })}
              />
            </Row>
            <Row label="Columns">
              <NumberField
                value={block.rows[0]?.length ?? 2}
                unit=""
                onChange={(count) =>
                  onPatch({
                    rows: block.rows.map((row) =>
                      Array.from(
                        { length: Math.max(1, count ?? 1) },
                        (_, index) => row[index] ?? "",
                      ),
                    ),
                  })
                }
              />
            </Row>
            <Row label="Heading row">
              <input
                type="checkbox"
                checked={block.header}
                onChange={(event) => onPatch({ header: event.target.checked })}
                className="size-4 accent-primary"
              />
            </Row>
            <Row label="Heading fill">
              <Swatch
                value={block.headerBackground}
                onChange={(headerBackground) => onPatch({ headerBackground })}
              />
            </Row>
            <Row label="Lines">
              <Swatch
                value={block.borderColor}
                onChange={(borderColor) => onPatch({ borderColor })}
              />
            </Row>
            <Note>Type into the cells on the canvas.</Note>
          </>
        )}

        {block.type === "social" && (
          <>
            {block.links.map((link, index) => (
              <div key={`${block.id}-${index}`} className="flex items-center gap-1.5">
                <Select
                  value={link.network}
                  onValueChange={(network) =>
                    onPatch({
                      links: block.links.map((entry, at) =>
                        at === index ? { ...entry, network: network as Network } : entry,
                      ),
                    })
                  }
                >
                  <SelectTrigger className="h-8 w-[112px] text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NETWORKS.map((entry) => (
                      <SelectItem key={entry.key} value={entry.key}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={link.href}
                  onChange={(event) => {
                    const href = event.target.value;
                    onPatch({
                      links: block.links.map((entry, at) =>
                        at === index
                          ? {
                              // A pasted address usually says which network it
                              // is, so it does not have to be chosen twice.
                              network: networkOf(href) ?? entry.network,
                              href,
                            }
                          : entry,
                      ),
                    });
                  }}
                  placeholder="https://"
                  className="h-8 min-w-0 flex-1 font-mono text-[12px]"
                />
                <IconButton
                  variant="danger"
                  size="sm"
                  label="Remove link"
                  onClick={() =>
                    onPatch({ links: block.links.filter((_entry, at) => at !== index) })
                  }
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              pill
              onClick={() =>
                onPatch({ links: [...block.links, { network: "website" as Network, href: "" }] })
              }
            >
              <Plus />
              Add link
            </Button>
            <Row label="Icons">
              <Select
                value={block.tone ?? "dark"}
                onValueChange={(tone) => onPatch({ tone: tone as "dark" | "light" })}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Size">
              <NumberField value={block.size} onChange={(size) => onPatch({ size: size ?? 24 })} />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
            <Note>
              A picture cannot be recoloured by the email holding it, so there are two sets: dark
              for a light email, light for a dark one.
            </Note>
          </>
        )}

        {block.type === "footer" && (
          <>
            <Textarea
              value={block.text}
              onChange={(event) => onPatch({ text: event.target.value })}
              rows={3}
              className="text-[12.5px]"
            />
            <Row label="Link text">
              <Input
                value={block.unsubscribeLabel}
                onChange={(event) => onPatch({ unsubscribeLabel: event.target.value })}
                className="h-8 text-[12.5px]"
              />
            </Row>
            <Row label="Link">
              <Input
                value={block.unsubscribeHref}
                onChange={(event) => onPatch({ unsubscribeHref: event.target.value })}
                className="h-8 font-mono text-[12px]"
              />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
            <Note>
              Campaigns fill <code className="font-mono">{"{{ unsubscribe_url }}"}</code> in for
              each recipient.
            </Note>
          </>
        )}

        {block.type === "list" && (
          <>
            <Row label="Numbered">
              <input
                type="checkbox"
                checked={block.ordered}
                onChange={(event) => onPatch({ ordered: event.target.checked })}
                className="size-4 accent-primary"
              />
            </Row>
            {!block.ordered && (
              <Row label="Marker">
                <Select value={block.marker} onValueChange={(marker) => onPatch({ marker })}>
                  <SelectTrigger className="h-8 text-[12.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="\u2022">• Dot</SelectItem>
                    <SelectItem value="\u2013">– Dash</SelectItem>
                    <SelectItem value="\u2713">✓ Tick</SelectItem>
                    <SelectItem value="\u2192">→ Arrow</SelectItem>
                    <SelectItem value="\u25aa">▪ Square</SelectItem>
                  </SelectContent>
                </Select>
              </Row>
            )}
            <Row label="Gap">
              <NumberField value={block.gap} onChange={(gap) => onPatch({ gap: gap ?? 8 })} />
            </Row>

            {block.items.map((item, index) => (
              <div key={`${block.id}-i${index}`} className="flex items-center gap-1.5">
                <Input
                  value={item}
                  onChange={(event) =>
                    onPatch({
                      items: block.items.map((entry, at) =>
                        at === index ? event.target.value : entry,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <IconButton
                  variant="danger"
                  label="Remove this item"
                  onClick={() => onPatch({ items: block.items.filter((_, at) => at !== index) })}
                >
                  <Trash2 />
                </IconButton>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onPatch({ items: [...block.items, "Another thing"] })}
            >
              <Plus />
              Add an item
            </Button>
          </>
        )}

        {block.type === "callout" && (
          <>
            <Row label="Stripe">
              <Swatch
                value={block.accent}
                fallback="none"
                onChange={(accent) => onPatch({ accent })}
              />
            </Row>
            <Row label="Icon">
              <Input
                value={block.icon}
                onChange={(event) => onPatch({ icon: event.target.value.slice(0, 4) })}
                placeholder="none"
                className="h-8 text-[12.5px]"
              />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
            {/* An emoji rather than a picture: an icon that is an image is an
                icon most readers never see, because images are blocked. */}
            <Note>
              Type an emoji for the icon, or leave it empty. The fill is under Background.
            </Note>
          </>
        )}

        {block.type === "stat" && (
          <>
            <Row label="Number size">
              <NumberField
                value={block.valueSize}
                onChange={(valueSize) => onPatch({ valueSize: valueSize ?? 30 })}
              />
            </Row>
            <Row label="Number colour">
              <Swatch value={block.valueColor} onChange={(valueColor) => onPatch({ valueColor })} />
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>

            {block.items.map((item, index) => (
              <div key={`${block.id}-s${index}`} className="flex items-center gap-1.5">
                <Input
                  value={item.value}
                  placeholder="1,204"
                  onChange={(event) =>
                    onPatch({
                      items: block.items.map((entry, at) =>
                        at === index ? { ...entry, value: event.target.value } : entry,
                      ),
                    })
                  }
                  className="h-8 w-20 text-[12.5px]"
                />
                <Input
                  value={item.label}
                  placeholder="Subscribers"
                  onChange={(event) =>
                    onPatch({
                      items: block.items.map((entry, at) =>
                        at === index ? { ...entry, label: event.target.value } : entry,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <IconButton
                  variant="danger"
                  label="Remove this number"
                  onClick={() => onPatch({ items: block.items.filter((_, at) => at !== index) })}
                >
                  <Trash2 />
                </IconButton>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={block.items.length >= 4}
              onClick={() => onPatch({ items: [...block.items, { value: "0", label: "Thing" }] })}
            >
              <Plus />
              Add a number
            </Button>
            {/* Four across a 600px card is 150px each, which is about two
                words. More than that and the labels wrap into each other. */}
            {block.items.length >= 4 && <Note>Four is as many as fit across an email.</Note>}
          </>
        )}

        {block.type === "menu" && (
          <>
            <Row label="Between">
              <Select value={block.separator} onValueChange={(separator) => onPatch({ separator })}>
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="\u00b7">· Dot</SelectItem>
                  <SelectItem value="|">| Pipe</SelectItem>
                  <SelectItem value="/">/ Slash</SelectItem>
                  <SelectItem value="\u2014">— Dash</SelectItem>
                  <SelectItem value=" ">Nothing</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>

            {block.links.map((link, index) => (
              <div key={`${block.id}-m${index}`} className="flex items-center gap-1.5">
                <Input
                  value={link.label}
                  placeholder="Home"
                  onChange={(event) =>
                    onPatch({
                      links: block.links.map((entry, at) =>
                        at === index ? { ...entry, label: event.target.value } : entry,
                      ),
                    })
                  }
                  className="h-8 w-24 text-[12.5px]"
                />
                <Input
                  value={link.href}
                  placeholder="https://"
                  onChange={(event) =>
                    onPatch({
                      links: block.links.map((entry, at) =>
                        at === index ? { ...entry, href: event.target.value } : entry,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <IconButton
                  variant="danger"
                  label="Remove this link"
                  onClick={() => onPatch({ links: block.links.filter((_, at) => at !== index) })}
                >
                  <Trash2 />
                </IconButton>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                onPatch({ links: [...block.links, { label: "Link", href: "https://" }] })
              }
            >
              <Plus />
              Add a link
            </Button>
          </>
        )}

        {block.type === "gallery" && (
          <>
            <Row label="Across">
              <Select
                value={String(block.perRow)}
                onValueChange={(value) => onPatch({ perRow: Number(value) })}
              >
                <SelectTrigger className="h-8 text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">Two</SelectItem>
                  <SelectItem value="3">Three</SelectItem>
                  <SelectItem value="4">Four</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <Row label="Gap">
              <NumberField value={block.gap} onChange={(gap) => onPatch({ gap: gap ?? 12 })} />
            </Row>
            <Row label="Corners">
              <NumberField
                value={block.radius}
                onChange={(radius) => onPatch({ radius: radius ?? 0 })}
              />
            </Row>

            {block.images.map((image, index) => (
              <div
                key={`${block.id}-g${index}`}
                className="space-y-1.5 rounded-lg border border-border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={image.src}
                    placeholder="Picture address"
                    onChange={(event) =>
                      onPatch({
                        images: block.images.map((entry, at) =>
                          at === index ? { ...entry, src: event.target.value } : entry,
                        ),
                      })
                    }
                    className="h-8 text-[12.5px]"
                  />
                  <IconButton
                    variant="danger"
                    label="Remove this picture"
                    onClick={() =>
                      onPatch({ images: block.images.filter((_, at) => at !== index) })
                    }
                  >
                    <Trash2 />
                  </IconButton>
                </div>
                <Input
                  value={image.alt}
                  placeholder="What it shows, for a blocked image"
                  onChange={(event) =>
                    onPatch({
                      images: block.images.map((entry, at) =>
                        at === index ? { ...entry, alt: event.target.value } : entry,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
                <Input
                  value={image.href}
                  placeholder="Where it goes (optional)"
                  onChange={(event) =>
                    onPatch({
                      images: block.images.map((entry, at) =>
                        at === index ? { ...entry, href: event.target.value } : entry,
                      ),
                    })
                  }
                  className="h-8 text-[12.5px]"
                />
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onPatch({ images: [...block.images, { src: "", alt: "", href: "" }] })}
            >
              <Plus />
              Add a picture
            </Button>
          </>
        )}

        {block.type === "html" && (
          <>
            <Textarea
              value={block.html}
              onChange={(event) => onPatch({ html: event.target.value })}
              rows={8}
              className="font-mono text-[12px]"
            />
            <Note>Passed through untouched. Whatever it does, it does in somebody's inbox.</Note>
          </>
        )}
      </Section>

      {shared}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The page, and the template itself                                          */
/* -------------------------------------------------------------------------- */

function PageStyle({
  theme,
  onChange,
  preheader,
  onPreheader,
}: {
  theme: EmailTheme;
  onChange: (changes: Partial<EmailTheme>) => void;
  preheader: string;
  onPreheader: (value: string) => void;
}) {
  return (
    <div>
      <Section title="Inbox">
        <Textarea
          value={preheader}
          onChange={(event) => onPreheader(event.target.value.slice(0, 200))}
          rows={2}
          placeholder="The line after the subject"
          className="text-[12.5px]"
        />
        <Note>
          Shown after the subject in the list, before anything is opened. Leave it empty and the
          client uses the first words of the email instead — which is how "View in browser" ends up
          being the summary.
        </Note>
      </Section>

      <Section title="Page">
        <Row label="Background">
          <Swatch value={theme.background} onChange={(background) => onChange({ background })} />
        </Row>
        <Row label="Card">
          <Swatch value={theme.surface} onChange={(surface) => onChange({ surface })} />
        </Row>
        <Row label="Width">
          <NumberField
            value={theme.width}
            // Below about 320 nothing reads; above about 900 a desktop client
            // puts a horizontal scrollbar under the message.
            onChange={(width) => onChange({ width: Math.min(900, Math.max(320, width ?? 600)) })}
          />
        </Row>
        <Row label="Corners">
          <NumberField
            value={theme.radius}
            onChange={(radius) => onChange({ radius: radius ?? 0 })}
          />
        </Row>
        <Note>600px is the width every client agrees on. Outlook squares the corners off.</Note>
      </Section>

      <Section title="Type">
        <Row label="Font">
          <Select value={theme.font} onValueChange={(font) => onChange({ font })}>
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONTS.map((font) => (
                <SelectItem key={font.label} value={font.value}>
                  {font.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Text">
          <Swatch value={theme.text} onChange={(text) => onChange({ text })} />
        </Row>
        <Row label="Links">
          <Swatch value={theme.link} onChange={(link) => onChange({ link })} />
        </Row>
        <Note>A web font will not load in most clients, so these are the ones that are there.</Note>
      </Section>
    </div>
  );
}

/**
 * What one automation email has instead of a name and a slug.
 *
 * Less than a campaign has, deliberately. Who it goes to and when are drawn
 * on the canvas as boxes of their own, so repeating them here would be two
 * places to change the same thing.
 */
function StepDetails({
  subject,
  onSubject,
  mergeFields,
}: {
  subject: string;
  onSubject: (value: string) => void;
  mergeFields: string[];
}) {
  return (
    <div>
      <Section title="Email">
        <Row label="Subject">
          <Input
            value={subject}
            onChange={(event) => onSubject(event.target.value)}
            className="h-8 text-[12.5px]"
          />
        </Row>
        <Note>
          When this goes out is decided by the wait boxes above it on the canvas, and who reaches it
          by the conditions.
        </Note>
      </Section>

      <Section title="Merge fields">
        <MergeFields fields={[...mergeFields, "preferences"]} />
      </Section>
    </div>
  );
}

/**
 * What a broadcast has instead of a name and a slug.
 *
 * Everything that decides where a campaign goes lives here, including the
 * button that sends it. It used to live on the campaigns list, one screen
 * away, which meant the answer to "how do I send this" was "go somewhere
 * else" — and the list it was going to could not be changed at all.
 */
function BroadcastDetails({
  id,
  details,
  onChange,
  context,
  status,
  followUp,
  dirty,
  onSave,
  variables,
}: {
  id: string;
  details: Details;
  onChange: (changes: Partial<Details>) => void;
  context: CampaignContext;
  status: string;
  /** True when this campaign takes its audience from another one. */
  followUp: boolean;
  dirty: boolean;
  onSave: () => void;
  variables: string[];
}) {
  const router = useRouter();
  const [busy, submit] = useSubmit();
  const [sending, setSending] = useState(false);
  const [when, setWhen] = useState("");
  const [size, setSize] = useState<number | null>(null);

  const draft = status === "draft";
  const list = context.lists.find((entry) => entry.id === details.listId);
  const mine = context.segments.filter((entry) => entry.listId === details.listId);
  const testing = details.subjectB.trim().length > 0;

  /*
   * How many people this would go to, asked of the server.
   *
   * Counted there rather than guessed here because a segment is a question
   * only the database can answer — and the number somebody wants before they
   * press Send is the real one, not the size of the whole list.
   *
   * The aim on screen is sent with the question rather than left for the
   * server to read off the saved row: the list can be changed and not yet
   * saved, and a count describing the row as it was two edits ago is worse
   * than no count at all.
   */
  const { listId, segmentId } = details;
  useEffect(() => {
    if (!draft) return;
    let alive = true;
    void audienceSizeAction(id, { listId, segmentId: segmentId || null }).then((result) => {
      if (alive && result.ok) setSize(result.size);
    });
    return () => {
      alive = false;
    };
  }, [id, draft, listId, segmentId]);

  function send() {
    submit(async () => {
      const result = await startBroadcastAction(id, when || undefined);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSending(false);
      toast.success(
        result.scheduled
          ? `Scheduled for ${result.recipients} people`
          : `Sending to ${result.recipients} people`,
      );
      router.refresh();
    });
  }

  return (
    <div>
      {/* Sending is the one thing here that cannot be undone, so it is asked
          about rather than done. The number is in the question because "send
          to everyone" and "send to eleven thousand people" are different
          decisions. */}
      <ConfirmDialog
        open={sending}
        onOpenChange={(next) => !next && setSending(false)}
        title={when ? "Schedule this campaign?" : "Send this campaign now?"}
        description={details.subject}
        consequences={
          <>
            It goes to {size === null ? "everybody who matches" : `${size} people`}
            {list ? ` on ${list.name}` : ""}
            {details.segmentId ? " in that segment" : ""}. This cannot be called back once it
            starts.
            {!context.postalAddress && (
              <>
                {" "}
                No postal address is set, so the footer will not carry one — US CAN-SPAM asks for it
                in commercial mail.
              </>
            )}
          </>
        }
        confirmLabel={when ? "Schedule it" : "Send it"}
        onConfirm={send}
      />

      <Section title="Campaign">
        <Row label="Subject">
          <Input
            value={details.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
            readOnly={!draft}
            className="h-8 text-[12.5px]"
          />
        </Row>

        {/* A second subject line is how a test is started: there is nothing to
            switch on, because filling this in is the switch. */}
        <Row label="Subject B">
          <Input
            value={details.subjectB}
            onChange={(event) => onChange({ subjectB: event.target.value })}
            readOnly={!draft}
            placeholder="Off — fill in to A/B test"
            className="h-8 text-[12.5px]"
          />
        </Row>

        {/* `view_in_browser` is a campaign's own web copy, so it is offered
            here and not in an automation, which has none. */}
        <MergeFields fields={[...(list?.fields ?? []), "view_in_browser", "preferences"]} />

        <Row label="List">
          {draft && !followUp ? (
            <Select
              value={details.listId}
              onValueChange={(value) =>
                // A segment belongs to one list, so it cannot survive the move.
                onChange({ listId: value, segmentId: "" })
              }
            >
              <SelectTrigger className="h-8 text-[12.5px]">
                <SelectValue placeholder="Pick a list" />
              </SelectTrigger>
              <SelectContent>
                {context.lists.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name} · {entry.subscribed}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[12.5px]">{list?.name ?? "a list"}</span>
          )}
        </Row>

        {draft && !followUp && (
          <Row label="Segment">
            <Select
              value={details.segmentId || "all"}
              onValueChange={(value) => onChange({ segmentId: value === "all" ? "" : value })}
            >
              <SelectTrigger className="h-8 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everybody on the list</SelectItem>
                {mine.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name} · {entry.size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}

        <Row label="From">
          {draft ? (
            <Select
              value={details.mailboxId}
              onValueChange={(value) => onChange({ mailboxId: value })}
            >
              <SelectTrigger className="h-8 text-[12.5px]">
                <SelectValue placeholder="Pick an address" />
              </SelectTrigger>
              <SelectContent>
                {context.mailboxes.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[12.5px]">
              {context.mailboxes.find((entry) => entry.id === details.mailboxId)?.address ?? "—"}
            </span>
          )}
        </Row>

        <Row label="Status">
          <span className="text-[12.5px] capitalize">{status}</span>
        </Row>

        {draft && (
          <>
            {/* Empty means now. A separate "send later" mode would be a switch
                that has to agree with a date field, and they never do. */}
            <Row label="Send at">
              <Input
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
                className="h-8 text-[12.5px]"
              />
            </Row>

            <Button
              variant="solid"
              className="w-full"
              disabled={busy || !details.listId || !details.mailboxId}
              onClick={() => {
                // Sending what is on screen, not what was last saved. Anything
                // else means a typo fixed a second ago goes out anyway.
                if (dirty) onSave();
                setSending(true);
              }}
            >
              <Send className="size-3.5" />
              {when ? "Schedule" : "Send now"}
            </Button>

            <Note>
              {/* Said, rather than left as a button that does nothing. A
                  campaign can be written before anybody has decided who it is
                  for; it just cannot go out that way. */}
              {!details.listId
                ? "Pick a list above before this can be sent. Everything else saves as a draft."
                : followUp
                  ? "This goes only to the people who were sent the original and never opened it."
                  : size === null
                    ? "Nothing goes out until you press Send."
                    : `Nothing goes out until you press Send. ${size} ${size === 1 ? "person" : "people"} would get it.`}
              {testing &&
                " The audience is split in half: one side gets Subject, the other Subject B."}
            </Note>

            {!context.postalAddress && (
              <Note className="text-warn">
                No postal address set.{" "}
                <a
                  href="/settings/overview"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Add one
                </a>{" "}
                — US CAN-SPAM requires it in commercial mail.
              </Note>
            )}
          </>
        )}

        {!draft && (
          <Note>
            This has already started. What went out is what went out, so it cannot be edited.
          </Note>
        )}
      </Section>

      <Section title="Variables">
        {variables.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            None. A broadcast can use <code className="font-mono">{"{{ name }}"}</code> and the
            other fields you hold against each subscriber.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {variables.map((name) => (
              <code
                key={name}
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground"
              >
                {name}
              </code>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function DetailsForm({
  details,
  onChange,
  variables,
  locked,
}: {
  details: Details;
  onChange: (changes: Partial<Details>) => void;
  variables: string[];
  locked: boolean;
}) {
  return (
    <div>
      <Section title="Template">
        <Row label="Name">
          <Input
            value={details.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="h-8 text-[12.5px]"
          />
        </Row>
        <Row label="Slug">
          <Input
            value={details.slug}
            onChange={(event) => onChange({ slug: slugify(event.target.value) })}
            className="h-8 font-mono text-[12px]"
          />
        </Row>
        <Note>
          {locked
            ? "The slug is what your code passes. Changing it breaks anything already sending by the old one."
            : "The slug is what your code will pass when it sends this."}
        </Note>
        <Row label="Subject">
          <Input
            value={details.subject}
            onChange={(event) => onChange({ subject: event.target.value })}
            placeholder="Welcome, {{ name }}"
            className="h-8 text-[12.5px]"
          />
        </Row>
        <Textarea
          value={details.description}
          onChange={(event) => onChange({ description: event.target.value })}
          rows={3}
          placeholder="What this is for, for whoever comes after you."
          className="text-[12.5px]"
        />
      </Section>

      <Section title="Variables">
        {variables.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            None yet. Type <code className="font-mono">{"{{ name }}"}</code> anywhere in the subject
            or the body and it is filled in when you send.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {variables.map((name) => (
              <code
                key={name}
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11.5px] text-muted-foreground"
              >
                {name}
              </code>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
