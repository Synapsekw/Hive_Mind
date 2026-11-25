"use client";

// The settings screen: the hive's name, then tabs (Agents, Workspaces, Topics, People, Hive; a
// member has no Topics and no Hive), each panel in its own file. The screen decides nothing
// about who may create, revoke or invite: it calls `actions` and the database answers. What is
// listed always comes from `data`, so a refresh from the server is what changes it. The chosen
// tab, the forms, the revoke question, the invitation notice and the token dialog are client
// state only; one form or question is open at a time. Every panel stays mounted while another
// is shown, and the tab is kept in the address (`?tab=`) by replacing it in place.
// A new agent's token is held in this component's state from the moment `createAgent`
// answers until Done, is drawn only by `TokenDialog`, and is written nowhere else. Because it
// cannot be fetched again, the page is inert from Create until Done, leaving asks first, and
// Back stays here while the dialog is open.
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Shell } from "../shell/Shell";
import { AgentsTab } from "./AgentsTab";
import { HiveTab } from "./HiveTab";
import { PeopleTab } from "./PeopleTab";
import { TokenDialog } from "./TokenDialog";
import { Topics } from "./Topics";
import { WorkspacesTab } from "./WorkspacesTab";
import { TAB_NAMES, tabCount, tabsFor, type Tab } from "./tabs";
import {
  FAILED,
  inviteFailure,
  sendFailure,
  sentAgain,
  sortAgents,
} from "./text";
import type {
  Agent,
  Created,
  Deletion,
  Invitation,
  Invited,
  NewAgent,
  Sent,
  SettingsActions,
  SettingsData,
} from "./types";
import s from "./settings.module.css";

/** A confirming Revoke sooner than this after the question opened is taken as a double click. */
const CONFIRM_AFTER_MS = 500;
/** How long Done waits for its own step back in the history before reading the list anyway. */
const UNHOLD_MS = 1000;

/** What is open: a form, or the revoke question of one agent. Never two. */
export type Open =
  { kind: "connect" } | { kind: "invite" } | { kind: "revoke"; id: string };

/** Where the focus goes after the next render. */
type Target =
  | { button: "connect" | "invite" }
  | { form: "connect" | "invite" }
  | { row: string; pick?: "keep" | "revoke" };

/** Whether a new invitation's email went out. Kept until dismissed. */
export type Notice = { name: string; email: string; sent: boolean };

const withId = (set: ReadonlySet<string>, id: string) => new Set(set).add(id);
const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};
const forgetting = (map: ReadonlyMap<string, string>, id: string) => {
  const next = new Map(map);
  next.delete(id);
  return next;
};

export function Settings({
  data,
  now,
  actions,
  inbox,
  deletion = null,
  closing = null,
  tab: initialTab = "agents",
}: {
  data: SettingsData;
  now: number;
  actions: SettingsActions;
  inbox: number | undefined;
  /** What deleting the hive would erase; null when it is not known. Shown to the owner only. */
  deletion?: Deletion | null;
  /** When the hive will be erased, while it is being deleted. */
  closing?: string | null;
  /** The tab open at first, from the address. */
  tab?: Tab;
}) {
  const router = useRouter();
  // Which tab is open. Client state only: every panel stays mounted, so a running Find topics
  // or a half-typed form survives a switch, and the address is rewritten in place.
  const [tab, setTab] = useState<Tab>(initialTab);
  const shownTabs = tabsFor(data.isOwner);
  const [open, setOpen] = useState<Open | null>(null);
  // What is running: a form's key or an agent's id.
  const [busy, setBusy] = useState<string | null>(null);
  // Agents and invitations whose revoke was refused, and the agents answered `ok` before the
  // refresh brings them.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  // Invitations answered `ok` to a revoke before the refresh takes them away.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  // Invitations whose Send again was refused, each with the sentence that says why.
  const [unsent, setUnsent] = useState<ReadonlyMap<string, string>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  // The new agent's token, from the answer until Done. Only the dialog draws it.
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(
    null,
  );
  const [said, setSaid] = useState("");
  // The same as `busy`, readable at once by a second press that arrives before the render.
  const running = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const target = useRef<Target | null>(null);
  // When the revoke question was last opened.
  const askedAt = useRef(0);
  // True while the history holds the extra entry that keeps Back on this page.
  const held = useRef(false);
  const creating = busy === "connect";
  const shown = fresh !== null;

  // From Create until Done the token exists only here, so a reload or a closed tab asks first.
  useEffect(() => {
    if (!creating && !shown) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = true;
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [creating, shown]);

  // While the dialog is open, Back and swipe-back stay on this page: one extra history entry
  // is put on top, and each time it is left it is put back. The entry carries no data of ours;
  // the token never goes near the history.
  useEffect(() => {
    if (!shown) return;
    const hold = () => window.history.pushState(null, "");
    if (!held.current) {
      held.current = true;
      hold();
    }
    const stay = () => {
      if (held.current) hold();
    };
    window.addEventListener("popstate", stay);
    return () => window.removeEventListener("popstate", stay);
  }, [shown]);

  const agents = sortAgents(
    data.agents.map((a) =>
      a.status === "active" && revoked.has(a.id)
        ? { ...a, status: "revoked" as const }
        : a,
    ),
  );
  const workspaceName = (id: string) =>
    data.workspaces.find((w) => w.id === id)?.name ?? null;
  const invitations = data.isOwner
    ? data.invitations.filter((i) => !gone.has(i.id))
    : [];

  // Runs after every render, once what was asked for is in the page and the page is no
  // longer inert.
  useEffect(() => {
    const want = target.current;
    if (!want) return;
    target.current = null;
    const root = panel.current;
    if (!root) return;
    let to: HTMLElement | null | undefined;
    if ("button" in want)
      to = root.querySelector<HTMLElement>(`[data-open="${want.button}"]`);
    else if ("form" in want)
      to = root.querySelector<HTMLElement>(`[data-form="${want.form}"] input`);
    else {
      const row = [...root.querySelectorAll<HTMLElement>("[data-row]")].find(
        (el) => el.dataset.row === want.row,
      );
      // Once the question has closed, "revoke" means the row's ⋯ button, which opens it.
      to = want.pick
        ? (row?.querySelector<HTMLElement>(`[data-pick="${want.pick}"]`) ??
          (want.pick === "revoke"
            ? row?.querySelector<HTMLElement>("[data-menu]")
            : null) ??
          row)
        : row;
      // A row that went under a closed fold (a revoked agent) cannot take the focus: its fold does.
      const fold = to?.closest("details:not([open])");
      if (fold) to = fold.querySelector<HTMLElement>("summary");
    }
    (to ?? heading.current)?.focus();
    // A form that opens low in the card is brought whole into view, not just its first field.
    if ("form" in want)
      to?.closest("form")?.scrollIntoView({ block: "nearest" });
  });

  function show(kind: "connect" | "invite") {
    if (running.current) return;
    target.current = { form: kind };
    setSaid("");
    setOpen({ kind });
  }

  function cancel(kind: "connect" | "invite") {
    if (running.current) return;
    target.current = { button: kind };
    setOpen(null);
  }

  /** True when the agent was created; the dialog then holds the token. */
  async function create(input: NewAgent): Promise<boolean> {
    if (running.current) return true;
    running.current = true;
    setBusy("connect");
    setSaid("");
    let answer: Created = { ok: false };
    try {
      answer = await actions.createAgent(input);
    } catch {
      answer = { ok: false };
    }
    running.current = false;
    setBusy(null);
    if (
      answer.ok !== true ||
      typeof answer.token !== "string" ||
      answer.token === ""
    ) {
      // The page was inert meanwhile and the focus left it: back into the form.
      target.current = { form: "connect" };
      setSaid(FAILED);
      return false;
    }
    setOpen(null);
    setFresh({ token: answer.token, name: input.name });
    return true;
  }

  /** Done in the dialog: the token leaves the state, and the list is read again. */
  function done() {
    setFresh(null);
    target.current = { button: "connect" };
    setSaid("Agent connected.");
    if (!held.current) {
      router.refresh();
      return;
    }
    // The extra history entry is taken away, so Back means what it meant before. The router
    // answers that move itself and would drop a refresh still under way, so the list is read
    // again only once the move has landed (or, should it never land, shortly after).
    held.current = false;
    let landed = false;
    const after = () => {
      if (landed) return;
      landed = true;
      window.removeEventListener("popstate", after);
      window.clearTimeout(timer);
      router.refresh();
    };
    window.addEventListener("popstate", after);
    const timer = window.setTimeout(after, UNHOLD_MS);
    window.history.back();
  }

  /** Null when the invitation was saved, else the sentence that says why not. */
  async function invite(email: string, name: string): Promise<string | null> {
    if (running.current) return null;
    running.current = true;
    setBusy("invite");
    setSaid("");
    let answer: Invited = { ok: false, reason: "failed" };
    try {
      answer = await actions.inviteMember(email, name);
    } catch {
      answer = { ok: false, reason: "failed" };
    }
    running.current = false;
    setBusy(null);
    if (answer.ok !== true || typeof answer.sent !== "boolean") {
      const why =
        (answer.ok === false ? inviteFailure(answer.reason) : null) ?? FAILED;
      setSaid(why);
      return why;
    }
    target.current = { button: "invite" };
    setOpen(null);
    // The notice says it itself: it is a status.
    setNotice({ name, email, sent: answer.sent });
    router.refresh();
    return null;
  }

  function dismiss() {
    target.current =
      open?.kind === "invite" ? { form: "invite" } : { button: "invite" };
    setNotice(null);
  }

  /** One step, no question: a revoked invitation can be made again. */
  async function revokeInvitation(invitation: Invitation) {
    if (running.current) return;
    running.current = true;
    setBusy(invitation.id);
    setFailed((set) => without(set, invitation.id));
    setUnsent((map) => forgetting(map, invitation.id));
    setSaid("");
    let ok = false;
    try {
      ok = (await actions.revokeInvitation(invitation.id)).ok === true;
    } catch {
      ok = false;
    }
    running.current = false;
    setBusy(null);
    if (!ok) {
      setFailed((set) => withId(set, invitation.id));
      setSaid(FAILED);
      // It may be refused because it is already accepted or revoked: read the list again.
      router.refresh();
      return;
    }
    // The row and its button go; the focus moves to where the next invitation starts.
    target.current =
      open?.kind === "invite" ? { form: "invite" } : { button: "invite" };
    setGone((set) => withId(set, invitation.id));
    // The notice is no longer true once its invitation is revoked.
    setNotice((n) =>
      n && n.email.toLowerCase() === invitation.email.toLowerCase() ? null : n,
    );
    setSaid(`Invitation for ${invitation.name} revoked.`);
    router.refresh();
  }

  /** Send again: one step, like revoking. The row and the focus stay where they are. */
  async function resendInvitation(invitation: Invitation) {
    if (running.current) return;
    running.current = true;
    setBusy(invitation.id);
    setFailed((set) => without(set, invitation.id));
    setUnsent((map) => forgetting(map, invitation.id));
    setSaid("");
    let answer: Sent = { ok: false, reason: "failed" };
    try {
      answer = await actions.resendInvitation(invitation.id);
    } catch {
      answer = { ok: false, reason: "failed" };
    }
    running.current = false;
    setBusy(null);
    if (answer.ok !== true) {
      const why = sendFailure(answer.reason) ?? FAILED;
      setUnsent((map) => new Map(map).set(invitation.id, why));
      setSaid(why);
      // It may be refused because it is already accepted or revoked: read the list again.
      if (answer.reason !== "wait" && answer.reason !== "limit")
        router.refresh();
      return;
    }
    // A notice that says this invitation's email could not be sent is no longer true.
    setNotice((n) =>
      n && !n.sent && n.email.toLowerCase() === invitation.email.toLowerCase()
        ? null
        : n,
    );
    setSaid(sentAgain(invitation.name));
  }

  function ask(id: string) {
    if (running.current) return;
    askedAt.current = Date.now();
    target.current = { row: id, pick: "keep" };
    setFailed((set) => without(set, id));
    setSaid("");
    setOpen({ kind: "revoke", id });
  }

  function keep(id: string) {
    if (running.current) return;
    target.current = { row: id, pick: "revoke" };
    setOpen(null);
  }

  async function revoke(agent: Agent) {
    // The second press of a double click lands where the question has just put this button:
    // too soon to be an answer to it.
    if (Date.now() - askedAt.current < CONFIRM_AFTER_MS) return;
    if (running.current) return;
    running.current = true;
    setBusy(agent.id);
    setSaid("");
    let ok = false;
    try {
      ok = (await actions.revokeAgent(agent.id)).ok === true;
    } catch {
      ok = false;
    }
    running.current = false;
    setBusy(null);
    setOpen((o) => (o?.kind === "revoke" && o.id === agent.id ? null : o));
    if (!ok) {
      target.current = { row: agent.id, pick: "revoke" };
      setFailed((set) => withId(set, agent.id));
      setSaid(FAILED);
      // It may be refused because it is already revoked elsewhere: read the list again.
      router.refresh();
      return;
    }
    target.current = { row: agent.id };
    setRevoked((set) => withId(set, agent.id));
    setSaid(`${agent.name} revoked.`);
    router.refresh();
  }

  function choose(t: Tab, focus = false) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    // In place: no navigation and no request, and Back still means what it meant.
    window.history.replaceState(null, "", url);
    if (focus) document.getElementById(`tab-${t}`)?.focus();
  }

  /** The tabs pattern: ←/→ wrap round, Home and End go to the ends. */
  function moveTab(e: KeyboardEvent<HTMLDivElement>) {
    const at = shownTabs.indexOf(tab);
    const last = shownTabs.length - 1;
    const to =
      e.key === "ArrowRight"
        ? at === last
          ? 0
          : at + 1
        : e.key === "ArrowLeft"
          ? at <= 0
            ? last
            : at - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (to === null) return;
    e.preventDefault();
    choose(shownTabs[to]!, true);
  }

  const counted = { ...data, agents };
  const panelOf = (t: Tab) => ({
    role: "tabpanel",
    id: `panel-${t}`,
    "aria-labelledby": `tab-${t}`,
    hidden: t !== tab,
    className: s.tabPanel,
  });

  return (
    <div className={s.root}>
      {/* Inert while the agent is being created too: a press on a rail link then would take
          the screen away before the token arrives, and the token is answered only once. */}
      <div className={s.page} inert={creating || shown || undefined}>
        <Shell current="settings" inbox={inbox} />
        <main
          ref={panel}
          aria-label="Settings"
          className={`${s.panel} rise`}
          style={{ "--rise-delay": "0.08s" } as CSSProperties}
        >
          <header className={s.bar}>
            <h1 ref={heading} tabIndex={-1} className={s.title}>
              {data.hiveName}
              <span className={s.titleSub}> · Settings</span>
            </h1>
            <div
              role="tablist"
              aria-label="Settings sections"
              className={s.tabs}
              onKeyDown={moveTab}
            >
              {shownTabs.map((t) => {
                const count = tabCount(t, counted, invitations.length);
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    id={`tab-${t}`}
                    aria-selected={t === tab}
                    aria-controls={`panel-${t}`}
                    tabIndex={t === tab ? 0 : -1}
                    className={s.tab}
                    onClick={() => choose(t)}
                  >
                    {TAB_NAMES[t]}
                    {count !== null && (
                      <>
                        {" "}
                        <span className={s.count}>{count}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </header>
          <div className={s.scroller}>
            <section {...panelOf("agents")}>
              <AgentsTab
                agents={agents}
                data={data}
                now={now}
                open={open}
                busy={busy}
                failed={failed}
                onShow={() => show("connect")}
                onCancel={() => cancel("connect")}
                onCreate={create}
                onAsk={ask}
                onKeep={keep}
                onRevoke={(a) => void revoke(a)}
                onSay={setSaid}
                workspaceName={workspaceName}
              />
            </section>
            <section {...panelOf("workspaces")}>
              <WorkspacesTab
                workspaces={data.workspaces}
                closing={closing !== null}
                deleteWorkspace={actions.deleteWorkspace}
                onSay={setSaid}
                onDeleted={() => router.refresh()}
              />
            </section>
            {data.isOwner && (
              <section {...panelOf("topics")}>
                <Topics
                  topics={data.topics}
                  workspaces={data.workspaces}
                  actions={actions}
                  closing={closing !== null}
                  onSay={setSaid}
                  onChanged={() => router.refresh()}
                />
              </section>
            )}
            <section {...panelOf("people")}>
              <PeopleTab
                data={data}
                invitations={invitations}
                now={now}
                open={open}
                busy={busy}
                failed={failed}
                unsent={unsent}
                notice={notice}
                onShow={() => show("invite")}
                onCancel={() => cancel("invite")}
                onInvite={invite}
                onDismiss={dismiss}
                onResend={(i) => void resendInvitation(i)}
                onRevokeInvitation={(i) => void revokeInvitation(i)}
                onSay={setSaid}
              />
            </section>
            {data.isOwner && (
              <section {...panelOf("hive")}>
                <HiveTab
                  hiveName={data.hiveName}
                  deletion={deletion}
                  closing={closing}
                  actions={actions}
                  onSay={setSaid}
                />
              </section>
            )}
          </div>
          <p aria-live="polite" className={s.srOnly}>
            {said}
          </p>
        </main>
      </div>
      {fresh && (
        <TokenDialog token={fresh.token} agentName={fresh.name} onDone={done} />
      )}
    </div>
  );
}
