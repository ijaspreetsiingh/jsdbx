// =====================================================
// JSDB - Portability Analyzer
// =====================================================
import { globalRegistry } from '../capabilities/index.js';
import type { DatabaseType, PortabilityReport, PortabilityWarning } from '../types/index.js';

export interface PortabilityAnalysis {
  database: DatabaseType;
  score: number;
  portable: string[];
  emulated: string[];
  unsupported: string[];
  warnings: PortabilityWarning[];
  recommendations: string[];
}

export class PortabilityAnalyzer {
  analyze(database: DatabaseType, usedFeatures: string[] = []): PortabilityAnalysis {
    const all = globalRegistry.getAllForDatabase(database);
    const usedSet = new Set(usedFeatures);

    const portable: string[] = [];
    const emulated: string[] = [];
    const unsupported: string[] = [];
    const warnings: PortabilityWarning[] = [];
    const recommendations: string[] = [];

    for (const cap of all) {
      if (usedSet.size > 0 && !usedSet.has(cap.feature)) continue;

      if (cap.status === 'native') {
        portable.push(cap.feature);
      } else if (cap.status === 'emulated') {
        emulated.push(cap.feature);
        warnings.push({
          code: `EMULATED_${cap.feature.toUpperCase().replace('.', '_')}`,
          message: `${cap.feature} is emulated on ${database}: ${cap.notes ?? ''}`,
          operation: cap.feature,
          suggestion: cap.fallback ?? cap.limitations?.join('; '),
        });
      } else if (cap.status === 'unsupported') {
        unsupported.push(cap.feature);
        warnings.push({
          code: `UNSUPPORTED_${cap.feature.toUpperCase().replace('.', '_')}`,
          message: `${cap.feature} is NOT supported on ${database}: ${cap.notes ?? ''}`,
          operation: cap.feature,
          suggestion: cap.fallback,
        });
        if (cap.fallback) {
          recommendations.push(`${cap.feature}: ${cap.fallback}`);
        }
      }
    }

    // Calculate score
    const total = all.length;
    const score = total === 0 ? 100 : Math.round(((portable.length + emulated.length * 0.7) / total) * 100);

    return {
      database,
      score,
      portable,
      emulated,
      unsupported,
      warnings,
      recommendations,
    };
  }

  comparePortability(
    databases: DatabaseType[] = ['mysql', 'mongodb', 'postgres', 'sqlite']
  ): Map<DatabaseType, PortabilityAnalysis> {
    const results = new Map<DatabaseType, PortabilityAnalysis>();
    for (const db of databases) {
      results.set(db, this.analyze(db));
    }
    return results;
  }

  formatReport(analysis: PortabilityAnalysis): string {
    const lines = [
      ``,
      `╔══════════════════════════════════════════╗`,
      `║         JSDB PORTABILITY REPORT          ║`,
      `╚══════════════════════════════════════════╝`,
      ``,
      `Database: ${analysis.database.toUpperCase()}`,
      `Portability Score: ${analysis.score} / 100`,
      ``,
      `── Portable Operations ──────────────────────`,
    ];

    for (const f of analysis.portable) {
      lines.push(`  ✓  ${f}`);
    }

    if (analysis.emulated.length > 0) {
      lines.push(``, `── Emulated Operations ──────────────────────`);
      for (const f of analysis.emulated) {
        lines.push(`  ⚡  ${f} (emulated)`);
      }
    }

    if (analysis.unsupported.length > 0) {
      lines.push(``, `── Unsupported Operations ───────────────────`);
      for (const f of analysis.unsupported) {
        lines.push(`  ✗  ${f}`);
      }
    }

    if (analysis.recommendations.length > 0) {
      lines.push(``, `── Recommendations ──────────────────────────`);
      for (const r of analysis.recommendations) {
        lines.push(`  →  ${r}`);
      }
    }

    lines.push(``);
    return lines.join('\n');
  }
}

export const portabilityAnalyzer = new PortabilityAnalyzer();
