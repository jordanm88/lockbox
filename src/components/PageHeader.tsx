interface PageHeaderProps {
  icon: string;
  title: string;
  subtitle: string;
}

export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="neo-card mb-8 border-neo-blue/80 bg-neo-cyan/10 px-6 py-6">
      <h2 className="flex items-center gap-3 text-3xl font-black uppercase tracking-tight text-ink">
        <span>{icon}</span>
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-sm font-bold text-ink/70">{subtitle}</p>
    </div>
  );
}
