// =====================================================
// JSDB - Security Analyzer
// Static analysis — cannot guarantee runtime security
// =====================================================
export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  recommendation: string;
  line?: number;
  file?: string;
}

export interface SecurityReport {
  findings: SecurityFinding[];
  score: number;
  summary: string;
  disclaimer: string;
}

export interface SecurityCheckConfig {
  hasAuthentication?: boolean;
  hasAuthorization?: boolean;
  hasRateLimit?: boolean;
  hasInputValidation?: boolean;
  tenancyEnabled?: boolean;
  auditLogEnabled?: boolean;
  rawQueryUsed?: boolean;
  sensetiveFieldsExposed?: string[];
  tlsEnabled?: boolean;
}

export class SecurityAnalyzer {
  analyze(config: SecurityCheckConfig): SecurityReport {
    const findings: SecurityFinding[] = [];

    if (!config.hasAuthentication) {
      findings.push({
        severity: 'high',
        category: 'Authentication',
        description: 'No authentication hooks detected',
        recommendation: 'Add auth hooks via securityManager.addAuthHook(). See docs/SECURITY.md',
      });
    }

    if (!config.hasAuthorization) {
      findings.push({
        severity: 'high',
        category: 'Authorization',
        description: 'No RBAC/authorization configured',
        recommendation: 'Configure roles via securityManager.rbac.defineRole(). See docs/SECURITY.md',
      });
    }

    if (!config.hasRateLimit) {
      findings.push({
        severity: 'medium',
        category: 'Rate Limiting',
        description: 'No rate limiting configured',
        recommendation: 'Configure rate limits in JSDBConfig or use securityManager.rateLimiter',
      });
    }

    if (!config.hasInputValidation) {
      findings.push({
        severity: 'medium',
        category: 'Input Validation',
        description: 'Runtime schema validation is not enabled',
        recommendation: 'Use schema validation via schemaEngine or add validation middleware',
      });
    }

    if (!config.tenancyEnabled) {
      findings.push({
        severity: 'info',
        category: 'Multi-Tenancy',
        description: 'Tenant isolation is not enabled',
        recommendation: 'If serving multiple tenants, enable: JSDB_TENANCY=true, JSDB_TENANT_FIELD=tenantId',
      });
    }

    if (!config.auditLogEnabled) {
      findings.push({
        severity: 'low',
        category: 'Audit Logging',
        description: 'Audit logging is disabled',
        recommendation: 'Enable audit logs for compliance: JSDB_AUDIT_LOG=true',
      });
    }

    if (config.rawQueryUsed) {
      findings.push({
        severity: 'high',
        category: 'SQL/NoSQL Injection',
        description: 'Raw query execution detected (executeRaw/db.raw). This bypasses JSDB safety layers.',
        recommendation: 'Ensure all raw queries use parameterized inputs. Never interpolate user data into raw queries.',
      });
    }

    if (config.sensetiveFieldsExposed && config.sensetiveFieldsExposed.length > 0) {
      findings.push({
        severity: 'high',
        category: 'Field-Level Security',
        description: `Potentially sensitive fields may be exposed: ${config.sensetiveFieldsExposed.join(', ')}`,
        recommendation: 'Use field-level access control to deny sensitive fields in API responses',
      });
    }

    if (!config.tlsEnabled) {
      findings.push({
        severity: 'medium',
        category: 'Transport Security',
        description: 'TLS/SSL is not explicitly configured for database connection',
        recommendation: 'Enable TLS for production database connections to prevent data interception',
      });
    }

    // Calculate score
    const weights: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3, info: 1 };
    const deduction = findings.reduce((sum, f) => sum + (weights[f.severity] ?? 0), 0);
    const score = Math.max(0, 100 - deduction);

    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const highCount = findings.filter((f) => f.severity === 'high').length;

    let summary = 'Security posture is acceptable.';
    if (criticalCount > 0) summary = `CRITICAL: ${criticalCount} critical security issue(s) found!`;
    else if (highCount > 0) summary = `WARNING: ${highCount} high severity issue(s) require attention.`;
    else if (findings.length === 0) summary = 'No security issues detected in static analysis.';

    return {
      findings,
      score,
      summary,
      disclaimer:
        'IMPORTANT: This is a static configuration analysis only. It cannot detect runtime vulnerabilities, business logic flaws, or issues in application code outside of JSDB. Manual security review and penetration testing are required for production deployments.',
    };
  }

  formatReport(report: SecurityReport): string {
    const lines = [
      ``,
      `╔══════════════════════════════════════════╗`,
      `║          JSDB SECURITY REPORT            ║`,
      `╚══════════════════════════════════════════╝`,
      ``,
      `Security Score: ${report.score} / 100`,
      `Summary: ${report.summary}`,
      ``,
    ];

    if (report.findings.length === 0) {
      lines.push(`  ✓  No security issues detected`);
    } else {
      lines.push(`── Findings ─────────────────────────────────`);
      for (const f of report.findings) {
        const icon = f.severity === 'critical' ? '🔴' : f.severity === 'high' ? '🟠' : f.severity === 'medium' ? '🟡' : f.severity === 'low' ? '🔵' : 'ℹ️';
        lines.push(``, `  ${icon} [${f.severity.toUpperCase()}] ${f.category}`);
        lines.push(`     ${f.description}`);
        lines.push(`     → ${f.recommendation}`);
      }
    }

    lines.push(``, `── Disclaimer ───────────────────────────────`);
    lines.push(`  ${report.disclaimer}`);
    lines.push(``);
    return lines.join('\n');
  }
}

export const securityAnalyzer = new SecurityAnalyzer();
