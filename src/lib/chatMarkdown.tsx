import type { ReactNode } from "react";
import { parseInlineMarkdown } from "./inlineMarkdown";

// A small, dependency-free renderer for the AI assistant's replies —
// paragraphs, bullet/numbered lists, and fenced code blocks, plus whatever
// inline markup `inlineMarkdown.tsx` already handles. The system prompt
// (see `ai.rs`) asks the model to stick to this subset; anything outside it
// just falls back to a plain paragraph rather than rendering incorrectly.

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-slate-100">
      <code>{code}</code>
    </pre>
  );
}

export function renderChatMarkdown(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let blockIndex = 0;

  let listItems: string[] = [];
  let listOrdered = false;

  function flushList() {
    if (listItems.length > 0) {
      const items = listItems.map((item, i) => <li key={i}>{parseInlineMarkdown(item, `li-${blockIndex}-${i}`)}</li>);
      blocks.push(
        listOrdered ? (
          <ol key={`list-${blockIndex++}`} className="ml-5 list-decimal space-y-1">
            {items}
          </ol>
        ) : (
          <ul key={`list-${blockIndex++}`} className="ml-5 list-disc space-y-1">
            {items}
          </ul>
        ),
      );
    }
    listItems = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushList();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push(<CodeBlock key={`code-${blockIndex++}`} code={codeLines.join("\n")} />);
      i += 1; // skip the closing fence
      continue;
    }

    if (trimmed === "") {
      flushList();
      i += 1;
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listItems.push(bullet[1]);
      i += 1;
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      if (listItems.length > 0 && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(numbered[1]);
      i += 1;
      continue;
    }

    flushList();
    blocks.push(
      <p key={`p-${blockIndex++}`} className="first:mt-0">
        {parseInlineMarkdown(trimmed, `p-${blockIndex}`)}
      </p>,
    );
    i += 1;
  }
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}
