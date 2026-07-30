interface Props {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title = "Confirm",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]">
      <div className="neo-panel w-full max-w-lg bg-white p-6">
        <div className="flex flex-col gap-4">
          <h3 className="text-xl font-semibold text-ink">{title}</h3>
          {description && <p className="text-slate-600">{description}</p>}
          <div className="mt-4 flex justify-end gap-3">
            <button onClick={onCancel} className="neo-btn px-4 py-2">
              {cancelLabel}
            </button>
            <button onClick={onConfirm} className="neo-btn bg-neo-red px-4 py-2 text-white">
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
