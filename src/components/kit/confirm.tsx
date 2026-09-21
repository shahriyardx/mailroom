"use client";

import { useEffect, useId, useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";

/**
 * The dialog that stands between somebody and something they cannot undo.
 *
 * Two strengths. Without `phrase` it is a stop — one button, one moment to
 * read what is about to happen. With `phrase` the button stays dead until
 * that exact text is typed, which is the difference between confirming and
 * merely clicking: a name has to be read off the row to be typed back.
 *
 * Reserve the typed form for what destroys mail, breaks a live integration,
 * or reaches outside this app. Everything else is a stop.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  /** Exactly what is lost. Written plainly, because this is the last place to say it. */
  consequences,
  phrase,
  confirmLabel = "Delete",
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  consequences?: React.ReactNode;
  phrase?: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  /** Anything else to decide before confirming, such as how far to delete. */
  children?: React.ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [running, start] = useTransition();
  const fieldId = useId();

  // Reopening after a cancel must not inherit what was typed last time.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const ready = !phrase || typed.trim() === phrase;

  return (
    <Dialog open={open} onOpenChange={running ? undefined : onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {consequences && (
          <div className="rounded-xl bg-danger-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-destructive">
            {consequences}
          </div>
        )}

        {children}

        {phrase && (
          <div>
            <label htmlFor={fieldId} className="mb-1.5 block text-[12.5px] text-muted-foreground">
              Type <span className="font-mono text-foreground">{phrase}</span> to confirm
            </label>
            <Input
              id={fieldId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              mono
              // Nothing here should be guessable from muscle memory.
              placeholder={phrase}
              className={cn(typed && !ready && "border-destructive")}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" pill disabled={running} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            pill
            disabled={!ready || running}
            loading={running}
            onClick={() => start(async () => await onConfirm())}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
