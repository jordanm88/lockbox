import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

// A deliberately small, dependency-free renderer — not a general markdown
// parser — scoped to exactly what GitHub's `generate_release_notes: true`
// actually produces (see build.yml): a "## What's Changed" heading, a flat
// bullet list of PR links, and a trailing "**Full Changelog**: <url>" line.
// Pulling in a markdown library for content this narrow and fully
// controlled (it's our own releases, never arbitrary user input) would be
// more dependency than the job needs. Renders straight to React elements
// rather than HTML + dangerouslySetInnerHTML, so there's no injection
// surface to sanitize against in the first place.

function openLink(url: string) {
  openUrl(url).catch((err) => console.error("Failed to open link", err));
}

const INLINE_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s)]+)/g;

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;
  INLINE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${index++}`;

    if (match[1] !== undefined) {
      // [label](url)
      const label = match[1];
      const url = match[2];
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => openLink(url)}
          className="font-medium text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-700"
        >
          {label}
        </button>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-ink">
          {match[3]}
        </strong>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-slate-200 px-1 py-0.5 text-xs">
          {match[4]}
        </code>,
      );
    } else if (match[5] !== undefined) {
      // Bare URL, e.g. the compare link on "**Full Changelog**: <url>" —
      // GitHub emits that one as plain text, not [text](url) syntax.
      const url = match[5];
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => openLink(url)}
          className="break-all font-medium text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-700"
        >
          {url}
        </button>,
      );
    }

    lastIndex = INLINE_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

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
            <li key={i}>{parseInline(item, `li-${blockIndex}-${i}`)}</li>
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
          {parseInline(heading[2], `h-${blockIndex}`)}
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
        {parseInline(trimmed, `p-${blockIndex}`)}
      </p>,
    );
  }
  flushList();

  return <div className="space-y-1 text-sm leading-relaxed text-slate-700">{blocks}</div>;
}
