import { Mark } from "./Mark";
import s from "./brand.module.css";

/** The mark and the HIVE MIND wordmark, for the sign-in cards. Reads as "Hive Mind". */
export function Logo() {
  return (
    <span className={s.logo}>
      <Mark size={32} />
      <span className={s.word}>
        <span className={s.hive}>Hive</span>{" "}
        <span className={s.mind}>Mind</span>
      </span>
    </span>
  );
}
