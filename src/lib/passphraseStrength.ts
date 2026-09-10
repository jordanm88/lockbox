// Length-weighted heuristic, not a dictionary/pattern cracker like zxcvbn —
// this field is a passphrase (autoComplete="new-password" but intended to be
// a multi-word phrase), where length matters far more than mixing in a
// digit or symbol, so the score leans on length first and treats character
// variety as a secondary boost rather than a requirement.
export interface PassphraseStrength {
  score: number; // 0-4
  label: string;
}

const CLASS_PATTERNS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

export function scorePassphrase(passphrase: string): PassphraseStrength {
  if (!passphrase) return { score: 0, label: "" };

  const classCount = CLASS_PATTERNS.filter((pattern) => pattern.test(passphrase)).length;
  let score = 0;
  if (passphrase.length >= 8) score++;
  if (passphrase.length >= 12) score++;
  if (passphrase.length >= 16 && classCount >= 2) score++;
  if (passphrase.length >= 20 || (passphrase.length >= 12 && classCount >= 3)) score++;
  score = Math.min(score, 4);

  return { score, label: LABELS[score] };
}

const BAR_COLORS = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-blue-500", "bg-emerald-500"];
const TEXT_COLORS = [
  "text-red-600 dark:text-red-400",
  "text-red-600 dark:text-red-400",
  "text-amber-600 dark:text-amber-400",
  "text-blue-600 dark:text-blue-400",
  "text-emerald-600 dark:text-emerald-400",
];

export function passphraseStrengthBarColor(score: number): string {
  return BAR_COLORS[score] ?? BAR_COLORS[0];
}

export function passphraseStrengthTextColor(score: number): string {
  return TEXT_COLORS[score] ?? TEXT_COLORS[0];
}
