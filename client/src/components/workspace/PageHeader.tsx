import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  icon?: LucideIcon;
  children?: ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
}: PageHeaderProps) {
  return (
    <header className="workspace-page-header">
      <div className="workspace-page-heading">
        {Icon && (
          <span className="workspace-page-icon" aria-hidden="true">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <p className="page-kicker">{eyebrow}</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
      </div>
      {children && <div className="workspace-page-actions">{children}</div>}
    </header>
  );
}
