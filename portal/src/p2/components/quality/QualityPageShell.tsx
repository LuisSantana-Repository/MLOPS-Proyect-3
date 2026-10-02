import type { ReactNode } from "react";

interface QualityPageShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Shell común de las seis vistas de calidad: mismo header y mismo ancho
 * máximo que el resto del portal (ver DashboardPage), para que las pantallas
 * nuevas se sientan parte de la misma app.
 */
export function QualityPageShell({ title, subtitle, actions, children }: QualityPageShellProps) {
  return (
    <main className="flex-1 px-6 py-6 lg:px-10 lg:py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
        {children}
      </div>
    </main>
  );
}
