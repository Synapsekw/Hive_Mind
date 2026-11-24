import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { createServerSupabase } from "../lib/supabase/server";
import { AccountProvider } from "../shell/AccountContext";
import { ClosingBanner } from "../shell/ClosingBanner";
import { FoldProvider } from "../shell/FoldProvider";
import { HiveActionsProvider } from "../shell/HiveActions";
import { LookProvider } from "../shell/LookProvider";
import { FOLD_COOKIE, parseFold } from "../shell/fold";
import { LOOK_COOKIE, parseLook } from "../theme/look";
import { loadAccount, type Account } from "./account";
import { cancelHiveDeletion, createHive, switchHive } from "./hives/actions";
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
  // Likewise which sides are folded, so the first paint has the right widths.
  const fold = parseFold(jar.get(FOLD_COOKIE)?.value);
  // The signed-in member for the rail. /login and /dev/* have no session: null there, and a
  // failure never breaks a page.
  let account: Account | null = null;
  try {
    account = await loadAccount(await createServerSupabase());
  } catch {
    account = null;
  }
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable}`}
      data-theme={look.theme}
      data-mode={look.mode}
      data-reach={look.reach}
      data-dots={look.dots}
      data-rail={fold.rail}
      data-panel={fold.panel}
    >
      <body>
        <LookProvider initial={look}>
          <FoldProvider initial={fold}>
            <AccountProvider account={account}>
              <HiveActionsProvider
                actions={{ switchHive, createHive, cancelHiveDeletion }}
              >
                {/* Draws nothing unless the hive on show is being deleted. */}
                <ClosingBanner />
                {children}
              </HiveActionsProvider>
            </AccountProvider>
          </FoldProvider>
        </LookProvider>
      </body>
    </html>
  );
}
