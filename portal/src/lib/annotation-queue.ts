import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { count, desc, eq } from "drizzle-orm";
import {
  ANNOTATION_STATUSES,
  type AnnotationQueueItem,
  type AnnotationStatus,
  type CreateAnnotationItemInput,
  type ImageRef,
} from "@/contracts";
import { readCropImage, resolveCropPath } from "@/lib/crops";
import { getDb } from "@/lib/db/client";
import { type AnnotationQueueRow, annotationQueue } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { badRequest, notFound } from "@/lib/http";
import { requirePublishedRow } from "@/lib/published-models";
import { annotationStore, getObjectBytes, objectExists } from "@/lib/s3";

/**
 * Repositorio de la cola de anotación (T13). Valida contra el estado real
 * (modelo publicado, imagen existente) antes de insertar.
 */

async function imageExists(image: ImageRef): Promise<boolean> {
  if (image.kind === "upload") return objectExists(annotationStore(), image.key);
  return access(resolveCropPath(env.REPO_ROOT, image.cropPath.split("/"))).then(
    () => true,
    () => false,
  );
}

export function imageUrl(id: string): string {
  return `/api/annotation-queue/${id}/image`;
}

function rowImage(row: AnnotationQueueRow): ImageRef {
  if (row.imageKind === "crop") return { kind: "crop", cropPath: row.imageKey };
  return {
    kind: "upload",
    key: row.imageKey,
    sha256: row.imageSha256 ?? "",
    contentType: (row.imageContentType ?? "image/jpeg") as "image/jpeg" | "image/png",
  };
}

export function toItem(row: AnnotationQueueRow): AnnotationQueueItem {
  return {
    id: row.id,
    status: row.status,
    image: rowImage(row),
    imageUrl: imageUrl(row.id),
    modelVersion: row.modelVersion,
    suggestedClass: row.suggestedClass,
    probabilities: row.probabilities,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createAnnotationItem(
  input: CreateAnnotationItemInput,
): Promise<AnnotationQueueItem> {
  await requirePublishedRow(input.modelVersion);

  const top = Object.entries(input.probabilities).sort((a, b) => b[1] - a[1])[0];
  if (!(input.suggestedClass in input.probabilities) || top[0] !== input.suggestedClass) {
    throw badRequest("La clase sugerida debe ser la de mayor probabilidad", {
      suggestedClass: [`Se esperaba ${top[0]}`],
    });
  }
  if (!(await imageExists(input.image))) {
    throw badRequest("La imagen no existe: vuelve a clasificarla antes de enviarla", {
      image: ["No encontrada"],
    });
  }

  const row: AnnotationQueueRow = {
    id: randomUUID(),
    status: "pending",
    imageKind: input.image.kind,
    imageKey: input.image.kind === "upload" ? input.image.key : input.image.cropPath,
    imageSha256: input.image.kind === "upload" ? input.image.sha256 : null,
    imageContentType: input.image.kind === "upload" ? input.image.contentType : null,
    modelVersion: input.modelVersion,
    suggestedClass: input.suggestedClass,
    probabilities: input.probabilities,
    createdAt: new Date(),
  };
  await getDb().insert(annotationQueue).values(row);
  return toItem(row);
}

export async function listAnnotationItems(
  status: AnnotationStatus | null,
  limit: number,
): Promise<{ items: AnnotationQueueItem[]; counts: Record<AnnotationStatus, number> }> {
  const db = getDb();
  const base = db.select().from(annotationQueue);
  const rows = await (status ? base.where(eq(annotationQueue.status, status)) : base)
    .orderBy(desc(annotationQueue.createdAt))
    .limit(limit);
  const grouped = await db
    .select({ status: annotationQueue.status, n: count() })
    .from(annotationQueue)
    .groupBy(annotationQueue.status);
  const counts = Object.fromEntries(ANNOTATION_STATUSES.map((s) => [s, 0])) as Record<
    AnnotationStatus,
    number
  >;
  for (const g of grouped) counts[g.status] = Number(g.n);
  return { items: rows.map(toItem), counts };
}

export async function getAnnotationItem(id: string): Promise<AnnotationQueueRow> {
  const rows = await getDb()
    .select()
    .from(annotationQueue)
    .where(eq(annotationQueue.id, id))
    .limit(1);
  if (!rows[0]) throw notFound(`No existe el elemento ${id} en la cola de anotación`);
  return rows[0];
}

/** Bytes y tipo de la imagen de un elemento de la cola. */
export async function readItemImage(
  row: AnnotationQueueRow,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (row.imageKind === "crop") {
    return {
      bytes: await readCropImage(env.REPO_ROOT, row.imageKey.split("/")),
      contentType: "image/jpeg",
    };
  }
  const bytes = await getObjectBytes(annotationStore(), row.imageKey);
  if (!bytes) throw notFound(`La imagen ${row.imageKey} ya no está en MinIO`);
  return { bytes, contentType: row.imageContentType ?? "image/jpeg" };
}
