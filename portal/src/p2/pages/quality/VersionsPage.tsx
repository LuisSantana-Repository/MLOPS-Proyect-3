import { useState } from "react";
import type {
  VersionDiff,
  VersionEntry,
  VersionEnvironment,
  VersionsFile,
} from "../../api/quality";
import { QualityEmptyState } from "../../components/quality/QualityEmptyState";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { QualityStat } from "../../components/quality/QualityStat";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useQualityVersions } from "../../hooks/quality/useQualityVersions";
import { useVersionDiff } from "../../hooks/quality/useVersionDiff";

function EnvironmentBadge({ label, env }: { label: string; env: VersionEnvironment }) {
  const pushed = env.status === "pushed";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        pushed ? "bg-accent-mint-soft text-accent-mint" : "bg-border text-ink-muted"
      }`}
      title={env.contentHash ?? "sin content hash"}
    >
      {label}: {pushed ? "pushed" : "pendiente"}
    </span>
  );
}

function VersionTimeline({ versions }: { versions: VersionEntry[] }) {
  return (
    <ol
      data-testid="versions-timeline"
      className="relative space-y-3 border-l border-border pl-5 before:absolute before:-left-[5px] before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-accent-lilac"
    >
      {versions.map((entry) => (
        <li
          key={entry.version}
          className="rounded-2xl border border-border bg-surface p-4 shadow-card"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm font-semibold text-ink">{entry.version}</span>
            <span className="text-xs text-ink-faint">{entry.createdAt}</span>
            {entry.commit && (
              <span className="font-mono text-[11px] text-ink-faint">commit {entry.commit}</span>
            )}
            <span className="ml-auto flex flex-wrap gap-2">
              <EnvironmentBadge label="DEV" env={entry.environments.dev} />
              <EnvironmentBadge label="PROD" env={entry.environments.prod} />
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-ink-faint">Imágenes</dt>
              <dd className="font-medium text-ink">{entry.totals.images}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">Cajas</dt>
              <dd className="font-medium text-ink">{entry.totals.annotations}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">% objetos pequeños</dt>
              <dd className="font-medium text-ink">
                {entry.metrics.smallObjectsPercent.toFixed(2)}%
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Ratio desbalance</dt>
              <dd className="font-medium text-ink">
                {entry.metrics.classImbalanceRatio.toFixed(2)}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}

function DiffPanel({ from, to }: { from: string; to: string }) {
  const resource = useVersionDiff(from, to);

  return (
    <div
      data-testid="version-diff"
      className="rounded-2xl border border-border bg-surface p-5 shadow-card"
    >
      <h2 className="mb-3 text-sm font-semibold text-ink">
        Diff entre <span className="font-mono">{from || "—"}</span> y{" "}
        <span className="font-mono">{to || "—"}</span>
      </h2>

      {resource.status === "loading" && <Skeleton className="h-24" />}

      {resource.status === "empty" && (
        <p className="text-sm text-ink-muted">{resource.message ?? "Sin información de diff."}</p>
      )}

      {resource.status === "error" && <p className="text-sm text-red-700">{resource.message}</p>}

      {resource.status === "success" && resource.data && <DiffContent data={resource.data} />}
    </div>
  );
}

function DeltaValue({ value, suffix = "" }: { value: number; suffix?: string }) {
  const sign = value > 0 ? "+" : "";
  const color = value > 0 ? "text-accent-mint" : value < 0 ? "text-accent-lilac" : "text-ink";
  return (
    <span className={`font-semibold ${color}`}>
      {sign}
      {value.toLocaleString("es")}
      {suffix}
    </span>
  );
}

function DiffContent({ data }: { data: VersionDiff }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QualityStat label="Imágenes añadidas" value={<DeltaValue value={data.imagesAdded} />} />
        <QualityStat label="Cajas añadidas" value={<DeltaValue value={data.annotationsAdded} />} />
        <QualityStat
          label="Δ objetos pequeños"
          value={<DeltaValue value={data.smallObjectsPercentDelta} suffix=" pp" />}
        />
        <QualityStat
          label="Δ grupos duplicados"
          value={<DeltaValue value={data.duplicateGroupsDelta} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Clases que salieron del mínimo
          </h3>
          {data.classesThatLeftMinimum.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Ninguna.</p>
          ) : (
            <ul data-testid="version-diff-left-minimum" className="mt-1 flex flex-wrap gap-2">
              {data.classesThatLeftMinimum.map((categoryId) => (
                <li
                  key={categoryId}
                  className="rounded-full bg-red-100 px-2.5 py-0.5 font-mono text-xs text-red-700"
                >
                  #{categoryId}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Clases que entraron al mínimo
          </h3>
          {data.classesThatEnteredMinimum.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">Ninguna.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {data.classesThatEnteredMinimum.map((categoryId) => (
                <li
                  key={categoryId}
                  className="rounded-full bg-accent-mint-soft px-2.5 py-0.5 font-mono text-xs text-accent-mint"
                >
                  #{categoryId}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        <table data-testid="version-diff-classes" className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-sidebar text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="px-3 py-2 font-medium">Clase</th>
              <th className="px-3 py-2 font-medium">Desde</th>
              <th className="px-3 py-2 font-medium">Hasta</th>
              <th className="px-3 py-2 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {data.classCountChanges.map((row) => (
              <tr
                key={row.categoryId}
                data-testid={`class-diff-${row.categoryId}`}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-3 py-2 font-mono text-ink">#{row.categoryId}</td>
                <td className="px-3 py-2 text-ink-muted">{row.from}</td>
                <td className="px-3 py-2 text-ink-muted">{row.to}</td>
                <td className="px-3 py-2">
                  <DeltaValue value={row.delta} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VersionsContent({ data }: { data: VersionsFile }) {
  const first = data.versions[0]?.version ?? "";
  const last = data.versions[data.versions.length - 1]?.version ?? "";
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);

  return (
    <div className="space-y-5">
      <VersionTimeline versions={data.versions} />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Desde
          <select
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {data.versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Hasta
          <select
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink"
          >
            {data.versions.map((entry) => (
              <option key={entry.version} value={entry.version}>
                {entry.version}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-ink-faint">
          Mínimo exigido por clase: {data.minimumImagesPerClass}
        </span>
      </div>

      <DiffPanel from={from} to={to} />
    </div>
  );
}

export function VersionsPage() {
  const resource = useQualityVersions();

  return (
    <QualityPageShell
      title="Versiones"
      subtitle="Línea de tiempo de releases, estado DEV/PROD y diferencias entre versiones."
    >
      {resource.status === "loading" && <Skeleton className="h-96" />}

      {resource.status === "empty" && (
        <QualityEmptyState message={resource.message ?? "Todavía no hay versiones publicadas."} />
      )}

      {resource.status === "error" && (
        <ErrorState
          title="No se pudieron cargar las versiones."
          message={resource.message ?? "Error desconocido."}
          onRetry={resource.reload}
        />
      )}

      {resource.status === "success" &&
        resource.data &&
        (resource.data.versions.length === 0 ? (
          <QualityEmptyState message="El archivo de versiones está vacío." />
        ) : (
          <VersionsContent data={resource.data} />
        ))}
    </QualityPageShell>
  );
}
