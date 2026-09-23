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
  Input,
  Note,
  Switch,
  Textarea,
} from "@/components/kit";
import { Empty, PageHeader, Row, SearchBox, Surface, Toolbar } from "@/components/mail/page-frame";
import {
  addListMembersAction,
  removeListAction,
  removeListMemberAction,
  setListMemberStatusAction,
  updateListAction,
} from "@/server/actions";
import type { ListRow as ListSummary, MemberRow } from "@/server/campaigns";
import { ArrowLeft, Check, Copy, FileUp, Trash2, UserPlus, Users } from "lucide-react";
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
  appUrl,
}: {
  list: ListSummary;
  members: MemberRow[];
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
        <Button variant="danger" size="md" disabled={busy} onClick={() => setDeleting(true)}>
          <Trash2 />
          Delete
        </Button>
        {add}
      </PageHeader>

      <JoiningSettings list={list} appUrl={appUrl} />

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
  const [copied, setCopied] = useState(false);

  const signupUrl = `${appUrl}/subscribe/${list.id}`;

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
      <Row className="items-start">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Make people confirm by email</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            They land as "not confirmed" and hear nothing until they click a link. It halves a list
            and it is the only thing that stops a stranger signing somebody else up — which is where
            spam complaints come from.
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
          <div className="text-[13px] font-medium">Give this list a signup page</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">
            A page anybody can open and put their address into, with no account. Off, the address
            below returns a 404.
          </div>
          {list.publicSignup && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(signupUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="mt-2 flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {signupUrl}
            </button>
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
