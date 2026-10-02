import { parseDocument, stringify } from 'yaml';
import type { QualityConfig } from './contracts.js';

/**
 * Serializa la política de vuelta a YAML.
 *
 * Se usa la API de `Document` (no `stringify` desde cero) para CONSERVAR los
 * comentarios del quality.yaml original: el archivo lo mantiene Frente 2 y
 * perder sus comentarios lo volvería incómodo de revisar.
 */
export function serializeQualityConfig(existingText: string, config: QualityConfig): string {
  const document = parseDocument(existingText);

  for (const [name, check] of Object.entries(config.checks)) {
    document.setIn(['checks', name, 'threshold'], check.threshold);
    document.setIn(['checks', name, 'severity'], check.severity);
    if (check.min_classes === undefined) {
      document.deleteIn(['checks', name, 'min_classes']);
    } else {
      document.setIn(['checks', name, 'min_classes'], check.min_classes);
    }
  }

  document.setIn(['splits', 'train'], config.splits.train);
  document.setIn(['splits', 'val'], config.splits.val);
  document.setIn(['splits', 'test'], config.splits.test);
  document.setIn(['splits', 'seed'], config.splits.seed);

  return document.toString();
}

export function stringifyQualityConfig(config: QualityConfig): string {
  return stringify(config);
}
