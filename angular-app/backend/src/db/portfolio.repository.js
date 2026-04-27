const { all, exec, get, openDatabase, run } = require('./sqlite');

class PortfolioRepository {
  constructor(databaseName = 'portfolio.db') {
    this.db = openDatabase(databaseName);
  }

  async initialize() {
    await exec(
      this.db,
      `
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
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
        total_invested_value REAL,
        total_valuation_value REAL,
        profit_euros_value REAL,
        total_return_value REAL,
        shares_value REAL,
        unit_value_number REAL
      );

      CREATE TABLE IF NOT EXISTS section_totals (
        section TEXT PRIMARY KEY,
        total_invested TEXT,
        total_valuation TEXT,
        profit_euros TEXT,
        total_return TEXT,
        total_invested_value REAL,
        total_valuation_value REAL,
        profit_euros_value REAL,
        total_return_value REAL
      );

      CREATE TABLE IF NOT EXISTS import_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        operation_type TEXT NOT NULL,
        operation_date TEXT NOT NULL,
        quantity REAL,
        unit_price REAL,
        amount REAL,
        fee_amount REAL,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      `
    );

    await this.ensureColumn('positions', 'investment_class', 'TEXT');
  }

  async ensureColumn(tableName, columnName, definition) {
    const columns = await all(this.db, `PRAGMA table_info(${tableName})`);

    if (columns.some((column) => column.name === columnName)) {
      return;
    }

    await run(this.db, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  async clearPortfolio() {
    await exec(
      this.db,
      `
      DELETE FROM positions;
      DELETE FROM section_totals;
      `
    );
  }

  async upsertPosition(position) {
    await run(
      this.db,
      `
      INSERT INTO positions (
        id, section, asset_kind, name, isin, ticker, symbol, performance_id,
        shares, currency, type, investment_class, total_invested, invested_weight, market_date,
        unit_value, total_valuation, profit_euros, valuation_weight, total_return,
        total_invested_value, total_valuation_value, profit_euros_value, total_return_value,
        shares_value, unit_value_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        section = excluded.section,
        asset_kind = excluded.asset_kind,
        name = excluded.name,
        isin = excluded.isin,
        ticker = excluded.ticker,
        symbol = excluded.symbol,
        performance_id = excluded.performance_id,
        shares = excluded.shares,
        currency = excluded.currency,
        type = excluded.type,
        investment_class = excluded.investment_class,
        total_invested = excluded.total_invested,
        invested_weight = excluded.invested_weight,
        market_date = excluded.market_date,
        unit_value = excluded.unit_value,
        total_valuation = excluded.total_valuation,
        profit_euros = excluded.profit_euros,
        valuation_weight = excluded.valuation_weight,
        total_return = excluded.total_return,
        total_invested_value = excluded.total_invested_value,
        total_valuation_value = excluded.total_valuation_value,
        profit_euros_value = excluded.profit_euros_value,
        total_return_value = excluded.total_return_value,
        shares_value = excluded.shares_value,
        unit_value_number = excluded.unit_value_number
      `,
      [
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
    await run(
      this.db,
      `
      INSERT INTO section_totals (
        section, total_invested, total_valuation, profit_euros, total_return,
        total_invested_value, total_valuation_value, profit_euros_value, total_return_value
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(section) DO UPDATE SET
        total_invested = excluded.total_invested,
        total_valuation = excluded.total_valuation,
        profit_euros = excluded.profit_euros,
        total_return = excluded.total_return,
        total_invested_value = excluded.total_invested_value,
        total_valuation_value = excluded.total_valuation_value,
        profit_euros_value = excluded.profit_euros_value,
        total_return_value = excluded.total_return_value
      `,
      [
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
    await run(
      this.db,
      `
      INSERT INTO import_metadata (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      [key, value]
    );
  }

  async getMetadata(key) {
    const row = await get(this.db, 'SELECT value FROM import_metadata WHERE key = ?', [key]);
    return row?.value ?? null;
  }

  async getPositions() {
    return all(this.db, 'SELECT * FROM positions ORDER BY section, total_valuation_value DESC, name ASC');
  }

  async getPositionById(id) {
    return get(this.db, 'SELECT * FROM positions WHERE id = ?', [id]);
  }

  async updatePosition(position) {
    return this.upsertPosition(position);
  }

  async deletePositionById(id) {
    await run(this.db, 'DELETE FROM operations WHERE asset_id = ?', [id]);
    return run(this.db, 'DELETE FROM positions WHERE id = ?', [id]);
  }

  async getSectionTotals() {
    return all(this.db, 'SELECT * FROM section_totals ORDER BY section ASC');
  }

  async getOperationsByAssetId(assetId) {
    return all(this.db, 'SELECT * FROM operations WHERE asset_id = ? ORDER BY operation_date ASC, created_at ASC, id ASC', [assetId]);
  }

  async getOperationsByAssetIds(assetIds) {
    if (!Array.isArray(assetIds) || !assetIds.length) {
      return [];
    }

    const placeholders = assetIds.map(() => '?').join(', ');
    return all(
      this.db,
      `SELECT * FROM operations WHERE asset_id IN (${placeholders}) ORDER BY asset_id ASC, operation_date ASC, created_at ASC, id ASC`,
      assetIds
    );
  }

  async getOperationById(id) {
    return get(this.db, 'SELECT * FROM operations WHERE id = ?', [id]);
  }

  async upsertOperation(operation) {
    await run(
      this.db,
      `
      INSERT INTO operations (
        id, asset_id, operation_type, operation_date, quantity, unit_price,
        amount, fee_amount, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        asset_id = excluded.asset_id,
        operation_type = excluded.operation_type,
        operation_date = excluded.operation_date,
        quantity = excluded.quantity,
        unit_price = excluded.unit_price,
        amount = excluded.amount,
        fee_amount = excluded.fee_amount,
        notes = excluded.notes,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      `,
      [
        operation.id,
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
    return run(this.db, 'DELETE FROM operations WHERE id = ?', [id]);
  }
}

module.exports = { PortfolioRepository };
