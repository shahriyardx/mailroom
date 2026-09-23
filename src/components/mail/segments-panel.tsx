"use client";

import {
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
  ListEmpty,
  ListRow,
  Note,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import type { SegmentRule } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  createSegmentAction,
  removeSegmentAction,
  segmentPreviewAction,
  updateSegmentAction,
} from "@/server/actions";
import type { SegmentRow } from "@/server/segments";
import { Filter, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Parts of a list, described.
 *
 * Mirrors the rule language on the server rather than inventing a second one:
 * every option here is a field the query knows how to ask about, so a segment
 * that can be built cannot fail to run.
 */
const FIELDS = [
  { key: "engagement", label: "Engagement", kind: "engagement" },
  { key: "address", label: "Email address", kind: "text" },
  { key: "name", label: "Name", kind: "text" },
  { key: "consentAt", label: "Joined", kind: "date" },
  { key: "fields.", label: "A merge field…", kind: "field" },
] as const;

const OPS: Record<string, { key: SegmentRule["op"]; label: string }[]> = {
  text: [
    { key: "is", label: "is" },
    { key: "is_not", label: "is not" },
    { key: "contains", label: "contains" },
    { key: "not_contains", label: "does not contain" },
    { key: "set", label: "is set" },
    { key: "not_set", label: "is empty" },
  ],
  field: [
    { key: "is", label: "is" },
    { key: "is_not", label: "is not" },
    { key: "contains", label: "contains" },
    { key: "not_contains", label: "does not contain" },
    { key: "set", label: "is set" },
    { key: "not_set", label: "is empty" },
  ],
  date: [
    { key: "after", label: "after" },
    { key: "before", label: "before" },
  ],
  engagement: [
    { key: "opened", label: "opened a campaign" },
    { key: "not_opened", label: "opened nothing" },
    { key: "clicked", label: "clicked a campaign" },
    { key: "not_clicked", label: "clicked nothing" },
  ],
};

/** Which family of operators a field takes. */
function kindOf(field: string): keyof typeof OPS {
  if (field === "engagement") return "engagement";
  if (field === "consentAt") return "date";
  if (field.startsWith("fields.")) return "field";
  return "text";
}

/** A rule in the words somebody would say it in. */
function describe(rule: SegmentRule): string {
  const name = rule.field.startsWith("fields.") ? rule.field.slice(7) : rule.field;
  const op = OPS[kindOf(rule.field)]?.find((entry) => entry.key === rule.op)?.label ?? rule.op;

  if (kindOf(rule.field) === "engagement") {
    const days = Number.parseInt(rule.value, 10);
    return Number.isFinite(days) && days > 0 ? `${op} in the last ${days} days` : op;
  }
  if (rule.op === "set" || rule.op === "not_set") return `${name} ${op}`;
  return `${name} ${op} ${rule.value}`;
}

interface Draft {
  id: string | null;
  listId: string;
  name: string;
  matchAll: boolean;
  rules: SegmentRule[];
}

const BLANK: SegmentRule = { field: "engagement", op: "not_opened", value: "" };

export function SegmentsPanel({
  segments,
  lists,
}: {
  segments: SegmentRow[];
  lists: { id: string; name: string; subscribed: number }[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<SegmentRow | null>(null);
  const [busy, setBusy] = useState(false);

  function open(row?: SegmentRow) {
    setDraft(
      row
        ? {
            id: row.id,
            listId: row.listId,
            name: row.name,
            matchAll: row.matchAll,
            rules: row.rules,
          }
        : {
            id: null,
            listId: lists[0]?.id ?? "",
            name: "",
            matchAll: true,
            rules: [{ ...BLANK }],
          },
    );
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const result = draft.id
        ? await updateSegmentAction(draft.id, {
            name: draft.name,
            matchAll: draft.matchAll,
            rules: draft.rules,
          })
        : await createSegmentAction({
            listId: draft.listId,
            name: draft.name,
            matchAll: draft.matchAll,
            rules: draft.rules,
          });
      if (!result.ok) throw new Error(result.error);
      setDraft(null);
      toast.success(draft.id ? "Segment saved" : "Segment made");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Segments"
      description="Parts of a list, described once and worked out again every time something is sent."
      meta={`${segments.length}`}
      action={
        <Button variant="solid" pill onClick={() => open()} disabled={lists.length === 0}>
          <Plus />
          New segment
        </Button>
      }
    >
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Delete this segment?"
        description={removing?.name}
        consequences="Any draft campaign aimed at it goes back to the whole list. Nothing happens to the people in it."
        confirmLabel="Delete segment"
        onConfirm={async () => {
          if (!removing) return;
          await removeSegmentAction(removing.id);
          setRemoving(null);
          toast.success("Segment deleted");
          router.refresh();
        }}
      />

      {draft && (
        <Dialog open onOpenChange={(next) => !next && setDraft(null)}>
          <DialogContent className="max-w-[620px]">
            <DialogHeader>
              <DialogTitle>{draft.id ? "Edit segment" : "New segment"}</DialogTitle>
              <DialogDescription>
                The rules are asked again each time a campaign is sent, so a segment is never out of
                date.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => current && { ...current, name: event.target.value })
                  }
                  placeholder="People who never open anything"
                />
              </Field>

              {/* The list is fixed once a segment exists: its rules are about
                  that list's people, and moving it would leave a question
                  pointing at the wrong set. */}
              <Field label="List">
                {draft.id ? (
                  <Input
                    readOnly
                    value={lists.find((row) => row.id === draft.listId)?.name ?? ""}
                  />
                ) : (
                  <Select
                    value={draft.listId}
                    onValueChange={(value) =>
                      setDraft((current) => current && { ...current, listId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a list" />
                    </SelectTrigger>
                    <SelectContent>
                      {lists.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name} · {row.subscribed}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>

              <Field label="Match">
                <Select
                  value={draft.matchAll ? "all" : "any"}
                  onValueChange={(value) =>
                    setDraft((current) => current && { ...current, matchAll: value === "all" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everybody who meets every rule</SelectItem>
                    <SelectItem value="any">Everybody who meets any rule</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div className="space-y-2">
                {draft.rules.map((rule, index) => (
                  <RuleRow
                    // Position is the identity here: rules have nothing else
                    // unique about them, and two identical ones are allowed.
                    // biome-ignore lint/suspicious/noArrayIndexKey: rules have no id
                    key={index}
                    rule={rule}
                    onChange={(next) =>
                      setDraft(
                        (current) =>
                          current && {
                            ...current,
                            rules: current.rules.map((entry, at) => (at === index ? next : entry)),
                          },
                      )
                    }
                    onRemove={() =>
                      setDraft(
                        (current) =>
                          current && {
                            ...current,
                            rules: current.rules.filter((_, at) => at !== index),
                          },
                      )
                    }
                  />
                ))}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft(
                      (current) =>
                        current && { ...current, rules: [...current.rules, { ...BLANK }] },
                    )
                  }
                >
                  <Plus />
                  Add a rule
                </Button>
              </div>

              <Matches draft={draft} />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button variant="solid" onClick={save} disabled={busy || !draft.listId}>
                {draft.id ? "Save segment" : "Make segment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {segments.length > 0 ? (
        <List>
          {segments.map((row) => (
            <ListRow key={row.id} className="items-start">
              <Filter className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-[13px]">{row.name}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">{row.listName}</span>
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {row.rules.length === 0
                    ? "Everybody on the list"
                    : row.rules.map(describe).join(row.matchAll ? " and " : " or ")}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                {row.size}
              </span>
              <IconButton label={`Edit ${row.name}`} onClick={() => open(row)}>
                <Pencil />
              </IconButton>
              <IconButton
                variant="danger"
                label={`Delete ${row.name}`}
                onClick={() => setRemoving(row)}
              >
                <Trash2 />
              </IconButton>
            </ListRow>
          ))}
        </List>
      ) : (
        <BlankSlate
          icon={<Filter />}
          title={lists.length === 0 ? "Make a list first" : "No segments yet"}
          hint={
            lists.length === 0
              ? "A segment is a question about a list, so there has to be a list to ask it about."
              : "Aim a campaign at part of a list: the people who never open anything, or everybody who joined this month."
          }
        />
      )}
    </Panel>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: SegmentRule;
  onChange: (rule: SegmentRule) => void;
  onRemove: () => void;
}) {
  const kind = kindOf(rule.field);
  const custom = kind === "field";
  const needsValue = rule.op !== "set" && rule.op !== "not_set";

  return (
    <div className="flex items-center gap-2">
      <Select
        value={custom ? "fields." : rule.field}
        onValueChange={(value) => {
          const next = OPS[kindOf(value)]?.[0]?.key ?? "is";
          onChange({ field: value, op: next, value: "" });
        }}
      >
        <SelectTrigger className="h-8 w-[150px] shrink-0 text-[12.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELDS.map((entry) => (
            <SelectItem key={entry.key} value={entry.key}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* A merge field is whatever the import called its column, so it is
          typed rather than chosen from a list nobody can predict. */}
      {custom && (
        <Input
          value={rule.field.slice(7)}
          onChange={(event) => onChange({ ...rule, field: `fields.${event.target.value}` })}
          placeholder="plan"
          className="h-8 w-[110px] shrink-0 font-mono text-[12.5px]"
        />
      )}

      <Select
        value={rule.op}
        onValueChange={(value) => onChange({ ...rule, op: value as SegmentRule["op"] })}
      >
        <SelectTrigger className="h-8 min-w-0 flex-1 text-[12.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(OPS[kind] ?? []).map((entry) => (
            <SelectItem key={entry.key} value={entry.key}>
              {entry.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsValue && (
        <Input
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
          type={kind === "date" ? "date" : "text"}
          placeholder={kind === "engagement" ? "days — blank for ever" : "value"}
          className="h-8 w-[150px] shrink-0 text-[12.5px]"
        />
      )}

      <IconButton label="Remove this rule" size="sm" onClick={onRemove}>
        <X />
      </IconButton>
    </div>
  );
}

/** How long to sit still before asking the server. Milliseconds. */
const SETTLE = 450;

/**
 * How many people the rules currently match.
 *
 * Asked as they are typed, because a segment is a question and the only way
 * to know whether it is the right one is the answer. Without it somebody
 * saves, goes back to the list, sees "0", and has no idea which rule did it.
 */
function Matches({ draft }: { draft: Draft }) {
  const [size, setSize] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);

  const question = JSON.stringify({
    listId: draft.listId,
    matchAll: draft.matchAll,
    rules: draft.rules,
  });

  useEffect(() => {
    if (!draft.listId) return;
    let alive = true;
    setAsking(true);

    // Waited on rather than asked per keystroke: every letter of a value is
    // otherwise a count over the whole list.
    const timer = setTimeout(async () => {
      const result = await segmentPreviewAction(JSON.parse(question));
      if (!alive) return;
      setAsking(false);
      setSize(result.ok ? result.size : null);
    }, SETTLE);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [question, draft.listId]);

  return (
    <Note className={cn("transition-opacity", asking && "opacity-50")}>
      {size === null ? (
        "Counting…"
      ) : size === 0 ? (
        <span className="text-warn">
          Nothing matches these rules. A campaign aimed here would be refused rather than sent to
          nobody.
        </span>
      ) : (
        <>
          <strong className="text-foreground">{size}</strong>{" "}
          {size === 1 ? "person matches" : "people match"} right now. The rules are asked again each
          time a campaign is sent, so this is never out of date.
        </>
      )}
    </Note>
  );
}
