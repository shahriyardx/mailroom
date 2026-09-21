"use client";

import type { Mailbox } from "@/db/schema";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Composer, type ComposerDraft } from "./composer";

interface ComposerApi {
  open: (draft?: ComposerDraft) => void;
  close: () => void;
  isOpen: boolean;
  /** False when this person holds no mailbox they may send as. */
  canWrite: boolean;
  /** Whether a reply could be sent from this particular mailbox. */
  canWriteAs: (mailboxId: string) => boolean;
}

const Context = createContext<ComposerApi | null>(null);

export function useComposer() {
  const value = useContext(Context);
  if (!value) throw new Error("useComposer must be used inside ComposerProvider");
  return value;
}

export function ComposerProvider({
  mailboxes,
  children,
}: {
  mailboxes: Mailbox[];
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ComposerDraft | null>(null);

  const open = useCallback((next?: ComposerDraft) => setDraft(next ?? {}), []);
  const close = useCallback(() => setDraft(null), []);
  const canWriteAs = useCallback(
    (mailboxId: string) => mailboxes.some((box) => box.id === mailboxId),
    [mailboxes],
  );

  const api = useMemo(
    () => ({
      open,
      close,
      isOpen: draft !== null,
      canWrite: mailboxes.length > 0,
      canWriteAs,
    }),
    [open, close, draft, mailboxes, canWriteAs],
  );

  return (
    <Context.Provider value={api}>
      {children}
      {draft && <Composer draft={draft} mailboxes={mailboxes} onClose={close} />}
    </Context.Provider>
  );
}
