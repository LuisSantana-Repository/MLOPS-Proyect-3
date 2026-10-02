import { type FormEvent, useState } from "react";
import { askCopilot, type CopilotAnswer } from "../../api/copilot";
import { QualityPageShell } from "../../components/quality/QualityPageShell";
import { Button } from "../../components/ui/Button";
import { useCopilotTools } from "../../hooks/quality/useCopilotTools";

function ToolTrace({ answer }: { answer: CopilotAnswer }) {
  if (answer.toolCalls.length === 0) {
    return (
      <div data-testid="copilot-tool-calls" className="text-sm text-ink-muted">
        Sin tool calls: el dataset no puede responder esa pregunta.
      </div>
    );
  }

  return (
    <div
      data-testid="copilot-tool-calls"
      className="rounded-2xl border border-border bg-surface p-4 shadow-card"
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Tool calls ({answer.toolCalls.length})
      </h3>
      <ul className="space-y-1.5">
        {answer.toolCalls.map((call) => (
          <li
            key={call.name}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-1.5 text-xs"
          >
            <span className="font-mono font-medium text-ink">{call.name}</span>
            <span className="text-ink-faint">fuente: {call.source}</span>
            <span className="ml-auto font-mono text-ink-muted">
              {call.datasetVersion ?? "sin versión"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CopilotPage() {
  const tools = useCopilotTools();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CopilotAnswer | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    setIsAsking(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await askCopilot(trimmed));
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "No se pudo procesar la pregunta.");
    } finally {
      setIsAsking(false);
    }
  }

  return (
    <QualityPageShell
      title="Copilot"
      subtitle="Pregunta por el dataset. Cada cifra proviene de una herramienta de solo lectura (MCP)."
    >
      <div className="space-y-4">
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card sm:flex-row sm:items-end"
        >
          <label
            htmlFor="copilot-question"
            className="flex flex-1 flex-col gap-1 text-xs text-ink-muted"
          >
            Pregunta
            <input
              id="copilot-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="¿Cuántas imágenes tiene el dataset?"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <Button type="submit" variant="primary" isLoading={isAsking}>
            Preguntar
          </Button>
        </form>

        {tools.status === "success" && tools.data && (
          <p className="text-xs text-ink-faint">
            Herramientas disponibles: {tools.data.map((tool) => tool.name).join(", ")}
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {answer && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="copilot-version" className="font-mono text-xs text-ink">
                {answer.datasetVersion ?? "sin versión"}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                  answer.grounded
                    ? "bg-accent-mint-soft text-accent-mint"
                    : "bg-status-pending-soft text-status-pending"
                }`}
              >
                {answer.grounded ? "Anclado a herramientas" : "Sin evidencia"}
              </span>
              <span className="text-xs text-ink-faint">proveedor: {answer.provider}</span>
            </div>

            <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-ink shadow-card">
              {answer.answer}
            </p>

            <ToolTrace answer={answer} />
          </div>
        )}
      </div>
    </QualityPageShell>
  );
}
