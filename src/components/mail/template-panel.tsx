"use client";

import {
  Badge,
  BlankSlate,
  Button,
  Field,
  Fieldset,
  FieldsetActions,
  IconButton,
  Input,
  List,
  ListRow,
  Note,
  Panel,
  Textarea,
} from "@/components/kit";
import type { Template } from "@/db/schema";
import { TemplateError, renderTemplateParts, slugify, templateVariables } from "@/lib/template";
import { useSubmit } from "@/lib/use-submit";
import { createTemplateAction, deleteTemplateAction, updateTemplateAction } from "@/server/actions";
import { Eye, FileText, PenLine, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { EmailFrame } from "./email-frame";

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

export function TemplatePanel({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Panel
      title="Templates"
      description="Saved subjects and bodies, sent by name through the API."
      meta={`${templates.length}`}
    >
      {templates.length > 0 ? (
        <List>
          {templates.map((row) =>
            editing === row.id ? (
              <li key={row.id} className="py-3">
                <Editor
                  initial={draftOf(row)}
                  busy={pending}
                  onCancel={() => setEditing(null)}
                  onSave={async (draft) => {
                    await updateTemplateAction(row.id, draft);
                    setEditing(null);
                    router.refresh();
                  }}
                />
              </li>
            ) : (
              <ListRow key={row.id}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                    {row.name}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {row.slug}
                    </code>
                  </p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {row.description || row.subject || "No subject"}
                  </p>
                </div>
                <Variables
                  names={templateVariables(row.subject, row.html, row.text)}
                  className="hidden sm:flex"
                />
                <IconButton label={`Edit ${row.name}`} onClick={() => setEditing(row.id)}>
                  <PenLine />
                </IconButton>
                <IconButton
                  variant="danger"
                  label={`Delete ${row.name}`}
                  onClick={() =>
                    start(async () => {
                      await deleteTemplateAction(row.id);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 />
                </IconButton>
              </ListRow>
            ),
          )}
        </List>
      ) : adding ? null : (
        <BlankSlate
          icon={<FileText />}
          title="No templates yet"
          hint="Write the subject and body once, then send it by name from your code."
          action={
            <Button variant="solid" pill onClick={() => setAdding(true)}>
              <Plus />
              New template
            </Button>
          }
        />
      )}

      {adding ? (
        <Fieldset title="New template">
          <Editor
            initial={EMPTY}
            busy={pending}
            onCancel={() => setAdding(false)}
            onSave={async (draft) => {
              await createTemplateAction(draft);
              setAdding(false);
              router.refresh();
            }}
          />
        </Fieldset>
      ) : templates.length > 0 ? (
        <FieldsetActions>
          <Button variant="solid" pill onClick={() => setAdding(true)}>
            <Plus />
            New template
          </Button>
        </FieldsetActions>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function Editor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  onSave: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [saving, submit] = useSubmit();

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const names = useMemo(
    () => templateVariables(draft.subject, draft.html, draft.text),
    [draft.subject, draft.html, draft.text],
  );

  // The slug is derived until somebody types one, at which point it is theirs.
  const slug = draft.slug || slugify(draft.name);

  return (
    <div className="flex flex-col gap-5">
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

      <Field label="HTML" htmlFor="template-html">
        <Textarea
          id="template-html"
          rows={8}
          value={draft.html}
          onChange={(event) => set("html", event.target.value)}
          placeholder="<p>Hello {{ name }},</p>"
          className="font-mono text-[12.5px]"
        />
      </Field>

      <Field
        label="Plain text"
        htmlFor="template-text"
        hint="Optional. Written from the HTML when left out."
      >
        <Textarea
          id="template-text"
          rows={4}
          value={draft.text}
          onChange={(event) => set("text", event.target.value)}
          placeholder="Hello {{ name }},"
          className="font-mono text-[12.5px]"
        />
      </Field>

      {names.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted-foreground">Needs:</span>
          <Variables names={names} />
        </div>
      )}

      {preview && <Preview draft={draft} names={names} />}

      <FieldsetActions>
        <Button
          variant="solid"
          pill
          loading={saving}
          disabled={!draft.name.trim() || saving || busy}
          onClick={() =>
            submit(async () => {
              try {
                await onSave({ ...draft, slug });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not save it");
              }
            })
          }
        >
          Save
        </Button>
        <Button pill onClick={() => setPreview((value) => !value)}>
          <Eye />
          {preview ? "Hide preview" : "Preview"}
        </Button>
        <Button variant="ghost" pill onClick={onCancel}>
          Cancel
        </Button>
      </FieldsetActions>
    </div>
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

function Variables({ names, className }: { names: string[]; className?: string }) {
  if (names.length === 0) return null;
  return (
    <span className={className ?? "flex flex-wrap gap-1.5"}>
      {names.map((name) => (
        <Badge key={name} size="sm" tone="neutral" className="font-mono">
          {name}
        </Badge>
      ))}
    </span>
  );
}
