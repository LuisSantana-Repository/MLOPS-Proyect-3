import { Link } from "react-router-dom";
import { getImageFileUrl } from "../../lib/api/images";

interface SampleImageProps {
  imageId: number;
  caption?: string;
}

/**
 * Muestra ofensora navegable: miniatura real de la imagen (servida por el
 * backend desde MinIO) + enlace a la pantalla de anotación de esa imagen.
 * Nunca se inventa una URL de imagen: se usa el mismo endpoint del portal.
 */
export function SampleImage({ imageId, caption }: SampleImageProps) {
  return (
    <Link
      to={`/annotate/${imageId}`}
      className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-2 transition-colors hover:border-accent-lilac/50 hover:bg-accent-lilac-soft/40"
    >
      {/* biome-ignore lint/performance/noImgElement: imagen servida por el backend de anotación */}
      <img
        src={getImageFileUrl(imageId)}
        alt={`Imagen ${imageId}`}
        loading="lazy"
        className="h-12 w-16 shrink-0 rounded-lg bg-canvas object-cover"
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-xs font-medium text-ink group-hover:text-accent-lilac">
          Ver imagen #{imageId}
        </span>
        {caption && <span className="truncate text-[11px] text-ink-faint">{caption}</span>}
      </span>
    </Link>
  );
}
