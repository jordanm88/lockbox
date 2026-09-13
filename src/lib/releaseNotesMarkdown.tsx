import type { ReactNode } from "react";
import { parseInlineMarkdown } from "./inlineMarkdown";

// A deliberately small, dependency-free renderer — not a general markdown
// parser — scoped to exactly what GitHub's `generate_release_notes: true`
// actually produces (see build.yml): a "## What's Changed" heading, a flat
// bullet list of PR links, and a trailing "**Full Changelog**: <url>" line.
// Pulling in a markdown library for content this narrow and fully
// controlled (it's our own releases, never arbitrary user input) would be
// more dependency than the job needs. Renders straight to React elements
// rather than HTML + dangerouslySetInnerHTML, so there's no injection
// surface to sanitize against in the first place. Inline-run parsing (bold,
// code, links) is shared with `chatMarkdown.tsx` via `inlineMarkdown.tsx`.

export function renderReleaseNotes(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let blockIndex = 0;

  function flushList() {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={`list-${blockIndex++}`} className="ml-5 list-disc space-y-1.5">
          {listItems.map((item, i) => (
            <li key={i}>{parseInlineMarkdown(item, `li-${blockIndex}-${i}`)}</li>
          ))}
        </ul>,
      );
    }
    listItems = [];
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed === "") {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      blocks.push(
        <p
          key={`h-${blockIndex++}`}
          className={`mt-4 font-bold text-ink first:mt-0 ${level <= 2 ? "text-base" : "text-sm"}`}
        >
          {parseInlineMarkdown(heading[2], `h-${blockIndex}`)}
        </p>,
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      listItems.push(bullet[1]);
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blockIndex++}`} className="mt-2 first:mt-0">
        {parseInlineMarkdown(trimmed, `p-${blockIndex}`)}
      </p>,
    );
  }
  flushList();

  return <div className="space-y-1 text-sm leading-relaxed text-slate-700">{blocks}</div>;
}
