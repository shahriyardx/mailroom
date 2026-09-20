"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";

import { cn } from "@/lib/utils";

type TabsVariant = "underline" | "segmented";

/**
 * The list decides the look; triggers read it from here rather than from a
 * selector, so the styling stays plain Tailwind with no ancestor guessing.
 */
const VariantContext = React.createContext<TabsVariant>("underline");

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  variant = "underline",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <VariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(
          "inline-flex items-center",
          variant === "underline" && "h-9 gap-4 border-b border-border",
          variant === "segmented" && "h-8 gap-0.5 rounded-full bg-muted p-0.5",
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </VariantContext.Provider>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(VariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium outline-none",
        "text-muted-foreground transition-colors duration-150 hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "underline" && [
          "relative h-9 px-0.5 data-[state=active]:text-foreground",
          // The active marker sits on the list's own bottom hairline.
          "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full",
          "after:bg-transparent data-[state=active]:after:bg-primary",
        ],
        variant === "segmented" && [
          "h-7 rounded-full px-3",
          "data-[state=active]:bg-card data-[state=active]:text-foreground",
          "data-[state=active]:shadow-raise",
        ],
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
