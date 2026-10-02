import { type FormEvent, useState } from "react";
import { type QualitySettings, updateQualitySettings } from "../../api/quality";
import { QualityEmptyState } from "../../components/quality/QualityEmptyState";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Skeleton } from "../../components/ui/Skeleton";
import { useQualitySettings } from "../../hooks/quality/useQualitySettings";

type CheckPatch = Partial<{ threshold: number; severity: "warn" | "fail"; min_classes: number }>;

function SettingsForm({ initial }: { initial: QualitySettings }) {
  const [config, setConfig] = useState<QualitySettings>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = config.splits.train + config.splits.val + config.splits.test;
  const proportionsOk = Math.abs(total - 1) < 1e-6;

  function updateCheck(name: string, patch: CheckPatch): void {
    setConfig((previous) => {
      const current = previous.checks[name];
      if (!current) return previous;
      return { ...previous, checks: { ...previous.checks, [name]: { ...current, ...patch } } };
    });
  }

  function updateSplit(field: "train" | "val" | "test" | "seed", value: number): void {
    setConfig((previous) => ({ ...previous, splits: { ...previous.splits, [field]: value } }));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSavedAt(null);

    if (!proportionsOk) {
      setError(
        `Las proporciones train + val + test deben sumar 1 (actualmente suman ${total.toFixed(2)}).`,
      );
      return;
    }

    setSaving(true);
    try {
      // El backend valida y escribe quality.yaml; la UI usa la respuesta para
      // reflejar exactamente lo persistido (nunca un estado optimista).
      const updated = await updateQualitySettings(config);
      setConfig(updated);
      setSavedAt(new Date().toLocaleTimeString("es"));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "No se pudo guardar la política de calidad.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <h2 className="border-b border-border bg-sidebar px-4 py-2.5 text-sm font-semibold text-ink">
          Checks de la compuerta
        </h2>
        <div className="divide-y divide-border">
          {Object.entries(config.checks).map(([name, check]) => (
            <div key={name} className="grid grid-cols-1 items-end gap-3 px-4 py-3 sm:grid-cols-4">
              <span className="font-mono text-sm text-ink">{name}</span>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Umbral
                <input
                  aria-label={`${name}-threshold`}
                  type="number"
                  step="any"
                  value={check.threshold}
                  onChange={(event) => updateCheck(name, { threshold: Number(event.target.value) })}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Severidad
                <select
                  aria-label={`${name}-severity`}
                  value={check.severity}
                  onChange={(event) =>
                    updateCheck(name, { severity: event.target.value as "warn" | "fail" })
                  }
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
                >
                  <option value="warn">warn</option>
                  <option value="fail">fail</option>
                </select>
              </label>
              {check.min_classes === undefined ? (
                <span />
              ) : (
                <label className="flex flex-col gap-1 text-xs text-ink-muted">
                  Mínimo de clases
                  <input
                    aria-label={`${name}-min_classes`}
                    type="number"
                    min={1}
                    value={check.min_classes}
                    onChange={(event) =>
                      updateCheck(name, { min_classes: Number(event.target.value) })
                    }
                    className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
                  />
                </label>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
        <h2 className="border-b border-border bg-sidebar px-4 py-2.5 text-sm font-semibold text-ink">
          Proporciones de los splits
        </h2>
        <div className="grid grid-cols-2 gap-4 px-4 py-4 lg:grid-cols-4">
          {(["train", "val", "test", "seed"] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1 text-xs text-ink-muted">
              {field}
              <input
                aria-label={`splits-${field}`}
                type="number"
                step={field === "seed" ? 1 : 0.01}
                value={config.splits[field]}
                onChange={(event) => updateSplit(field, Number(event.target.value))}
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>
          ))}
        </div>
        <p className={`px-4 pb-4 text-xs ${proportionsOk ? "text-ink-faint" : "text-red-700"}`}>
          train + val + test = {total.toFixed(2)}
        </p>
      </section>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {savedAt && (
        <p className="rounded-xl border border-accent-mint/40 bg-accent-mint-soft/40 px-4 py-3 text-sm text-accent-mint">
          Política guardada a las {savedAt}. Vuelve a ejecutar el Quality Gate para aplicar el
          cambio.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isLoading={saving}>
          Guardar política
        </Button>
        <span className="text-xs text-ink-faint">
          Persiste en <code className="font-mono">quality.yaml</code>, el mismo archivo que lee la
          compuerta.
        </span>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold text-ink">Volver a ejecutar el Quality Gate</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Después de guardar, corre el pipeline de calidad (Frente 2) para aplicar la nueva
          política:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-canvas p-3 font-mono text-xs text-ink">
          <code>
            {`python -m dataset_quality.cli --coco dataset.json --config quality.yaml --images-dir images/ --output output/quality.json`}
          </code>
        </pre>
      </section>
    </form>
  );
}

export function SettingsPage() {
  const resource = useQualitySettings();

  return (
    <QualityPageShell
      title="Configuración"
      subtitle="Edita los umbrales y severidades de la política; el cambio persiste en quality.yaml."
    >
      {resource.status === "loading" && <Skeleton className="h-96" />}

      {resource.status === "empty" && (
        <QualityEmptyState
          message={resource.message ?? "Todavía no existe un archivo de política."}
        />
      )}

      {resource.status === "error" && (
        <ErrorState
          title="No se pudo cargar la política."
          message={resource.message ?? "Error desconocido."}
          onRetry={resource.reload}
        />
      )}

      {resource.status === "success" && resource.data && <SettingsForm initial={resource.data} />}
    </QualityPageShell>
  );
}
