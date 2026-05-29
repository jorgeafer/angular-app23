const { query, queryOne } = require('./postgres');

class PortfolioRepository {
  constructor(portfolioKey = 'main') {
    this.portfolioKey = portfolioKey;
  }

  async initialize() {
    await query(`
      CREATE TABLE IF NOT EXISTS positions (
        portfolio_key TEXT NOT NULL,
        id TEXT NOT NULL,
        section TEXT NOT NULL,
        asset_kind TEXT,
        name TEXT NOT NULL,
        isin TEXT,
        ticker TEXT,
        symbol TEXT,
        performance_id TEXT,
        shares TEXT,
        currency TEXT,
        type TEXT,
        investment_class TEXT,
        total_invested TEXT,
        invested_weight TEXT,
        market_date TEXT,
        unit_value TEXT,
        total_valuation TEXT,
        profit_euros TEXT,
        valuation_weight TEXT,
        total_return TEXT,
        total_invested_value DOUBLE PRECISION,
        total_valuation_value DOUBLE PRECISION,
        profit_euros_value DOUBLE PRECISION,
        total_return_value DOUBLE PRECISION,
        shares_value DOUBLE PRECISION,
        unit_value_number DOUBLE PRECISION,
        PRIMARY KEY (portfolio_key, id)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS section_totals (
        portfolio_key TEXT NOT NULL,
        section TEXT NOT NULL,
        total_invested TEXT,
        total_valuation TEXT,
        profit_euros TEXT,
        total_return TEXT,
        total_invested_value DOUBLE PRECISION,
        total_valuation_value DOUBLE PRECISION,
        profit_euros_value DOUBLE PRECISION,
        total_return_value DOUBLE PRECISION,
        PRIMARY KEY (portfolio_key, section)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS import_metadata (
        portfolio_key TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (portfolio_key, key)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        portfolio_key TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        operation_date TEXT NOT NULL,
        quantity DOUBLE PRECISION,
        unit_price DOUBLE PRECISION,
        amount DOUBLE PRECISION,
        fee_amount DOUBLE PRECISION,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_operations_portfolio_asset
      ON operations (portfolio_key, asset_id)
    `);

    await this.ensureColumn('positions', 'investment_class', 'TEXT');
  }

  async ensureColumn(tableName, columnName, definition) {
    const row = await queryOne(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2`,
      [tableName, columnName]
    );

    if (row) return;

    await query(`ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${definition}`);
  }

  async clearPortfolio() {
    await query('DELETE FROM positions WHERE portfolio_key = $1', [this.portfolioKey]);
    await query('DELETE FROM section_totals WHERE portfolio_key = $1', [this.portfolioKey]);
  }

  async upsertPosition(position) {
    await query(
      `INSERT INTO positions (
        portfolio_key, id, section, asset_kind, name, isin, ticker, symbol, performance_id,
        shares, currency, type, investment_class, total_invested, invested_weight, market_date,
        unit_value, total_valuation, profit_euros, valuation_weight, total_return,
        total_invested_value, total_valuation_value, profit_euros_value, total_return_value,
        shares_value, unit_value_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
      ON CONFLICT (portfolio_key, id) DO UPDATE SET
        section = EXCLUDED.section,
        asset_kind = EXCLUDED.asset_kind,
        name = EXCLUDED.name,
        isin = EXCLUDED.isin,
        ticker = EXCLUDED.ticker,
        symbol = EXCLUDED.symbol,
        performance_id = EXCLUDED.performance_id,
        shares = EXCLUDED.shares,
        currency = EXCLUDED.currency,
        type = EXCLUDED.type,
        investment_class = EXCLUDED.investment_class,
        total_invested = EXCLUDED.total_invested,
        invested_weight = EXCLUDED.invested_weight,
        market_date = EXCLUDED.market_date,
        unit_value = EXCLUDED.unit_value,
        total_valuation = EXCLUDED.total_valuation,
        profit_euros = EXCLUDED.profit_euros,
        valuation_weight = EXCLUDED.valuation_weight,
        total_return = EXCLUDED.total_return,
        total_invested_value = EXCLUDED.total_invested_value,
        total_valuation_value = EXCLUDED.total_valuation_value,
        profit_euros_value = EXCLUDED.profit_euros_value,
        total_return_value = EXCLUDED.total_return_value,
        shares_value = EXCLUDED.shares_value,
        unit_value_number = EXCLUDED.unit_value_number`,
      [
        this.portfolioKey,
        position.id,
        position.section,
        position.assetKind ?? null,
        position.name,
        position.isin,
        position.ticker ?? null,
        position.symbol ?? null,
        position.performanceId ?? null,
        position.shares,
        position.currency,
        position.type,
        position.investmentClass ?? null,
        position.totalInvested,
        position.investedWeight,
        position.marketDate,
        position.unitValue,
        position.totalValuation,
        position.profitEuros,
        position.valuationWeight,
        position.totalReturn,
        position.totalInvestedValue,
        position.totalValuationValue,
        position.profitEurosValue,
        position.totalReturnValue,
        position.sharesValue,
        position.unitValueNumber
      ]
    );
  }

  async upsertSectionTotals(totals) {
    await query(
      `INSERT INTO section_totals (
        portfolio_key, section, total_invested, total_valuation, profit_euros, total_return,
        total_invested_value, total_valuation_value, profit_euros_value, total_return_value
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (portfolio_key, section) DO UPDATE SET
        total_invested = EXCLUDED.total_invested,
        total_valuation = EXCLUDED.total_valuation,
        profit_euros = EXCLUDED.profit_euros,
        total_return = EXCLUDED.total_return,
        total_invested_value = EXCLUDED.total_invested_value,
        total_valuation_value = EXCLUDED.total_valuation_value,
        profit_euros_value = EXCLUDED.profit_euros_value,
        total_return_value = EXCLUDED.total_return_value`,
      [
        this.portfolioKey,
        totals.section,
        totals.totalInvested,
        totals.totalValuation,
        totals.profitEuros,
        totals.totalReturn,
        totals.totalInvestedValue,
        totals.totalValuationValue,
        totals.profitEurosValue,
        totals.totalReturnValue
      ]
    );
  }

  async setMetadata(key, value) {
    await query(
      `INSERT INTO import_metadata (portfolio_key, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (portfolio_key, key) DO UPDATE SET value = EXCLUDED.value`,
      [this.portfolioKey, key, value]
    );
  }

  async getMetadata(key) {
    const row = await queryOne(
      'SELECT value FROM import_metadata WHERE portfolio_key = $1 AND key = $2',
      [this.portfolioKey, key]
    );
    return row?.value ?? null;
  }

  async getPositions() {
    return query(
      'SELECT * FROM positions WHERE portfolio_key = $1 ORDER BY section, total_valuation_value DESC, name ASC',
      [this.portfolioKey]
    );
  }

  async getPositionById(id) {
    return queryOne(
      'SELECT * FROM positions WHERE portfolio_key = $1 AND id = $2',
      [this.portfolioKey, id]
    );
  }

  async updatePosition(position) {
    return this.upsertPosition(position);
  }

  async deletePositionById(id) {
    await query(
      'DELETE FROM operations WHERE portfolio_key = $1 AND asset_id = $2',
      [this.portfolioKey, id]
    );
    return query(
      'DELETE FROM positions WHERE portfolio_key = $1 AND id = $2',
      [this.portfolioKey, id]
    );
  }

  async getSectionTotals() {
    return query(
      'SELECT * FROM section_totals WHERE portfolio_key = $1 ORDER BY section ASC',
      [this.portfolioKey]
    );
  }

  async getOperationsByAssetId(assetId) {
    return query(
      `SELECT * FROM operations WHERE portfolio_key = $1 AND asset_id = $2
       ORDER BY operation_date ASC, created_at ASC, id ASC`,
      [this.portfolioKey, assetId]
    );
  }

  async getOperationsByAssetIds(assetIds) {
    if (!Array.isArray(assetIds) || !assetIds.length) {
      return [];
    }

    return query(
      `SELECT * FROM operations WHERE portfolio_key = $1 AND asset_id = ANY($2)
       ORDER BY asset_id ASC, operation_date ASC, created_at ASC, id ASC`,
      [this.portfolioKey, assetIds]
    );
  }

  async getOperationById(id) {
    return queryOne(
      'SELECT * FROM operations WHERE id = $1 AND portfolio_key = $2',
      [id, this.portfolioKey]
    );
  }

  async upsertOperation(operation) {
    await query(
      `INSERT INTO operations (
        id, portfolio_key, asset_id, operation_type, operation_date, quantity, unit_price,
        amount, fee_amount, notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        portfolio_key = EXCLUDED.portfolio_key,
        asset_id = EXCLUDED.asset_id,
        operation_type = EXCLUDED.operation_type,
        operation_date = EXCLUDED.operation_date,
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        amount = EXCLUDED.amount,
        fee_amount = EXCLUDED.fee_amount,
        notes = EXCLUDED.notes,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at`,
      [
        operation.id,
        this.portfolioKey,
        operation.assetId,
        operation.operationType,
        operation.operationDate,
        operation.quantity ?? null,
        operation.unitPrice ?? null,
        operation.amount ?? null,
        operation.feeAmount ?? null,
        operation.notes ?? null,
        operation.createdAt ?? null,
        operation.updatedAt ?? null
      ]
    );
  }

  async deleteOperationById(id) {
    return query(
      'DELETE FROM operations WHERE id = $1 AND portfolio_key = $2',
      [id, this.portfolioKey]
    );
  }
}

module.exports = { PortfolioRepository };
