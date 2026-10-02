import { readQualityArtifact } from '../../data/artifacts/quality-artifact.repository.js';
import { NotFoundError } from '../errors.js';
import {
  parseEmbeddings,
  parseReleaseBundle,
  parseVersions,
  type ReannotationQueueItem,
  type ReleaseBundle,
  type VersionsFile,
} from './contracts.js';
import {
  type AnalyzersView,
  buildAnalyzers,
  buildEmbeddingsView,
  buildOverview,
  buildSplits,
  diffVersions,
  type EmbeddingsView,
  type OverviewView,
  type SplitsView,
  type VersionDiff,
} from './quality.service.js';

/**
 * Orquestación entre los artefactos en disco y las proyecciones puras.
 *
 * Es la única pieza de este módulo que importa de la capa `data`; las
 * funciones de `quality.service.ts` siguen siendo puras. Si el artefacto no
 * existe se lanza `NotFoundError` (la UI responde 404 y muestra "sin datos");
 * si existe pero no cumple el contrato, Zod lanza y la UI responde 500.
 */

async function loadRelease(artifactsDir: string): Promise<ReleaseBundle> {
  const raw = await readQualityArtifact(artifactsDir, 'release.json');
  if (raw === null) {
    throw new NotFoundError(
      `No hay release.json en "${artifactsDir}". Ejecuta el pipeline de calidad para generarlo.`,
    );
  }
  return parseReleaseBundle(raw);
}

export async function getOverview(artifactsDir: string): Promise<OverviewView> {
  return buildOverview(await loadRelease(artifactsDir));
}

export async function getAnalyzers(artifactsDir: string): Promise<AnalyzersView> {
  return buildAnalyzers(await loadRelease(artifactsDir));
}

export async function getSplits(artifactsDir: string): Promise<SplitsView> {
  return buildSplits(await loadRelease(artifactsDir));
}

export async function getReannotationQueue(artifactsDir: string): Promise<ReannotationQueueItem[]> {
  return (await loadRelease(artifactsDir)).reannotation_queue;
}

export async function getVersions(artifactsDir: string): Promise<VersionsFile> {
  const raw = await readQualityArtifact(artifactsDir, 'versions.json');
  if (raw === null) {
    throw new NotFoundError(
      `No hay versions.json en "${artifactsDir}". El proceso de release todavía no publica versiones.`,
    );
  }
  return parseVersions(raw);
}

export async function getVersionDiff(
  artifactsDir: string,
  from: string,
  to: string,
): Promise<VersionDiff> {
  return diffVersions(await getVersions(artifactsDir), from, to);
}

export async function getEmbeddings(artifactsDir: string): Promise<EmbeddingsView> {
  const raw = await readQualityArtifact(artifactsDir, 'embeddings.json');
  if (raw === null) {
    throw new NotFoundError(
      `No hay embeddings.json en "${artifactsDir}". La analítica exploratoria aún no se precomputó.`,
    );
  }
  const embeddings = parseEmbeddings(raw);
  const release = await loadRelease(artifactsDir);
  return buildEmbeddingsView(embeddings, release);
}
