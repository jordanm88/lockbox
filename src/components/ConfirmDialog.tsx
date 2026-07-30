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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="neo-panel w-full max-w-lg p-6">
        <div className="flex flex-col gap-4">
          <h3 className="text-xl font-black">{title}</h3>
          {description && <p className="text-ink/70">{description}</p>}
          <div className="mt-4 flex justify-end gap-3">
            <button onClick={onCancel} className="neo-btn py-2 px-4">
              {cancelLabel}
            </button>
            <button onClick={onConfirm} className="neo-btn bg-neo-red text-white py-2 px-4">
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
