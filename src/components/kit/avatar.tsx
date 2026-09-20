"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Twelve tints that all sit at the same lightness, so no sender ever shouts
 * louder than another. The hue is picked from the address, not at random, so
 * the same person keeps the same colour on every screen and every reload.
 */
const HUES = [12, 42, 78, 112, 152, 185, 215, 245, 278, 305, 330, 352];

function hueFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return HUES[hash % HUES.length];
}

export function initialsFor(name: string | null | undefined, address?: string | null) {
  const source = (name ?? "").trim() || (address ?? "").split("@")[0] || "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const SIZES = {
  xs: "size-6 text-[10px]",
  sm: "size-7 text-[11px]",
  md: "size-8 text-[11.5px]",
  lg: "size-10 text-[13px]",
  xl: "size-12 text-[15px]",
} as const;

interface AvatarProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  /** Drives both the initials and the colour. */
  name?: string | null;
  address?: string | null;
  src?: string | null;
  size?: keyof typeof SIZES;
}

export function Avatar({ className, name, address, src, size = "md", ...props }: AvatarProps) {
  const seed = (address || name || "?").toLowerCase();
  const hue = hueFor(seed);

  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex shrink-0 select-none overflow-hidden rounded-full",
        SIZES[size],
        className,
      )}
      {...props}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={name ?? address ?? ""}
          className="aspect-square size-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex size-full items-center justify-center font-semibold"
        style={{
          backgroundColor: `oklch(0.93 0.045 ${hue})`,
          color: `oklch(0.42 0.13 ${hue})`,
        }}
      >
        {initialsFor(name, address)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
