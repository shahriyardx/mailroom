"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Note,
  Textarea,
} from "@/components/kit";
import { Empty, PageHeader, Row, SearchBox, Surface, Toolbar } from "@/components/mail/page-frame";
import {
  addListMembersAction,
  createListAction,
  removeListAction,
  removeListMemberAction,
  setListMemberStatusAction,
} from "@/server/actions";
import type { ListRow as ListSummary, MemberRow } from "@/server/campaigns";
import { FileUp, ListChecks, Plus, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Who a broadcast goes to.
 *
 * Two columns rather than two stacked panels: the lists are a short index you
 * pick from, and the people on the one you picked are the screen. Stacking
 * them pushed the names — the thing anybody came here for — below the fold as
 * soon as there were more than a few lists.
 *
 * The consent line is not decoration and is not optional. Somebody will ask
 * why they are being emailed, and the answer has to be better than a shrug.
 */
export function ListsPanel({
  lists,
  selected,
  members,
}: {
  lists: ListSummary[];
  selected: ListSummary | null;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [newList, setNewList] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);

  /*
   * The file is read here and its text put in the box, rather than uploaded.
   *
   * There is nothing to store — the addresses go straight into rows — so an
   * upload endpoint would only add a place for a half-finished import to sit.
   * Putting the text in the box also means somebody can see what they are
   * about to add, and fix a stray line, before anything is written.
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

  /** Roughly what will be added, so the count is not a surprise. */
  const lineCount = paste.split(/\r?\n/).filter((line) => line.trim()).length;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter(
      (person) =>
        person.address.includes(needle) || (person.name ?? "").toLowerCase().includes(needle),
    );
  }, [members, query]);

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

  const createList = (
    <Button onClick={() => setNewList(true)}>
      <Plus />
      Create list
    </Button>
  );

  return (
    <>
      <PageHeader title="Lists" count={lists.length}>
        {selected ? (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <UserPlus />
            Add people
          </Button>
        ) : null}
        {createList}
      </PageHeader>

      {lists.length === 0 ? (
        <Surface>
          <Empty
            icon={<ListChecks />}
            title="No lists yet"
            hint="A list is a group of people who agreed to hear from you. A broadcast goes to one, so this is the first thing to make."
          >
            {createList}
          </Empty>
        </Surface>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:items-start">
          <Surface>
            {lists.map((entry) => {
              const active = entry.id === selected?.id;
              return (
                <Link
                  key={entry.id}
                  href={`/campaigns/lists?list=${entry.id}`}
                  className={`flex items-center gap-3 border-border border-b px-3.5 py-2.5 transition-colors last:border-b-0 ${
                    active ? "bg-muted/60" : "hover:bg-muted/30"
                  }`}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
                    <ListChecks />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{entry.name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {entry.subscribed} subscribed
                    </span>
                  </span>
                </Link>
              );
            })}
          </Surface>

          <div>
            {selected ? (
              <>
                <Toolbar>
                  <SearchBox
                    value={query}
                    onChange={setQuery}
                    placeholder={`Search ${selected.name}…`}
                  />
                  <Button
                    variant="ghost"
                    disabled={busy}
                    title="Deletes the list and everyone on it"
                    onClick={() => run(() => removeListAction(selected.id), "List removed")}
                  >
                    Delete list
                  </Button>
                </Toolbar>

                <Surface>
                  {members.length === 0 ? (
                    <Empty
                      icon={<Users />}
                      title="Nobody on this list yet"
                      hint="Add the people who agreed to hear from you. You will be asked where they came from."
                    >
                      <Button onClick={() => setAdding(true)}>
                        <UserPlus />
                        Add people
                      </Button>
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
                            <span className="truncate font-mono text-[12.5px]">
                              {person.address}
                            </span>
                            <Badge
                              size="sm"
                              tone={
                                person.status === "subscribed"
                                  ? "ok"
                                  : person.status === "unsubscribed"
                                    ? "warn"
                                    : "danger"
                              }
                            >
                              {person.status}
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
                          variant="ghost"
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
              </>
            ) : null}
          </div>
        </div>
      )}

      <Dialog open={newList} onOpenChange={setNewList}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Create a list</DialogTitle>
            <DialogDescription>
              Somebody can be on more than one, and leaving one does not touch the others.
            </DialogDescription>
          </DialogHeader>

          <form
            id="new-list"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              startTransition(async () => {
                const result = await createListAction(name);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("List made");
                setName("");
                setNewList(false);
                router.refresh();
              });
            }}
          >
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Newsletter"
                disabled={busy}
                autoFocus
              />
            </Field>
          </form>

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setNewList(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-list" disabled={busy || !name.trim()}>
              Create list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add people to {selected?.name}</DialogTitle>
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
              if (!selected || !paste.trim()) return;
              startTransition(async () => {
                const result = await addListMembersAction(selected.id, paste, source);
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
            <Button type="submit" form="add-people" disabled={busy || !paste.trim()}>
              Add to list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
