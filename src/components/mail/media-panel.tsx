"use client";

import {
  BlankSlate,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  IconButton,
  Panel,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/kit";
import { cn, formatBytes } from "@/lib/utils";
import { deleteMediaAction } from "@/server/actions";
import { Check, Copy, ImageIcon, RotateCw, Trash2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * The files an account can put in its own mail.
 *
 * One flat list, newest first. A mail account's picture library is a handful
 * of logos and headers, and folders, tags and search are all things to
 * maintain for a list that fits on one screen.
 */

export interface MediaItem {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  createdAt?: string | Date;
}

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
const ALLOWED = ACCEPT.split(",");
const MAX_BYTES = 10 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Uploading                                                                  */
/* -------------------------------------------------------------------------- */

interface Pending {
  key: string;
  file: File;
  filename: string;
  sizeBytes: number;
  /** A local address for the bytes, so the picture is on screen immediately. */
  preview: string | null;
  progress: number;
  error: string | null;
}

/**
 * One file, with the bar moving.
 *
 * XMLHttpRequest rather than fetch, which is the whole reason: fetch cannot
 * report how much of a request body has gone, so a ten-megabyte picture would
 * be a spinner for as long as it took and nothing else.
 */
function putOne(file: File, onProgress: (fraction: number) => void): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("files", file);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/media");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };

    request.onload = () => {
      let payload: { media?: MediaItem[]; error?: string } = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        // Falls through to the message below.
      }
      const saved = payload.media?.[0];
      if (request.status >= 200 && request.status < 300 && saved) resolve(saved);
      else reject(new Error(payload.error ?? "The upload failed"));
    };

    request.onerror = () => reject(new Error("The upload failed"));
    request.send(form);
  });
}

/**
 * The queue behind both the page and the picker.
 *
 * Files are sent one at a time on purpose. Ten at once share the same line and
 * every bar crawls together, which reads as nothing happening; one at a time,
 * each finishes and leaves.
 */
function useUploads(onSaved: (item: MediaItem) => void) {
  const [pending, setPending] = useState<Pending[]>([]);
  const running = useRef(false);
  const queue = useRef<Pending[]>([]);

  const patch = useCallback((key: string, changes: Partial<Pending>) => {
    setPending((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...changes } : entry)),
    );
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;

    while (queue.current.length > 0) {
      const next = queue.current.shift()!;
      try {
        const saved = await putOne(next.file, (fraction) =>
          patch(next.key, { progress: fraction }),
        );
        onSaved(saved);
        if (next.preview) URL.revokeObjectURL(next.preview);
        setPending((current) => current.filter((entry) => entry.key !== next.key));
      } catch (error) {
        patch(next.key, {
          error: error instanceof Error ? error.message : "The upload failed",
          progress: 0,
        });
      }
    }

    running.current = false;
  }, [onSaved, patch]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const fresh: Pending[] = [];

      for (const file of files) {
        // Checked here as well as on the server, so a file that was never
        // going to be taken is refused before it is sent rather than after.
        const type = file.type || "application/octet-stream";
        const error = !ALLOWED.includes(type)
          ? "Not a kind of file mail can show"
          : file.size > MAX_BYTES
            ? "Over 10 MB"
            : null;

        fresh.push({
          key: `${file.name}-${file.size}-${fresh.length}-${performance.now()}`,
          file,
          filename: file.name,
          sizeBytes: file.size,
          preview: type.startsWith("image/") ? URL.createObjectURL(file) : null,
          progress: 0,
          error,
        });
      }

      setPending((current) => [...fresh, ...current]);
      queue.current.push(...fresh.filter((entry) => !entry.error));
      void drain();
    },
    [drain],
  );

  const retry = useCallback(
    (key: string) => {
      setPending((current) => {
        const entry = current.find((item) => item.key === key);
        if (entry) {
          queue.current.push({ ...entry, error: null, progress: 0 });
          void drain();
        }
        return current.map((item) =>
          item.key === key ? { ...item, error: null, progress: 0 } : item,
        );
      });
    },
    [drain],
  );

  const dismiss = useCallback((key: string) => {
    setPending((current) => {
      const entry = current.find((item) => item.key === key);
      if (entry?.preview) URL.revokeObjectURL(entry.preview);
      return current.filter((item) => item.key !== key);
    });
  }, []);

  const busy = pending.some((entry) => !entry.error);

  return { pending, add, retry, dismiss, busy };
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

export function MediaPanel({ media }: { media: MediaItem[] }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<MediaItem | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /*
   * What has been uploaded in this tab but is not in the page's own data yet.
   * The row exists the moment the upload finishes; the page only learns about
   * it when the server sends it back. Holding it here means a finished upload
   * turns into a real card at once rather than blinking out and returning.
   */
  const [fresh, setFresh] = useState<MediaItem[]>([]);

  const { pending, add, retry, dismiss, busy } = useUploads(
    useCallback(
      (item: MediaItem) => {
        setFresh((current) => [item, ...current]);
        router.refresh();
      },
      [router],
    ),
  );

  const known = new Set(media.map((item) => item.id));
  const shown = [...fresh.filter((item) => !known.has(item.id)), ...media];
  const bytes = shown.reduce((sum, item) => sum + item.sizeBytes, 0);

  return (
    <Panel
      title="Media"
      description="Pictures and files your mail can point at. Anyone with the address can fetch one."
      meta={shown.length > 0 ? `${shown.length} · ${formatBytes(bytes)}` : undefined}
      action={
        <Button variant="solid" pill onClick={() => input.current?.click()}>
          <Upload />
          Upload
        </Button>
      }
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) add(event.target.files);
          event.target.value = "";
        }}
      />

      <DropZone onFiles={add}>
        {shown.length === 0 && pending.length === 0 ? (
          <BlankSlate
            icon={<ImageIcon />}
            title="Nothing uploaded yet"
            hint="Drop a picture here, or press Upload. PNG, JPEG, GIF, WebP and PDF, up to 10 MB each."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {/* Going up, so a file being sent is where the newest one lands. */}
            {pending.map((entry) => (
              <PendingCard
                key={entry.key}
                entry={entry}
                onRetry={() => retry(entry.key)}
                onDismiss={() => dismiss(entry.key)}
              />
            ))}
            {shown.map((item) => (
              <MediaCard key={item.id} item={item} onDelete={() => setRemoving(item)} />
            ))}
          </div>
        )}
      </DropZone>

      {busy && (
        <p className="pt-3 text-[12px] text-muted-foreground">
          Uploading {pending.filter((entry) => !entry.error).length}…
        </p>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title="Take this out of the library?"
        description={removing?.filename}
        consequences={
          <>
            Mail already sent keeps working — the file itself stays where it is, because a message
            somebody opens next year still asks for it. It only stops being offered here.
          </>
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          await deleteMediaAction(removing.id);
          setFresh((current) => current.filter((item) => item.id !== removing.id));
          setRemoving(null);
          toast.success("Removed");
          router.refresh();
        }}
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

/** The whole area takes a drop, not a small dashed square inside it. */
function DropZone({
  onFiles,
  children,
}: {
  onFiles: (files: FileList | File[]) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer.files?.length) onFiles(event.dataTransfer.files);
      }}
      className={cn(
        "rounded-xl transition-colors",
        over && "outline-2 outline-primary outline-dashed outline-offset-4",
      )}
    >
      {children}
    </div>
  );
}

function PendingCard({
  entry,
  onRetry,
  onDismiss,
}: {
  entry: Pending;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const percent = Math.round(entry.progress * 100);

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        entry.error ? "border-destructive/50" : "border-border",
      )}
    >
      <div className="relative h-28 bg-muted">
        {entry.preview ? (
          // The file itself, straight off the disk, before it has gone anywhere.
          <img
            src={entry.preview}
            alt=""
            className={cn("h-full w-full object-contain", !entry.error && "opacity-60")}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[11.5px] text-muted-foreground">
            {entry.filename.split(".").pop()?.toUpperCase() ?? "FILE"}
          </div>
        )}

        {!entry.error && (
          <span className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 rounded-full bg-card/90 px-2 py-0.5 font-medium text-[11px] tabular-nums">
            {percent}%
          </span>
        )}
      </div>

      {/* The bar sits on the join, where it reads as the picture filling up. */}
      <div className="h-[3px] bg-muted">
        <div
          className={cn(
            "h-full transition-[width] duration-200",
            entry.error ? "bg-destructive" : "bg-primary",
          )}
          style={{ width: entry.error ? "100%" : `${Math.max(percent, 4)}%` }}
        />
      </div>

      <figcaption className="flex items-center gap-1 px-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px]" title={entry.filename}>
            {entry.filename}
          </span>
          <span
            className={cn(
              "text-[11px]",
              entry.error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {entry.error ?? formatBytes(entry.sizeBytes)}
          </span>
        </span>

        {entry.error && (
          <>
            <IconButton size="sm" label={`Try ${entry.filename} again`} onClick={onRetry}>
              <RotateCw className="size-3.5" />
            </IconButton>
            <IconButton size="sm" label={`Forget ${entry.filename}`} onClick={onDismiss}>
              <X className="size-3.5" />
            </IconButton>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function MediaCard({ item, onDelete }: { item: MediaItem; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <Thumbnail item={item} />

      <figcaption className="flex items-center gap-1 px-2.5 py-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px]" title={item.filename}>
            {item.filename}
          </span>
          <span className="text-[11px] text-muted-foreground">{formatBytes(item.sizeBytes)}</span>
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              size="sm"
              label={`Copy the address of ${item.filename}`}
              onClick={() => {
                void navigator.clipboard.writeText(item.url);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy address"}</TooltipContent>
        </Tooltip>

        <IconButton variant="danger" size="sm" label={`Remove ${item.filename}`} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </IconButton>
      </figcaption>
    </figure>
  );
}

function Thumbnail({ item }: { item: MediaItem }) {
  if (!item.contentType.startsWith("image/")) {
    return (
      <div className="flex h-28 items-center justify-center bg-muted text-[11.5px] text-muted-foreground">
        {item.contentType.split("/")[1]?.toUpperCase() ?? "FILE"}
      </div>
    );
  }

  return (
    // A checkerboard behind it, so a transparent logo is not a blank square.
    <div className="h-28 bg-[repeating-conic-gradient(rgba(127,127,127,0.12)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
      {/* Uploaded pictures, served by us, at a size next/image cannot know. */}
      <img
        src={item.url}
        alt={item.filename}
        loading="lazy"
        className="h-full w-full object-contain"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Choosing one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The library as a dialog, for the places that need an address rather than a
 * page: the image block in the builder. It uploads too, because having to
 * leave, upload and come back is how a picker becomes a detour.
 */
export function MediaPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: MediaItem) => void;
}) {
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const alone = useRef(false);

  const { pending, add, retry, dismiss, busy } = useUploads(
    useCallback(
      (item: MediaItem) => {
        setMedia((current) => [item, ...(current ?? [])]);
        // One file, dropped in on its own, was chosen by being dropped.
        if (alone.current) {
          onPick(item);
          onOpenChange(false);
        }
      },
      [onPick, onOpenChange],
    ),
  );

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetch("/api/media")
      .then((response) => response.json())
      .then((payload) => {
        if (alive) setMedia(payload.media ?? []);
      })
      .catch(() => alive && setMedia([]));
    return () => {
      alive = false;
    };
  }, [open]);

  function take(files: FileList | File[]) {
    alone.current = files.length === 1;
    add(files);
  }

  const pictures = (media ?? []).filter((item) => item.contentType.startsWith("image/"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Choose a picture</DialogTitle>
          <DialogDescription>
            From the media library. Anything uploaded here is kept there too.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files?.length) take(event.target.files);
            event.target.value = "";
          }}
        />

        <DropZone onFiles={take}>
          <div className="max-h-[52vh] min-h-[180px] overflow-y-auto px-0.5">
            {media === null ? (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {[0, 1, 2, 3].map((slot) => (
                  <div key={slot} className="h-[136px] animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : pictures.length === 0 && pending.length === 0 ? (
              <BlankSlate
                icon={<ImageIcon />}
                title="Nothing here yet"
                hint="Drop a picture in, or press Upload below."
              />
            ) : (
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
                {pending.map((entry) => (
                  <PendingCard
                    key={entry.key}
                    entry={entry}
                    onRetry={() => retry(entry.key)}
                    onDismiss={() => dismiss(entry.key)}
                  />
                ))}
                {pictures.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onPick(item);
                      onOpenChange(false);
                    }}
                    className="overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-primary"
                  >
                    <Thumbnail item={item} />
                    <span className="block truncate px-2 py-1.5 text-[11.5px]">
                      {item.filename}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DropZone>

        <div className="flex items-center justify-end gap-2">
          {busy && (
            <span className="mr-auto text-[12px] text-muted-foreground">
              Uploading {pending.filter((entry) => !entry.error).length}…
            </span>
          )}
          <Button variant="outline" size="sm" pill onClick={() => input.current?.click()}>
            <Upload />
            Upload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
