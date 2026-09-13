import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";

// Shared by `releaseNotesMarkdown.tsx` (GitHub release bodies) and
// `chatMarkdown.tsx` (AI assistant replies) — the inline-run parsing (bold,
// code, links) both need is identical; only the block-level structure
// around it differs per source.

function openLink(url: string) {
  openUrl(url).catch((err) => console.error("Failed to open link", err));
}

const INLINE_PATTERN =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|_([^_]+)_|(https?:\/\/[^\s)]+)/g;

export function parseInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
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
          className="font-medium text-blue-600 dark:text-blue-400 underline decoration-blue-200 underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
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
      nodes.push(
        <em key={key} className="italic">
          {match[5]}
        </em>,
      );
    } else if (match[6] !== undefined) {
      // Bare URL, not [text](url) markdown syntax.
      const url = match[6];
      nodes.push(
        <button
          key={key}
          type="button"
          onClick={() => openLink(url)}
          className="break-all font-medium text-blue-600 dark:text-blue-400 underline decoration-blue-200 underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
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
