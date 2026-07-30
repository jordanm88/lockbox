interface PageHeaderProps {
  icon: string;
  title: string;
  subtitle: string;
}

export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="neo-card mb-8 border-slate-200 bg-white/85 px-6 py-6 backdrop-blur-sm">
      <h2 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-ink">
        <span>{icon}</span>
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-sm font-medium text-slate-600">{subtitle}</p>
    </div>
  );
}
