// =====================================================
// JSDB - Translation System
// SQL ↔ MongoDB translation with status classification
// =====================================================

export {
  type TranslationStatus,
  type FeatureTranslation,
  type TranslationReport,
  isSafeToExecute,
  requiresConfirmation,
  describeStatus,
  worstStatus,
} from './status.js';

export {
  SQLToMongoTranslator,
  type SQLToMongoOptions,
  type SQLToMongoResult,
} from './sql-to-mongo.js';

export {
  MongoToSQLTranslator,
  type MongoToSQLOptions,
  type MongoToSQLResult,
} from './mongo-to-sql.js';

export {
  PortabilityAnalyzer,
  portabilityAnalyzer,
  type AnalyzeOptions,
  type AnalyzeResult,
  type ExplainResult,
  type DryRunResult,
} from './analyzer.js';
