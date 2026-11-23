"use client";

// The one place an agent's token is ever shown: a modal straight after the agent is created.
// The token arrives as a prop from the screen's state and is drawn here and nowhere else; this
// file writes it to no storage, no address, no log and no attribute. The dialog cannot be lost
// by accident: Escape and a click outside do nothing, only Done closes it, and with it the
// screen drops the token.
import { useEffect, useId, useRef, useState } from "react";
import { MCP_COMMAND, envLine } from "./text";
import s from "./settings.module.css";

/** How long the Copy button says "Copied". */
const COPIED_MS = 2000;
const BY_HAND = "Select the token and copy it by hand.";

export function TokenDialog({
  token,
  agentName,
  onDone,
}: {
  token: string;
  agentName: string;
  onDone: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [byHand, setByHand] = useState(false);
  const titleId = useId();
  const warningId = useId();
  const fieldId = useId();

  useEffect(() => {
    copyButton.current?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Heard on the document, so they hold wherever the focus is: Escape closes nothing, and Tab
  // turns round at either end of the dialog. The page behind is inert.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (!el) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== "Tab") return;
      const stops = [...el.querySelectorAll<HTMLElement>("button, input")];
      if (stops.length === 0) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const edge = e.shiftKey ? 0 : stops.length - 1;
      if (at === -1 || at === edge) {
        e.preventDefault();
        stops[e.shiftKey ? stops.length - 1 : 0]!.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(token);
      ok = true;
    } catch {
      ok = false;
    }
    if (timer.current) clearTimeout(timer.current);
    setByHand(!ok);
    setCopied(ok);
    if (ok) timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className={s.scrim}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={warningId}
        className={s.dialog}
      >
        <h2 id={titleId} className={s.dialogTitle}>
          Token for {agentName}
        </h2>
        <p id={warningId} className={s.warning}>
          This token is shown once. Copy it now; it cannot be shown again.
        </p>
        <div className={s.tokenRow}>
          <label htmlFor={fieldId} className={s.srOnly}>
            Token
          </label>
          <input
            id={fieldId}
            type="text"
            readOnly
            value={token}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className={s.token}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            ref={copyButton}
            type="button"
            className={s.primary}
            data-copy
            onClick={copy}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p aria-live="polite" className={byHand ? s.refused : s.srOnly}>
          {byHand ? BY_HAND : copied ? "Token copied." : ""}
        </p>
        <section aria-labelledby={`${titleId}-how`} className={s.how}>
          <h3 id={`${titleId}-how`} className={s.label}>
            What to do with it
          </h3>
          <ol className={s.steps}>
            <li>
              <p className={s.step}>
                For Claude Code, put this line in the <code>.env</code> file of
                your Hive_Mind folder:
              </p>
              <pre className={s.code}>
                <code>{envLine(token)}</code>
              </pre>
            </li>
            <li>
              <p className={s.step}>Add the server once, with your own path:</p>
              <pre className={s.code}>
                <code>{MCP_COMMAND}</code>
              </pre>
            </li>
            <li>
              <p className={s.step}>
                Then give the agent the instruction file from
                docs/agent-integration.md, section 5.
              </p>
            </li>
          </ol>
        </section>
        <div className={s.dialogFoot}>
          <button type="button" className={s.confirm} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
