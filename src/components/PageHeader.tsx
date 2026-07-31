interface PageHeaderProps {
  icon: string;
  title: string;
  subtitle: string;
}

// Deliberately plain — Drive/Dropbox/OneDrive don't put page titles inside a
// boxed, colored banner, just a heading + a line of muted helper text.
export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="mb-6">
      <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-ink">
        <span className="text-2xl">{icon}</span>
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}
