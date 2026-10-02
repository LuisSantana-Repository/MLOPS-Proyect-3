import { SampleImage } from "./SampleImage";

export interface SampleRef {
  id: string | number;
  imageId: number;
  caption?: string;
}

/** Lista de muestras ofensoras navegables. */
export function SamplesList({ title, samples }: { title: string; samples: SampleRef[] }) {
  if (samples.length === 0) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
        <p className="text-sm text-ink-faint">Sin muestras ofensoras.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {samples.map((sample) => (
          <li key={sample.id}>
            <SampleImage imageId={sample.imageId} caption={sample.caption} />
          </li>
        ))}
      </ul>
    </div>
  );
}
