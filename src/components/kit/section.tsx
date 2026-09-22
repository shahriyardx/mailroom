"use client";

import { createContext, useContext } from "react";

/**
 * Which kind of screen a panel is sitting on.
 *
 * Settings and the campaigns view want the same panels to look different.
 * A settings screen is a long divided list you scan once a quarter; an
 * application screen is a page somebody works in, where each block is its own
 * surface and the headings carry more weight.
 *
 * A context rather than a prop because the panels are nested several deep
 * inside components that have no business knowing where they are rendered.
 * The provider is a client component high in the tree, so panels rendered by
 * server components below it still read it.
 */
export type SectionKind = "settings" | "app";

const SectionContext = createContext<SectionKind>("settings");

export function SectionProvider({
  kind,
  children,
}: {
  kind: SectionKind;
  children: React.ReactNode;
}) {
  return <SectionContext.Provider value={kind}>{children}</SectionContext.Provider>;
}

export function useSection() {
  return useContext(SectionContext);
}
