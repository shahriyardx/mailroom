"use client";

import {
  Badge,
  BlankSlate,
  Button,
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
  List,
  ListRow,
  Note,
  Panel,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components/kit";
import type { Template } from "@/db/schema";
import { TemplateError, renderTemplateParts, slugify, templateVariables } from "@/lib/template";
import { useSubmit } from "@/lib/use-submit";
import { createTemplateAction, deleteTemplateAction, updateTemplateAction } from "@/server/actions";
import { Eye, FileCode2, PenLine, Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { EmailFrame } from "./email-frame";

/**
 * Loaded when somebody opens the form, not when they open the screen.
 *
 * A syntax-highlighted editor is most of the weight of this page, and most
 * visits here are to look at the list.
 */
const CodeEditor = dynamic(() => import("./code-editor").then((module) => module.CodeEditor), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] rounded-[10px]" />,
});

/** Which of the three panes the one body slot is showing. */
type Pane = "html" | "text" | "preview";

interface Draft {
  name: string;
  slug: string;
  description: string;
  subject: string;
  html: string;
  text: string;
}

const EMPTY: Draft = { name: "", slug: "", description: "", subject: "", html: "", text: "" };

function draftOf(row: Template): Draft {
  return {
    name: row.name,
    slug: row.slug,
    description: row.description ?? "",
    subject: row.subject,
    html: row.html ?? "",
    text: row.text ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/* The list                                                                   */
/* -------------------------------------------------------------------------- */

export function TemplatePanel({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // Null is closed. A row means "edit that one"; a null row inside an open
  // state means "make one".
  const [open, setOpen] = useState<{ row: Template | null } | null>(null);
  const [removing, setRemoving] = useState<Template | null>(null);

  return (
    <Panel
      title="Templates"
      description="Saved subjects and bodies, sent by name through the API."
      meta={`${templates.length}`}
      // Beside the heading rather than under the list: it is the one thing
      // this screen is for, and at the bottom it moved further away the more
      // templates you had.
      action={
        <Button variant="solid" pill onClick={() => setOpen({ row: null })}>
          <Plus />
          New template
        </Button>
      }
    >
      {/* A stop, not a typed confirmation: a template is rewritten in minutes.
          What it cannot undo is the send that names it an hour from now. */}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Delete this template?"
        description={removing ? `${removing.name} (${removing.slug})` : undefined}
        consequences={
          <>
            Any send that names this template starts failing with a 404. Mail already sent from it
            is unaffected — the body was copied into the message when it went.
          </>
        }
        confirmLabel="Delete template"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteTemplateAction(removing.id);
            setRemoving(null);
            toast.success("Template deleted");
            router.refresh();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete it");
          }
        }}
      />

      {templates.length > 0 ? (
        <List>
          {templates.map((row) => (
            <TemplateRow
              key={row.id}
              row={row}
              busy={pending}
              onEdit={() => setOpen({ row })}
              onDelete={() => setRemoving(row)}
            />
          ))}
        </List>
      ) : (
        <BlankSlate
          icon={<FileCode2 />}
          title="No templates yet"
          hint="Write the subject and body once, then send it by name from your code."
        />
      )}

      <TemplateDialog
        state={open}
        onClose={() => setOpen(null)}
        onSaved={() => {
          setOpen(null);
          router.refresh();
        }}
      />
    </Panel>
  );
}

function TemplateRow({
  row,
  busy,
  onEdit,
  onDelete,
}: {
  row: Template;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const names = templateVariables(row.subject, row.html, row.text);

  return (
    <ListRow className="items-start">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <FileCode2 className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium">{row.name}</span>
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {row.slug}
          </code>
        </p>

        {/* The subject is what this template actually sends, so it is the
            line worth showing. A description, when there is one, says why it
            exists — a different question, and the quieter of the two. */}
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {row.subject || "No subject"}
        </p>
        {row.description && (
          <p className="truncate text-[12px] text-muted-foreground/70">{row.description}</p>
        )}

        <Variables names={names} className="mt-2" />
      </div>

      <span className="flex shrink-0 items-center gap-0.5">
        <IconButton label={`Edit ${row.name}`} onClick={onEdit}>
          <PenLine />
        </IconButton>
        <IconButton
          variant="danger"
          label={`Delete ${row.name}`}
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 />
        </IconButton>
      </span>
    </ListRow>
  );
}

/** At most this many names before the rest become a count. */
const VARIABLES_SHOWN = 5;

function Variables({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;

  const shown = names.slice(0, VARIABLES_SHOWN);
  const rest = names.length - shown.length;

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {shown.map((name) => (
        <Badge key={name} size="sm" tone="neutral" className="font-mono">
          {name}
        </Badge>
      ))}
      {rest > 0 && <span className="text-[11.5px] text-muted-foreground">+{rest} more</span>}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The form                                                                   */
/* -------------------------------------------------------------------------- */

function TemplateDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { row: Template | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, submit] = useSubmit();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pane, setPane] = useState<Pane>("html");

  // Filled the first time each template is opened, and not on every render
  // after, or typing would be undone as fast as it happened.
  const key = state ? (state.row?.id ?? "new") : null;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  if (key && loadedFor !== key) {
    setLoadedFor(key);
    setDraft(state?.row ? draftOf(state.row) : EMPTY);
    setPane("html");
  }

  const set = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const names = useMemo(
    () => templateVariables(draft.subject, draft.html, draft.text),
    [draft.subject, draft.html, draft.text],
  );

  // The slug is derived until somebody types one, at which point it is theirs.
  const slug = draft.slug || slugify(draft.name);
  const existing = state?.row ?? null;

  async function save() {
    try {
      if (existing) await updateTemplateAction(existing.id, { ...draft, slug });
      else await createTemplateAction({ ...draft, slug });
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save it");
    }
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(value) => {
        if (!value) {
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{existing ? existing.name : "New template"}</DialogTitle>
          <DialogDescription>
            Put a placeholder where the details go, and send the values with the message.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto px-1 pb-1">
          {/* A grid, not a wrapping row: one of these carries a hint and the
              other does not, and aligning their bottoms put the two labels on
              different lines. */}
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="template-name">
              <Input
                id="template-name"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Welcome email"
              />
            </Field>
            <Field label="Slug" htmlFor="template-slug" hint="What your code calls it">
              <Input
                id="template-slug"
                value={slug}
                onChange={(event) => set("slug", event.target.value)}
                placeholder="welcome-email"
                className="font-mono text-[12.5px]"
              />
            </Field>
          </div>

          <Field label="Subject" htmlFor="template-subject">
            <Input
              id="template-subject"
              value={draft.subject}
              onChange={(event) => set("subject", event.target.value)}
              placeholder="Welcome aboard, {{ name }}"
            />
          </Field>

          <Field
            label="Description"
            htmlFor="template-description"
            hint="Optional. For whoever finds this later."
          >
            <Input
              id="template-description"
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
              placeholder="Sent when somebody finishes signing up"
            />
          </Field>

          {/* One body at a time. HTML and plain text are two versions of the
              same message, not two things to fill in, and two boxes at once
              read as a form that wants both. Preview takes the same space
              rather than appearing under it, so what you are comparing does
              not move down the page while you look at it. */}
          <div className="flex flex-col gap-2">
            <Tabs value={pane} onValueChange={(value) => setPane(value as Pane)}>
              <TabsList
                variant="segmented"
                className="h-9 gap-1 rounded-xl border border-border bg-muted/70 p-1"
              >
                <TabsTrigger value="html" className="h-7 rounded-lg px-3">
                  HTML
                </TabsTrigger>
                <TabsTrigger value="text" className="h-7 rounded-lg px-3">
                  Plain text
                </TabsTrigger>
                <TabsTrigger value="preview" className="h-7 rounded-lg px-3">
                  <Eye />
                  Preview
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {pane === "html" && (
              <CodeEditor
                value={draft.html}
                onChange={(value) => set("html", value)}
                placeholder="<p>Hello {{ name }},</p>"
              />
            )}

            {pane === "text" && (
              <>
                <Textarea
                  id="template-text"
                  rows={12}
                  value={draft.text}
                  onChange={(event) => set("text", event.target.value)}
                  placeholder="Hello {{ name }},"
                  className="font-mono text-[12.5px]"
                />
                <p className="text-[12px] leading-snug text-muted-foreground">
                  Optional. Written from the HTML when left out.
                </p>
              </>
            )}

            {pane === "preview" && <Preview draft={draft} names={names} />}
          </div>

          {names.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">Needs:</span>
              <Variables names={names} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" pill onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="solid"
            pill
            loading={saving}
            disabled={!draft.name.trim() || saving}
            onClick={() => submit(save)}
          >
            {existing ? "Save changes" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The template as it would arrive, with each hole filled by its own name.
 *
 * Standing in the values this way is the point: it shows the wording and the
 * layout without inventing a plausible-looking customer, so nothing in the
 * preview can be mistaken for real data.
 */
function Preview({ draft, names }: { draft: Draft; names: string[] }) {
  const sample = Object.fromEntries(names.map((name) => [name, `«${name}»`]));
  const nested: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(sample)) {
    const parts = path.split(".");
    let cursor = nested;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts.at(-1)!] = value;
  }

  let rendered: { subject: string; html: string | null; text: string | null };
  try {
    rendered = renderTemplateParts(
      { subject: draft.subject, html: draft.html || null, text: draft.text || null },
      nested,
    );
  } catch (error) {
    return (
      <Note className="text-destructive">
        {error instanceof TemplateError ? error.message : "That template cannot be rendered"}
      </Note>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <p className="border-b border-border bg-muted/40 px-3 py-2 text-[12.5px] font-medium">
        {rendered.subject || "No subject"}
      </p>
      {rendered.html ? (
        <EmailFrame html={rendered.html} text={rendered.text} />
      ) : (
        <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[12px]">
          {rendered.text || "Nothing to show"}
        </pre>
      )}
    </div>
  );
}
