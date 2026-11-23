import { notFound } from "next/navigation";
import { Notice } from "../../../shell/Notice";

// A development page: the notice screen without a database. Never served in production.
export default function DevNoticePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Notice tryAgain>Couldn&apos;t load the hive.</Notice>;
}
