"use client";

// The settings screen: the person's own agents, the hive's members and, for the owner, the
// invitations still open. The screen decides nothing about who may create, revoke or invite: it
// calls `actions` and the database answers. What is listed always comes from `data`, so a
// refresh from the server is what changes it. The forms, the revoke question, the invitation
// notice and the token dialog are client state only; one form or question is open at a time.
// A new agent's token is held in this component's state from the moment `createAgent`
// answers until Done, is drawn only by `TokenDialog`, and is written nowhere else. Because it
// cannot be fetched again, the page is inert from Create until Done, leaving asks first, and
// Back stays here while the dialog is open.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Shell } from "../shell/Shell";
import { shortDate } from "../vault/format";
import { TokenDialog } from "./TokenDialog";
import {
  INVITE_HELP,
  inviteFailure,
  inviteNotice,
  sortAgents,
  statusText,
  tierHelp,
  tierText,
} from "./text";
import {
  PROVIDERS,
  type Agent,
  type Created,
  type Invitation,
  type Invited,
  type NewAgent,
  type Provider,
  type SettingsActions,
  type SettingsData,
  type TrustTier,
  type Workspace,
} from "./types";
import s from "./settings.module.css";

const FAILED = "That didn't work. Try again.";
const ADDRESS_BY_HAND = "Select the address and copy it by hand.";
/** A confirming Revoke sooner than this after the question opened is taken as a double click. */
const CONFIRM_AFTER_MS = 500;
/** How long Done waits for its own step back in the history before reading the list anyway. */
const UNHOLD_MS = 1000;
/** How long Copy address says "Copied". */
const COPIED_MS = 2000;
const NAME_MAX = 60;
const EMAIL_MAX = 254;
const TIERS: TrustTier[] = ["vendor", "self_hosted"];

/** What is open: a form, or the revoke question of one agent. Never two. */
type Open =
  { kind: "connect" } | { kind: "invite" } | { kind: "revoke"; id: string };

/** Where the focus goes after the next render. */
type Target =
  | { button: "connect" | "invite" }
  | { form: "connect" | "invite" }
  | { row: string; pick?: "keep" | "revoke" };

/** What the owner passes on after an invitation is saved. Kept until dismissed. */
type Notice = { name: string; email: string; address: string };

const withId = (set: ReadonlySet<string>, id: string) => new Set(set).add(id);
const without = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/** One `@` with something on both sides, no whitespace, at most 254 characters. */
function emailShape(v: string): boolean {
  if (v.length === 0 || v.length > EMAIL_MAX || /\s/.test(v)) return false;
  const parts = v.split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "";
}

export function Settings({
  data,
  now,
  actions,
  inbox,
}: {
  data: SettingsData;
  now: number;
  actions: SettingsActions;
  inbox: number | undefined;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open | null>(null);
  // What is running: a form's key or an agent's id.
  const [busy, setBusy] = useState<string | null>(null);
  // Agents and invitations whose revoke was refused, and the agents answered `ok` before the
  // refresh brings them.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  // Invitations answered `ok` to a revoke before the refresh takes them away.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
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
      to = want.pick
        ? (row?.querySelector<HTMLElement>(`[data-pick="${want.pick}"]`) ?? row)
        : row;
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

  /** Null when the person was added or invited, else the sentence that says why not. */
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
    if (
      answer.ok !== true ||
      (answer.outcome !== "added" && answer.outcome !== "invited")
    ) {
      const why =
        (answer.ok === false ? inviteFailure(answer.reason) : null) ?? FAILED;
      setSaid(why);
      return why;
    }
    target.current = { button: "invite" };
    setOpen(null);
    if (answer.outcome === "added") setSaid(`${name} added.`);
    // The notice says it itself: it is a status.
    else setNotice({ name, email, address: `${window.location.origin}/login` });
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
    // The sentence to pass on is no longer true once its invitation is revoked.
    setNotice((n) =>
      n && n.email.toLowerCase() === invitation.email.toLowerCase() ? null : n,
    );
    setSaid(`Invitation for ${invitation.name} revoked.`);
    router.refresh();
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
              Settings
            </h1>
            <p className={s.hive}>{data.hiveName}</p>
          </header>
          <div className={s.scroller}>
            <section aria-labelledby="settings-agents" className={s.section}>
              <div className={s.sectionHead}>
                <div className={s.headText}>
                  <h2 className={s.label}>
                    <span id="settings-agents">Agents</span>
                    <span className={s.count}>{agents.length}</span>
                  </h2>
                  <p className={s.note}>
                    An agent writes into one workspace as you. It can never
                    change sharing, accept links or delete notes.
                  </p>
                </div>
                {open?.kind !== "connect" && (
                  <button
                    type="button"
                    data-open="connect"
                    className={s.primary}
                    onClick={() => show("connect")}
                  >
                    Connect an agent
                  </button>
                )}
              </div>
              {open?.kind === "connect" && (
                <ConnectForm
                  workspaces={data.workspaces}
                  busy={busy === "connect"}
                  onCreate={create}
                  onCancel={() => cancel("connect")}
                  onSay={setSaid}
                />
              )}
              {agents.length > 0 ? (
                <ul role="list" aria-label="Agents" className={s.rows}>
                  {agents.map((a) => (
                    <AgentRow
                      key={a.id}
                      agent={a}
                      workspace={workspaceName(a.workspaceId)}
                      now={now}
                      busy={busy === a.id}
                      failed={failed.has(a.id)}
                      asking={open?.kind === "revoke" && open.id === a.id}
                      onAsk={() => ask(a.id)}
                      onKeep={() => keep(a.id)}
                      onRevoke={() => void revoke(a)}
                    />
                  ))}
                </ul>
              ) : (
                <div className={s.empty}>
                  <p className={s.emptyTitle}>No agents yet.</p>
                  <p className={s.emptyText}>
                    Connect one and it can read the hive and write notes into
                    the workspace you choose.
                  </p>
                </div>
              )}
            </section>
            <section aria-labelledby="settings-members" className={s.section}>
              <div className={s.sectionHead}>
                <div className={s.headText}>
                  <h2 className={s.label}>
                    <span id="settings-members">Members</span>
                    <span className={s.count}>{data.members.length}</span>
                  </h2>
                  <p className={s.note}>
                    Everyone in {data.hiveName}. Each keeps their own notes
                    until they share them.
                  </p>
                </div>
                {data.isOwner && open?.kind !== "invite" && (
                  <button
                    type="button"
                    data-open="invite"
                    className={s.secondary}
                    onClick={() => show("invite")}
                  >
                    Invite a member
                  </button>
                )}
              </div>
              {data.isOwner && open?.kind === "invite" && (
                <InviteForm
                  busy={busy === "invite"}
                  onInvite={invite}
                  onCancel={() => cancel("invite")}
                  onSay={setSaid}
                />
              )}
              {data.isOwner && (
                <InviteNotice
                  notice={notice}
                  onDismiss={dismiss}
                  onSay={setSaid}
                />
              )}
              <ul role="list" aria-label="Members" className={s.rows}>
                {data.members.map((m) => (
                  <li key={m.id} className={s.member}>
                    <span className={s.memberName}>
                      <span className={s.memberText}>{m.name}</span>
                      {m.isMe && <span className={s.mark}>you</span>}
                    </span>
                    <span className={s.role}>
                      {m.role === "owner" ? "Owner" : "Member"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            {invitations.length > 0 && (
              <section
                aria-labelledby="settings-invitations"
                className={s.section}
              >
                <div className={s.sectionHead}>
                  <div className={s.headText}>
                    <h2 className={s.label}>
                      <span id="settings-invitations">Invitations</span>
                      <span className={s.count}>{invitations.length}</span>
                    </h2>
                    <p className={s.note}>
                      Not members yet. Each joins when they first sign in with
                      the invited email.
                    </p>
                  </div>
                </div>
                <ul role="list" aria-label="Invitations" className={s.rows}>
                  {invitations.map((i) => (
                    <InvitationRow
                      key={i.id}
                      invitation={i}
                      now={now}
                      busy={busy === i.id}
                      failed={failed.has(i.id)}
                      onRevoke={() => void revokeInvitation(i)}
                    />
                  ))}
                </ul>
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

function AgentRow({
  agent,
  workspace,
  now,
  busy,
  failed,
  asking,
  onAsk,
  onKeep,
  onRevoke,
}: {
  agent: Agent;
  workspace: string | null;
  now: number;
  busy: boolean;
  failed: boolean;
  asking: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onRevoke: () => void;
}) {
  const active = agent.status === "active";
  const status = statusText(agent.status);
  const off = busy || undefined;
  return (
    <li
      data-row={agent.id}
      data-off={!active || undefined}
      tabIndex={-1}
      className={s.item}
      aria-busy={off}
      onKeyDown={(e) => {
        if (e.key === "Escape" && asking) onKeep();
      }}
    >
      <div className={s.text}>
        <p className={s.what}>
          <span className={s.name}>{agent.name}</span>
          {status && <span className={s.mark}>{status}</span>}
        </p>
        <p className={s.meta}>
          <span>{agent.provider}</span>
          {workspace && <span>{workspace}</span>}
          <span>{tierText(agent.trustTier)}</span>
        </p>
        <p className={s.meta}>
          <span>Connected {shortDate(agent.createdAt, now)}</span>
          <span>
            {agent.lastUsedAt
              ? `Last used ${shortDate(agent.lastUsedAt, now)}`
              : "Never used"}
          </span>
        </p>
      </div>
      {active && (
        <div className={s.side}>
          <div
            role="group"
            aria-label={`Revoke ${agent.name}`}
            className={s.actions}
          >
            {asking ? (
              <>
                <p className={s.ask}>Revoke {agent.name}?</p>
                <button
                  type="button"
                  data-pick="revoke"
                  className={s.confirm}
                  aria-disabled={off}
                  onClick={onRevoke}
                >
                  Revoke
                </button>
                <button
                  type="button"
                  data-pick="keep"
                  className={s.secondary}
                  aria-disabled={off}
                  onClick={onKeep}
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                data-pick="revoke"
                className={s.secondary}
                aria-label={`Revoke ${agent.name}`}
                onClick={onAsk}
              >
                Revoke
              </button>
            )}
          </div>
          {asking && (
            <p className={s.aside}>It stops working within the hour.</p>
          )}
          {failed && <p className={s.refused}>{FAILED}</p>}
        </div>
      )}
    </li>
  );
}

/** An open invitation: who, where it was sent, until when, and Revoke in one step. */
function InvitationRow({
  invitation,
  now,
  busy,
  failed,
  onRevoke,
}: {
  invitation: Invitation;
  now: number;
  busy: boolean;
  failed: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className={s.item} aria-busy={busy || undefined}>
      <div className={s.text}>
        <p className={s.what}>
          <span className={s.name}>{invitation.name}</span>
        </p>
        <p className={s.meta}>
          <span className={s.address}>{invitation.email}</span>
        </p>
        <p className={s.meta}>
          <span>Invited {shortDate(invitation.createdAt, now)}</span>
          <span>Expires {shortDate(invitation.expiresAt, now)}</span>
        </p>
      </div>
      <div className={s.side}>
        <div className={s.actions}>
          <button
            type="button"
            className={s.secondary}
            aria-label={`Revoke invitation for ${invitation.name}`}
            aria-disabled={busy || undefined}
            onClick={onRevoke}
          >
            Revoke
          </button>
        </div>
        {failed && <p className={s.refused}>{FAILED}</p>}
      </div>
    </li>
  );
}

/**
 * The sentence the owner passes on to the invited person. The status element is always in the
 * page, empty until there is something to say, so that what arrives in it is announced.
 */
function InviteNotice({
  notice,
  onDismiss,
  onSay,
}: {
  notice: Notice | null;
  onDismiss: () => void;
  onSay: (text: string) => void;
}) {
  return (
    <div className={notice ? s.notice : undefined}>
      <div role="status" className={notice ? s.noticeText : undefined}>
        {notice
          ? inviteNotice(notice.name, notice.email, notice.address)
          : null}
      </div>
      {notice && (
        <NoticeActions
          key={`${notice.email} ${notice.name}`}
          address={notice.address}
          onDismiss={onDismiss}
          onSay={onSay}
        />
      )}
    </div>
  );
}

function NoticeActions({
  address,
  onDismiss,
  onSay,
}: {
  address: string;
  onDismiss: () => void;
  onSay: (text: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [byHand, setByHand] = useState(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(address);
      ok = true;
    } catch {
      ok = false;
    }
    if (timer.current) clearTimeout(timer.current);
    setByHand(!ok);
    setCopied(ok);
    onSay(ok ? "Address copied." : ADDRESS_BY_HAND);
    if (ok) timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className={s.noticeActions}>
      {byHand && <p className={s.refused}>{ADDRESS_BY_HAND}</p>}
      <button
        type="button"
        className={s.secondary}
        data-copy
        // A key that is still held repeats; only a fresh press copies.
        onKeyDown={(e) => {
          if (e.repeat) e.preventDefault();
        }}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy address"}
      </button>
      <button type="button" className={s.secondary} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function ConnectForm({
  workspaces,
  busy,
  onCreate,
  onCancel,
  onSay,
}: {
  workspaces: Workspace[];
  busy: boolean;
  onCreate: (input: NewAgent) => Promise<boolean>;
  onCancel: () => void;
  onSay: (text: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  // Chosen for the person only when there is nothing to choose.
  const [workspaceId, setWorkspaceId] = useState(
    workspaces.length === 1 ? workspaces[0]!.id : "",
  );
  const [provider, setProvider] = useState<Provider>(PROVIDERS[0]);
  const [trustTier, setTrustTier] = useState<TrustTier>("vendor");
  const [problem, setProblem] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const workspaceField = useRef<HTMLSelectElement>(null);

  function refuse(text: string, field: HTMLElement | null) {
    setProblem(text);
    onSay(text);
    field?.focus();
  }

  async function submit() {
    if (busy) return;
    const clean = name.trim();
    if (clean === "")
      return refuse("Give the agent a name.", nameField.current);
    if (clean.length > NAME_MAX)
      return refuse(
        `Keep the name to ${NAME_MAX} characters or fewer.`,
        nameField.current,
      );
    if (!workspaces.some((w) => w.id === workspaceId))
      return refuse("Choose a workspace.", workspaceField.current);
    setProblem(null);
    const ok = await onCreate({
      name: clean,
      workspaceId,
      provider,
      trustTier,
    });
    if (!ok) setProblem(FAILED);
  }

  return (
    <form
      aria-label="Connect an agent"
      data-form="connect"
      className={s.form}
      noValidate
      aria-busy={busy || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className={s.fields}>
        <div className={s.field}>
          <label htmlFor={`${id}-name`} className={s.fieldLabel}>
            Name
          </label>
          <input
            ref={nameField}
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="off"
            className={s.input}
            placeholder="Claude on my laptop"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <div className={s.field}>
          <label htmlFor={`${id}-workspace`} className={s.fieldLabel}>
            Workspace
          </label>
          <span className={s.selectBox}>
            <select
              ref={workspaceField}
              id={`${id}-workspace`}
              name="workspace"
              className={s.select}
              data-empty={workspaceId === "" || undefined}
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.currentTarget.value)}
            >
              {workspaces.length !== 1 && (
                <option value="" disabled>
                  Choose a workspace
                </option>
              )}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className={s.field}>
          <label htmlFor={`${id}-provider`} className={s.fieldLabel}>
            Provider
          </label>
          <span className={s.selectBox}>
            <select
              id={`${id}-provider`}
              name="provider"
              className={s.select}
              value={provider}
              onChange={(e) => {
                const picked = PROVIDERS.find(
                  (p) => p === e.currentTarget.value,
                );
                if (picked) setProvider(picked);
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>
      <fieldset className={s.tiers}>
        <legend className={s.fieldLabel}>Trust tier</legend>
        <div className={s.tierList}>
          {TIERS.map((t) => (
            <label key={t} className={s.tier}>
              <input
                type="radio"
                name={`${id}-tier`}
                className={s.hiddenInput}
                checked={trustTier === t}
                onChange={() => setTrustTier(t)}
              />
              <span aria-hidden="true" className={s.ring} />
              <span className={s.tierName}>{tierText(t)}</span>
              <span className={s.tierHelp}>{tierHelp(t)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={s.formFoot}>
        <button
          type="submit"
          className={s.primary}
          aria-disabled={busy || undefined}
        >
          Create
        </button>
        <button
          type="button"
          className={s.secondary}
          aria-disabled={busy || undefined}
          onClick={onCancel}
        >
          Cancel
        </button>
        {problem && <p className={s.refused}>{problem}</p>}
      </div>
    </form>
  );
}

function InviteForm({
  busy,
  onInvite,
  onCancel,
  onSay,
}: {
  busy: boolean;
  onInvite: (email: string, name: string) => Promise<string | null>;
  onCancel: () => void;
  onSay: (text: string) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  function refuse(text: string, field: HTMLElement | null) {
    setProblem(text);
    onSay(text);
    field?.focus();
  }

  async function submit() {
    if (busy) return;
    const cleanEmail = email.trim();
    const cleanName = name.trim();
    if (!emailShape(cleanEmail))
      return refuse("Enter an email address.", emailField.current);
    if (cleanName === "")
      return refuse("Give them a display name.", nameField.current);
    if (cleanName.length > NAME_MAX)
      return refuse(
        `Keep the name to ${NAME_MAX} characters or fewer.`,
        nameField.current,
      );
    setProblem(null);
    setProblem(await onInvite(cleanEmail, cleanName));
  }

  return (
    <form
      aria-label="Invite a member"
      data-form="invite"
      className={s.form}
      noValidate
      aria-busy={busy || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div className={s.fields}>
        <div className={s.field}>
          <label htmlFor={`${id}-email`} className={s.fieldLabel}>
            Email
          </label>
          <input
            ref={emailField}
            id={`${id}-email`}
            name="email"
            type="text"
            inputMode="email"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            className={s.input}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
        </div>
        <div className={s.field}>
          <label htmlFor={`${id}-display`} className={s.fieldLabel}>
            Display name
          </label>
          <input
            ref={nameField}
            id={`${id}-display`}
            name="display"
            type="text"
            autoComplete="off"
            className={s.input}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
      </div>
      <p className={s.hint}>{INVITE_HELP}</p>
      <div className={s.formFoot}>
        <button
          type="submit"
          className={s.primary}
          aria-disabled={busy || undefined}
        >
          Invite
        </button>
        <button
          type="button"
          className={s.secondary}
          aria-disabled={busy || undefined}
          onClick={onCancel}
        >
          Cancel
        </button>
        {problem && <p className={s.refused}>{problem}</p>}
      </div>
    </form>
  );
}
