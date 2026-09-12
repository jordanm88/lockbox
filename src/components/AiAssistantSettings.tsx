import { useEffect, useState } from "react";
import {
  clearAiApiKey,
  getAiConfig,
  rebuildAiIndex,
  setAiApiKey,
  setAiEnabled,
} from "../lib/vaultBridge";
import { getErrorMessage } from "../lib/errors";

interface AiAssistantSettingsProps {
  /** Called after any change that affects whether the chat popup should be
   * visible (enabling/disabling, saving/removing a key), so App.tsx's own
   * copy of the config stays in sync without waiting for the next unlock. */
  onConfigChanged: () => void;
}

// Anthropic is the only provider actually wired up — these two are shown so
// the intended shape ("pick a provider, others come later") is visible now,
// not because they do anything yet.
const PLACEHOLDER_PROVIDERS = ["OpenAI", "Google Gemini"];

export default function AiAssistantSettings({ onConfigChanged }: AiAssistantSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [rebuilding, setRebuilding] = useState(false);
  const [indexStatus, setIndexStatus] = useState<string | null>(null);

  async function refresh() {
    try {
      const config = await getAiConfig();
      setEnabled(config.enabled);
      setHasApiKey(config.hasApiKey);
    } catch {
      // Vault likely locked mid-navigation — leave the last known state.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleToggleEnabled() {
    const next = !enabled;
    try {
      await setAiEnabled(next);
      setEnabled(next);
      onConfigChanged();
    } catch (err) {
      setKeyStatus({ kind: "error", text: getErrorMessage(err, "Failed to update the AI assistant setting.") });
    }
  }

  async function handleSaveKey() {
    setKeyStatus(null);
    if (apiKeyInput.trim().length === 0) {
      setKeyStatus({ kind: "error", text: "Enter an API key first." });
      return;
    }
    setSavingKey(true);
    try {
      await setAiApiKey("anthropic", apiKeyInput.trim());
      setApiKeyInput("");
      setHasApiKey(true);
      setKeyStatus({ kind: "ok", text: "API key saved and verified." });
      onConfigChanged();
    } catch (err) {
      setKeyStatus({ kind: "error", text: getErrorMessage(err, "Failed to save the API key.") });
    } finally {
      setSavingKey(false);
    }
  }

  async function handleClearKey() {
    setKeyStatus(null);
    try {
      await clearAiApiKey();
      setHasApiKey(false);
      setEnabled(false);
      setKeyStatus({ kind: "ok", text: "API key removed." });
      onConfigChanged();
    } catch (err) {
      setKeyStatus({ kind: "error", text: getErrorMessage(err, "Failed to remove the API key.") });
    }
  }

  async function handleRebuildIndex() {
    setRebuilding(true);
    setIndexStatus(null);
    try {
      const count = await rebuildAiIndex();
      setIndexStatus(`Indexed ${count} file${count === 1 ? "" : "s"}.`);
    } catch (err) {
      setIndexStatus(getErrorMessage(err, "Failed to rebuild the index."));
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="neo-panel mb-6 bg-paper p-6">
      <h3 className="mb-1 text-xl font-semibold text-ink">AI Assistant</h3>
      <p className="mb-4 text-sm text-slate-500">
        Ask questions about this vault's files in a chat popup. When enabled, your question — and any relevant file
        content found in this vault — is sent to your chosen provider using your own API key, only at the moment
        you ask something. Nothing is sent in the background.
      </p>

      <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="font-semibold text-ink">Enable AI Assistant</div>
          <div className="text-sm text-slate-600">{hasApiKey ? "Ready to use." : "Add an API key below first."}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={loading || !hasApiKey}
          onClick={handleToggleEnabled}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-neo-blue" : "bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <div className="mt-4">
        <span className="mb-2 block text-sm font-semibold text-slate-700">Provider</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="neo-btn cursor-default bg-neo-blue py-2.5 text-center text-white">Anthropic (Claude Haiku 4.5)</div>
          {PLACEHOLDER_PROVIDERS.map((name) => (
            <div
              key={name}
              title="Coming soon"
              className="neo-btn cursor-not-allowed bg-slate-50 py-2.5 text-center text-slate-400"
            >
              {name} <span className="text-xs">(soon)</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="ai-api-key" className="mb-1 block text-sm font-semibold text-slate-700">
          Anthropic API Key
        </label>
        <div className="flex gap-2">
          <input
            id="ai-api-key"
            type="password"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder={hasApiKey ? "•••••••••••••••••••• (key saved)" : "sk-ant-…"}
            className="neo-input w-full px-4 py-2"
          />
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={savingKey}
            className="neo-btn shrink-0 bg-neo-blue px-4 py-2 text-white disabled:opacity-60"
          >
            {savingKey ? "Verifying…" : "Save"}
          </button>
        </div>
        {hasApiKey && (
          <button type="button" onClick={handleClearKey} className="mt-2 text-xs font-semibold text-red-600 hover:text-red-700">
            Remove saved key
          </button>
        )}
        {keyStatus && (
          <p className={`mt-2 text-sm font-medium ${keyStatus.kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {keyStatus.text}
          </p>
        )}
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-ink">Vault content index</div>
            <div className="text-xs text-slate-500">
              Plain-text files and PDFs are searchable by content; everything else by name/size only.
            </div>
          </div>
          <button
            type="button"
            onClick={handleRebuildIndex}
            disabled={rebuilding}
            className="neo-btn shrink-0 bg-white px-3 py-2 text-sm disabled:opacity-60"
          >
            {rebuilding ? "Rebuilding…" : "Rebuild index"}
          </button>
        </div>
        {indexStatus && <p className="mt-2 text-sm text-slate-600">{indexStatus}</p>}
      </div>
    </div>
  );
}
