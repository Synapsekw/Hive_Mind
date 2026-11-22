import type { BrowserContext } from "@playwright/test";

// The test server's origin; keep in step with the port in playwright.config.ts.
const ORIGIN = "http://localhost:3100";

/** Sets the `hive-look` cookie (`<theme>.<mode>.<reach>.<dots>`) as the Appearance panel would. */
export async function setLook(
  context: BrowserContext,
  look: string,
): Promise<void> {
  await context.addCookies([
    { name: "hive-look", value: look, url: ORIGIN, sameSite: "Lax" },
  ]);
}
