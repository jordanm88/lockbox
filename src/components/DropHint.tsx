interface DropHintProps {
  active: boolean;
}

export default function DropHint({ active }: DropHintProps) {
  return (
    <p className={`text-sm font-bold uppercase tracking-wide ${active ? "text-neo-blue" : "text-ink/60"}`}>
      Drag files or folders into this area to stage them before encryption.
    </p>
  );
}
