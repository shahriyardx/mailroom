"use client";

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/kit";
import { cn } from "@/lib/utils";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

/**
 * A day and a time, picked without the browser's own control.
 *
 * `<input type="datetime-local">` opens a panel the browser positions itself,
 * and in a three-hundred-pixel inspector against the edge of the window most
 * of that panel is off screen — the part with the days in it. Nothing can be
 * done about it from here: it is drawn outside the page.
 *
 * So this is a popover the page owns, which means it can be kept on screen.
 * It is also the same control in every browser, which the native one is
 * emphatically not.
 */

/** Named as well as lettered, because two of the letters repeat. */
const DAYS = [
  { key: "sunday", letter: "S" },
  { key: "monday", letter: "M" },
  { key: "tuesday", letter: "T" },
  { key: "wednesday", letter: "W" },
  { key: "thursday", letter: "T" },
  { key: "friday", letter: "F" },
  { key: "saturday", letter: "S" },
];

/** Quarter hours. A flow that fires at 09:07 is nobody's intention. */
const MINUTES = [0, 15, 30, 45];

/** Every hour of the day, as its own value rather than as a position. */
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** Every box in the grid: the days of this month, padded to whole weeks. */
function monthGrid(of: Date) {
  const first = new Date(of.getFullYear(), of.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());

  return Array.from({ length: 42 }, (_, step) => {
    const day = new Date(start);
    day.setDate(start.getDate() + step);
    return day;
  });
}

export function MomentField({
  value,
  onChange,
  emptyLabel,
  className,
  disabled = false,
}: {
  /** Null is allowed only where `emptyLabel` says what null means. */
  value: Date | null;
  onChange: (next: Date | null) => void;
  /** What to show, and to go back to, when nothing is chosen. */
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const today = new Date();
  /*
   * What the grid does its arithmetic against.
   *
   * Nothing chosen still needs a day to draw a month around, and the useful
   * one is now — somebody scheduling something is far more often looking at
   * this month than at one a year away.
   */
  const anchor = value ?? today;

  /** Which month is on screen. Not the choice — just what is being looked at. */
  const [month, setMonth] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));

  function moveMonth(by: number) {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + by, 1));
  }

  /** Keeps the time, changes the day. */
  function pickDay(day: Date) {
    const next = new Date(day);
    next.setHours(anchor.getHours(), value ? anchor.getMinutes() : 0, 0, 0);
    onChange(next);
  }

  /** Keeps the day, changes the time. */
  function pickTime(hours: number, minutes: number) {
    const next = new Date(anchor);
    next.setHours(hours, minutes, 0, 0);
    onChange(next);
  }

  const said = value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value)
    : (emptyLabel ?? "Pick a moment");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-start font-normal", className)}
          disabled={disabled}
        >
          <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !value && "text-muted-foreground")}>{said}</span>
        </Button>
      </PopoverTrigger>

      {/* Radix keeps this inside the window, which is the whole point. */}
      <PopoverContent align="start" className="w-[260px] p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => moveMonth(-1)}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-[12.5px] font-medium">
            {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => moveMonth(1)}
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px">
          {DAYS.map((day) => (
            <span
              key={day.key}
              aria-label={day.key}
              className="grid h-6 place-items-center text-[10.5px] text-muted-foreground"
            >
              {day.letter}
            </span>
          ))}

          {monthGrid(month).map((day) => {
            const outside = day.getMonth() !== month.getMonth();
            const chosen = Boolean(value) && sameDay(day, anchor);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => pickDay(day)}
                className={cn(
                  "grid h-7 place-items-center rounded-md text-[12px] transition-colors",
                  chosen
                    ? "bg-primary font-medium text-primary-foreground"
                    : outside
                      ? "text-muted-foreground/40 hover:bg-accent"
                      : "hover:bg-accent",
                  // Today is worth marking, but not louder than the choice.
                  !chosen && sameDay(day, today) && "font-semibold text-primary",
                )}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-center gap-1.5 border-border border-t pt-2.5">
          <Select
            value={String(anchor.getHours())}
            onValueChange={(hours) => pickTime(Number(hours), anchor.getMinutes())}
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HOURS.map((hour) => (
                <SelectItem key={hour} value={String(Number(hour))}>
                  {hour}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[12.5px] text-muted-foreground">:</span>
          <Select
            value={String(MINUTES.includes(anchor.getMinutes()) ? anchor.getMinutes() : 0)}
            onValueChange={(minutes) => pickTime(anchor.getHours(), Number(minutes))}
          >
            <SelectTrigger className="h-8 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINUTES.map((minute) => (
                <SelectItem key={minute} value={String(minute)}>
                  {String(minute).padStart(2, "0")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Only where nothing chosen means something — "send now", rather than
            an empty field somebody forgot to fill in. */}
        {emptyLabel && value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {emptyLabel}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
