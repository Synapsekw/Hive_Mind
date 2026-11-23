import { notFound } from "next/navigation";
import { fixtureGallery } from "../../../gallery/fixture";
import { DevGallery } from "./DevGallery";

// A development page: the gallery over the built-in fixture. Never served in production.
// A fixed clock keeps every render, and so every test and screenshot, the same.
//   ?fail=1      every action is refused
//   ?mislabel=1  a PDF's link answers with a web page instead
//   ?empty=1     a hive with no files
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DevGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const data =
    one(q.empty) === "1" ? { files: [], next: null } : fixtureGallery(NOW);
  return (
    <DevGallery
      data={data}
      now={NOW}
      fail={one(q.fail) === "1"}
      mislabel={one(q.mislabel) === "1"}
    />
  );
}
