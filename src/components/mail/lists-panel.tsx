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
  Input,
} from "@/components/kit";
import { Empty, PageHeader, Row, SearchBox, Surface, Toolbar } from "@/components/mail/page-frame";
import { createListAction } from "@/server/actions";
import type { ListRow as ListSummary } from "@/server/campaigns";
import { ChevronRight, ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * The index of lists.
 *
 * Each list is a place you go to, not a thing you select beside its contents.
 * The two-column version this replaces gave a third of the screen to an index
 * that is usually two items long, and pushed the names — the thing anybody
 * opened the page for — into the remaining gutter.
 */
export function ListsPanel({ lists }: { lists: ListSummary[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return lists;
    return lists.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [lists, query]);

  const create = (
    <Button variant="solid" size="md" onClick={() => setOpen(true)}>
      <Plus />
      Create list
    </Button>
  );

  return (
    <>
      <PageHeader title="Lists" count={lists.length}>
        {create}
      </PageHeader>

      {lists.length > 2 ? (
        <Toolbar>
          <SearchBox value={query} onChange={setQuery} placeholder="Search lists…" />
        </Toolbar>
      ) : null}

      <Surface>
        {lists.length === 0 ? (
          <Empty
            icon={<ListChecks />}
            title="No lists yet"
            hint="A list is a group of people who agreed to hear from you. A broadcast goes to one, so this is the first thing to make."
          >
            {create}
          </Empty>
        ) : shown.length === 0 ? (
          <Empty
            icon={<ListChecks />}
            title="Nothing matches"
            hint="No list matches what you have typed."
          />
        ) : (
          shown.map((entry) => (
            <Link key={entry.id} href={`/campaigns/lists/${entry.id}`} className="block">
              <Row>
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-4">
                  <ListChecks />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{entry.name}</div>
                  <div className="mt-0.5 text-[12px] text-muted-foreground">
                    {entry.subscribed.toLocaleString()} subscribed
                    {entry.total > entry.subscribed
                      ? ` · ${(entry.total - entry.subscribed).toLocaleString()} not`
                      : ""}
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Row>
            </Link>
          ))
        )}
      </Surface>

      <Dialog open={open} onOpenChange={setOpen}>
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
                setOpen(false);
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
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="solid" type="submit" form="new-list" disabled={busy || !name.trim()}>
              Create list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
