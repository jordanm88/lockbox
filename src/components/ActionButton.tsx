import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "danger" | "neutral";
}

export default function ActionButton({ variant = "neutral", className = "", ...props }: Props) {
  const base = "neo-btn px-4 py-2.5";
  const vclass =
    variant === "primary"
      ? "bg-neo-blue text-white"
      : variant === "danger"
      ? "bg-neo-red text-white"
      : "bg-white text-ink";

  return <button {...props} className={`${base} ${vclass} ${className}`.trim()} />;
}
