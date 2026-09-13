import { FormEvent, useEffect, useRef, useState } from "react";
import { aiChat, ChatSource } from "../lib/vaultBridge";
import { getErrorMessage } from "../lib/errors";
import { renderChatMarkdown } from "../lib/chatMarkdown";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
  sources?: ChatSource[];
}

interface ChatPopupProps {
  /** Jumps to the Vault tab and searches for this file — see App.tsx's
   * `openFileFromChat`. */
  onOpenFile: (relativePath: string) => void;
}

function leafName(path: string): string {
  return path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
}

// Positioned by the shared bottom-right stack in App.tsx (alongside
// UploadToast), not by this component itself — see the comment there for
// why nothing here sets its own `fixed`/`bottom`/`right` classes. Chat
// history is plain component state: it's gone the moment the vault locks
// or the popup unmounts, deliberately never written to disk (see the AI
// assistant plan) — one less encrypted store to design, and it keeps
// residual Q&A content off the drive entirely.
export default function ChatPopup({ onOpenFile }: ChatPopupProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || sending) return;

    const history = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: question }]);
    setInput("");
    setSending(true);

    try {
      const response = await aiChat(question, history);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: response.answer, sources: response.sources },
      ]);
    } catch (err) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: getErrorMessage(err, "Failed to reach the AI assistant."), error: true },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-neo-blue text-2xl text-white shadow-xl transition hover:scale-105"
      >
        🤖
      </button>
    );
  }

  return (
    <div className="flex h-[32rem] w-96 max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">🤖 Vault Assistant</p>
          <p className="truncate text-xs text-slate-500">Anthropic Claude · this vault's files only</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-full px-2 py-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            Ask about files in your vault — e.g. "what's in my notes.txt?" or "do I have any invoices?". Relevant
            file content is sent to Anthropic, using your own API key, only when you ask something here. It never
            searches the web — only this vault's files.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[88%]">
              <div
                className={`rounded-2xl px-3.5 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-neo-blue text-white"
                    : message.error
                      ? "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                      : "bg-slate-100 text-ink"
                }`}
              >
                {message.role === "assistant" && !message.error ? (
                  renderChatMarkdown(message.content)
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
              {message.sources && message.sources.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {message.sources.map((source) => (
                    <button
                      key={source.path}
                      type="button"
                      onClick={() => onOpenFile(source.path)}
                      title={source.hasContent ? source.path : `${source.path} (name/size only)`}
                      className="flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 ring-1 ring-slate-200 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                    >
                      <span aria-hidden>📄</span>
                      <span className="truncate">{leafName(source.path)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-xs font-medium text-slate-400">Thinking…</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-100 p-3">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about your vault…"
          disabled={sending}
          className="neo-input flex-1 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="neo-btn shrink-0 bg-neo-blue px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  );
}
