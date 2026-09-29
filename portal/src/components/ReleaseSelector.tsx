import { type ApprovedRelease, SPLIT_NAMES } from "@/contracts";

const short = (hash: string | null) => (hash ? hash.slice(0, 12) : "—");

/** Selector del release DVC aprobado con su procedencia y el split 70/20/10. */
export function ReleaseSelector({
  releases,
  selectedTag,
  onChange,
}: {
  releases: ApprovedRelease[];
  selectedTag: string;
  onChange: (tag: string) => void;
}) {
  const release = releases.find((r) => r.tag === selectedTag) ?? null;
  return (
    <section className="card">
      <h2>1. Release aprobado</h2>
      <label htmlFor="release">Release DVC</label>
      <select id="release" value={selectedTag} onChange={(e) => onChange(e.target.value)}>
        {releases.map((r) => (
          <option key={r.tag} value={r.tag}>
            {r.tag}
          </option>
        ))}
      </select>

      {release ? (
        <>
          <h3>Procedencia</h3>
          <dl className="kv">
            <dt>Commit del Proyecto 2</dt>
            <dd>
              <code title={release.provenance.sourceCommit ?? ""}>
                {short(release.provenance.sourceCommit)}
              </code>
            </dd>
            <dt>Anotaciones (md5)</dt>
            <dd>
              <code title={release.provenance.annotationsMd5}>
                {short(release.provenance.annotationsMd5)}
              </code>
            </dd>
            <dt>Recortes (DVC)</dt>
            <dd>
              <code title={release.provenance.cropsMd5 ?? ""}>
                {short(release.provenance.cropsMd5)}
              </code>
            </dd>
            <dt>Manifiesto (DVC)</dt>
            <dd>
              <code title={release.provenance.manifestMd5 ?? ""}>
                {short(release.provenance.manifestMd5)}
              </code>
            </dd>
          </dl>

          <h3>
            Split 70/20/10 · semilla {release.split.seed ?? "—"} · fuga{" "}
            {release.split.leakage === 0 ? "0 ✓" : (release.split.leakage ?? "—")}
          </h3>
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">Clase</th>
                {SPLIT_NAMES.map((s) => (
                  <th key={s} scope="col" className="num">
                    {s}
                  </th>
                ))}
                <th scope="col" className="num">
                  total
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(release.split.byClass).map(([cls, c]) => (
                <tr key={cls}>
                  <th scope="row">{cls}</th>
                  {SPLIT_NAMES.map((s) => (
                    <td key={s} className="num">
                      {c[s]}
                    </td>
                  ))}
                  <td className="num">{c.total}</td>
                </tr>
              ))}
              <tr className="total">
                <th scope="row">Total</th>
                {SPLIT_NAMES.map((s) => (
                  <td key={s} className="num">
                    {release.split.totals[s]} (
                    {Math.round((100 * release.split.totals[s]) / release.split.totals.total)}%)
                  </td>
                ))}
                <td className="num">{release.split.totals.total}</td>
              </tr>
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
