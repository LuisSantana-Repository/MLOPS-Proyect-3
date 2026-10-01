#!/usr/bin/env node
/**
 * T16 — Auditoría de datos simulados en el frontend del portal.
 *
 * Revisa las cinco páginas (/training, /experiments, /evaluation, /models, /inference)
 * y el código compartido de la interfaz (src/components, src/lib/ui), sin los tests.
 *
 * Uso, desde portal/:   node scripts/audit-mocks.mjs
 * Sale con código 1 si encuentra algo. Una línea legítima se justifica con un
 * comentario `audit-ok: <motivo>` en esa misma línea.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const PAGES = ["training", "experiments", "evaluation", "models", "inference"];
const SHARED = ["src/components", "src/lib/ui"];
const SOURCE = /\.(tsx?|jsx?|mjs)$/;
const TEST = /\.(test|spec)\.[jt]sx?$/;

const CHECKS = [
  {
    id: "mock-import",
    re: /from\s+["'][^"']*(mock|fixture|fake|dummy|sample|seed|example)[^"']*["']/gi,
    msg: "import de un archivo de datos simulados",
  },
  {
    id: "mock-name",
    re: /\b(mock|fake|dummy|sample|placeholder)(Data|Runs?|Metrics|Models?|Rows|Items|Predictions?|Jobs?)\b/gi,
    msg: "nombre de variable de datos simulados",
  },
  {
    id: "data-array",
    re: /=\s*\[\s*\{/g,
    msg: "arreglo literal de objetos (¿datos de ejemplo?)",
  },
  {
    id: "hex-id",
    re: /["'`][0-9a-f]{32}(?:[0-9a-f]{32})?["'`]/gi,
    msg: "run_id o hash escrito a mano",
  },
  {
    id: "release-tag",
    re: /["'`][^"'`\n]*v\d+\.\d+\.\d+@[0-9a-f]{6,}/gi,
    msg: "tag de release escrito a mano",
  },
  {
    id: "metric-number",
    re: /(?<![\w.])0\.\d{2,}(?![\w.])|(?<![\w.])\d{1,3}\.\d+\s*%/g,
    msg: "número con forma de métrica (p. ej. 0.97 o 92.6%)",
  },
];

function listFiles(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const path = join(abs, name);
    const rel = relative(ROOT, path);
    if (statSync(path).isDirectory()) return listFiles(rel);
    return SOURCE.test(name) && !TEST.test(name) ? [rel] : [];
  });
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*");
}

const findings = [];

for (const page of PAGES) {
  const dir = join("src", "app", page);
  if (!existsSync(join(ROOT, dir, "page.tsx"))) {
    findings.push({ file: `${dir}/page.tsx`, line: 0, id: "missing-page", msg: "no existe la página", code: "" });
  }
}

const files = [...new Set([...PAGES.flatMap((p) => listFiles(join("src", "app", p))), ...SHARED.flatMap(listFiles)])];

for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf-8");
  const lines = text.split("\n");
  for (const check of CHECKS) {
    for (const match of text.matchAll(check.re)) {
      const lineNo = text.slice(0, match.index).split("\n").length;
      const line = lines[lineNo - 1] ?? "";
      if (line.includes("audit-ok") || isComment(line)) continue;
      findings.push({ file, line: lineNo, id: check.id, msg: check.msg, code: line.trim() });
    }
  }
}

console.log(`Auditoría de datos simulados: ${files.length} archivos revisados`);
console.log(`Páginas: ${PAGES.map((p) => `/${p}`).join(", ")}\n`);

if (findings.length === 0) {
  console.log("✓ Sin hallazgos: ninguna vista usa datos simulados ni cifras escritas a mano.");
  process.exit(0);
}

for (const f of findings) {
  console.log(`${f.file}${f.line ? `:${f.line}` : ""}  [${f.id}] ${f.msg}`);
  if (f.code) console.log(`    ${f.code}`);
}
console.log(`\n✗ ${findings.length} hallazgo(s). Corrige cada uno o justifícalo con "audit-ok: <motivo>".`);
process.exit(1);
