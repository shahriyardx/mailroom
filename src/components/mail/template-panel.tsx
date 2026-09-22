"use client";

import {
  Badge,
  BlankSlate,
  Button,
  ConfirmDialog,
  IconButton,
  List,
  ListRow,
  Panel,
} from "@/components/kit";
import type { Template } from "@/db/schema";
import { templateVariables } from "@/lib/template";
import { deleteTemplateAction } from "@/server/actions";
import { FileCode2, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/**
 * The templates an account has, as a list.
 *
 * Editing one happens on its own page rather than in a dialog: a builder
 * wants the whole window, and a template is something people come back to,
 * link each other to and keep open beside the code that sends it.
 */
export function TemplatePanel({ templates }: { templates: Template[] }) {
  const router = useRouter();
  // Settings and campaigns both render this screen, and each keeps its own
  // half of the app under its own path.
  const base = usePathname();
  const [removing, setRemoving] = useState<Template | null>(null);

  return (
    <Panel
      title="Templates"
      description="Saved subjects and bodies, sent by name through the API."
      meta={`${templates.length}`}
      action={
        <Button variant="solid" pill asChild>
          <Link href={`${base}/new`}>
            <Plus />
            New template
          </Link>
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
              href={`${base}/${row.id}`}
              onDelete={() => setRemoving(row)}
            />
          ))}
        </List>
      ) : (
        <BlankSlate
          icon={<FileCode2 />}
          title="No templates yet"
          hint="Build the subject and body once, then send it by name from your code."
        />
      )}
    </Panel>
  );
}

function TemplateRow({
  row,
  href,
  onDelete,
}: {
  row: Template;
  href: string;
  onDelete: () => void;
}) {
  const names = templateVariables(row.subject, row.html, row.text);

  return (
    <ListRow className="relative items-start">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {row.design ? <LayoutTemplate className="size-4" /> : <FileCode2 className="size-4" />}
      </span>

      <div className="min-w-0 flex-1">
        {/* The whole row opens it: an edit pencil next to a row that does
            nothing when clicked is a target people miss. */}
        <Link href={href} className="block outline-none after:absolute after:inset-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-[13px] hover:underline">{row.name}</span>
            <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {row.slug}
            </code>
          </p>
        </Link>

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

      <span className="relative z-10 flex shrink-0 items-center gap-0.5">
        <IconButton variant="danger" label={`Delete ${row.name}`} onClick={onDelete}>
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
