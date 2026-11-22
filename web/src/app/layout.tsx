import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { LookProvider } from "../shell/LookProvider";
import { LOOK_COOKIE, parseLook } from "../theme/look";
import "./globals.css";

// Self-hosted variable fonts (latin, normal style), copied from @fontsource-variable/* with
// their licences beside them. No request to a font service at build or run time.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "400 600",
  display: "swap",
  variable: "--font-sans",
});
const mono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "400 500",
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Hive",
  description: "Shared memory for small expert teams.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The cookie is not trusted: only the four checked values reach the page.
  const jar = await cookies();
  const look = parseLook(jar.get(LOOK_COOKIE)?.value);
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable}`}
      data-theme={look.theme}
      data-mode={look.mode}
      data-reach={look.reach}
      data-dots={look.dots}
    >
      <body>
        <LookProvider initial={look}>{children}</LookProvider>
      </body>
    </html>
  );
}
