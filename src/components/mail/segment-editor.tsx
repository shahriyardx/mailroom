"use client";

import {
  Button,
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
} from "@/components/kit";
import type { SegmentRule } from "@/db/schema";
import { cn } from "@/lib/utils";
import { createSegmentAction, segmentPreviewAction, updateSegmentAction } from "@/server/actions";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * The thing that writes a segment, wherever somebody is standing.
 *
 * Its own file because there are two places a segment is made — the Segments
 * screen, and the list it is about — and a rule builder that exists twice is
 * a rule builder that disagrees with itself by the third change.
 */

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
  { key: "status", label: "Status", kind: "status" },
  { key: "consentAt", label: "Joined", kind: "date" },
  { key: "tags", label: "Tag", kind: "tag" },
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
  status: [
    { key: "is", label: "is" },
    { key: "is_not", label: "is not" },
  ],
  date: [
    { key: "after", label: "after" },
    { key: "before", label: "before" },
  ],
  tag: [
    { key: "has", label: "has" },
    { key: "not_has", label: "does not have" },
  ],
  engagement: [
    { key: "opened", label: "opened a campaign" },
    { key: "not_opened", label: "opened nothing" },
    { key: "clicked", label: "clicked a campaign" },
    { key: "not_clicked", label: "clicked nothing" },
  ],
};

/** Which family of operators a field takes. */
/** What a member's status is called in the app, rather than in the column. */
const STATUSES = [
  { key: "subscribed", label: "subscribed" },
  { key: "pending", label: "not confirmed" },
  { key: "unsubscribed", label: "unsubscribed" },
  { key: "bounced", label: "bounced" },
  { key: "complained", label: "complained" },
] as const;

function kindOf(field: string): keyof typeof OPS {
  if (field === "engagement") return "engagement";
  if (field === "status") return "status";
  if (field === "tags") return "tag";
  if (field === "consentAt") return "date";
  if (field.startsWith("fields.")) return "field";
  return "text";
}

/** A rule in the words somebody would say it in. */
export function describeRule(rule: SegmentRule): string {
  const name = rule.field.startsWith("fields.") ? rule.field.slice(7) : rule.field;
  const op = OPS[kindOf(rule.field)]?.find((entry) => entry.key === rule.op)?.label ?? rule.op;

  if (kindOf(rule.field) === "engagement") {
    const days = Number.parseInt(rule.value, 10);
    return Number.isFinite(days) && days > 0 ? `${op} in the last ${days} days` : op;
  }
  if (rule.op === "set" || rule.op === "not_set") return `${name} ${op}`;
  if (kindOf(rule.field) === "tag") return `${op} the tag "${rule.value}"`;
  if (kindOf(rule.field) === "status") {
    const said = STATUSES.find((entry) => entry.key === rule.value)?.label ?? rule.value;
    return `${name} ${op} ${said}`;
  }
  return `${name} ${op} ${rule.value}`;
}

/** Every rule of a segment, in one line. */
export function describeSegment(row: { matchAll: boolean; rules: SegmentRule[] }) {
  if (row.rules.length === 0) return "Everybody on the list";
  return row.rules.map(describeRule).join(row.matchAll ? " and " : " or ");
}

export interface SegmentDraft {
  id: string | null;
  listId: string;
  name: string;
  matchAll: boolean;
  rules: SegmentRule[];
}

const BLANK: SegmentRule = { field: "engagement", op: "not_opened", value: "" };

/** A draft for a new segment, on a list that is already decided or not. */
export function blankSegment(listId = ""): SegmentDraft {
  return { id: null, listId, name: "", matchAll: true, rules: [{ ...BLANK }] };
}

/** A draft that edits one that exists. */
export function draftFrom(row: {
  id: string;
  listId: string;
  name: string;
  matchAll: boolean;
  rules: SegmentRule[];
}): SegmentDraft {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    matchAll: row.matchAll,
    rules: row.rules,
  };
}

export function SegmentEditor({
  draft,
  setDraft,
  lists,
  onClose,
  onSaved,
}: {
  draft: SegmentDraft;
  setDraft: (next: (current: SegmentDraft | null) => SegmentDraft | null) => void;
  /**
   * Lists to choose from. Pass one — the list being looked at — and the
   * choice disappears, because on a list's own page it has already been made.
   */
  lists: { id: string; name: string; subscribed: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const fixed = draft.id !== null || lists.length === 1;

  async function save() {
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
      toast.success(draft.id ? "Segment saved" : "Segment made");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit segment" : "New segment"}</DialogTitle>
          <DialogDescription>
            The rules are asked again each time something is sent, so a segment is never out of
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

          {/* The list is fixed once a segment exists: its rules are about that
              list's people, and moving it would leave a question pointing at
              the wrong set. On a list's own page it was never a question. */}
          <Field label="List">
            {fixed ? (
              <Input readOnly value={lists.find((row) => row.id === draft.listId)?.name ?? ""} />
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
                  (current) => current && { ...current, rules: [...current.rules, { ...BLANK }] },
                )
              }
            >
              <Plus />
              Add a rule
            </Button>
          </div>

          <Matches draft={draft} />

          {draft.rules.some((rule) => rule.field === "status") && (
            <Note>
              Mail only ever goes to people who are subscribed, so a segment about anybody else is
              for looking at rather than for sending to. A campaign aimed at one is refused with a
              reason rather than sent to nobody.
            </Note>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" onClick={save} disabled={busy || !draft.listId}>
            {draft.id ? "Save segment" : "Make segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

      {needsValue && kind === "status" && (
        <Select value={rule.value} onValueChange={(value) => onChange({ ...rule, value })}>
          <SelectTrigger className="h-8 w-[150px] shrink-0 text-[12.5px]">
            <SelectValue placeholder="Pick one…" />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((entry) => (
              <SelectItem key={entry.key} value={entry.key}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {needsValue && kind !== "status" && (
        <Input
          value={rule.value}
          onChange={(event) => onChange({ ...rule, value: event.target.value })}
          type={kind === "date" ? "date" : "text"}
          placeholder={
            kind === "engagement" ? "days — blank for ever" : kind === "tag" ? "customer" : "value"
          }
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
function Matches({ draft }: { draft: SegmentDraft }) {
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
          time something is sent, so this is never out of date.
        </>
      )}
    </Note>
  );
}
