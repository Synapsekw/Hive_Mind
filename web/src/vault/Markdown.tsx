// A note's text, rendered. The text was written by other people and agents, so it is data:
// react-markdown builds React elements (no raw HTML plugin, so markup in a note stays text),
// its default URL check drops `javascript:` and friends, links open in a new tab, and an image
// becomes a link to it so nothing remote is fetched just by opening a note.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripFrontmatter } from "./format";
import s from "./vault.module.css";

const components: Components = {
  // A link whose address the URL check removed (`javascript:` and the like) stays as its text.
  a: ({ node: _node, href, children, ...rest }) =>
    href ? (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : "";
    if (!url) return <span className={s.imageLink}>{alt}</span>;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={s.imageLink}
      >
        {alt || url}
      </a>
    );
  },
};

export function Markdown({ body }: { body: string }) {
  return (
    <div className={s.markdown}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {stripFrontmatter(body)}
      </ReactMarkdown>
    </div>
  );
}
