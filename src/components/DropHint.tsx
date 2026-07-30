interface DropHintProps {
  active: boolean;
}

export default function DropHint({ active }: DropHintProps) {
  return (
    <p className={`text-sm font-medium ${active ? "text-neo-blue" : "text-slate-600"}`}>
      Drag files or folders into this area to stage them before encryption.
    </p>
  );
}
