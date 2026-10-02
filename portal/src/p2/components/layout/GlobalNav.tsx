import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  FlaskConical,
  History,
  LayoutDashboard,
  ListChecks,
  PieChart,
  Rocket,
  ScatterChart,
  Search,
  Settings,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { NavLink } from "react-router-dom";

interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const PORTAL_ITEMS: NavItem[] = [
  { label: "Tablero", to: "/dashboard", icon: LayoutDashboard },
  { label: "Buscar", to: "/search", icon: Search },
  { label: "Subir fotografías", to: "/upload", icon: Upload },
];

/** Seis vistas del Proyecto 2 (calidad y versionado del dataset). */
const QUALITY_ITEMS: NavItem[] = [
  { label: "Resumen", to: "/overview", icon: Activity },
  { label: "Analizadores", to: "/analyzers", icon: BarChart3 },
  { label: "Analítica", to: "/analytics", icon: ScatterChart },
  { label: "Particiones", to: "/splits", icon: PieChart },
  { label: "Versiones", to: "/versions", icon: History },
  { label: "Copilot", to: "/copilot", icon: Bot },
  { label: "Configuración", to: "/settings", icon: Settings },
];

/** Cinco páginas del Proyecto 3 (entrenamiento e inferencia del clasificador). */
const MODEL_ITEMS: NavItem[] = [
  { label: "Training", to: "/training", icon: Rocket },
  { label: "Experiments", to: "/experiments", icon: FlaskConical },
  { label: "Evaluation", to: "/evaluation", icon: Target },
  { label: "Models", to: "/models", icon: Boxes },
  { label: "Inference", to: "/inference", icon: Sparkles },
  { label: "Cola de anotación", to: "/annotation-queue", icon: ListChecks },
];

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent-lilac-soft text-accent-lilac"
                  : "text-ink-muted hover:bg-surface hover:text-ink"
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

/**
 * Navegación global del portal unificado: portal de anotación (Proyecto 1), vistas de
 * calidad del dataset (Proyecto 2) y páginas del modelo (Proyecto 3). Annotate
 * sigue sin usar este shell (modo de enfoque de pantalla completa).
 */
export function GlobalNav({ children }: { children?: ReactNode }) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border bg-sidebar lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent-lilac" aria-hidden />
        <span className="truncate text-sm font-semibold text-ink">Portal de Anotación</span>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-6">
        <NavGroup items={PORTAL_ITEMS} />

        <p className="mt-3 hidden px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint lg:block">
          Calidad del dataset
        </p>

        <NavGroup items={QUALITY_ITEMS} />

        <p className="mt-3 hidden px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint lg:block">
          Modelo
        </p>

        <NavGroup items={MODEL_ITEMS} />
      </nav>

      {children && <div className="border-t border-border px-5 py-5">{children}</div>}
    </aside>
  );
}
