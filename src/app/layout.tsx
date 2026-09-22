import { ProgressBar } from "@/components/kit/progress-bar";
import { TooltipProvider } from "@/components/kit/tooltip";
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
  title: "Mailroom",
  description: "Self-hosted mail on Amazon SES and Cloudflare",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          // Applies the saved theme before paint so there is no flash of the
          // wrong colours. "system" follows the device; anything else but
          // "light" is dark, which is also what an unset value means.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: required for pre-paint theme
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");var d=t==="light"?false:t==="system"?matchMedia("(prefers-color-scheme: dark)").matches:true;document.documentElement.classList.toggle("dark",d)}catch(e){document.documentElement.classList.add("dark")}`,
          }}
        />
      </head>
      <body className={`${display.variable} ${ui.variable} ${mono.variable} h-full antialiased`}>
        {/* Every page can use a tooltip and every page can be navigated to,
            so both providers live at the root rather than inside one screen's
            shell. */}
        <ProgressBar>
          <TooltipProvider>{children}</TooltipProvider>
        </ProgressBar>
      </body>
    </html>
  );
}
