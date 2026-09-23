"use client";

import {
  Badge,
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
  Note,
  Switch,
  Textarea,
} from "@/components/kit";
import { Empty, PageHeader, Row, SearchBox, Surface, Toolbar } from "@/components/mail/page-frame";
import {
  type SegmentDraft,
  SegmentEditor,
  blankSegment,
  describeSegment,
  draftFrom,
} from "@/components/mail/segment-editor";
import {
  addListMembersAction,
  removeListAction,
  removeListMemberAction,
  removeSegmentAction,
  setListMemberStatusAction,
  updateListAction,
} from "@/server/actions";
import type { ListRow as ListSummary, MemberRow } from "@/server/campaigns";
import type { SegmentRow } from "@/server/segments";
import {
  ArrowLeft,
  Check,
  Code,
  Copy,
  Download,
  FileUp,
  Filter,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * One list, and everybody on it.
 *
 * Its own page rather than the right-hand half of a split. The names are what
 * anybody came for, so they get the whole width, and the list you are looking
 * at is in the URL — which means it can be linked to and the back button does
 * what it looks like it should.
 */
export function ListDetailPanel({
  list,
  members,
  segments,
  appUrl,
}: {
  list: ListSummary;
  members: MemberRow[];
  /** The parts of this list somebody has already described. */
  segments: SegmentRow[];
  /** Where this instance answers, so the signup link can be shown in full. */
  appUrl: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter(
      (person) =>
        person.address.includes(needle) || (person.name ?? "").toLowerCase().includes(needle),
    );
  }, [members, query]);

  /*
   * The file is read here and its text put in the box, rather than uploaded.
   * Nothing needs storing — the addresses go straight into rows — and seeing
   * them first means a stray line can be fixed before anything is written.
   */
  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setPaste(String(reader.result ?? ""));
      setFileName(file.name);
      if (!source.trim()) setSource(`imported from ${file.name}`);
    };
    reader.onerror = () => toast.error("That file could not be read");
    reader.readAsText(file);
  }

  const lineCount = paste.split(/\r?\n/).filter((line) => line.trim()).length;

  function run(work: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.error ?? "That did not work");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  const add = (
    <Button variant="solid" size="md" onClick={() => setAdding(true)}>
      <UserPlus />
      Add people
    </Button>
  );

  return (
    <>
      <Link
        href="/campaigns/lists"
        className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All lists
      </Link>

      <PageHeader
        title={list.name}
        description={`${list.subscribed.toLocaleString()} subscribed${
          list.pending > 0 ? ` · ${list.pending.toLocaleString()} not confirmed` : ""
        }${
          list.total > list.subscribed + list.pending
            ? ` · ${(list.total - list.subscribed - list.pending).toLocaleString()} gone`
            : ""
        }`}
      >
        {/* A plain link, not a fetch: the browser saves a file it was sent,
            and building a blob here would put the whole audience into a
            string first for no reason. */}
        <Button asChild variant="ghost" size="md">
          <a href={`/api/campaigns/lists/${list.id}/export`} download>
            <Download />
            Export
          </a>
        </Button>
        <Button variant="danger" size="md" disabled={busy} onClick={() => setDeleting(true)}>
          <Trash2 />
          Delete
        </Button>
        {add}
      </PageHeader>

      <JoiningSettings list={list} appUrl={appUrl} />

      <ListSegments list={list} segments={segments} />

      {members.length > 0 ? (
        <Toolbar>
          <SearchBox value={query} onChange={setQuery} placeholder="Search this list…" />
        </Toolbar>
      ) : null}

      <Surface>
        {members.length === 0 ? (
          <Empty
            icon={<Users />}
            title="Nobody on this list yet"
            hint="Add the people who agreed to hear from you. You will be asked where they came from."
          >
            {add}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty
            icon={<Users />}
            title="Nothing matches"
            hint="Nobody on this list matches what you have typed."
          />
        ) : (
          shown.map((person) => (
            <Row key={person.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-[12.5px]">{person.address}</span>
                  {person.name ? (
                    <span className="truncate text-[12.5px] text-muted-foreground">
                      {person.name}
                    </span>
                  ) : null}
                  <Badge
                    size="sm"
                    tone={
                      person.status === "subscribed"
                        ? "ok"
                        : person.status === "pending"
                          ? "neutral"
                          : person.status === "unsubscribed"
                            ? "warn"
                            : "danger"
                    }
                  >
                    {person.status === "pending" ? "not confirmed" : person.status}
                  </Badge>

                  {/* Shown, because a tag put on by an automation is
                      otherwise invisible until a segment disagrees with
                      somebody about it. */}
                  {person.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {person.consentSource ?? "No source recorded"}
                </div>
              </div>

              {person.status === "subscribed" ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setListMemberStatusAction(person.id, "unsubscribed"),
                      "Taken off the list",
                    )
                  }
                >
                  Unsubscribe
                </Button>
              ) : null}

              <Button
                variant="danger-ghost"
                size="sm"
                disabled={busy}
                onClick={() => run(() => removeListMemberAction(person.id), "Removed")}
              >
                Remove
              </Button>
            </Row>
          ))
        )}
      </Surface>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${list.name}?`}
        description="The list goes, and so does everybody on it."
        consequences={
          list.total > 0
            ? `${list.total.toLocaleString()} ${
                list.total === 1 ? "person" : "people"
              } will be removed, along with the record of where each of them came from. Any broadcast written for this list goes too. None of it can be recovered.`
            : "Nothing is on this list yet, so nothing is lost."
        }
        confirmLabel="Delete list"
        onConfirm={async () => {
          /*
           * Awaited, then navigated. The first version fired the delete and
           * pushed in the same tick, so the page it landed on could still be
           * rendering the list it had just destroyed.
           */
          const result = await removeListAction(list.id);
          if (!result.ok) {
            toast.error(result.error ?? "That list could not be deleted");
            return;
          }
          toast.success("List deleted");
          router.push("/campaigns/lists");
        }}
      />

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add people to {list.name}</DialogTitle>
            <DialogDescription>
              Upload a CSV, or paste one address per line. A name after a comma is used if you have
              one.
            </DialogDescription>
          </DialogHeader>

          <form
            id="add-people"
            className="space-y-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!paste.trim()) return;
              startTransition(async () => {
                const result = await addListMembersAction(list.id, paste, source);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(
                  `${result.added} added${result.skipped ? `, ${result.skipped} already on it` : ""}${
                    result.rejected ? `, ${result.rejected} not an address` : ""
                  }`,
                );
                setPaste("");
                setFileName(null);
                setAdding(false);
                router.refresh();
              });
            }}
          >
            <button
              type="button"
              onClick={() => filePicker.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) readFile(file);
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-border border-dashed px-3.5 py-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                <FileUp />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{fileName ?? "Upload a CSV"}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {fileName
                    ? "Loaded below. Choose another to replace it."
                    : "Or drop one here. A header row naming its columns is understood."}
                </span>
              </span>
            </button>
            <input
              ref={filePicker}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file);
                // Lets the same file be chosen twice in a row.
                event.target.value = "";
              }}
            />

            <Field label="Addresses" hint={lineCount > 0 ? `${lineCount} lines` : undefined}>
              <Textarea
                value={paste}
                onChange={(event) => {
                  setPaste(event.target.value);
                  setFileName(null);
                }}
                placeholder={"ada@example.com, Ada Lovelace\nbob@example.com"}
                rows={6}
                disabled={busy}
              />
            </Field>

            <Field
              label="Where did they come from?"
              hint="Stored against each person. You will want this the day somebody asks why you are emailing them."
            >
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="signup form / imported from Mailchimp / added by hand"
                disabled={busy}
              />
            </Field>

            <Note>
              Somebody already on the list is left exactly as they are. Re-importing last month's
              file will not resubscribe anybody who has left since.
            </Note>
          </form>

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="solid"
              type="submit"
              form="add-people"
              disabled={busy || !paste.trim()}
            >
              Add to list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * How people are allowed to join this list.
 *
 * Both switches are off on a fresh list and both change what somebody signing
 * up experiences, so they are stated as sentences rather than labels — a
 * toggle called "Double opt-in" tells somebody who has not run a list before
 * exactly nothing about what will happen.
 */
function JoiningSettings({ list, appUrl }: { list: ListSummary; appUrl: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [copied, setCopied] = useState<"url" | "embed" | null>(null);

  const signupUrl = `${appUrl}/subscribe/${list.id}`;
  /*
   * An iframe rather than a form posting across origins.
   *
   * A pasted form would send somebody away from the site they were reading to
   * see "you are subscribed" on ours, which is a worse thing to do to a
   * reader than a box that answers where it stands. It is also the version
   * that keeps working when the form changes.
   */
  const embedSnippet = `<iframe src="${signupUrl}?embed=1" title="Subscribe to ${list.name}" width="100%" height="320" style="border:0" loading="lazy"></iframe>`;

  function take(what: "url" | "embed", value: string) {
    void navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  }

  function change(patch: { doubleOptIn?: boolean; publicSignup?: boolean }) {
    startTransition(async () => {
      const result = await updateListAction(list.id, patch);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Surface className="mb-3">
      {/* Named, because two switches with no heading over them are two
          switches nobody knows the subject of. */}
      <div className="border-border border-b px-4 pt-3 pb-2">
        <span className="eyebrow">How people join</span>
      </div>

      <Row className="items-start">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[13px]">Make people confirm by email</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            They land as "not confirmed" until they click a link. It stops a stranger signing
            somebody else up, which is where spam complaints come from.
          </div>
        </div>
        <Switch
          checked={list.doubleOptIn}
          disabled={busy}
          onCheckedChange={(next) => change({ doubleOptIn: next })}
          aria-label="Make people confirm by email"
        />
      </Row>

      <Row className="items-start">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[13px]">Give this list a signup page</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            A page anybody can open and put their address into, with no account.
          </div>
          {list.publicSignup && (
            <div className="mt-2 space-y-1.5">
              <button
                type="button"
                onClick={() => take("url", signupUrl)}
                className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                {copied === "url" ? <Check className="size-3" /> : <Copy className="size-3" />}
                {signupUrl}
              </button>

              {/* The same form, for a site rather than a link. Offered here
                  because this is where somebody is when they decide people
                  should be able to sign up. */}
              <button
                type="button"
                onClick={() => take("embed", embedSnippet)}
                className="flex w-full items-start gap-1.5 rounded-lg bg-muted px-2 py-1 text-left font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
              >
                <span className="mt-0.5 shrink-0">
                  {copied === "embed" ? <Check className="size-3" /> : <Code className="size-3" />}
                </span>
                <span className="min-w-0 break-all">{embedSnippet}</span>
              </button>
              <p className="text-[11.5px] text-muted-foreground">
                Paste that into your own site to put the form on it.
              </p>
            </div>
          )}
        </div>
        <Switch
          checked={list.publicSignup}
          disabled={busy}
          onCheckedChange={(next) => change({ publicSignup: next })}
          aria-label="Give this list a signup page"
        />
      </Row>
    </Surface>
  );
}

/**
 * The parts of this list, made where the list is.
 *
 * A segment is a question about one list, so the natural place to ask it is
 * the page showing that list — not a screen elsewhere where the first thing
 * to do is pick the list again. The same editor opens in both places.
 */
function ListSegments({ list, segments }: { list: ListSummary; segments: SegmentRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<SegmentDraft | null>(null);
  const [removing, setRemoving] = useState<SegmentRow | null>(null);

  const only = [{ id: list.id, name: list.name, subscribed: list.subscribed }];

  return (
    <Surface className="mb-3">
      <div className="flex items-center gap-2 border-border border-b px-4 pt-3 pb-2">
        <span className="eyebrow flex-1">Segments of this list</span>
        <Button variant="ghost" size="sm" onClick={() => setDraft(blankSegment(list.id))}>
          <Plus />
          New segment
        </Button>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Delete this segment?"
        description={removing?.name}
        consequences="Any draft campaign aimed at it goes back to the whole list, and any automation narrowed by it goes back to everybody. Nothing happens to the people in it."
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
        <SegmentEditor
          draft={draft}
          setDraft={setDraft}
          lists={only}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            router.refresh();
          }}
        />
      )}

      {segments.length === 0 ? (
        <Row>
          <p className="text-[12.5px] text-muted-foreground">
            None yet. A segment is a question about these people — who never opens anything, who
            joined this month — and a campaign or an automation can be aimed at one.
          </p>
        </Row>
      ) : (
        segments.map((row) => (
          <Row key={row.id} className="items-center">
            <Filter className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[13px]">{row.name}</div>
              <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {describeSegment(row)}
              </div>
            </div>
            {/* Said rather than counted: a bare number beside two icons reads
                as a stray digit, and the one thing worth knowing about a
                segment is how many people are actually in it. */}
            <Badge size="sm" tone={row.size === 0 ? "warn" : "neutral"} className="shrink-0">
              {row.size === 0
                ? "nobody yet"
                : `${row.size} ${row.size === 1 ? "person" : "people"}`}
            </Badge>
            <IconButton asChild label={`Export ${row.name}`}>
              <a href={`/api/campaigns/lists/${list.id}/export?segment=${row.id}`} download>
                <Download />
              </a>
            </IconButton>
            <IconButton label={`Edit ${row.name}`} onClick={() => setDraft(draftFrom(row))}>
              <Pencil />
            </IconButton>
            <IconButton
              variant="danger"
              label={`Delete ${row.name}`}
              onClick={() => setRemoving(row)}
            >
              <Trash2 />
            </IconButton>
          </Row>
        ))
      )}
    </Surface>
  );
}
