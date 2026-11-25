import { notFound } from "next/navigation";
import { fixtureGallery } from "../../../gallery/fixture";
import { DevGallery } from "./DevGallery";

// A development page: the gallery over the built-in fixture. Never served in production.
// A fixed clock keeps every render, and so every test and screenshot, the same.
//   ?fail=1      every action is refused
//   ?mislabel=1  a PDF's link answers with a web page instead
//   ?empty=1     a hive with no files
//   ?every=1     every file opens in the viewer (the v2 viewer's tests)
//   ?stale=1     every thumbnail link is dead, as on a page left open past ten minutes
//   ?more=1      older files wait behind "Load more", so server-side filters ask the server
//   ?slowstart=1 starting an upload takes 1.5 s
//   ?failfinish=1 the first file an upload records is refused once (its bytes are stored)
const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DevGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  let data =
    one(q.empty) === "1"
      ? {
          files: [],
          sessions: [],
          folders: [],
          members: [],
          memberships: [],
          next: null,
        }
      : fixtureGallery(NOW);
  // Without ?more the first page is the whole gallery: every filter is answered in the page.
  if (one(q.more) !== "1") data = { ...data, next: null };
  if (one(q.stale) === "1")
    data = {
      ...data,
      files: data.files.map((f) =>
        f.thumb ? { ...f, thumb: "/dev/gallery/expired-thumbnail" } : f,
      ),
    };
  return (
    <DevGallery
      data={data}
      now={NOW}
      fail={one(q.fail) === "1"}
      mislabel={one(q.mislabel) === "1"}
      everyFile={one(q.every) === "1"}
      slowStart={one(q.slowstart) === "1"}
      failFinish={one(q.failfinish) === "1"}
    />
  );
}
