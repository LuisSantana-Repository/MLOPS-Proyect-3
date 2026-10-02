import type { CheckStatus } from "../../api/quality";

const STYLES: Record<CheckStatus, string> = {
  pass: "bg-accent-mint-soft text-accent-mint",
  warn: "bg-status-pending-soft text-status-pending",
  fail: "bg-red-100 text-red-700",
};

/**
 * Badge PASS / WARN / FAIL. El color nunca es la única señal: el texto
 * siempre está presente (accesibilidad).
 */
export function QualityStatusBadge({ status }: { status: CheckStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[status]}`}
    >
      {status.toUpperCase()}
    </span>
  );
}
