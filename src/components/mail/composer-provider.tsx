"use client";

import type { Mailbox } from "@/db/schema";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Composer, type ComposerDraft } from "./composer";

interface ComposerApi {
  open: (draft?: ComposerDraft) => void;
  close: () => void;
  isOpen: boolean;
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

  const api = useMemo(() => ({ open, close, isOpen: draft !== null }), [open, close, draft]);

  return (
    <Context.Provider value={api}>
      {children}
      {draft && <Composer draft={draft} mailboxes={mailboxes} onClose={close} />}
    </Context.Provider>
  );
}
