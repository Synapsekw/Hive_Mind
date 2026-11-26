"use client";

// The inbox's right column: the one selected item and its decision. A link shows the person's
// own note and the colleague's side by side; of the colleague's note only the owner's name, the
// topic and, when the person may already read it, the title (the data rule of `types.ts`).
// The opening lines are the person's own note's, read by `useOpening` and shown as plain text.
import Link from "next/link";
import type { RefObject } from "react";
import { shortDate } from "../vault/format";
import {
  ACCEPT_LINK,
  ALL_DONE,
  BACK,
  FINAL_NOTE,
  HELD_NOTE,
  NOT_SHARED,
  OPEN_IN_VAULT,
  OPEN_VAULT,
  SEE_LATER,
  YOUR_NOTE,
  acceptEffect,
  declineQuestion,
  heldFrom,
  linkLine,
  moreWaiting,
  proposer,
  theirLabel,
  tierReason,
  vaultHref,
} from "./text";
import type { HeldItem, LinkItem, Opening } from "./types";
import s from "./inbox.module.css";

export const FAILED = "That didn't work. Try again.";

export type Current =
  { kind: "link"; item: LinkItem } | { kind: "held"; item: HeldItem } | null;

type Props = {
  current: Current;
  opening: Opening | null;
  now: number;
  busy: boolean;
  failed: boolean;
  asking: boolean;
  /** How many still wait beyond the loaded rows, for the All done state. */
  waiting: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAccept(): void;
  onAsk(): void;
  onKeep(): void;
  onDecline(): void;
  onRelease(): void;
  /** The narrow fold's way back to the list (Task 3). */
  onBack?: () => void;
};

/** The note's first lines; a fixed-height blank while they are on their way, nothing if none. */
function Lines({ opening }: { opening: Opening | null }) {
  if (opening === null) return <div aria-hidden="true" className={s.lines} />;
  if (!opening.ok || !opening.text) return null;
  return <p className={s.opening}>{opening.text}</p>;
}

export function InboxDetail(props: Props) {
  const { current, headingRef } = props;
  return (
    <section
      aria-labelledby="inbox-detail-title"
      className={s.detail}
      onKeyDown={(e) => {
        if (e.key === "Escape" && props.onBack && !props.asking) props.onBack();
      }}
    >
      {props.onBack && (
        <button
          type="button"
          className={s.back}
          aria-label="Back to the inbox"
          onClick={props.onBack}
        >
          ← {BACK}
        </button>
      )}
      {current === null ? (
        <div className={s.done}>
          <h2
            ref={headingRef}
            tabIndex={-1}
            id="inbox-detail-title"
            className={s.detailTitle}
          >
            {ALL_DONE}
          </h2>
          {props.waiting > 0 ? (
            <p className={s.emptyText}>{moreWaiting(props.waiting)}</p>
          ) : (
            <Link href="/vault" className={s.secondary}>
              {OPEN_VAULT}
            </Link>
          )}
        </div>
      ) : current.kind === "link" ? (
        <LinkDetail {...props} item={current.item} />
      ) : (
        <HeldDetail {...props} item={current.item} />
      )}
    </section>
  );
}

function LinkDetail({
  item,
  opening,
  now,
  busy,
  failed,
  asking,
  headingRef,
  onAccept,
  onAsk,
  onKeep,
  onDecline,
}: Props & { item: LinkItem }) {
  const line = linkLine(item);
  const { memberName, topic, title } = item.theirs;
  const off = busy || undefined;
  return (
    <div className={s.detailBody} aria-busy={off}>
      <p className={s.meta}>
        <span>{proposer(item)}</span>
        <span>{tierReason(item.tier)}</span>
        <span>{shortDate(item.createdAt, now)}</span>
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        id="inbox-detail-title"
        className={s.detailTitle}
      >
        Link <em className={s.own}>{line.mine}</em> {line.rest}
      </h2>
      <div className={s.pair}>
        <div className={s.box}>
          <p className={s.label}>{YOUR_NOTE}</p>
          <p className={s.boxTitle}>{item.mine.title || item.mine.path}</p>
          <p className={s.path}>{item.mine.path}</p>
          <Lines opening={opening} />
          <Link
            href={vaultHref(item.mine.workspaceId, item.mine.id)}
            className={s.quiet}
          >
            {OPEN_IN_VAULT}
          </Link>
        </div>
        <span aria-hidden="true" className={s.swap}>
          ⇄
        </span>
        <div className={s.box}>
          <p className={s.label}>{theirLabel(memberName)}</p>
          {title !== null ? (
            <>
              <p className={s.boxTitle}>{title}</p>
              <p className={s.path}>{topic}</p>
            </>
          ) : (
            <>
              <p className={s.boxTitle}>{NOT_SHARED}</p>
              <p className={s.note}>{SEE_LATER}</p>
            </>
          )}
        </div>
      </div>
      <p className={s.effect}>
        <span aria-hidden="true" className={s.glyph} />
        <span>{acceptEffect(item)}</span>
      </p>
      <div
        role="group"
        aria-label={`Answer for ${line.mine}`}
        data-actions
        className={s.actions}
        onKeyDown={(e) => {
          if (e.key === "Escape" && asking) onKeep();
        }}
      >
        {asking ? (
          <>
            <p className={s.ask}>{declineQuestion()}</p>
            <button
              type="button"
              data-pick="decline"
              className={s.confirm}
              aria-disabled={off}
              onClick={onDecline}
            >
              Decline
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
          <>
            <button
              type="button"
              data-pick="accept"
              className={s.primary}
              aria-disabled={off}
              onClick={onAccept}
            >
              {ACCEPT_LINK}
            </button>
            <button
              type="button"
              data-pick="decline"
              className={s.secondary}
              aria-disabled={off}
              onClick={busy ? undefined : onAsk}
            >
              Decline
            </button>
          </>
        )}
      </div>
      <p className={s.aside}>{FINAL_NOTE}</p>
      {failed && <p className={s.refused}>{FAILED}</p>}
    </div>
  );
}

function HeldDetail({
  item,
  opening,
  now,
  busy,
  failed,
  headingRef,
  onRelease,
}: Props & { item: HeldItem }) {
  const off = busy || undefined;
  return (
    <div className={s.detailBody} aria-busy={off}>
      <h2
        ref={headingRef}
        tabIndex={-1}
        id="inbox-detail-title"
        className={s.detailTitle}
      >
        {item.title || item.path}
      </h2>
      <p className={s.path}>{item.path}</p>
      <p className={s.meta}>
        <span>{heldFrom(item.agentName, shortDate(item.updatedAt, now))}</span>
      </p>
      <Lines opening={opening} />
      <p className={s.effect}>{HELD_NOTE}</p>
      <div
        role="group"
        aria-label={`Answer for ${item.title || item.path}`}
        data-actions
        className={s.actions}
      >
        <button
          type="button"
          data-pick="release"
          className={s.primary}
          aria-disabled={off}
          onClick={onRelease}
        >
          Release
        </button>
        <Link
          href={vaultHref(item.workspaceId, item.id)}
          className={s.secondary}
        >
          {OPEN_IN_VAULT}
        </Link>
      </div>
      {failed && <p className={s.refused}>{FAILED}</p>}
    </div>
  );
}
