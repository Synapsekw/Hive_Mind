"use client";

// The filter chips: Type, Date, Session, Agent and Owner. Each opens a small list; an active chip
// says its value and carries a × that clears it, and "Clear all" clears every chip. The chips are
// client state backed by the address; the screen decides whether a change needs the server.
import { useState, type ReactNode } from "react";
import { Caret, Cross } from "./icons";
import { KIND_LABEL } from "./kind";
import { usePopover } from "./usePopover";
import type { DatePreset, Filters, GallerySession, Kind } from "./types";
import s from "./gallery.module.css";

const DATES: { key: DatePreset; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "range", label: "Range" },
];

export type FilterBarProps = {
  filters: Filters;
  /** Loaded sessions, newest first. */
  sessions: GallerySession[];
  agents: string[];
  members: { id: string; name: string }[];
  onChange(patch: Partial<Filters>): void;
  onClearAll(): void;
};

function Chip({
  label,
  value,
  onClear,
  children,
}: {
  label: string;
  /** What the chip is set to, or null when it is off. */
  value: string | null;
  onClear(): void;
  children: (close: () => void) => ReactNode;
}) {
  const pop = usePopover();
  return (
    <div ref={pop.wrap} className={s.chipWrap} onKeyDown={pop.onKeyDown}>
      <span className={s.chip} data-on={value !== null || undefined}>
        <button
          ref={pop.trigger}
          type="button"
          className={s.chipButton}
          aria-expanded={pop.open}
          onClick={() => pop.setOpen(!pop.open)}
        >
          {value === null ? label : `${label}: ${value}`}
          {value === null && <Caret />}
        </button>
        {value !== null && (
          <button
            type="button"
            className={s.chipClear}
            aria-label={`Clear ${label}`}
            onClick={() => {
              pop.setOpen(false);
              onClear();
            }}
          >
            <Cross small />
          </button>
        )}
      </span>
      {pop.open && (
        <div role="group" aria-label={label} className={s.popover}>
          {children(() => {
            pop.setOpen(false);
            pop.trigger.current?.focus();
          })}
        </div>
      )}
    </div>
  );
}

/** A list of choices, one of which may be on; choosing the one that is on turns it off. */
function Choices<T extends string>({
  items,
  value,
  onPick,
}: {
  items: { key: T; label: string }[];
  value: T | null;
  onPick(key: T | null): void;
}) {
  if (items.length === 0)
    return <p className={s.popNote}>Nothing loaded yet.</p>;
  return (
    <>
      {items.map((x) => (
        <button
          key={x.key}
          type="button"
          className={s.popItem}
          aria-pressed={value === x.key}
          onClick={() => onPick(value === x.key ? null : x.key)}
        >
          {x.label}
        </button>
      ))}
    </>
  );
}

function DateChoices({
  filters,
  onChange,
}: {
  filters: Filters;
  onChange(patch: Partial<Filters>): void;
}) {
  // A range is only applied once both days are there and in order.
  const [ranging, setRanging] = useState(filters.date === "range");
  const [from, setFrom] = useState(filters.from ?? "");
  const [to, setTo] = useState(filters.to ?? "");
  const applyRange = (a: string, b: string) => {
    if (a && b && a <= b) onChange({ date: "range", from: a, to: b });
  };
  const current = ranging ? "range" : filters.date;
  return (
    <>
      {DATES.map((d) => (
        <label key={d.key} className={s.popItem}>
          <input
            type="radio"
            name="gallery-date"
            checked={current === d.key}
            onChange={() => {
              if (d.key === "range") {
                setRanging(true);
                applyRange(from, to);
              } else {
                setRanging(false);
                onChange({ date: d.key, from: null, to: null });
              }
            }}
          />
          {d.label}
        </label>
      ))}
      {ranging && (
        <div className={s.range}>
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.currentTarget.value);
                applyRange(e.currentTarget.value, to);
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.currentTarget.value);
                applyRange(from, e.currentTarget.value);
              }}
            />
          </label>
        </div>
      )}
    </>
  );
}

export function FilterBar({
  filters,
  sessions,
  agents,
  members,
  onChange,
  onClearAll,
}: FilterBarProps) {
  const kinds = Object.entries(KIND_LABEL) as [Kind, string][];
  const dateValue =
    filters.date === "any"
      ? null
      : filters.date === "range"
        ? `${filters.from} – ${filters.to}`
        : DATES.find((d) => d.key === filters.date)!.label;
  const session = filters.session
    ? (sessions.find((x) => x.id === filters.session)?.title ?? "A session")
    : null;
  const owner = filters.owner
    ? (members.find((m) => m.id === filters.owner)?.name ?? "Someone")
    : null;
  const any =
    filters.kinds.length > 0 ||
    filters.date !== "any" ||
    !!filters.session ||
    !!filters.agent ||
    !!filters.owner;

  return (
    <div role="group" aria-label="Filters" className={s.chips}>
      <Chip
        label="Type"
        value={
          filters.kinds.length
            ? filters.kinds.map((k) => KIND_LABEL[k]).join(", ")
            : null
        }
        onClear={() => onChange({ kinds: [] })}
      >
        {() =>
          kinds.map(([key, label]) => (
            <label key={key} className={s.popItem}>
              <input
                type="checkbox"
                checked={filters.kinds.includes(key)}
                onChange={(e) =>
                  onChange({
                    kinds: e.currentTarget.checked
                      ? [...filters.kinds, key]
                      : filters.kinds.filter((k) => k !== key),
                  })
                }
              />
              {label}
            </label>
          ))
        }
      </Chip>
      <Chip
        label="Date"
        value={dateValue}
        onClear={() => onChange({ date: "any", from: null, to: null })}
      >
        {() => <DateChoices filters={filters} onChange={onChange} />}
      </Chip>
      <Chip
        label="Session"
        value={session}
        onClear={() => onChange({ session: null })}
      >
        {(close) => (
          <Choices
            items={sessions.map((x) => ({ key: x.id, label: x.title }))}
            value={filters.session}
            onPick={(id) => {
              onChange({ session: id });
              close();
            }}
          />
        )}
      </Chip>
      <Chip
        label="Agent"
        value={filters.agent}
        onClear={() => onChange({ agent: null })}
      >
        {(close) => (
          <Choices
            items={agents.map((a) => ({ key: a, label: a }))}
            value={filters.agent}
            onPick={(agent) => {
              onChange({ agent });
              close();
            }}
          />
        )}
      </Chip>
      <Chip
        label="Owner"
        value={owner}
        onClear={() => onChange({ owner: null })}
      >
        {(close) => (
          <Choices
            items={members.map((m) => ({ key: m.id, label: m.name }))}
            value={filters.owner}
            onPick={(id) => {
              onChange({ owner: id });
              close();
            }}
          />
        )}
      </Chip>
      {any && (
        <button type="button" className={s.clearAll} onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
