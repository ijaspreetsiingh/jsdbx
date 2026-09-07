// =====================================================
// JSDB - SQL Parser
// Parses native SQL strings into Universal IR nodes
// Supports: SELECT, INSERT, UPDATE, DELETE with
// WHERE, JOIN, GROUP BY, HAVING, ORDER BY, LIMIT,
// subqueries, aggregate functions, etc.
// =====================================================
import { JSDBValidationError } from '../errors/index.js';
import type { Filter, Document, SortSpec, AggregationStage, Scalar, Update, AggregateLookup } from '../types/index.js';
import type { IRNode } from './nodes.js';

// ---- Token Types ----

type TokenType =
  | 'KEYWORD' | 'IDENT' | 'STRING' | 'NUMBER' | 'PARAM'
  | 'COMMA' | 'DOT' | 'STAR' | 'LPAREN' | 'RPAREN'
  | 'EQ' | 'NEQ' | 'LT' | 'GT' | 'LTE' | 'GTE'
  | 'SEMICOLON' | 'EOF'
  | 'PLUS' | 'MINUS' | 'SLASH' | 'PERCENT'
  | 'DOTDOT' | 'BETWEEN' | 'LIKE' | 'IN' | 'IS' | 'NOT'
  | 'NULL' | 'TRUE' | 'FALSE' | 'ASC' | 'DESC'
  | 'AS' | 'ON' | 'AND' | 'OR' | 'XOR'
  | 'QUESTION'
  | 'SELECT' | 'FROM' | 'WHERE' | 'INSERT' | 'UPDATE' | 'DELETE'
  | 'GROUP' | 'BY' | 'HAVING' | 'ORDER' | 'LIMIT' | 'OFFSET'
  | 'JOIN' | 'INNER' | 'LEFT' | 'RIGHT' | 'OUTER' | 'CROSS'
  | 'SET' | 'VALUES' | 'INTO' | 'DISTINCT' | 'UNION'
  | 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
  | 'CASE' | 'WHEN' | 'THEN' | 'ELSE' | 'END'
  | 'EXISTS' | 'CREATE' | 'DROP' | 'ALTER' | 'TABLE'
  | 'INDEX' | 'AS' | 'NOT' | 'NULL' | 'TRUE' | 'FALSE'
  | 'ASC' | 'DESC';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

// ---- Keywords ----

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER',
  'TABLE', 'INDEX', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'AS', 'DISTINCT', 'ALL', 'UNION', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'IFNULL', 'NULLIF',
  'CONCAT', 'UPPER', 'LOWER', 'LENGTH', 'TRIM', 'SUBSTRING', 'LEFT', 'RIGHT',
  'NOW', 'CURDATE', 'DATE', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
  'CAST', 'CONVERT', 'IF', 'ROUND', 'ABS', 'CEIL', 'FLOOR',
  'TRUE', 'FALSE', 'ASC', 'DESC', 'XOR',
  'AUTO_INCREMENT', 'PRIMARY', 'KEY', 'UNIQUE', 'FOREIGN', 'REFERENCES',
  'DEFAULT', 'ENGINE', 'CHARSET', 'COLLATE', 'IF', 'NOT', 'EXISTS',
]);

// ---- Tokenizer ----

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(sql[i])) { i++; continue; }

    // Skip single-line comments
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < len && sql[i] !== '\n') i++;
      continue;
    }

    // Skip block comments
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < len - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    const pos = i;

    // String literals
    if (sql[i] === "'" || sql[i] === '"' || sql[i] === '`') {
      const quote = sql[i];
      i++;
      let val = '';
      while (i < len && sql[i] !== quote) {
        if (sql[i] === '\\' && i + 1 < len) { val += sql[i + 1]; i += 2; continue; }
        val += sql[i]; i++;
      }
      i++; // closing quote
      if (quote === '`') {
        tokens.push({ type: 'IDENT', value: val, pos });
      } else {
        tokens.push({ type: 'STRING', value: val, pos });
      }
      continue;
    }

    // Numbers
    if (/[0-9]/.test(sql[i]) || (sql[i] === '.' && i + 1 < len && /[0-9]/.test(sql[i + 1]))) {
      let val = '';
      while (i < len && /[0-9.]/.test(sql[i])) { val += sql[i]; i++; }
      if (i < len && (sql[i] === 'e' || sql[i] === 'E')) {
        val += sql[i]; i++;
        if (i < len && (sql[i] === '+' || sql[i] === '-')) { val += sql[i]; i++; }
        while (i < len && /[0-9]/.test(sql[i])) { val += sql[i]; i++; }
      }
      tokens.push({ type: 'NUMBER', value: val, pos });
      continue;
    }

    // Parameter placeholders
    if (sql[i] === '?') {
      tokens.push({ type: 'QUESTION', value: '?', pos }); i++; continue;
    }
    if (sql[i] === '$' && /[0-9]/.test(sql[i + 1] ?? '')) {
      let val = '$'; i++;
      while (i < len && /[0-9]/.test(sql[i])) { val += sql[i]; i++; }
      tokens.push({ type: 'PARAM', value: val, pos });
      continue;
    }

    // Operators
    if (sql[i] === '=' && sql[i + 1] === '=') { tokens.push({ type: 'EQ', value: '==', pos }); i += 2; continue; }
    if (sql[i] === '!' && sql[i + 1] === '=') { tokens.push({ type: 'NEQ', value: '!=', pos }); i += 2; continue; }
    if (sql[i] === '<' && sql[i + 1] === '>') { tokens.push({ type: 'NEQ', value: '<>', pos }); i += 2; continue; }
    if (sql[i] === '<' && sql[i + 1] === '=') { tokens.push({ type: 'LTE', value: '<=', pos }); i += 2; continue; }
    if (sql[i] === '>' && sql[i + 1] === '=') { tokens.push({ type: 'GTE', value: '>=', pos }); i += 2; continue; }
    if (sql[i] === '<') { tokens.push({ type: 'LT', value: '<', pos }); i++; continue; }
    if (sql[i] === '>') { tokens.push({ type: 'GT', value: '>', pos }); i++; continue; }
    if (sql[i] === '=') { tokens.push({ type: 'EQ', value: '=', pos }); i++; continue; }

    // Punctuation
    if (sql[i] === ',') { tokens.push({ type: 'COMMA', value: ',', pos }); i++; continue; }
    if (sql[i] === '.') { tokens.push({ type: 'DOT', value: '.', pos }); i++; continue; }
    if (sql[i] === '*') { tokens.push({ type: 'STAR', value: '*', pos }); i++; continue; }
    if (sql[i] === '(') { tokens.push({ type: 'LPAREN', value: '(', pos }); i++; continue; }
    if (sql[i] === ')') { tokens.push({ type: 'RPAREN', value: ')', pos }); i++; continue; }
    if (sql[i] === ';') { tokens.push({ type: 'SEMICOLON', value: ';', pos }); i++; continue; }
    if (sql[i] === '+') { tokens.push({ type: 'PLUS', value: '+', pos }); i++; continue; }
    if (sql[i] === '-') { tokens.push({ type: 'MINUS', value: '-', pos }); i++; continue; }
    if (sql[i] === '/') { tokens.push({ type: 'SLASH', value: '/', pos }); i++; continue; }
    if (sql[i] === '%') { tokens.push({ type: 'PERCENT', value: '%', pos }); i++; continue; }

    // Identifiers / Keywords
    if (/[a-zA-Z_]/.test(sql[i])) {
      let val = '';
      while (i < len && /[a-zA-Z0-9_]/.test(sql[i])) { val += sql[i]; i++; }
      const upper = val.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: upper as TokenType, value: val, pos });
      } else {
        tokens.push({ type: 'IDENT', value: val, pos });
      }
      continue;
    }

    // Unknown character — skip
    i++;
  }

  tokens.push({ type: 'EOF', value: '', pos: len });
  return tokens;
}

// ---- Parser ----

class SQLParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token { return this.tokens[this.pos + offset]; }
  private advance(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new JSDBValidationError(
        `Expected ${type} but got ${t.type} ("${t.value}") at position ${t.pos}`
      );
    }
    return this.advance();
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) { this.advance(); return true; }
    return false;
  }

  private matchKeyword(kw: string): boolean {
    const t = this.peek();
    if (t.type === (kw.toUpperCase() as TokenType) && t.value.toUpperCase() === kw.toUpperCase()) { this.advance(); return true; }
    // Also handle KEYWORD type with matching value
    if (t.type === 'KEYWORD' && t.value.toUpperCase() === kw.toUpperCase()) { this.advance(); return true; }
    return false;
  }

  private isKeyword(kw: string): boolean {
    const t = this.peek();
    return (t.type === (kw.toUpperCase() as TokenType) || t.type === 'KEYWORD') && t.value.toUpperCase() === kw.toUpperCase();
  }

  // ---- Parse SQL statement ----

  parseStatement(): ParsedSQL {
    const t = this.peek();
    const tv = t.value.toUpperCase();
    if (tv === 'SELECT') { return this.parseSelect(); }
    if (tv === 'INSERT') { return this.parseInsert(); }
    if (tv === 'UPDATE') { return this.parseUpdate(); }
    if (tv === 'DELETE') { return this.parseDelete(); }
    throw new JSDBValidationError(`Expected SQL statement, got ${t.type} ("${t.value}")`);
  }

  // ---- SELECT ----

  private parseSelect(): ParsedSelect {
    this.advance(); // SELECT

    const distinct = this.matchKeyword('DISTINCT');
    const selectCols = this.parseSelectColumns();

    // FROM is optional for SELECT without table (e.g., SELECT 1, SELECT NOW())
    let from: { table: string; alias?: string; joins: JoinClause[] } | undefined;
    if (this.matchKeyword('FROM')) {
      from = this.parseFromClause();
    }

    let where: Filter | undefined;
    if (this.matchKeyword('WHERE')) {
      where = this.parseWhereClause();
    }

    let groupBy: string[] | undefined;
    if (this.matchKeyword('GROUP')) {
      this.expectKeyword('BY');
      groupBy = this.parseIdentList();
    }

    let having: Filter | undefined;
    if (this.matchKeyword('HAVING')) {
      having = this.parseWhereClause();
    }

    let orderBy: SortSpec | undefined;
    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY');
      orderBy = this.parseOrderByClause();
    }

    let limit: number | undefined;
    let offset: number | undefined;
    if (this.matchKeyword('LIMIT')) {
      limit = this.parseNumber();
      if (this.matchKeyword('OFFSET') || this.match('COMMA')) {
        offset = this.parseNumber();
      }
    } else if (this.matchKeyword('OFFSET')) {
      offset = this.parseNumber();
      if (this.matchKeyword('ROWS') || this.matchKeyword('FETCH')) {
        // FETCH FIRST n ROWS ONLY syntax — skip
        this.matchKeyword('FIRST');
        this.parseNumber();
        this.matchKeyword('ROWS');
        this.matchKeyword('ONLY');
      }
    }

    return {
      type: 'SELECT',
      columns: selectCols,
      from,
      where,
      groupBy,
      having,
      orderBy,
      limit,
      offset,
      distinct,
    };
  }

  private parseSelectColumns(): SelectColumn[] {
    const cols: SelectColumn[] = [];
    cols.push(this.parseSelectColumn());
    // Handle comma-separated columns
    while (this.peek().type === 'COMMA' && this.pos < this.tokens.length - 1) {
      this.advance(); // consume comma
      if (this.peek().type === 'RPAREN') break; // end of subquery
      cols.push(this.parseSelectColumn());
    }
    return cols;
  }

  private parseSelectColumn(): SelectColumn {
    // Check for aggregate functions and CASE
    // Tokenizer produces literal types like COUNT, SUM, etc. for these keywords,
    // not generic KEYWORD type
    const t = this.peek();
    const typeOrKw = t.type === 'KEYWORD' ? t.value.toUpperCase() : t.type;
    if (['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(typeOrKw)) {
      return this.parseAggregateColumn();
    }
    if (typeOrKw === 'CASE') {
      return this.parseCaseColumn();
    }

    const expr = this.parseExpression();
    let alias: string | undefined;

    if (this.matchKeyword('AS')) {
      alias = this.advance().value;
    } else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value)) {
      alias = this.advance().value;
    }

    return { expr, alias };
  }

  private parseAggregateColumn(): SelectColumn {
    const fn = this.advance().value.toUpperCase();
    this.expect('LPAREN');
    const distinct = this.matchKeyword('DISTINCT');
    let arg: string;
    if (this.match('STAR')) {
      arg = '*';
    } else {
      arg = this.parseExpressionStrForAggregate();
    }
    this.expect('RPAREN');

    let alias: string | undefined;
    if (this.matchKeyword('AS')) {
      alias = this.advance().value;
    } else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value)) {
      alias = this.advance().value;
    }

    return {
      expr: { type: 'aggregate', fn, arg, distinct } as unknown as Scalar,
      alias: alias ?? `${fn.toLowerCase()}(${arg})`,
    };
  }

  /**
   * Parse an expression for aggregate function arguments (e.g., SUM(price * qty)).
   * Handles: field, field + N, field - N, field * N, field / N, field / field, etc.
   */
  private parseExpressionStrForAggregate(): string {
    let val = '';
    const t = this.peek();
    if (t.type === 'IDENT' || t.type === 'KEYWORD' || KEYWORDS.has(t.type)) {
      val = this.advance().value;
      // Check for dot notation
      if (this.peek().type === 'DOT') {
        this.advance();
        val += '.' + this.advance().value;
      }
      // Check for arithmetic: field + N, field - N, field * N, field / N
      if (this.peek().type === 'PLUS' || this.peek().type === 'MINUS' ||
          this.peek().type === 'STAR' || this.peek().type === 'SLASH') {
        const op = this.advance().value;
        val += ' ' + (op === '+' ? '+' : op === '-' ? '-' : op === '*' ? '*' : '/');
        // Parse right operand (could be number or field)
        const rt = this.peek();
        if (rt.type === 'NUMBER') {
          val += ' ' + this.advance().value;
        } else if (rt.type === 'IDENT' || rt.type === 'KEYWORD') {
          val += ' ' + this.advance().value;
        } else if (rt.type === 'STRING') {
          val += ' ' + this.advance().value;
        }
        // Check for another arithmetic or end
        // If there are more tokens, they would be handled by recursive calls or error
      }
    }
    return val;
  }

  private parseCaseColumn(): SelectColumn {
    // CASE WHEN ... THEN ... ELSE ... END
    this.advance(); // CASE
    const parts: { when: string; then: Scalar }[] = [];
    while (this.matchKeyword('WHEN')) {
      const when = this.parseWhenCondition();
      this.expectKeyword('THEN');
      const then = this.parseScalarValue();
      parts.push({ when, then });
    }
    let elseVal: Scalar | undefined;
    if (this.matchKeyword('ELSE')) {
      elseVal = this.parseScalarValue();
    }
    this.expectKeyword('END');

    let alias: string | undefined;
    if (this.matchKeyword('AS')) {
      alias = this.advance().value;
    } else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value)) {
      alias = this.advance().value;
    }

    return { expr: { type: 'case', parts, else: elseVal } as unknown as Scalar, alias };
  }

  private parseWhenCondition(): string {
    let val = '';
    const t = this.peek();
    // Parse left side (field name, possibly with dot)
    if (t.type === 'IDENT' || t.type === 'KEYWORD' || KEYWORDS.has(t.type)) {
      val = this.advance().value;
      if (this.peek().type === 'DOT') {
        this.advance();
        val += '.' + this.advance().value;
      }
    }
    // Parse comparison operator
    const compSymbols: Record<string, string> = { EQ: '=', NEQ: '!=', LT: '<', GT: '>', LTE: '<=', GTE: '>=' };
    const opType = this.peek().type;
    if (compSymbols[opType]) {
      val += ' ' + compSymbols[opType];
      this.advance(); // consume operator
      // Parse right side
      const rt = this.peek();
      if (rt.type === 'NUMBER') { val += ' ' + this.advance().value; }
      else if (rt.type === 'STRING') { val += ' ' + this.advance().value; }
      else if (rt.type === 'IDENT' || rt.type === 'KEYWORD') { val += ' ' + this.advance().value; }
      else if (rt.type === 'PARAM') { val += ' ' + this.advance().value; }
    }
    return val;
  }

  private parseFromClause(): FromClause {
    const table = this.parseTableName();
    let alias: string | undefined;
    let joins: JoinClause[] = [];

    if (this.matchKeyword('AS')) {
      alias = this.advance().value;
    } else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value) && !this.isClauseStart()) {
      alias = this.advance().value;
    }

    // Parse joins
    while (this.isJoinKeyword()) {
      joins.push(this.parseJoin());
    }

    return { table, alias, joins };
  }

  private isJoinKeyword(): boolean {
    const t = this.peek();
    const typeOrKw = t.type === 'KEYWORD' ? t.value.toUpperCase() : t.type;
    return ['JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS'].includes(typeOrKw);
  }

  private parseJoin(): JoinClause {
    let type: string = 'INNER';
    if (this.matchKeyword('INNER')) { type = 'INNER'; }
    else if (this.matchKeyword('LEFT')) {
      type = 'LEFT';
      this.matchKeyword('OUTER');
    } else if (this.matchKeyword('RIGHT')) {
      type = 'RIGHT';
      this.matchKeyword('OUTER');
    } else if (this.matchKeyword('CROSS')) {
      type = 'CROSS';
    }
    this.expectKeyword('JOIN');

    const table = this.parseTableName();
    let alias: string | undefined;
    if (this.matchKeyword('AS')) {
      alias = this.advance().value;
    } else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value) && !this.isClauseStart()) {
      alias = this.advance().value;
    }

    let on: Filter | undefined;
    if (this.matchKeyword('ON')) {
      on = this.parseJoinOnClause();
    }

    return { type, table, alias, on };
  }

  private parseJoinOnClause(): Filter {
    // Parse: left_field = right_field [AND ...]
    const filter: Filter = {};
    const left = this.parseExpressionStr();
    this.expect('EQ');
    const right = this.parseExpressionStr();

    // Store as $joinEq for translation
    (filter as Document)['_$joinOn'] = { left, right };

    // Handle additional AND conditions
    while (this.matchKeyword('AND')) {
      const l = this.parseExpressionStr();
      this.expect('EQ');
      const r = this.parseExpressionStr();
      if (!filter['$and']) filter['$and'] = [];
      (filter['$and'] as Filter[]).push({ _$joinOn: { left: l, right: r } } as unknown as Filter);
    }

    return filter;
  }

  // ---- WHERE clause ----

  private parseWhereClause(): Filter {
    // Check for scalar subquery at the start: (SELECT ...) 
    if (this.peek().type === 'LPAREN') {
      // Check if the next token is SELECT (scalar subquery)
      const nextToken = this.tokens[this.pos + 1];
      const isSelect = nextToken && (nextToken.type === 'SELECT' || nextToken.value?.toUpperCase() === 'SELECT');
      if (isSelect) {
        this.advance(); // consume (
        const subquery = this.parseSelect();
        this.expectKeyword('RPAREN');
        return { _$subquery: subquery } as unknown as Filter;
      }
    }
    return this.parseOrExpr();
  }

  private parseOrExpr(): Filter {
    let left = this.parseAndExpr();
    while (this.matchKeyword('OR')) {
      const right = this.parseAndExpr();
      if (!(left as Record<string, unknown>)['$or']) {
        left = { $or: [left] } as unknown as Filter;
      }
      ((left as Record<string, unknown>)['$or'] as Filter[]).push(right);
    }
    return left;
  }

  private parseAndExpr(): Filter {
    let left = this.parseNotExpr();
    while (this.matchKeyword('AND')) {
      const right = this.parseNotExpr();
      if (!(left as Record<string, unknown>)['$and']) {
        left = { $and: [left] } as unknown as Filter;
      }
      ((left as Record<string, unknown>)['$and'] as Filter[]).push(right);
    }
    return left;
  }

  private parseNotExpr(): Filter {
    // Check for scalar subquery: (SELECT ...) at the start
    if (this.peek().type === 'LPAREN') {
      // Check if the next token is SELECT (scalar subquery)
      const nextToken = this.tokens[this.pos + 1];
      const isSelect = nextToken && (nextToken.type === 'SELECT' || nextToken.value?.toUpperCase() === 'SELECT');
      if (isSelect) {
        this.advance(); // consume (
        const subquery = this.parseSelect();
        this.expectKeyword('RPAREN');
        return { _$subquery: subquery } as unknown as Filter;
      }
      // Otherwise, it's a grouped expression for precedence
      this.advance(); // consume (
      const expr = this.parseOrExpr(); // parse the inner expression
      this.expect('RPAREN'); // expect closing paren
      return expr;
    }
    if (this.matchKeyword('NOT')) {
      const expr = this.parseComparisonExpr();
      return { $not: expr } as Filter;
    }
    return this.parseComparisonExpr();
  }

  private parseComparisonExpr(): Filter {
    // Check for scalar subquery: (SELECT ...) or field OP (SELECT ...)
    // Heuristic: if we see LPAREN after a comparison-ready position, try subquery
    if (this.peek().type === 'LPAREN') {
      // Peek ahead: is the next token SELECT? If so, it's a subquery
      const next = this.peek(1);
      if (next.type === 'SELECT' || next.value?.toUpperCase() === 'SELECT') {
        this.advance(); // consume (
        const subquery = this.parseSelect();
        this.expectKeyword('RPAREN');
        // Return marker that expandSubqueries in core.ts will handle
        return { _$subquery: subquery } as unknown as Filter;
      }
    }

    const left = this.parseExpressionStr();

    // IS [NOT] NULL
    if (this.matchKeyword('IS')) {
      const notNull = this.matchKeyword('NOT');
      this.expectKeyword('NULL');
      const filter: Filter = {};
      (filter as Document)[left] = notNull ? { $ne: null } : null;
      return filter;
    }

    // Scalar subquery: field OP (SELECT ...)
    if (this.peek().type === 'LPAREN') {
      this.advance(); // consume (
      const subquery = this.parseSelect();
      this.expectKeyword('RPAREN');
      // Return as _$subquery filter — caller will handle
      return { _$subquery: subquery } as unknown as Filter;
    }

    // [NOT] IN (...)
    if (this.matchKeyword('NOT')) {
      if (this.matchKeyword('IN')) {
        this.expect('LPAREN');
        const values = this.parseValueList();
        this.expect('RPAREN');
        const filter: Filter = {};
        (filter as Document)[left] = { $nin: values };
        return filter;
      }
      // NOT BETWEEN
      if (this.matchKeyword('BETWEEN')) {
        const low = this.parseScalarValue();
        this.expectKeyword('AND');
        const high = this.parseScalarValue();
        const filter: Filter = {};
        (filter as Document)[left] = { $lt: low, $gt: high };
        return filter;
      }
      // NOT LIKE
      if (this.matchKeyword('LIKE')) {
        const pattern = this.parseScalarValue();
        const filter: Filter = {};
        (filter as Document)[left] = { $not: { $like: pattern } };
        return filter;
      }
    }

    if (this.matchKeyword('IN')) {
      this.expect('LPAREN');
      const values = this.parseValueList();
      this.expect('RPAREN');
      const filter: Filter = {};
      (filter as Document)[left] = { $in: values };
      return filter;
    }

    if (this.matchKeyword('BETWEEN')) {
      const low = this.parseScalarValue();
      this.expectKeyword('AND');
      const high = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $gte: low, $lte: high };
      return filter;
    }

    if (this.matchKeyword('LIKE')) {
      const pattern = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $like: pattern };
      return filter;
    }

    if (this.matchKeyword('ILIKE')) {
      const pattern = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $ilike: pattern };
      return filter;
    }

    // EXISTS (subquery)
    if (this.matchKeyword('EXISTS')) {
      this.expect('LPAREN');
      const subquery = this.parseSelect();
      this.expect('RPAREN');
      return { $exists: true, _$subquery: subquery } as unknown as Filter;
    }

    // Comparison operators
    if (this.match('EQ')) {
      const val = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = val;
      return filter;
    }
    if (this.match('NEQ')) {
      const val = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $ne: val };
      return filter;
    }
    if (this.match('LT')) {
      const val = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $lt: val };
      return filter;
    }
    if (this.match('GT')) {
      const val = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $gt: val };
      return filter;
    }
    if (this.match('LTE')) {
      const val = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $lte: val };
      return filter;
    }
    if (this.match('GTE')) {
      const val = this.parseScalarValue();
      const filter: Filter = {};
      (filter as Document)[left] = { $gte: val };
      return filter;
    }

    // Just a field reference — treat as $exists
    const filter: Filter = {};
    (filter as Document)[left] = { $exists: true };
    return filter;
  }

  // ---- INSERT ----

  private parseInsert(): ParsedInsert {
    this.advance(); // INSERT
    // Support INSERT IGNORE
    this.matchKeyword('IGNORE');
    this.matchKeyword('INTO');
    const table = this.parseTableName();
    let alias: string | undefined;
    if (this.matchKeyword('AS')) { alias = this.advance().value; }
    else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value) && !this.isClauseStart()) {
      alias = this.advance().value;
    }

    let columns: string[] | undefined;
    if (this.peek().type === 'LPAREN') {
      this.advance();
      columns = this.parseIdentList();
      this.expect('RPAREN');
    }

    let rows: Scalar[][] | undefined;
    let select: ParsedSelect | undefined;
    let onDuplicateKeyUpdate: { field: string; value: Scalar | string }[] | undefined;
    let onConflict: ParsedInsert['onConflict'];

    if (this.matchKeyword('VALUES')) {
      rows = [];
      this.expect('LPAREN');
      rows.push(this.parseValueList());
      this.expect('RPAREN');
      while (this.match('COMMA')) {
        this.expect('LPAREN');
        rows.push(this.parseValueList());
        this.expect('RPAREN');
      }
    } else if (this.matchKeyword('SELECT')) {
      select = this.parseSelect();
    } else {
      throw new JSDBValidationError('INSERT: expected VALUES or SELECT');
    }

    // ON DUPLICATE KEY UPDATE (MySQL)
    if (this.matchKeyword('ON')) {
      if (this.matchKeyword('DUPLICATE')) {
        this.expectKeyword('KEY');
        this.expectKeyword('UPDATE');
        onDuplicateKeyUpdate = [];
        onDuplicateKeyUpdate.push(this.parseSetClause());
        while (this.match('COMMA')) {
          onDuplicateKeyUpdate.push(this.parseSetClause());
        }
      } else if (this.matchKeyword('CONFLICT')) {
        // ON CONFLICT [(target)] DO NOTHING | DO UPDATE SET ...
        let target: string[] | undefined;
        if (this.peek().type === 'LPAREN') {
          this.advance();
          target = this.parseIdentList();
          this.expect('RPAREN');
        }
        this.expectKeyword('DO');
        if (this.matchKeyword('NOTHING')) {
          onConflict = { target, action: 'nothing' };
        } else {
          this.expectKeyword('UPDATE');
          this.expectKeyword('SET');
          const updateClauses: { field: string; value: Scalar | string }[] = [];
          updateClauses.push(this.parseSetClause());
          while (this.match('COMMA')) {
            updateClauses.push(this.parseSetClause());
          }
          onConflict = { target, action: 'update', update: updateClauses };
        }
      }
    }

    // RETURNING clause (PostgreSQL) — consume and ignore in parser (handled at adapter level)
    if (this.matchKeyword('RETURNING')) {
      this.parseSelectColumns(); // consume the column list
    }

    return { type: 'INSERT', table, alias, columns, rows, select, onDuplicateKeyUpdate, onConflict };
  }

  // ---- UPDATE ----

  private parseUpdate(): ParsedUpdate {
    this.advance(); // UPDATE
    const table = this.parseTableName();
    let alias: string | undefined;
    if (this.matchKeyword('AS')) { alias = this.advance().value; }
    else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value) && !this.isClauseStart()) {
      alias = this.advance().value;
    }

    // UPDATE ... JOIN ... SET ... (MySQL-style)
    const joins: JoinClause[] = [];
    while (this.isJoinKeyword()) {
      joins.push(this.parseJoin());
    }

    this.expectKeyword('SET');
    const setClauses: { field: string; value: Scalar | string }[] = [];
    setClauses.push(this.parseSetClause());
    while (this.match('COMMA')) {
      setClauses.push(this.parseSetClause());
    }

    let where: Filter | undefined;
    if (this.matchKeyword('WHERE')) {
      where = this.parseWhereClause();
    }

    let limit: number | undefined;
    if (this.matchKeyword('LIMIT')) {
      limit = this.parseNumber();
    }

    // RETURNING clause (PostgreSQL) — consume
    if (this.matchKeyword('RETURNING')) {
      this.parseSelectColumns();
    }

    return { type: 'UPDATE', table, alias, joins: joins.length > 0 ? joins : undefined, setClauses, where, limit };
  }

  private parseSetClause(): { field: string; value: Scalar | string } {
    const field = this.parseExpressionStr();
    this.expect('EQ');
    // Check for arithmetic expression: field = field + N, field = field - N, etc.
    const val = this.parseScalarValue();
    // Check if next tokens are operator + value (e.g., "+ 1", "- 5")
    if (typeof val === 'string' && val === field) {
      const op = this.peek();
      if (op.type === 'PLUS' || op.type === 'MINUS' || op.type === 'STAR' || op.type === 'SLASH') {
        this.advance(); // consume operator
        const numVal = this.parseScalarValue();
        if (typeof numVal === 'number') {
          // Return a marker that updateToIR will convert to $inc/$mul
          // Subtraction uses $inc with negative value
          // Division: no direct MongoDB operator, use string marker for now
          const opName = op.type === 'PLUS' ? 'inc'
            : op.type === 'MINUS' ? 'inc'
            : op.type === 'STAR' ? 'mul'
            : 'div';
          const opVal = op.type === 'MINUS' ? -numVal
            : op.type === 'PLUS' ? numVal
            : op.type === 'STAR' ? numVal
            : numVal;
          return { field, value: `__${opName}:${opVal}` as unknown as Scalar };
        }
      }
    }
    return { field, value: val };
  }

  // ---- DELETE ----

  private parseDelete(): ParsedDelete {
    this.expectKeyword('DELETE');
    this.expectKeyword('FROM');
    const table = this.parseTableName();
    let alias: string | undefined;
    if (this.matchKeyword('AS')) { alias = this.advance().value; }
    else if (this.peek().type === 'IDENT' && !this.isReservedWord(this.peek().value) && !this.isClauseStart()) {
      alias = this.advance().value;
    }

    let where: Filter | undefined;
    if (this.matchKeyword('WHERE')) {
      where = this.parseWhereClause();
    }

    let limit: number | undefined;
    if (this.matchKeyword('LIMIT')) {
      limit = this.parseNumber();
    }

    // RETURNING clause (PostgreSQL) — consume and ignore
    if (this.matchKeyword('RETURNING')) {
      this.parseSelectColumns();
    }

    return { type: 'DELETE', table, alias, where, limit };
  }

  // ---- Helpers ----

  private parseTableName(): string {
    const t = this.peek();
    if (t.type === 'IDENT') return this.advance().value;
    if (t.type === 'KEYWORD') return this.advance().value;
    throw new JSDBValidationError(`Expected table name, got ${t.type} ("${t.value}")`);
  }

  private parseIdentList(): string[] {
    const ids: string[] = [];
    ids.push(this.advance().value);
    while (this.match('COMMA')) {
      ids.push(this.advance().value);
    }
    return ids;
  }

  private parseExpression(): Scalar {
    const t = this.peek();
    if (t.type === 'LPAREN') {
      // Check for scalar subquery: (SELECT ...) or grouped expression
      // Save position to try parsing as subquery first
      const startPos = this.pos;
      const startToken = this.peek();
      this.advance(); // consume (
      // Try to parse as SELECT subquery
      if (this.peek().value.toUpperCase() === 'SELECT') {
        const subquery = this.parseSelect();
        this.expectKeyword('RPAREN');
        return { _$subquery: subquery } as unknown as Scalar;
      }
      // Not a subquery, treat as grouped expression - parse inner expression
      const inner = this.parseExpression();
      this.expect('RPAREN');
      return inner;
    }
    if (t.type === 'STRING') { this.advance(); return t.value; }
    if (t.type === 'NUMBER') { this.advance(); return Number(t.value); }
    if (t.type === 'NULL') { this.advance(); return null; }
    if (t.type === 'TRUE') { this.advance(); return true; }
    if (t.type === 'FALSE') { this.advance(); return false; }
    if (t.type === 'STAR') { this.advance(); return '*' as unknown as Scalar; }
    if (t.type === 'IDENT' || t.type === 'KEYWORD') {
      this.advance();
      let field = t.value;
      if (this.peek().type === 'DOT') {
        this.advance();
        field = t.value + '.' + this.advance().value;
      }
      // Check for arithmetic: field + N, field - N, field * N, field / N
      if (this.peek().type === 'PLUS' || this.peek().type === 'MINUS' ||
          this.peek().type === 'STAR' || this.peek().type === 'SLASH') {
        const op = this.advance().value;
        const right = this.parseExpression();
        const mongoOp = op === '+' ? '$add' : op === '-' ? '$subtract'
          : op === '*' ? '$multiply' : '$divide';
        // Ensure right operand is properly prefixed for field references
        const rightVal = typeof right === 'string' ? `$${right}` : right;
        return { [mongoOp]: [`$${field}`, rightVal] } as unknown as Scalar;
      }
      return field;
    }
    this.advance();
    return t.value;
  }

  private parseExpressionStr(): string {
    let val = '';
    const t = this.peek();
    if (t.type === 'IDENT' || t.type === 'KEYWORD' || KEYWORDS.has(t.type)) {
      val = this.advance().value;
      if (this.peek().type === 'DOT') {
        this.advance();
        val += '.' + this.advance().value;
      } else if (this.peek().type === 'LPAREN') {
        val += this.parseParensStr();
      }
    } else if (this.peek().type === 'STAR') {
      this.advance();
      val = '*';
    } else if (this.peek().type === 'PARAM') {
      val = this.advance().value;
    } else if (this.peek().type === 'QUESTION') {
      val = this.advance().value;
    }
    return val;
  }

  private parseParensStr(): string {
    this.expect('LPAREN');
    let str = '(';
    let depth = 1;
    while (depth > 0) {
      const t = this.peek();
      if (t.type === 'EOF') break;
      if (t.type === 'LPAREN') depth++;
      if (t.type === 'RPAREN') depth--;
      if (depth > 0) {
        str += t.value;
        this.advance();
      }
    }
    this.expect('RPAREN');
    str += ')';
    return str;
  }

  private parseScalarValue(): Scalar {
    const t = this.peek();
    if (t.type === 'STRING') { this.advance(); return t.value; }
    if (t.type === 'NUMBER') { this.advance(); return Number(t.value); }
    if (t.type === 'NULL') { this.advance(); return null; }
    if (t.type === 'TRUE') { this.advance(); return true; }
    if (t.type === 'FALSE') { this.advance(); return false; }
    if (t.type === 'QUESTION') { this.advance(); return '?' as unknown as Scalar; }
    if (t.type === 'PARAM') { this.advance(); return t.value as unknown as Scalar; }
    // Inline subquery (SELECT inside VALUES/expression — treat as opaque string)
    if ((t.type as string) === 'SELECT') { return this.parseSelect() as unknown as Scalar; }
    // Function call or expression
    if (t.type === 'IDENT' || t.type === 'KEYWORD') {
      this.advance();
      if (this.peek().type === 'LPAREN') {
        this.advance();
        this.parseValueList();
        this.expect('RPAREN');
      }
      return t.value as unknown as Scalar;
    }
    throw new JSDBValidationError(`Expected value, got ${t.type} ("${t.value}")`);
  }

  private parseValueList(): Scalar[] {
    const values: Scalar[] = [];
    values.push(this.parseScalarValue());
    while (this.match('COMMA')) {
      values.push(this.parseScalarValue());
    }
    return values;
  }

  private parseNumber(): number {
    // LIMIT/OFFSET can use ? placeholder — return 0 as sentinel; caller re-binds from params
    if (this.peek().type === 'QUESTION') {
      this.advance();
      return NaN; // sentinel — will be replaced by actual param value during rebinding
    }
    if (this.peek().type === 'PARAM') {
      this.advance();
      return NaN;
    }
    const t = this.expect('NUMBER');
    return Number(t.value);
  }

  private parseOrderByClause(): SortSpec {
    const sort: SortSpec = {};
    const field = this.parseExpressionStr();
    const dir = this.matchKeyword('DESC') ? 'desc' : (this.matchKeyword('ASC') ? 'asc' : 'asc');
    sort[field] = dir;
    while (this.match('COMMA')) {
      const f = this.parseExpressionStr();
      const d = this.matchKeyword('DESC') ? 'desc' : (this.matchKeyword('ASC') ? 'asc' : 'asc');
      sort[f] = d;
    }
    return sort;
  }

  private expectKeyword(kw: string): void {
    if (!this.matchKeyword(kw)) {
      throw new JSDBValidationError(`Expected "${kw}" but got "${this.peek().value}" at position ${this.peek().pos}`);
    }
  }

  private isReservedWord(word: string): boolean {
    const upper = word.toUpperCase();
    return KEYWORDS.has(upper);
  }

  private isClauseStart(): boolean {
    const t = this.peek();
    if (t.type === 'EOF' || t.type === 'SEMICOLON') return true;
    const typeOrKw = t.type === 'KEYWORD' ? t.value.toUpperCase() : t.type;
    return ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'UNION', 'SET', 'VALUES', 'ON', 'AND', 'OR'].includes(typeOrKw);
  }
}

// ---- Public API ----

export interface SelectColumn {
  expr: Scalar | { type: 'aggregate'; fn: string; arg: string; distinct: boolean } | { type: 'case'; parts: { when: string; then: Scalar }[]; else?: Scalar };
  alias?: string;
}

export interface FromClause {
  table: string;
  alias?: string;
  joins: JoinClause[];
}

export interface JoinClause {
  type: string;
  table: string;
  alias?: string;
  on?: Filter;
}

export interface ParsedSelect {
  type: 'SELECT';
  columns: SelectColumn[];
  from?: FromClause;
  where?: Filter;
  groupBy?: string[];
  having?: Filter;
  orderBy?: SortSpec;
  limit?: number;
  offset?: number;
  distinct?: boolean;
}

export interface ParsedInsert {
  type: 'INSERT';
  table: string;
  alias?: string;
  columns?: string[];
  rows?: Scalar[][];
  select?: ParsedSelect;
  onDuplicateKeyUpdate?: { field: string; value: Scalar | string }[];  // MySQL ON DUPLICATE KEY UPDATE
  onConflict?: {                                                          // PostgreSQL ON CONFLICT
    target?: string[];
    action: 'nothing' | 'update';
    update?: { field: string; value: Scalar | string }[];
  };
}

export interface ParsedUpdate {
  type: 'UPDATE';
  table: string;
  alias?: string;
  joins?: JoinClause[];                                                   // UPDATE with JOIN
  setClauses: { field: string; value: Scalar | string }[];
  where?: Filter;
  limit?: number;
}

export interface ParsedDelete {
  type: 'DELETE';
  table: string;
  alias?: string;
  where?: Filter;
  limit?: number;
}

export type ParsedSQL = ParsedSelect | ParsedInsert | ParsedUpdate | ParsedDelete;

/**
 * Parse a native SQL string into a structured AST
 */
export function parseSQL(sql: string): ParsedSQL {
  const trimmed = sql.trim().replace(/;$/, '').trim();
  if (!trimmed) throw new JSDBValidationError('Empty SQL query');
  const tokens = tokenize(trimmed);
  const parser = new SQLParser(tokens);
  return parser.parseStatement();
}

/**
 * Convert a ParsedSQL AST into a Universal IR node
 */
export function sqlToIR(parsed: ParsedSQL): IRNode {
  switch (parsed.type) {
    case 'SELECT': return selectToIR(parsed);
    case 'INSERT': return insertToIRWithUpsert(parsed);
    case 'UPDATE': return updateToIR(parsed);
    case 'DELETE': return deleteToIR(parsed);
  }
}

function selectToIR(sel: ParsedSelect): IRNode {
  // Handle SELECT without FROM clause (e.g., SELECT 1, SELECT NOW())
  if (!sel.from) {
    // Return a special IR node for scalar expressions
    // This will be handled by the compat layer or adapter
    return {
      type: 'find',
      collection: '_scalar', // special collection name
      filter: {},
      metadata: {
        timestamp: new Date(),
        _scalarSelect: sel.columns,
      },
    };
  }

  const collection = sel.from.table;

// ---- CASE WHEN helpers ----
function convertWhenToExpr(when: string): unknown {
  // Convert "field = value" or "field > value" to MongoDB expression
  const ops: Record<string, string> = { '=': '$eq', '!=': '$ne', '<>': '$ne', '<': '$lt', '>': '$gt', '<=': '$lte', '>=': '$gte' };
  for (const [sqlOp, mongoOp] of Object.entries(ops)) {
    const idx = when.indexOf(sqlOp);
    if (idx > 0) {
      const left = when.slice(0, idx).trim();
      const right = when.slice(idx + sqlOp.length).trim();
      const rightVal = right.startsWith("'") ? right.slice(1, -1) : Number(right) || right;
      return { [mongoOp]: [`$${left}`, rightVal] };
    }
  }
  // Fallback: treat as field reference
  return `$${when}`;
}

function convertThenValue(val: Scalar): unknown {
  if (typeof val === 'string' && !val.startsWith('$')) return val;
  if (typeof val === 'number' || typeof val === 'boolean' || val === null) return val;
  return val;
}

/**
 * Map HAVING filter field names to the actual group stage aliases.
 * e.g. HAVING COUNT(*) > 5 → after $group, field is "count(*)" (the alias)
 */
function mapHavingToGroupAliases(having: Filter, columns: SelectColumn[]): Filter {
  const result: Document = {};
  for (const [key, val] of Object.entries(having)) {
    // Find matching column with this aggregate expression
    let mappedKey = key;
    for (const col of columns) {
      if (typeof col.expr === 'object' && col.expr !== null && 'type' in col.expr) {
        const agg = col.expr as { type: string; fn: string; arg: string };
        if (agg.type === 'aggregate') {
          const alias = col.alias ?? `${agg.fn.toLowerCase()}(${agg.arg})`;
          // Match "COUNT(*)" → "count(*)" or "SUM(price)" → "sum(price)"
          const normalizedKey = key.toLowerCase();
          const normalizedAlias = alias.toLowerCase();
          if (normalizedKey === normalizedAlias || normalizedKey === `${agg.fn.toLowerCase()}(${agg.arg})`) {
            mappedKey = alias;
            break;
          }
        }
      }
    }
    result[mappedKey] = val as import('../types/index.js').DocumentValue;
  }
  return result as Filter;
}

/**
 * Parse a full comparison condition for CASE WHEN.
 * Captures: field > value, field = 'string', field != field, etc.
 */

  // ---- JOINs present → always use aggregation pipeline ----
  const hasJoins = sel.from.joins && sel.from.joins.length > 0;

  // Convert aggregate columns to pipeline
  const hasAggregates = sel.columns.some(c =>
    typeof c.expr === 'object' && c.expr !== null && 'type' in c.expr && (c.expr as { type: string }).type === 'aggregate'
  );

  if (hasAggregates || sel.groupBy || sel.having || hasJoins) {
    // Use aggregation pipeline
    const pipeline: AggregationStage[] = [];

    // $match BEFORE joins (filter on primary table first)
    if (sel.where && !hasJoins) pipeline.push({ $match: sel.where });

    // ---- Translate JOINs → $lookup stages ----
    if (hasJoins) {
      // Apply WHERE that references only the primary table before lookups
      if (sel.where) {
        const primaryAlias = sel.from.alias ?? sel.from.table;
        const whereOnPrimary = extractTableFilter(sel.where, primaryAlias, sel.from.table);
        if (whereOnPrimary) pipeline.push({ $match: whereOnPrimary });
      }

      for (const join of sel.from.joins) {
        const joinOn = join.on as Document | undefined;
        if (!joinOn) continue;

        // Extract localField / foreignField from _$joinOn
        const joinEq = (joinOn as Document)['_$joinOn'] as { left: string; right: string } | undefined;
        const extraConditions = (joinOn['$and'] as Filter[] | undefined) ?? [];

        let localField = '';
        let foreignField = '';

        if (joinEq) {
          // Normalize: strip table prefix (e.g. "u.id" → "id")
          const stripPrefix = (s: string) => s.includes('.') ? s.split('.').slice(1).join('.') : s;
          const leftStripped = stripPrefix(joinEq.left);
          const rightStripped = stripPrefix(joinEq.right);

          // Determine which side belongs to which table
          const joinTable = join.alias ?? join.table;
          const primaryTable = sel.from.alias ?? sel.from.table;

          const leftOwner = joinEq.left.includes('.') ? joinEq.left.split('.')[0] : primaryTable;
          const rightOwner = joinEq.right.includes('.') ? joinEq.right.split('.')[0] : joinTable;

          if (leftOwner === joinTable || leftOwner === join.alias) {
            foreignField = leftStripped;
            localField = rightStripped;
          } else {
            localField = leftStripped;
            foreignField = rightStripped;
          }
        }

        const asAlias = join.alias ?? join.table;

        const lookupStage: AggregateLookup['$lookup'] = {
          from: join.table,
          localField: localField || 'id',
          foreignField: foreignField || 'id',
          as: asAlias,
        };

        pipeline.push({ $lookup: lookupStage });

        // For INNER JOIN — filter out documents where the joined array is empty
        if (join.type === 'INNER') {
          pipeline.push({ $match: { [asAlias]: { $exists: true, $ne: [] } } as Filter });
        }

        // $unwind to flatten the joined array (makes it behave like SQL JOIN row)
        pipeline.push({
          $unwind: {
            path: `$${asAlias}`,
            preserveNullAndEmptyArrays: join.type === 'LEFT' || join.type === 'LEFT OUTER',
          }
        });

        // Flatten joined fields to top-level for SQL-style column access
        // e.g. orders.status → orders_status accessible in subsequent stages
        pipeline.push({
          $addFields: {
            [`${asAlias}_merged`]: `$${asAlias}`,
          } as Document,
        });
      }

      // Apply WHERE conditions that may reference joined tables
      if (sel.where) pipeline.push({ $match: sel.where });
    }

    // Always build $group when there are aggregate functions
    if (hasAggregates || sel.groupBy) {
      const groupDoc: Document = {};

      if (sel.groupBy && sel.groupBy.length > 0) {
        // Strip table prefix from GROUP BY fields
        const cleanFields = sel.groupBy.map(f => f.includes('.') ? f.split('.').slice(1).join('.') : f);
        if (cleanFields.length === 1) {
          groupDoc._id = `$${cleanFields[0]}`;
        } else {
          groupDoc._id = Object.fromEntries(cleanFields.map(f => [f, `$${f}`]));
        }
        // Note: grouped fields go in _id, NOT as regular accumulator fields
        // Non-grouped fields with aggregate functions are added below
      } else if (hasAggregates) {
        groupDoc._id = null;
      }

      for (const col of sel.columns) {
        if (typeof col.expr === 'object' && col.expr !== null && 'type' in col.expr) {
          const typedExpr = col.expr as { type: string; fn?: string; arg?: string; distinct?: boolean;
            parts?: { when: string; then: Scalar }[]; else?: Scalar };
          if (typedExpr.type === 'aggregate' && typedExpr.fn && typedExpr.arg) {
            // Strip table prefix from aggregate args
            const cleanArg = typedExpr.arg.includes('.') ? typedExpr.arg.split('.').slice(1).join('.') : typedExpr.arg;
            const alias = col.alias ?? `${typedExpr.fn.toLowerCase()}(${cleanArg})`;
            // COUNT(*) → $sum:1 (MongoDB counts docs via $sum); other aggs use their operator
            if (typedExpr.fn === 'COUNT') {
              groupDoc[alias] = { $sum: cleanArg === '*' ? 1 : `$${cleanArg}` } as unknown as Scalar;
            } else {
              const field = `$${cleanArg}`;
              groupDoc[alias] = { [`$${typedExpr.fn.toLowerCase()}`]: field } as unknown as Scalar;
            }
          } else if (typedExpr.type === 'case' && typedExpr.parts) {
            // CASE WHEN in $group — emit computed field after $group via $addFields
            const alias = col.alias ?? `case_${Object.keys(groupDoc).length}`;
            // We'll add this as a post-group $addFields stage
            const branches = typedExpr.parts.map(p => ({
              case: convertWhenToExpr(p.when),
              then: convertThenValue(p.then),
            }));
            // Store for later — will be added as $addFields after $group
            if (!(groupDoc as Document).__caseFields) (groupDoc as Document).__caseFields = {};
            ((groupDoc as Document).__caseFields as Document)[alias] = {
              $switch: {
                branches,
                default: typedExpr.else !== undefined ? convertThenValue(typedExpr.else) : null,
              },
            } as unknown as import('../types/index.js').DocumentValue;
          }
        }
      }

      if (hasAggregates || (sel.groupBy && sel.groupBy.length > 0)) {
        // Extract case fields before pushing $group (they go in $addFields)
        const caseFields = (groupDoc as Document).__caseFields as Document | undefined;
        delete (groupDoc as Document).__caseFields;
        pipeline.push({ $group: groupDoc as { _id: unknown } });
        // Add CASE WHEN computed fields after $group
        if (caseFields && Object.keys(caseFields).length > 0) {
          pipeline.push({ $addFields: caseFields });
        }
        // Post-group $project to restore grouped field names from _id
        // Always needed when there's GROUP BY, even with aggregates
        if (sel.groupBy && sel.groupBy.length > 0) {
          // Build projection: map _id to the grouped field name, keep aggregate aliases
          const projDoc: Document = {};
          // Map each GROUP BY field to projected column
          const groupFields = sel.groupBy as string[];
          for (let i = 0; i < groupFields.length; i++) {
            const groupField = groupFields[i];
            const cleanField = groupField.includes('.') ? groupField.split('.').slice(1).join('.') : groupField;
            projDoc[cleanField] = '$_id';
          }
          // Add aggregate columns with their aliases
          for (const col of sel.columns) {
            if (typeof col.expr === 'object' && col.expr !== null && 'type' in col.expr) {
              const agg = col.expr as { type: string; fn: string; arg: string };
              if (agg.type === 'aggregate' && col.alias) {
                projDoc[col.alias] = `$${col.alias}`;
              }
            }
          }
          // Always include _id projection to the first group field (or remove it)
          if (projDoc._id) {
            projDoc._id = 0; // remove _id, use projected field instead
          } else {
            // No GROUP BY fields but aggregates — just keep aliases
            projDoc._id = 0;
          }
          pipeline.push({ $project: projDoc });
        }
      }
    }

    if (sel.having) {
      // HAVING references aggregate results — map field names to group aliases
      // e.g. HAVING COUNT(*) > 5 → { "count(*)": { $gt: 5 } }
      // After $group, fields are named by alias (e.g. "count(*)")
      const mappedHaving = mapHavingToGroupAliases(sel.having, sel.columns);
      pipeline.push({ $match: mappedHaving });
    }

    // ---- $project — build output shape from SELECT columns ----
    if (!hasAggregates && sel.columns.length > 0) {
      const allStar = sel.columns.length === 1 && sel.columns[0].expr === '*';
      if (!allStar) {
        const projDoc: Document = {};
        for (const col of sel.columns) {
          if (typeof col.expr === 'string' && col.expr !== '*') {
            // Strip table alias prefix for projection key
            const cleanField = col.expr.includes('.')
              ? col.expr.split('.').slice(1).join('.')
              : col.expr;
            const outputKey = col.alias ?? cleanField;
            // Map table.field references to nested path e.g. orders.status → orders.status
            projDoc[outputKey] = `$${col.expr}`;
          } else if (typeof col.expr === 'object' && col.expr !== null) {
            // Arithmetic expression: { $add: [...] }, { $multiply: [...] }, etc.
            const outputKey = col.alias ?? `computed_${Object.keys(projDoc).length}`;
            projDoc[outputKey] = col.expr as unknown as import('../types/index.js').DocumentValue;
          }
        }
        if (Object.keys(projDoc).length > 0) {
          pipeline.push({ $project: projDoc });
        }
      }
    }

    if (sel.orderBy) pipeline.push({ $sort: sel.orderBy });
    if (sel.limit !== undefined && !isNaN(sel.limit)) pipeline.push({ $limit: sel.limit });
    if (sel.offset !== undefined && !isNaN(sel.offset) && sel.offset > 0) pipeline.push({ $skip: sel.offset });

    return {
      type: 'aggregate',
      collection,
      pipeline,
      metadata: { timestamp: new Date() },
    };
  }

  // Simple SELECT — use find
  // If there are arithmetic expressions or CASE, use aggregation pipeline instead
  const hasExpressions = sel.columns.some(c =>
    typeof c.expr === 'object' && c.expr !== null && !('type' in c.expr)
  );
  const hasCaseExpr = sel.columns.some(c =>
    typeof c.expr === 'object' && c.expr !== null && 'type' in c.expr && (c.expr as { type: string }).type === 'case'
  );

  if (hasExpressions || hasCaseExpr) {
    // Route through aggregation pipeline for computed columns
    const pipeline: AggregationStage[] = [];
    if (sel.where) pipeline.push({ $match: sel.where });

    // Build $project with expressions
    const projDoc: Document = {};
    for (const col of sel.columns) {
      if (typeof col.expr === 'string' && col.expr !== '*') {
        const cleanField = col.expr.includes('.')
          ? col.expr.split('.').slice(1).join('.')
          : col.expr;
        const outputKey = col.alias ?? cleanField;
        projDoc[outputKey] = `$${col.expr}`;
      } else if (typeof col.expr === 'object' && col.expr !== null) {
        const outputKey = col.alias ?? `computed_${Object.keys(projDoc).length}`;
        if ('type' in col.expr && (col.expr as { type: string }).type === 'case') {
          // CASE WHEN → $switch
          const caseExpr = col.expr as { type: 'case'; parts: { when: string; then: Scalar }[]; else?: Scalar };
          const branches = caseExpr.parts.map(p => ({
            case: convertWhenToExpr(p.when),
            then: convertThenValue(p.then),
          }));
          projDoc[outputKey] = {
            $switch: {
              branches,
              default: caseExpr.else !== undefined ? convertThenValue(caseExpr.else) : null,
            },
          } as unknown as import('../types/index.js').DocumentValue;
        } else {
          projDoc[outputKey] = col.expr as unknown as import('../types/index.js').DocumentValue;
        }
      }
    }
    if (Object.keys(projDoc).length > 0) {
      pipeline.push({ $project: projDoc });
    }
    if (sel.orderBy) pipeline.push({ $sort: sel.orderBy });
    if (sel.limit !== undefined && !isNaN(sel.limit)) pipeline.push({ $limit: sel.limit });
    if (sel.offset !== undefined && !isNaN(sel.offset) && sel.offset > 0) pipeline.push({ $skip: sel.offset });

    return {
      type: 'aggregate',
      collection,
      pipeline,
      metadata: { timestamp: new Date() },
    };
  }

  const projection: Document = {};
  const allStar = sel.columns.length === 1 && sel.columns[0].expr === '*';
  if (!allStar) {
    for (const col of sel.columns) {
      if (typeof col.expr === 'string') {
        projection[col.expr] = 1 as import('../types/index.js').ProjectionSpec[string];
      }
    }
  }

  return {
    type: 'find',
    collection,
    filter: sel.where ?? {},
    projection: allStar ? undefined : projection as import('../types/index.js').ProjectionSpec,
    sort: sel.orderBy,
    limit: sel.limit,
    offset: sel.offset ?? 0,
    metadata: { timestamp: new Date() },
  };
}

/**
 * Extract filter conditions that only reference a specific table (or no table prefix).
 * Used to push primary-table filters before $lookup stages.
 */
function extractTableFilter(filter: Filter, tableAlias: string, tableName: string): Filter | null {
  const result: Document = {};
  for (const [key, val] of Object.entries(filter)) {
    if (key === '$and' || key === '$or' || key === '$nor') continue; // skip logical — push after join
    const owner = key.includes('.') ? key.split('.')[0] : null;
    if (!owner || owner === tableAlias || owner === tableName) {
      const cleanKey = key.includes('.') ? key.split('.').slice(1).join('.') : key;
      result[cleanKey] = val as import('../types/index.js').DocumentValue;
    }
  }
  return Object.keys(result).length > 0 ? result as Filter : null;
}

// Import needed for $lookup type — see top of file

function insertToIR(ins: ParsedInsert): IRNode {
  if (ins.rows && ins.rows.length > 0) {
    if (ins.rows.length === 1 && ins.columns) {
      const doc: Document = {};
      for (let i = 0; i < ins.columns.length; i++) {
        doc[ins.columns[i]] = ins.rows[0][i] as import('../types/index.js').DocumentValue;
      }
      return {
        type: 'insert',
        collection: ins.table,
        document: doc,
        metadata: { timestamp: new Date() },
      };
    }

    const docs = ins.rows.map(row => {
      const doc: Document = {};
      if (ins.columns) {
        for (let i = 0; i < ins.columns.length; i++) {
          doc[ins.columns[i]] = row[i] as import('../types/index.js').DocumentValue;
        }
      }
      return doc;
    });

    return {
      type: 'insertMany',
      collection: ins.table,
      documents: docs,
      ordered: true,
      metadata: { timestamp: new Date() },
    };
  }

  // INSERT ... SELECT — store the subquery for two-step execution in compat layer
  if (ins.select) {
    const subIR = selectToIR(ins.select);
    return {
      type: 'insertMany',
      collection: ins.table,
      documents: [],           // empty — compat layer will fill from subquery result
      ordered: true,
      // carry subquery IR in metadata for compat layer to execute first
      metadata: {
        timestamp: new Date(),
        _insertFromSelect: subIR as unknown as string,
        _insertColumns: (ins.columns ?? []) as unknown as string,
      },
    };
  }

  throw new JSDBValidationError('INSERT: no VALUES or SELECT clause found');
}

function updateToIR(upd: ParsedUpdate): IRNode {
  const updateDoc: Document = {};
  const arithmeticOps: Document = {};
  for (const clause of upd.setClauses) {
    // Strip table prefix from SET field (e.g. "u.name = ?" → set field "name")
    const field = clause.field.includes('.') ? clause.field.split('.').slice(1).join('.') : clause.field;
    const val = clause.value as unknown as string;
    // Check for arithmetic markers from parseSetClause
    if (typeof val === 'string' && val.startsWith('__inc:')) {
      arithmeticOps['$inc'] = arithmeticOps['$inc'] || {};
      (arithmeticOps['$inc'] as Document)[field] = Number(val.slice(6));
    } else if (typeof val === 'string' && val.startsWith('__mul:')) {
      arithmeticOps['$mul'] = arithmeticOps['$mul'] || {};
      (arithmeticOps['$mul'] as Document)[field] = Number(val.slice(6));
    } else if (typeof val === 'string' && val.startsWith('__div:')) {
      // Division: no $div operator — use $set with $divide expression
      const divisor = Number(val.slice(6));
      updateDoc[field] = { $divide: [`$${field}`, divisor] } as unknown as import('../types/index.js').DocumentValue;
    } else {
      updateDoc[field] = clause.value as unknown as import('../types/index.js').DocumentValue;
    }
  }

  // Build the final update document
  let finalUpdate: Document;
  if (Object.keys(arithmeticOps).length > 0) {
    // Merge $set and arithmetic ops
    finalUpdate = { ...arithmeticOps };
    if (Object.keys(updateDoc).length > 0) {
      finalUpdate['$set'] = updateDoc;
    }
  } else {
    finalUpdate = updateDoc;
  }

  // UPDATE with JOIN — convert to aggregate + update pipeline
  // We translate it to an updateMany with the filter extracted from WHERE
  // The JOIN conditions are embedded in the filter via $lookup emulation
  if (upd.joins && upd.joins.length > 0) {
    // For SQL DBs: pass through as-is via raw fallback (compiler handles JOIN UPDATE)
    // For MongoDB: not directly supported — we store join info in metadata
    return {
      type: upd.limit !== undefined ? 'update' : 'updateMany',
      collection: upd.table,
      filter: upd.where ?? {},
      update: finalUpdate as Update,
      metadata: {
        timestamp: new Date(),
        _updateJoins: upd.joins as unknown as string,
      },
    };
  }

  return {
    type: upd.limit !== undefined ? 'update' : 'updateMany',
    collection: upd.table,
    filter: upd.where ?? {},
    update: finalUpdate as Update,
    metadata: { timestamp: new Date() },
  };
}

function insertToIRWithUpsert(ins: ParsedInsert): IRNode {
  // Handle ON DUPLICATE KEY UPDATE / ON CONFLICT by converting to upsert
  if (ins.onDuplicateKeyUpdate || (ins.onConflict && ins.onConflict.action === 'update')) {
    const clauses = ins.onDuplicateKeyUpdate ?? ins.onConflict?.update ?? [];
    const setDoc: Document = {};
    for (const c of clauses) {
      setDoc[c.field] = c.value as unknown as import('../types/index.js').DocumentValue;
    }
    // Build insert doc from first row
    const insertDoc: Document = {};
    if (ins.rows && ins.rows.length > 0 && ins.columns) {
      for (let i = 0; i < ins.columns.length; i++) {
        insertDoc[ins.columns[i]] = ins.rows[0][i] as import('../types/index.js').DocumentValue;
      }
    }
    // Use upsert=true updateOne — on conflict update the specified fields
    return {
      type: 'update',
      collection: ins.table,
      filter: insertDoc as Filter,  // match by the full inserted doc (best-effort)
      update: { $set: setDoc },
      upsert: true,
      metadata: { timestamp: new Date() },
    };
  }

  // ON CONFLICT DO NOTHING → insert with upsert=false (just ignore duplicates)
  if (ins.onConflict && ins.onConflict.action === 'nothing') {
    return insertToIR(ins);
  }

  return insertToIR(ins);
}

function deleteToIR(del: ParsedDelete): IRNode {
  return {
    type: del.limit !== undefined ? 'delete' : 'deleteMany',
    collection: del.table,
    filter: del.where ?? {},
    metadata: { timestamp: new Date() },
  };
}
