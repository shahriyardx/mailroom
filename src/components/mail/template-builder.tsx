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
import type { Broadcast, Template } from "@/db/schema";
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
  type Padding,
  type Where,
  designToText,
  emptyDesign,
  findBlock,
  insertBlock,
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
  createTemplateAction,
  deleteTemplateAction,
  sendTemplateTestAction,
  sendableMailboxesAction,
  updateBroadcastAction,
  updateTemplateAction,
} from "@/server/actions";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
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
  Link2,
  Minus,
  MousePointerClick,
  Plus,
  Quote as QuoteIcon,
  Send,
  Table2,
  Trash2,
  Type,
  UnfoldVertical,
  UserMinus,
  Youtube,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
        { kind: "quote", label: "Quote", icon: QuoteIcon },
        { kind: "code", label: "Code", icon: Code2 },
        { kind: "image", label: "Image", icon: ImageIcon },
        { kind: "youtube", label: "YouTube", icon: Youtube },
      ],
    },
    {
      group: "Layout",
      items: [
        { kind: "button", label: "Button", icon: MousePointerClick },
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
  html: "Raw HTML",
};

interface Details {
  name: string;
  slug: string;
  description: string;
  subject: string;
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
export type BuilderTarget =
  | { kind: "template"; template: Template | null }
  | { kind: "broadcast"; broadcast: Broadcast; listName: string };

export function TemplateBuilder({
  template,
  basePath,
}: {
  template: Template | null;
  basePath: string;
}) {
  return <Builder target={{ kind: "template", template }} basePath={basePath} />;
}

export function BroadcastBuilder({
  broadcast,
  listName,
  basePath,
}: {
  broadcast: Broadcast;
  listName: string;
  basePath: string;
}) {
  return <Builder target={{ kind: "broadcast", broadcast, listName }} basePath={basePath} />;
}

function Builder({ target, basePath }: { target: BuilderTarget; basePath: string }) {
  const router = useRouter();
  const [busy, submit] = useSubmit();

  const template = target.kind === "template" ? target.template : null;
  const source = target.kind === "template" ? target.template : target.broadcast;
  // A broadcast that has gone is a record of what went, not a draft.
  const locked = target.kind === "broadcast" && target.broadcast.status !== "draft";

  const [details, setDetails] = useState<Details>({
    name: template?.name ?? "",
    slug: template?.slug ?? "",
    description: template?.description ?? "",
    subject: source?.subject ?? "",
  });

  const [design, setDesign] = useState<EmailDesign>(
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
  const [previewing, setPreviewing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const block = selected ? findBlock(design.blocks, selected) : null;

  const dirty = JSON.stringify({ details, design, html }) !== saved.current;

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

    if (target.kind === "broadcast") {
      submit(async () => {
        const result = await updateBroadcastAction(target.broadcast.id, {
          subject: details.subject,
          ...body,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        saved.current = JSON.stringify({ details, design, html });
        toast.success("Broadcast saved");
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
          {target.kind === "broadcast" ? "Broadcasts" : "Templates"}
        </Button>

        <span className="h-5 w-px bg-border" />

        {target.kind === "broadcast" ? (
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
            to {target.listName}
            {locked && " · already sent"}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
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
          <aside className="w-[188px] shrink-0 overflow-y-auto border-border border-r bg-card py-3">
            {PALETTE.map((section) => (
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
            ))}
          </aside>
        )}

        <div
          className={cn(
            "min-w-0 flex-1 overflow-y-auto",
            pane === "design" && !previewing ? "" : "bg-muted/30 px-6 py-6",
          )}
        >
          {previewing ? (
            <div className="mx-auto max-w-[760px] overflow-hidden rounded-xl border border-border bg-card">
              <div className="border-border border-b px-4 py-2.5 text-[13px]">
                <span className="text-muted-foreground">Subject: </span>
                {details.subject || <span className="text-muted-foreground">(none)</span>}
              </div>
              <EmailFrame
                html={compiled || null}
                text={handwritten ? (source?.text ?? null) : designToText(design)}
                imagesAllowed
              />
            </div>
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
                />
              )}

              {tab === "details" &&
                (target.kind === "broadcast" ? (
                  <BroadcastDetails
                    subject={details.subject}
                    onSubject={(subject) => setDetails((current) => ({ ...current, subject }))}
                    listName={target.listName}
                    status={target.broadcast.status}
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
        <div style={{ ...box, textAlign: block.align }}>
          <div style={typeOf(block, theme, { size: 13, weight: 500 })}>
            {block.links.map((link) => (
              <span
                key={link.label}
                style={{ margin: "0 8px", color: block.style?.color ?? theme.link }}
              >
                {link.label}
              </span>
            ))}
          </div>
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

function NumberField({
  value,
  onChange,
  unit = "px",
  placeholder,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  unit?: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : Number(event.target.value))
        }
        className="h-8 pr-8 text-[12.5px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
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

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

/**
 * Padding, either as one number or as four.
 *
 * Linked by default because that is what most blocks want, and because four
 * boxes where one would do is how an inspector starts feeling like a form.
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
          {linked ? (
            <NumberField
              value={padding[0]}
              onChange={(entry) => onChange([entry ?? 0, entry ?? 0, entry ?? 0, entry ?? 0])}
            />
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {SIDES.map((side, index) => (
                <NumberField
                  key={side}
                  value={padding[index]}
                  placeholder={side}
                  onChange={(entry) => {
                    const next = [...padding] as Padding;
                    next[index] = entry ?? 0;
                    onChange(next);
                  }}
                />
              ))}
            </div>
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
        <p className="pl-[94px] text-[11px] text-muted-foreground">Top, right, bottom, left.</p>
      )}
    </div>
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
                <Input
                  value={link.label}
                  onChange={(event) =>
                    onPatch({
                      links: block.links.map((entry, at) =>
                        at === index ? { ...entry, label: event.target.value } : entry,
                      ),
                    })
                  }
                  placeholder="Label"
                  className="h-8 w-[88px] text-[12.5px]"
                />
                <Input
                  value={link.href}
                  onChange={(event) =>
                    onPatch({
                      links: block.links.map((entry, at) =>
                        at === index ? { ...entry, href: event.target.value } : entry,
                      ),
                    })
                  }
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
              onClick={() => onPatch({ links: [...block.links, { label: "", href: "" }] })}
            >
              <Plus />
              Add link
            </Button>
            <Row label="Align">
              <AlignPicker value={block.align} onChange={(align) => onPatch({ align })} />
            </Row>
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
              Broadcasts fill <code className="font-mono">{"{{ unsubscribe_url }}"}</code> in for
              each recipient.
            </Note>
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
}: {
  theme: EmailTheme;
  onChange: (changes: Partial<EmailTheme>) => void;
}) {
  return (
    <div>
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
            onChange={(width) => onChange({ width: width ?? 600 })}
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

/** What a broadcast has instead of a name and a slug. */
function BroadcastDetails({
  subject,
  onSubject,
  listName,
  status,
  variables,
}: {
  subject: string;
  onSubject: (value: string) => void;
  listName: string;
  status: string;
  variables: string[];
}) {
  return (
    <div>
      <Section title="Broadcast">
        <Row label="Subject">
          <Input
            value={subject}
            onChange={(event) => onSubject(event.target.value)}
            readOnly={status !== "draft"}
            className="h-8 text-[12.5px]"
          />
        </Row>
        <Row label="To">
          <span className="text-[12.5px]">{listName}</span>
        </Row>
        <Row label="Status">
          <span className="text-[12.5px] capitalize">{status}</span>
        </Row>
        <Note>
          {status === "draft"
            ? "Nothing goes out until you press Send on the broadcasts screen."
            : "This has already started. What went out is what went out, so it cannot be edited."}
        </Note>
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
