"use client";

// The People tab: one list of the hive's members and, for the owner, the invitations still
// open, each with its ⋯ menu (Send again, Revoke invitation); Invite someone and its dialog;
// and the notice that says whether the email went out. What each press does, and every state
// but the invite form's own fields (what is being typed, and why it was refused), lives in
// `Settings`.
import { useId, useRef, useState } from "react";
import { PanelDialog } from "../vault/PanelDialog";
import { RowMenu } from "./RowMenu";
import type { Notice, Open } from "./Settings";
import {
  FAILED,
  INVITATIONS_NOTE,
  INVITED,
  INVITE_HELP,
  INVITE_TITLE,
  NAME_MAX,
  REVOKE_INVITATION,
  SEND_AGAIN,
  invitationLine,
  inviteNotice,
} from "./text";
import type { Invitation, SettingsData } from "./types";
import s from "./settings.module.css";

const EMAIL_MAX = 254;

/** One `@` with something on both sides, no whitespace, at most 254 characters. */
function emailShape(v: string): boolean {
  if (v.length === 0 || v.length > EMAIL_MAX || /\s/.test(v)) return false;
  const parts = v.split("@");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "";
}

export function PeopleTab({
  data,
  invitations,
  now,
  open,
  busy,
  failed,
  unsent,
  notice,
  onShow,
  onCancel,
  onInvite,
  onDismiss,
  onResend,
  onRevokeInvitation,
  onSay,
}: {
  data: SettingsData;
  /** The open invitations still listed; none for a member. */
  invitations: Invitation[];
  now: number;
  open: Open | null;
  busy: string | null;
  failed: ReadonlySet<string>;
  /** Why the last Send again of an invitation did not happen. */
  unsent: ReadonlyMap<string, string>;
  notice: Notice | null;
  onShow: () => void;
  onCancel: () => void;
  /** Null when the invitation was saved, else the sentence that says why not. */
  onInvite: (email: string, name: string) => Promise<string | null>;
  onDismiss: () => void;
  onResend: (invitation: Invitation) => void;
  onRevokeInvitation: (invitation: Invitation) => void;
  onSay: (text: string) => void;
}) {
  const inviting = data.isOwner && open?.kind === "invite";
  return (
    <section aria-labelledby="settings-people" className={s.section}>
      {/* While the invite dialog is open, what is behind its dim takes no focus and no press. */}
      <div className={s.sectionHead} inert={inviting || undefined}>
        <div className={s.headText}>
          <h2 className={s.label}>
            <span id="settings-people">People</span>
            <span className={s.count}>
              {data.members.length + invitations.length}
            </span>
          </h2>
          <p className={s.note}>
            Everyone in {data.hiveName}. Each keeps their own notes until they
            share them.
          </p>
        </div>
        {data.isOwner && (
          // Kept in its place behind the dialog, but not drawn: one yellow button at a time.
          <button
            type="button"
            data-open="invite"
            className={s.primary}
            data-behind={inviting || undefined}
            onClick={() => {
              if (!inviting) onShow();
            }}
          >
            {INVITE_TITLE}
          </button>
        )}
      </div>
      {inviting && (
        <PanelDialog
          label={INVITE_TITLE}
          busy={busy === "invite"}
          onClose={onCancel}
        >
          <InviteForm
            busy={busy === "invite"}
            onInvite={onInvite}
            onCancel={onCancel}
            onSay={onSay}
          />
        </PanelDialog>
      )}
      <div inert={inviting || undefined}>
        {data.isOwner && <InviteNotice notice={notice} onDismiss={onDismiss} />}
        <ul role="list" aria-label="People" className={s.rows}>
          {data.members.map((m) => (
            <li key={m.id} className={s.member}>
              <span className={s.memberName}>
                <span className={s.memberText}>{m.name}</span>
                {m.isMe && <span className={s.mark}>You</span>}
              </span>
              <span className={s.role}>
                {m.role === "owner" ? "Owner" : "Member"}
              </span>
            </li>
          ))}
          {invitations.map((i) => (
            <InvitationRow
              key={i.id}
              invitation={i}
              now={now}
              busy={busy === i.id}
              failed={failed.has(i.id)}
              unsent={unsent.get(i.id) ?? null}
              onResend={() => onResend(i)}
              onRevoke={() => onRevokeInvitation(i)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * An open invitation: who, the Invited mark, one grey line (where it was sent, when, until
 * when), and a ⋯ menu with Send again and Revoke invitation, each one step. `unsent` is why
 * the last Send again did not happen.
 */
function InvitationRow({
  invitation,
  now,
  busy,
  failed,
  unsent,
  onResend,
  onRevoke,
}: {
  invitation: Invitation;
  now: number;
  busy: boolean;
  failed: boolean;
  unsent: string | null;
  onResend: () => void;
  onRevoke: () => void;
}) {
  return (
    <li
      data-invitation={invitation.id}
      className={s.item}
      aria-busy={busy || undefined}
    >
      <div className={s.text}>
        <p className={s.what}>
          <span className={s.name}>{invitation.name}</span>
          <span className={s.mark} title={INVITATIONS_NOTE}>
            {INVITED}
          </span>
        </p>
        <p className={`${s.meta} ${s.address}`}>
          {invitationLine(invitation, now).map((part, i) => (
            <span key={i}>{part}</span>
          ))}
        </p>
      </div>
      <div className={s.side}>
        <RowMenu
          label={`Actions for ${invitation.name}`}
          disabled={busy}
          items={[
            { key: "resend", text: SEND_AGAIN, onPick: onResend },
            {
              key: "revoke",
              text: REVOKE_INVITATION,
              danger: true,
              onPick: onRevoke,
            },
          ]}
        />
        {unsent && <p className={s.refused}>{unsent}</p>}
        {failed && <p className={s.refused}>{FAILED}</p>}
      </div>
    </li>
  );
}

/**
 * Whether the new invitation's email went out. The status element is always in the page, empty
 * until there is something to say, so that what arrives in it is announced.
 */
function InviteNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  return (
    <div className={notice ? s.notice : undefined}>
      <div role="status" className={notice ? s.noticeText : undefined}>
        {notice ? inviteNotice(notice.email, notice.sent) : null}
      </div>
      {notice && (
        <div className={s.noticeActions}>
          <button type="button" className={s.secondary} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
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
      aria-label={INVITE_TITLE}
      data-form="invite"
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
      <h2 className={s.dialogTitle}>{INVITE_TITLE}</h2>
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
          Invite
        </button>
      </div>
    </form>
  );
}
