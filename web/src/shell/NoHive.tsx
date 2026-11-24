"use client";

// What the home page says to a signed-in person who is in no hive, and the way out that needs
// no invitation: New hive, opening the rail's own form in place. Without a way to create a hive
// (no actions given or provided) it is the sentence alone.
import { useRef, useState } from "react";
import { useHiveActions, type HiveActions } from "./HiveActions";
import { NewHiveForm } from "./HiveSwitcher";
import { NEW_HIVE, NO_HIVE, NO_HIVE_OR_START } from "./hiveText";
import { Notice } from "./Notice";
import s from "./shell.module.css";

export function NoHive({
  createHive: given,
}: {
  createHive?: HiveActions["createHive"];
}) {
  const provided = useHiveActions();
  const createHive = given ?? provided?.createHive;
  const [form, setForm] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  if (!createHive) return <Notice>{NO_HIVE}</Notice>;
  return (
    <Notice
      after={
        <div className={s.start}>
          {form ? (
            <NewHiveForm
              createHive={createHive}
              displayName=""
              onCancel={() => {
                setForm(false);
                requestAnimationFrame(() => opener.current?.focus());
              }}
            />
          ) : (
            <button
              ref={opener}
              type="button"
              className={s.formButton}
              onClick={() => setForm(true)}
            >
              {NEW_HIVE}
            </button>
          )}
        </div>
      }
    >
      {NO_HIVE_OR_START}
    </Notice>
  );
}
