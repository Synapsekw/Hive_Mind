"use client";

// The Agents tab: the person's own agents, Connect an agent and its dialog, each active agent's
// ⋯ menu and revoke question, and the agents that no longer work folded away. What each press
// does lives in `Settings`, which also holds the new agent's token; this file never sees it.
// Only the connect form keeps state of its own: what is being typed into it.
import { useId, useRef, useState } from "react";
import { PanelDialog } from "../vault/PanelDialog";
import { RowMenu } from "./RowMenu";
import type { Open } from "./Settings";
import {
  CONNECT_TITLE,
  FAILED,
  NAME_MAX,
  REVOKE_ITEM,
  agentLine,
  foldedAgents,
  statusText,
  tierHelp,
  tierText,
} from "./text";
import {
  PROVIDERS,
  type Agent,
  type NewAgent,
  type Provider,
  type SettingsData,
  type TrustTier,
  type Workspace,
} from "./types";
import s from "./settings.module.css";

const TIERS: TrustTier[] = ["vendor", "self_hosted"];

export function AgentsTab({
  agents,
  data,
  now,
  open,
  busy,
  failed,
  onShow,
  onCancel,
  onCreate,
  onAsk,
  onKeep,
  onRevoke,
  onSay,
  workspaceName,
}: {
  /** In the order they are listed, with the ones revoked here already marked. */
  agents: Agent[];
  data: SettingsData;
  now: number;
  open: Open | null;
  busy: string | null;
  failed: ReadonlySet<string>;
  onShow: () => void;
  onCancel: () => void;
  /** True when the agent was created; the dialog then holds the token. */
  onCreate: (input: NewAgent) => Promise<boolean>;
  onAsk: (id: string) => void;
  onKeep: (id: string) => void;
  onRevoke: (agent: Agent) => void;
  onSay: (text: string) => void;
  workspaceName: (id: string) => string | null;
}) {
  // `sortAgents` keeps the active ones first; each group keeps its order.
  const active = agents.filter((a) => a.status === "active");
  const off = agents.filter((a) => a.status !== "active");
  const row = (a: Agent) => (
    <AgentRow
      key={a.id}
      agent={a}
      workspace={workspaceName(a.workspaceId)}
      now={now}
      busy={busy === a.id}
      failed={failed.has(a.id)}
      asking={open?.kind === "revoke" && open.id === a.id}
      onAsk={() => onAsk(a.id)}
      onKeep={() => onKeep(a.id)}
      onRevoke={() => onRevoke(a)}
    />
  );
  return (
    <section aria-labelledby="settings-agents" className={s.section}>
      <div className={s.sectionHead}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-agents">Agents</span>
            <span className={s.count}>{active.length}</span>
          </h2>
          <p className={s.note}>
            An agent writes into one workspace as you. It can never change
            sharing, accept links or delete notes.
          </p>
        </div>
        <button
          type="button"
          data-open="connect"
          className={s.primary}
          onClick={onShow}
        >
          {CONNECT_TITLE}
        </button>
      </div>
      {open?.kind === "connect" && (
        <PanelDialog
          label={CONNECT_TITLE}
          busy={busy === "connect"}
          onClose={onCancel}
        >
          <ConnectForm
            workspaces={data.workspaces}
            busy={busy === "connect"}
            onCreate={onCreate}
            onCancel={onCancel}
            onSay={onSay}
          />
        </PanelDialog>
      )}
      {agents.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>No agents yet.</p>
          <p className={s.emptyText}>
            Connect one and it can read the hive and write notes into the
            workspace you choose.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <ul role="list" aria-label="Agents" className={s.rows}>
              {active.map(row)}
            </ul>
          )}
          {off.length > 0 && (
            <details className={`${s.fold} ${s.agentFold}`}>
              <summary className={s.foldSummary}>
                {foldedAgents(off.length)}
              </summary>
              <ul
                role="list"
                aria-label="Revoked or expired agents"
                className={s.rows}
              >
                {off.map(row)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
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
          {agentLine(agent, workspace, now).map((part, i) => (
            <span key={i}>{part}</span>
          ))}
        </p>
      </div>
      {active && (
        <div className={s.side}>
          {asking ? (
            <>
              <div
                role="group"
                aria-label={`Revoke ${agent.name}`}
                className={s.actions}
              >
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
              </div>
              <p className={s.aside}>It stops working within the hour.</p>
            </>
          ) : (
            <RowMenu
              label={`Actions for ${agent.name}`}
              items={[
                {
                  key: "revoke",
                  text: REVOKE_ITEM,
                  danger: true,
                  onPick: onAsk,
                },
              ]}
            />
          )}
          {failed && <p className={s.refused}>{FAILED}</p>}
        </div>
      )}
    </li>
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
      aria-label={CONNECT_TITLE}
      data-form="connect"
      className={`${s.form} ${s.dialogForm}`}
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
      <h2 className={s.dialogTitle}>{CONNECT_TITLE}</h2>
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
      <div className={`${s.formFoot} ${s.dialogFoot}`}>
        {problem && <p className={s.refused}>{problem}</p>}
        <button
          type="button"
          className={s.secondary}
          aria-disabled={busy || undefined}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className={s.primary}
          aria-disabled={busy || undefined}
        >
          Create
        </button>
      </div>
    </form>
  );
}
