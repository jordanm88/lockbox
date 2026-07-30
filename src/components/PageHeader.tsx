interface PageHeaderProps {
  icon: string;
  title: string;
  subtitle: string;
}

export default function PageHeader({ icon, title, subtitle }: PageHeaderProps) {
  return (
    <div className="neo-card mb-8 bg-neo-cyan px-6 py-5">
      <h2 className="flex items-center gap-3 text-3xl font-black uppercase tracking-tight">
        <span>{icon}</span>
        {title}
      </h2>
      <p className="mt-1 font-bold">{subtitle}</p>
    </div>
  );
}
