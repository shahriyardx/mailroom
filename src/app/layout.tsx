import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/** Product voice: page titles, empty states, the wordmark. */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

/** Everything read as language. */
const ui = Figtree({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

/** Everything read as data: addresses, timestamps, sizes, DNS values. */
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mail",
  description: "Self-hosted mail on Amazon SES and Cloudflare",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Applies the saved theme before paint so there is no flash of the wrong colours.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: required for pre-paint theme
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}>
        {children}
      </body>
    </html>
  );
}
