const { HttpError } = require('../errors/http-error');
const { PortfolioRepository } = require('../db/portfolio.repository');
const { YahooFinanceService } = require('./yahoo-finance.service');

class PortfolioQueryService {
  constructor(repository = new PortfolioRepository(), yahooFinanceService = new YahooFinanceService()) {
    this.repository = repository;
    this.yahooFinanceService = yahooFinanceService;
    this.yahooSnapshotCache = new Map();
    this.marketSeriesCache = new Map();
    this.yahooSnapshotTtlMs = 15 * 60 * 1000;
  }

  async initialize() {
    await this.repository.initialize();
  }

  async getPortfolioDataset(options = {}) {
    const asOfDate = normalizeIsoDate(options.asOfDate);
    const [positionRows, lastImportedAt] = await Promise.all([
      this.repository.getPositions(),
      this.repository.getMetadata('last_imported_at')
    ]);

    let sections = await this.buildSections(positionRows.map(mapPositionRow), asOfDate);

    let rows = sections.flatMap((section) => section.rows);
    rows = applyPortfolioInsights(rows);
    sections = sections.map((section) => {
      const sectionRows = rows.filter((row) => row.section === section.title);
      return {
        ...section,
        rows: sectionRows,
        totals: buildTotals(sectionRows)
      };
    });

    const portfolioTotal = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);
    const alertRows = rows.filter((row) => row.section === 'FONDOS');
    const alertPortfolioTotal = alertRows.reduce((sum, row) => sum + row.totalValuationValue, 0);
    const analytics = buildAnalytics(rows, portfolioTotal);
    const quality = buildQualityOverview(rows);
    const alertAnalytics = buildAnalytics(alertRows, alertPortfolioTotal);
    const alertQuality = buildQualityOverview(alertRows);
    const alerts = buildAlerts(alertRows, alertAnalytics, alertQuality, lastImportedAt);

    return {
      lastUpdated: rows
        .map((row) => row.marketDate)
        .filter(Boolean)
        .sort((left, right) => right.localeCompare(left))[0] ?? '',
      lastImportedAt,
      sections,
      rows,
      summaryByType: buildSummary(rows, (row) => row.type || 'Sin tipo'),
      summaryByCurrency: buildSummary(rows, (row) => row.currency || 'Sin divisa'),
      summaryByClass: buildSummary(rows, (row) => row.investmentClass || 'Sin clase'),
      summaryBySector: buildSummary(rows, (row) => row.sector || (row.section === 'FONDOS' ? row.categoryName || 'Sin categoria' : 'Sin sector')),
      summaryByCountry: buildSummary(rows, (row) => row.country || 'Sin pais'),
      summaryByManager: buildSummary(rows, (row) => row.managerName || (row.section === 'ACCIONES' ? 'Directa' : 'Sin gestora')),
      summaryByAsset: [...rows]
        .sort((left, right) => right.totalValuationValue - left.totalValuationValue)
        .slice(0, 8)
        .map((row) => ({
          label: row.name,
          value: row.totalValuationValue,
          formattedValue: formatCurrency(row.totalValuationValue),
          percentage: computePercentage(row.totalValuationValue, portfolioTotal)
        })),
      alerts,
      analytics,
      quality,
      benchmarkOverview: await this.buildBenchmarkOverview(rows)
    };
  }

  async getAssetById(id) {
    const rows = await this.repository.getPositions();
    const sections = await this.buildSections(rows.map(mapPositionRow));
    return sections.flatMap((section) => section.rows).find((row) => row.id === id) ?? null;
  }

  async getAssetOperations(id) {
    const asset = await this.getAssetById(id);

    if (!asset) {
      throw new HttpError(404, 'Asset not found');
    }

    await this.ensureSeedOperation(asset);
    const operations = await this.repository.getOperationsByAssetId(id);
    return operations.map(mapOperationRow);
  }

  async createAssetOperation(id, payload = {}) {
    const asset = await this.getAssetById(id);

    if (!asset) {
      throw new HttpError(404, 'Asset not found');
    }

    await this.ensureSeedOperation(asset);
    const operation = normalizeOperationPayload(payload, asset);
    const now = new Date().toISOString();

    await this.repository.upsertOperation({
      ...operation,
      id: createOperationId(),
      assetId: id,
      createdAt: now,
      updatedAt: now
    });

    return this.getAssetOperations(id);
  }

  async updateAssetOperation(id, operationId, payload = {}) {
    const asset = await this.getAssetById(id);

    if (!asset) {
      throw new HttpError(404, 'Asset not found');
    }

    const existingOperation = await this.repository.getOperationById(operationId);

    if (!existingOperation || existingOperation.asset_id !== id) {
      throw new HttpError(404, 'Operation not found');
    }

    const operation = normalizeOperationPayload(payload, asset);

    await this.repository.upsertOperation({
      ...operation,
      id: operationId,
      assetId: id,
      createdAt: existingOperation.created_at || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    return this.getAssetOperations(id);
  }

  async deleteAssetOperation(id, operationId) {
    const existingOperation = await this.repository.getOperationById(operationId);

    if (!existingOperation || existingOperation.asset_id !== id) {
      throw new HttpError(404, 'Operation not found');
    }

    const currentOperations = await this.repository.getOperationsByAssetId(id);

    if (currentOperations.length <= 1) {
      throw new HttpError(400, 'At least one operation must remain in the asset history');
    }

    await this.repository.deleteOperationById(operationId);
    return this.getAssetOperations(id);
  }

  async updateAssetValue(id, payload = {}) {
    const storedRow = await this.repository.getPositionById(id);

    if (!storedRow) {
      throw new HttpError(404, 'Asset not found');
    }

    const row = mapPositionRow(storedRow);

    const field = normalizeEditableField(payload.field);

    if (!field) {
      throw new HttpError(400, 'Field is not editable');
    }

    const normalizedValue = normalizeEditableValueInput(field, payload.value);
    const updatedRow = applyEditableValue(row, field, normalizedValue);
    await this.repository.updatePosition(updatedRow);

    return updatedRow;
  }

  async createFundPosition(payload = {}) {
    const input = normalizeCreateFundPayload(payload);

    if (!input.name) {
      throw new HttpError(400, 'Fund name is required');
    }

    if (!input.isin) {
      throw new HttpError(400, 'ISIN is required');
    }

    if (!input.type) {
      throw new HttpError(400, 'Type is required');
    }

    if (!input.currency) {
      throw new HttpError(400, 'Currency is required');
    }

    if (!Number.isFinite(input.totalInvestedValue) || input.totalInvestedValue <= 0) {
      throw new HttpError(400, 'Invested capital must be a valid positive number');
    }

    if (!Number.isFinite(input.sharesValue) || input.sharesValue <= 0) {
      throw new HttpError(400, 'Shares must be a valid positive number');
    }

    const existingRows = await this.repository.getPositions();
    const duplicate = existingRows.find(
      (row) => row.section === 'FONDOS' && String(row.isin || '').trim().toUpperCase() === input.isin.toUpperCase()
    );

    if (duplicate) {
      throw new HttpError(409, 'There is already a fund with that ISIN');
    }

    const createdRow = createFundRow(input);
    await this.repository.upsertPosition(createdRow);

    return this.enrichRow(createdRow);
  }

  async deleteFundPosition(id) {
    const storedRow = await this.repository.getPositionById(id);

    if (!storedRow) {
      throw new HttpError(404, 'Asset not found');
    }

    if (storedRow.section !== 'FONDOS') {
      throw new HttpError(400, 'Only fund positions can be deleted');
    }

    await this.repository.deletePositionById(id);
    return { ok: true };
  }

  async buildSections(rows, asOfDate) {
    const enrichedRows = await Promise.all(rows.map((row) => this.enrichRow(row, asOfDate)));
    const operations = await this.repository.getOperationsByAssetIds(enrichedRows.map((row) => row.id));
    const operationsByAssetId = groupOperationsByAssetId(operations.map(mapOperationRow));
    const rowsWithOperations = enrichedRows.map((row) => {
      const rowOperations = operationsByAssetId.get(row.id) ?? [];
      const effectiveOperations = rowOperations.length ? rowOperations : [buildSeedOperation(row)];
      return applyOperationsToRow(row, effectiveOperations);
    });
    const latestMarketDate = resolveLatestMarketDate(rowsWithOperations);

    return ['FONDOS', 'ACCIONES'].map((sectionName) => {
      const sectionRows = recalculateSectionRows(rowsWithOperations.filter((row) => row.section === sectionName))
        .map((row) => applyDataQuality(row, latestMarketDate));
      return {
        title: sectionName,
        rows: sectionRows,
        totals: buildTotals(sectionRows)
      };
    });
  }

  async enrichRow(row, asOfDate) {
    const lookup = resolveYahooLookup(row);

    if (!lookup) {
      return row;
    }

    try {
      if (row.section === 'FONDOS') {
        const snapshot = await withTimeout(this.getFundSnapshot(lookup), 8000);
        return snapshot ? applyFundSnapshot(row, snapshot, asOfDate) : row;
      }

      const snapshot = await withTimeout(this.getEquitySnapshot(lookup), 8000);
      return snapshot ? applyEquitySnapshot(row, snapshot) : row;
    } catch {
      return row;
    }
  }

  async getFundSnapshot(lookup) {
    const cacheKey = `fund:${lookup.idType}:${lookup.id}`;
    const cachedEntry = this.yahooSnapshotCache.get(cacheKey);

    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    const snapshot = await this.yahooFinanceService.getFundSnapshot({
      assetType: 'fund',
      idType: lookup.idType,
      id: lookup.id
    });

    this.yahooSnapshotCache.set(cacheKey, {
      expiresAt: Date.now() + this.yahooSnapshotTtlMs,
      value: snapshot
    });

    return snapshot;
  }

  async getEquitySnapshot(lookup) {
    const cacheKey = `equity:${lookup.idType}:${lookup.id}`;
    const cachedEntry = this.yahooSnapshotCache.get(cacheKey);

    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    const snapshot = await this.yahooFinanceService.getAssetDetails({
      assetType: 'equity',
      idType: lookup.idType,
      id: lookup.id
    });

    this.yahooSnapshotCache.set(cacheKey, {
      expiresAt: Date.now() + this.yahooSnapshotTtlMs,
      value: snapshot
    });

    return snapshot;
  }

  async buildBenchmarkOverview(rows) {
    const benchmarkConfig = resolveBenchmarkConfig(rows);

    if (!benchmarkConfig) {
      return null;
    }

    try {
      const series = await withTimeout(this.getMarketSeries(benchmarkConfig.symbol), 8000);
      return buildBenchmarkOverview(rows, benchmarkConfig, series);
    } catch {
      return null;
    }
  }

  async getMarketSeries(symbol) {
    const cachedEntry = this.marketSeriesCache.get(symbol);

    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return cachedEntry.value;
    }

    const series = await this.yahooFinanceService.getMarketSeries(symbol);

    this.marketSeriesCache.set(symbol, {
      expiresAt: Date.now() + this.yahooSnapshotTtlMs,
      value: series
    });

    return series;
  }

  async ensureSeedOperation(asset) {
    const existingOperations = await this.repository.getOperationsByAssetId(asset.id);

    if (existingOperations.length > 0) {
      return;
    }

    const seed = buildSeedOperation(asset);
    const now = new Date().toISOString();

    await this.repository.upsertOperation({
      ...seed,
      id: createOperationId(),
      assetId: asset.id,
      createdAt: now,
      updatedAt: now
    });
  }

}

function mapPositionRow(row) {
  const parsedSharesValue = parsePositionQuantity(row.shares);
  const parsedUnitValueNumber = parseDisplayNumber(row.unit_value);
  const totalInvestedValue = row.total_invested_value ?? 0;
  const normalizedFundMetrics =
    row.section === 'FONDOS'
      ? buildDerivedMetrics({
          sharesValue: parsedSharesValue,
          unitValueNumber: parsedUnitValueNumber,
          totalInvestedValue
        })
      : null;

  return {
    id: row.id,
    section: row.section,
    assetKind: row.asset_kind,
    name: row.name,
    isin: row.isin || '',
    ticker: row.ticker || undefined,
    symbol: row.symbol || undefined,
    performanceId: row.performance_id || undefined,
    shares: row.shares,
    currency: row.currency,
    type: normalizePositionType(row.section, row.type),
    investmentClass: row.section === 'FONDOS' ? normalizeInvestmentClass(row.investment_class) : undefined,
    totalInvested: row.total_invested,
    investedWeight: row.invested_weight,
    marketDate: row.market_date,
    unitValue: row.unit_value,
    totalValuation: row.total_valuation,
    profitEuros: row.profit_euros,
    valuationWeight: row.valuation_weight,
    totalReturn: row.total_return,
    totalInvestedValue,
    totalValuationValue: normalizedFundMetrics?.totalValuationValue ?? row.total_valuation_value ?? 0,
    profitEurosValue: normalizedFundMetrics?.profitEurosValue ?? row.profit_euros_value ?? 0,
    totalReturnValue: normalizedFundMetrics?.totalReturnValue ?? row.total_return_value ?? 0,
    sharesValue: parsedSharesValue,
    unitValueNumber: parsedUnitValueNumber,
    averageCost: '',
    averageCostValue: 0,
    annualizedReturn: '',
    annualizedReturnValue: 0,
    contribution: '',
    contributionValue: 0,
    sector: undefined,
    country: undefined,
    managerName: undefined,
    categoryName: undefined,
    totalValuation: normalizedFundMetrics?.totalValuation ?? row.total_valuation,
    profitEuros: normalizedFundMetrics?.profitEuros ?? row.profit_euros,
    totalReturn: normalizedFundMetrics?.totalReturn ?? row.total_return,
    navHistory: undefined,
    qualityIssues: [],
    qualityScore: 100,
    stalePrice: false,
    missingIdentifiers: false,
    missingHistory: false
  };
}

function mapOperationRow(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    operationType: row.operation_type,
    operationDate: row.operation_date,
    quantity: row.quantity ?? null,
    unitPrice: row.unit_price ?? null,
    amount: row.amount ?? null,
    feeAmount: row.fee_amount ?? null,
    notes: row.notes ?? '',
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? ''
  };
}

function resolveYahooLookup(row) {
  if (row.isin) {
    return { idType: 'isin', id: row.isin };
  }

  if (row.symbol) {
    return { idType: 'symbol', id: row.symbol };
  }

  if (row.ticker) {
    return { idType: 'ticker', id: row.ticker };
  }

  return null;
}

function buildSummary(rows, keySelector) {
  const grouped = new Map();

  for (const row of rows) {
    const key = keySelector(row);
    grouped.set(key, (grouped.get(key) ?? 0) + row.totalValuationValue);
  }

  const total = Array.from(grouped.values()).reduce((sum, value) => sum + value, 0);

  return Array.from(grouped.entries())
    .map(([label, value]) => ({
      label,
      value,
      formattedValue: formatCurrency(value),
      percentage: computePercentage(value, total)
    }))
    .sort((left, right) => right.value - left.value);
}

function groupOperationsByAssetId(operations) {
  const grouped = new Map();

  for (const operation of operations) {
    if (!grouped.has(operation.assetId)) {
      grouped.set(operation.assetId, []);
    }

    grouped.get(operation.assetId).push(operation);
  }

  return grouped;
}

function computePercentage(value, total) {
  return total > 0 ? (value / total) * 100 : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatPercent(value) {
  return `${formatNumber(value, 2)}%`;
}

function buildTotals(rows) {
  if (!rows.length) {
    return null;
  }

  const totalInvestedValue = rows.reduce((sum, row) => sum + row.totalInvestedValue, 0);
  const totalValuationValue = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);
  const profitEurosValue = roundMoney(totalValuationValue - totalInvestedValue);
  const totalReturnValue = totalInvestedValue > 0 ? roundPercent((profitEurosValue / totalInvestedValue) * 100) : 0;

  return {
    totalInvested: formatCurrency(totalInvestedValue),
    totalValuation: formatCurrency(totalValuationValue),
    profitEuros: formatCurrency(profitEurosValue),
    totalReturn: formatPercent(totalReturnValue),
    totalInvestedValue,
    totalValuationValue,
    profitEurosValue,
    totalReturnValue
  };
}

function recalculateSectionRows(rows) {
  if (!rows.length) {
    return [];
  }

  const sectionTotalInvested = rows.reduce((sum, row) => sum + row.totalInvestedValue, 0);
  const sectionTotalValuation = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);

  return rows.map((row) => {
    const investedWeightValue = sectionTotalInvested > 0 ? roundPercent((row.totalInvestedValue / sectionTotalInvested) * 100) : 0;
    const valuationWeightValue = sectionTotalValuation > 0 ? roundPercent((row.totalValuationValue / sectionTotalValuation) * 100) : 0;

    return {
      ...row,
      investedWeight: formatPercent(investedWeightValue),
      investedWeightValue,
      valuationWeight: formatPercent(valuationWeightValue),
      valuationWeightValue
    };
  });
}

function applyEditableValue(row, field, nextValue) {
  if (field === 'investmentClass') {
    return {
      ...row,
      investmentClass: nextValue
    };
  }

  if (field === 'type') {
    return {
      ...row,
      type: nextValue
    };
  }

  if (field === 'currency') {
    return {
      ...row,
      currency: nextValue
    };
  }

  const nextRow = {
    ...row,
    sharesValue: field === 'shares' ? nextValue : row.sharesValue,
    totalInvestedValue: field === 'totalInvested' ? roundMoney(nextValue) : row.totalInvestedValue
  };

  nextRow.shares = formatEditableShares(nextRow.sharesValue, row.shares);
  nextRow.totalInvested = formatCurrency(nextRow.totalInvestedValue);
  const derivedMetrics = buildDerivedMetrics(nextRow);

  nextRow.totalValuationValue = derivedMetrics.totalValuationValue;
  nextRow.totalValuation = derivedMetrics.totalValuation;
  nextRow.profitEurosValue = derivedMetrics.profitEurosValue;
  nextRow.profitEuros = derivedMetrics.profitEuros;
  nextRow.totalReturnValue = derivedMetrics.totalReturnValue;
  nextRow.totalReturn = derivedMetrics.totalReturn;

  return nextRow;
}

function applyOperationsToRow(row, operations) {
  if (!Array.isArray(operations) || !operations.length) {
    return row;
  }

  let sharesValue = 0;
  let totalInvestedValue = 0;
  let cashAdjustments = 0;

  for (const operation of operations) {
    if (operation.operationType === 'buy') {
      sharesValue += operation.quantity ?? 0;
      totalInvestedValue += (operation.amount ?? 0) + (operation.feeAmount ?? 0);
      continue;
    }

    if (operation.operationType === 'sell') {
      const quantity = operation.quantity ?? 0;
      const averageCost = sharesValue > 0 ? totalInvestedValue / sharesValue : 0;
      sharesValue = Math.max(sharesValue - quantity, 0);
      totalInvestedValue = Math.max(totalInvestedValue - (averageCost * quantity), 0);
      cashAdjustments += (operation.amount ?? 0) - (operation.feeAmount ?? 0) - (averageCost * quantity);
      continue;
    }

    if (operation.operationType === 'dividend') {
      cashAdjustments += operation.amount ?? 0;
      continue;
    }

    if (operation.operationType === 'fee') {
      cashAdjustments -= (operation.amount ?? 0) + (operation.feeAmount ?? 0);
    }
  }

  const totalValuationValue = roundMoney(sharesValue * (row.unitValueNumber || 0));
  const profitEurosValue = roundMoney(totalValuationValue - totalInvestedValue + cashAdjustments);
  const totalReturnValue = totalInvestedValue > 0 ? roundPercent((profitEurosValue / totalInvestedValue) * 100) : 0;

  return {
    ...row,
    sharesValue,
    shares: formatEditableShares(sharesValue, row.shares),
    totalInvestedValue,
    totalInvested: formatCurrency(totalInvestedValue),
    totalValuationValue,
    totalValuation: formatCurrency(totalValuationValue),
    profitEurosValue,
    profitEuros: formatCurrency(profitEurosValue),
    totalReturnValue,
    totalReturn: formatPercent(totalReturnValue)
  };
}

function applyFundSnapshot(row, snapshot, asOfDate) {
  const selectedNavPoint = resolveSnapshotPoint(snapshot, asOfDate);

  if (typeof selectedNavPoint?.close !== 'number') {
    return row;
  }

  const sharesQuantity = parsePositionQuantity(row.shares);
  const navValue = selectedNavPoint.close;
  const unitDigits = Math.max(4, countDecimals(navValue), countDisplayedDecimals(row.unitValue));
  const totalValuationValue = roundMoney(sharesQuantity * navValue);
  const profitEurosValue = roundMoney(totalValuationValue - row.totalInvestedValue);
  const totalReturnValue = row.totalInvestedValue > 0 ? roundPercent((profitEurosValue / row.totalInvestedValue) * 100) : 0;

  return {
    ...row,
    investmentClass: row.investmentClass,
    managerName: snapshot.family || row.managerName,
    categoryName: snapshot.category || row.categoryName,
    country: snapshot.country || row.country,
    marketDate: selectedNavPoint.date || snapshot.navDate || row.marketDate,
    unitValue: formatNumber(navValue, unitDigits),
    unitValueNumber: navValue,
    totalValuation: formatCurrency(totalValuationValue),
    totalValuationValue,
    profitEuros: formatCurrency(profitEurosValue),
    profitEurosValue,
    totalReturn: formatPercent(totalReturnValue),
    totalReturnValue,
    sharesValue: sharesQuantity,
    navHistory: Array.isArray(snapshot.dailyPerformance) ? snapshot.dailyPerformance : row.navHistory
  };
}

function applyEquitySnapshot(row, snapshot) {
  if (typeof snapshot?.latestPrice !== 'number') {
    return row;
  }

  const sharesQuantity = parsePositionQuantity(row.shares);
  const latestPrice = snapshot.latestPrice;
  const totalValuationValue = roundMoney(sharesQuantity * latestPrice);
  const profitEurosValue = roundMoney(totalValuationValue - row.totalInvestedValue);
  const totalReturnValue = row.totalInvestedValue > 0 ? roundPercent((profitEurosValue / row.totalInvestedValue) * 100) : 0;
  const unitDigits = Math.max(2, countDecimals(latestPrice), countDisplayedDecimals(row.unitValue));

  return {
    ...row,
    sector: snapshot.sector || row.sector,
    country: snapshot.country || row.country,
    marketDate: snapshot.latestPriceDate || row.marketDate,
    unitValue: formatNumber(latestPrice, unitDigits),
    unitValueNumber: latestPrice,
    totalValuation: formatCurrency(totalValuationValue),
    totalValuationValue,
    profitEuros: formatCurrency(profitEurosValue),
    profitEurosValue,
    totalReturn: formatPercent(totalReturnValue),
    totalReturnValue,
    sharesValue: sharesQuantity,
    navHistory: Array.isArray(snapshot.dailyPerformance) ? snapshot.dailyPerformance : row.navHistory
  };
}

function resolveSnapshotPoint(snapshot, asOfDate) {
  const history = Array.isArray(snapshot?.dailyPerformance) ? snapshot.dailyPerformance : [];

  if (history.length > 0) {
    if (asOfDate) {
      for (let index = history.length - 1; index >= 0; index -= 1) {
        if (history[index].date <= asOfDate) {
          return history[index];
        }
      }
    }

    return history[history.length - 1];
  }

  if (typeof snapshot?.nav === 'number') {
    return {
      date: snapshot.navDate,
      close: snapshot.nav
    };
  }

  return null;
}

function resolveLatestMarketDate(rows) {
  return rows
    .map((row) => normalizeIsoDate(row.marketDate))
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] ?? '';
}

function applyDataQuality(row, latestMarketDate) {
  const qualityIssues = [];
  const normalizedMarketDate = normalizeIsoDate(row.marketDate);
  const stalePrice = normalizedMarketDate ? isDateOlderThan(normalizedMarketDate, latestMarketDate, 7) : true;
  const missingIdentifiers = !row.isin && !row.ticker && !row.symbol;
  const missingHistory = !Array.isArray(row.navHistory) || row.navHistory.length < 2;

  if (stalePrice) {
    qualityIssues.push('Precio desactualizado');
  }

  if (missingIdentifiers) {
    qualityIssues.push('Identificadores incompletos');
  }

  if (missingHistory) {
    qualityIssues.push('Sin historico suficiente');
  }

  const qualityScore = Math.max(0, 100 - (stalePrice ? 35 : 0) - (missingIdentifiers ? 35 : 0) - (missingHistory ? 30 : 0));

  return {
    ...row,
    qualityIssues,
    qualityScore,
    stalePrice,
    missingIdentifiers,
    missingHistory
  };
}

function isDateOlderThan(candidate, latest, maxDays) {
  if (!candidate || !latest) {
    return false;
  }

  const candidateDate = new Date(`${candidate}T00:00:00`);
  const latestDate = new Date(`${latest}T00:00:00`);

  if (Number.isNaN(candidateDate.getTime()) || Number.isNaN(latestDate.getTime())) {
    return false;
  }

  return latestDate.getTime() - candidateDate.getTime() > maxDays * 24 * 60 * 60 * 1000;
}

function diffInYears(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25), 0);
}

function buildAnalytics(rows, portfolioTotal) {
  const topHolding = [...rows].sort((left, right) => right.totalValuationValue - left.totalValuationValue)[0] ?? null;
  const bestPerformer = [...rows].sort((left, right) => right.totalReturnValue - left.totalReturnValue)[0] ?? null;
  const worstPerformer = [...rows].sort((left, right) => left.totalReturnValue - right.totalReturnValue)[0] ?? null;
  const topContributor = [...rows].sort((left, right) => right.contributionValue - left.contributionValue)[0] ?? null;
  const topFiveWeight = computePercentage(
    [...rows]
      .sort((left, right) => right.totalValuationValue - left.totalValuationValue)
      .slice(0, 5)
      .reduce((sum, row) => sum + row.totalValuationValue, 0),
    portfolioTotal
  );
  const annualizedPortfolioReturn = buildPortfolioAnnualizedReturn(rows);

  return {
    topHoldingName: topHolding?.name ?? '-',
    topHoldingWeight: topHolding ? computePercentage(topHolding.totalValuationValue, portfolioTotal) : 0,
    topFiveWeight,
    bestPerformerName: bestPerformer?.name ?? '-',
    bestPerformerValue: bestPerformer?.totalReturnValue ?? 0,
    worstPerformerName: worstPerformer?.name ?? '-',
    worstPerformerValue: worstPerformer?.totalReturnValue ?? 0,
    topContributorName: topContributor?.name ?? '-',
    topContributorValue: topContributor?.contributionValue ?? 0,
    annualizedPortfolioReturn,
    positiveCount: rows.filter((row) => row.totalReturnValue > 0).length,
    negativeCount: rows.filter((row) => row.totalReturnValue < 0).length,
    staleCount: rows.filter((row) => row.stalePrice).length,
    missingIdentifierCount: rows.filter((row) => row.missingIdentifiers).length,
    missingHistoryCount: rows.filter((row) => row.missingHistory).length
  };
}

function buildQualityOverview(rows) {
  if (!rows.length) {
    return {
      score: 100,
      staleCount: 0,
      missingIdentifierCount: 0,
      missingHistoryCount: 0
    };
  }

  const staleCount = rows.filter((row) => row.stalePrice).length;
  const missingIdentifierCount = rows.filter((row) => row.missingIdentifiers).length;
  const missingHistoryCount = rows.filter((row) => row.missingHistory).length;
  const score = round(
    rows.reduce((sum, row) => sum + (row.qualityScore ?? 100), 0) / rows.length,
    0
  );

  return {
    score,
    staleCount,
    missingIdentifierCount,
    missingHistoryCount
  };
}

function buildSeedOperation(row) {
  const quantity = roundNumber(row.sharesValue, 6);
  const unitPrice = quantity > 0 ? roundMoney(row.totalInvestedValue / quantity) : roundMoney(row.unitValueNumber || 0);
  const amount = roundMoney(quantity * unitPrice);

  return {
    assetId: row.id,
    operationType: 'buy',
    operationDate: normalizeIsoDate(row.marketDate) || new Date().toISOString().slice(0, 10),
    quantity,
    unitPrice,
    amount,
    feeAmount: 0,
    notes: 'Posicion inicial'
  };
}

function buildAlerts(rows, analytics, quality, lastImportedAt) {
  const alerts = [];

  if (analytics.topHoldingWeight >= 30) {
    alerts.push({
      id: 'top-holding-concentration',
      severity: 'critical',
      title: 'Concentracion alta en una sola posicion',
      description: `${analytics.topHoldingName} pesa ${formatPercent(analytics.topHoldingWeight)} de la cartera.`
    });
  }

  if (analytics.topFiveWeight >= 65) {
    alerts.push({
      id: 'top-five-concentration',
      severity: 'warning',
      title: 'Top 5 demasiado concentrado',
      description: `Las cinco mayores posiciones concentran ${formatPercent(analytics.topFiveWeight)}.`
    });
  }

  if (quality.staleCount > 0) {
    alerts.push({
      id: 'stale-prices',
      severity: 'warning',
      title: 'Hay posiciones con precio desactualizado',
      description: `${quality.staleCount} activos tienen una fecha de mercado retrasada frente al resto.`
    });
  }

  if (quality.missingIdentifierCount > 0) {
    alerts.push({
      id: 'missing-identifiers',
      severity: 'warning',
      title: 'Faltan identificadores',
      description: `${quality.missingIdentifierCount} activos no tienen ISIN/ticker/symbol suficientes para enriquecer datos.`
    });
  }

  if (quality.missingHistoryCount > 0) {
    alerts.push({
      id: 'missing-history',
      severity: 'info',
      title: 'Historico incompleto',
      description: `${quality.missingHistoryCount} activos no tienen suficiente historico para comparativas y series.`
    });
  }

  if (lastImportedAt) {
    const importedAt = new Date(lastImportedAt);
    if (!Number.isNaN(importedAt.getTime())) {
      const hoursSinceImport = (Date.now() - importedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceImport > 72) {
        alerts.push({
          id: 'import-stale',
          severity: 'info',
          title: 'Base local no refrescada recientemente',
          description: `La ultima importacion base fue hace ${Math.floor(hoursSinceImport)} horas.`
        });
      }
    }
  }

  return alerts;
}

function resolveBenchmarkConfig(rows) {
  const hasEquities = rows.some((row) => row.section === 'ACCIONES');
  const hasFunds = rows.some((row) => row.section === 'FONDOS');

  if (hasEquities && hasFunds) {
    return { symbol: 'SPY', label: 'S&P 500' };
  }

  if (hasFunds) {
    return { symbol: 'URTH', label: 'MSCI World' };
  }

  if (hasEquities) {
    return { symbol: 'SPY', label: 'S&P 500' };
  }

  return null;
}

function buildBenchmarkOverview(rows, benchmarkConfig, marketSeries) {
  const portfolioSeries = buildPortfolioPerformanceSeries(rows);
  const benchmarkPerformance = normalizeBenchmarkSeries(marketSeries);

  if (!portfolioSeries.length || !benchmarkPerformance.length) {
    return null;
  }

  const comparisonSeries = buildBenchmarkComparisonSeries(portfolioSeries, benchmarkPerformance);

  if (comparisonSeries.length < 2) {
    return null;
  }

  const snapshots = [
    buildBenchmarkSnapshot('1 mes', comparisonSeries, 30),
    buildBenchmarkSnapshot('YTD', comparisonSeries, 'ytd'),
    buildBenchmarkSnapshot('1 ano', comparisonSeries, 365),
    buildBenchmarkSnapshot('Desde inicio', comparisonSeries, 'all')
  ].filter(Boolean);

  if (!snapshots.length) {
    return null;
  }

  return {
    label: benchmarkConfig.label,
    symbol: benchmarkConfig.symbol,
    series: comparisonSeries,
    snapshots
  };
}

function applyPortfolioInsights(rows) {
  if (!rows.length) {
    return [];
  }

  const portfolioValuation = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);

  return rows.map((row) => {
    const averageCostValue = row.sharesValue > 0 ? roundMoney(row.totalInvestedValue / row.sharesValue) : 0;
    const annualizedReturnValue = computeAnnualizedReturn(row);
    const contributionValue =
      portfolioValuation > 0 ? roundPercent((row.totalValuationValue / portfolioValuation) * row.totalReturnValue) : 0;

    return {
      ...row,
      averageCostValue,
      averageCost: formatCurrency(averageCostValue),
      annualizedReturnValue,
      annualizedReturn: formatPercent(annualizedReturnValue),
      contributionValue,
      contribution: formatPercent(contributionValue)
    };
  });
}

function computeAnnualizedReturn(row) {
  if (!row.totalInvestedValue || row.totalInvestedValue <= 0 || row.totalValuationValue <= 0) {
    return 0;
  }

  const history = Array.isArray(row.navHistory) ? row.navHistory : [];
  const firstDate = normalizeIsoDate(history[0]?.date || '');
  const lastDate = normalizeIsoDate(history.at(-1)?.date || row.marketDate);

  if (!firstDate || !lastDate) {
    return row.totalReturnValue;
  }

  const years = diffInYears(firstDate, lastDate);

  if (years <= 0) {
    return row.totalReturnValue;
  }

  return roundPercent((Math.pow(row.totalValuationValue / row.totalInvestedValue, 1 / years) - 1) * 100);
}

function buildPortfolioAnnualizedReturn(rows) {
  const eligibleRows = rows.filter((row) => row.totalInvestedValue > 0 && row.totalValuationValue > 0 && Array.isArray(row.navHistory) && row.navHistory.length > 1);

  if (!eligibleRows.length) {
    return 0;
  }

  const totalInvestedValue = eligibleRows.reduce((sum, row) => sum + row.totalInvestedValue, 0);
  const totalValuationValue = eligibleRows.reduce((sum, row) => sum + row.totalValuationValue, 0);
  const firstDate = eligibleRows
    .map((row) => normalizeIsoDate(row.navHistory?.[0]?.date || ''))
    .filter(Boolean)
    .sort()[0];
  const lastDate = eligibleRows
    .map((row) => normalizeIsoDate(row.navHistory?.at(-1)?.date || row.marketDate))
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!firstDate || !lastDate) {
    return 0;
  }

  const years = diffInYears(firstDate, lastDate);

  if (years <= 0) {
    return 0;
  }

  return roundPercent((Math.pow(totalValuationValue / totalInvestedValue, 1 / years) - 1) * 100);
}

function buildBenchmarkComparisonSeries(portfolioSeries, benchmarkSeries) {
  const allDates = Array.from(
    new Set([...portfolioSeries.map((point) => point.date), ...benchmarkSeries.map((point) => point.date)])
  ).sort();

  if (!allDates.length) {
    return [];
  }

  const commonStartDate = [portfolioSeries[0]?.date, benchmarkSeries[0]?.date].filter(Boolean).sort().at(-1);

  if (!commonStartDate) {
    return [];
  }

  let portfolioIndex = 0;
  let benchmarkIndex = 0;
  let latestPortfolio = null;
  let latestBenchmark = null;
  let basePortfolio = null;
  let baseBenchmark = null;
  const series = [];

  for (const date of allDates) {
    while (portfolioIndex < portfolioSeries.length && portfolioSeries[portfolioIndex].date <= date) {
      latestPortfolio = portfolioSeries[portfolioIndex].value;
      portfolioIndex += 1;
    }

    while (benchmarkIndex < benchmarkSeries.length && benchmarkSeries[benchmarkIndex].date <= date) {
      latestBenchmark = benchmarkSeries[benchmarkIndex].value;
      benchmarkIndex += 1;
    }

    if (date < commonStartDate || latestPortfolio === null || latestBenchmark === null) {
      continue;
    }

    if (basePortfolio === null) {
      basePortfolio = latestPortfolio;
    }

    if (baseBenchmark === null) {
      baseBenchmark = latestBenchmark;
    }

    const portfolioReturn = roundPercent(latestPortfolio - basePortfolio);
    const benchmarkReturn = roundPercent(latestBenchmark - baseBenchmark);

    series.push({
      date,
      portfolioReturn,
      benchmarkReturn,
      excessReturn: roundPercent(portfolioReturn - benchmarkReturn)
    });
  }

  return series;
}

function buildPortfolioPerformanceSeries(rows) {
  const eligibleRows = rows.filter((row) => Array.isArray(row.navHistory) && row.navHistory.length > 1);

  if (!eligibleRows.length) {
    return [];
  }

  const allDates = Array.from(new Set(eligibleRows.flatMap((row) => row.navHistory.map((point) => point.date)))).sort();
  const series = [];
  const pointsByRow = eligibleRows.map((row) => ({
    row,
    history: [...row.navHistory].sort((left, right) => left.date.localeCompare(right.date)),
    historyIndex: 0,
    latestClose: null
  }));

  for (const date of allDates) {
    let totalProfitEuros = 0;
    let hasValue = false;

    for (const pointState of pointsByRow) {
      while (
        pointState.historyIndex < pointState.history.length &&
        pointState.history[pointState.historyIndex].date <= date
      ) {
        pointState.latestClose = pointState.history[pointState.historyIndex].close;
        pointState.historyIndex += 1;
      }

      if (pointState.latestClose === null) {
        continue;
      }

      hasValue = true;
      totalProfitEuros += (pointState.row.sharesValue * pointState.latestClose) - pointState.row.totalInvestedValue;
    }

    if (hasValue) {
      series.push({
        date,
        value: roundPercent((totalProfitEuros / Math.max(eligibleRows.reduce((sum, row) => sum + row.totalInvestedValue, 0), 1)) * 100)
      });
    }
  }

  return series;
}

function normalizeBenchmarkSeries(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return [];
  }

  const firstClose = points[0]?.close;

  if (!Number.isFinite(firstClose) || firstClose <= 0) {
    return [];
  }

  return points.map((point) => ({
    date: point.date,
    value: roundPercent(((point.close - firstClose) / firstClose) * 100)
  }));
}

function buildBenchmarkSnapshot(label, comparisonSeries, range) {
  const subset = sliceSeriesForRange(comparisonSeries, range);

  if (subset.length < 2) {
    return null;
  }

  const portfolioReturn = subset.at(-1).portfolioReturn - subset[0].portfolioReturn;
  const benchmarkReturn = subset.at(-1).benchmarkReturn - subset[0].benchmarkReturn;

  return {
    label,
    portfolioReturn: roundPercent(portfolioReturn),
    benchmarkReturn: roundPercent(benchmarkReturn),
    excessReturn: roundPercent(portfolioReturn - benchmarkReturn)
  };
}

function sliceSeriesForRange(series, range) {
  if (range === 'all') {
    return series;
  }

  const lastDate = new Date(`${series.at(-1)?.date}T00:00:00`);
  if (Number.isNaN(lastDate.getTime())) {
    return series;
  }

  let threshold = new Date(0);

  if (range === 'ytd') {
    threshold = new Date(lastDate.getFullYear(), 0, 1);
  } else if (typeof range === 'number') {
    threshold = new Date(lastDate);
    threshold.setDate(threshold.getDate() - range);
  }

  return series.filter((point) => new Date(`${point.date}T00:00:00`) >= threshold);
}

function normalizeIsoDate(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function countDisplayedDecimals(value) {
  if (!value || typeof value !== 'string') {
    return 0;
  }

  const normalized = value.replace(/[^\d,.\-]/g, '');
  const separatorIndex = Math.max(normalized.lastIndexOf(','), normalized.lastIndexOf('.'));
  return separatorIndex >= 0 ? normalized.length - separatorIndex - 1 : 0;
}

function countDecimals(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const serialized = value.toString();
  const dotIndex = serialized.indexOf('.');
  return dotIndex >= 0 ? serialized.length - dotIndex - 1 : 0;
}

function parsePositionQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (!value || typeof value !== 'string') {
    return 0;
  }

  const sanitized = value.replace(/[^\d,.\-]/g, '').trim();

  if (!sanitized) {
    return 0;
  }

  const lastComma = sanitized.lastIndexOf(',');
  const lastDot = sanitized.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    const normalized = sanitized.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (lastComma > -1) {
    const normalized = sanitized.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (lastDot > -1) {
    const normalized = sanitized.replace(/,/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseEditableInput(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }

  if (typeof value !== 'string') {
    return NaN;
  }

  const sanitized = value.replace(/[^\d,.\-]/g, '').trim();

  if (!sanitized) {
    return NaN;
  }

  return parsePositionQuantity(sanitized);
}

function parseDisplayNumber(value) {
  return parsePositionQuantity(value);
}

function normalizePositionType(section, value) {
  const normalizedValue = String(value ?? '').trim();

  if (/^acci[óoÃ\?]n$/i.test(normalizedValue) || /^acci.n$/i.test(normalizedValue)) {
    return 'Acción';
  }

  if (normalizedValue) {
    return normalizedValue;
  }

  return section === 'ACCIONES' ? 'Acción' : '';
}

function normalizeInvestmentClass(value) {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || undefined;
}

function normalizeEditableField(value) {
  return value === 'shares' || value === 'totalInvested' || value === 'investmentClass' || value === 'type' || value === 'currency'
    ? value
    : null;
}

function normalizeEditableValueInput(field, value) {
  if (field === 'investmentClass') {
    const normalizedClass = normalizeInvestmentClassInput(value);

    if (!normalizedClass) {
      throw new HttpError(400, 'Investment class is invalid');
    }

    return normalizedClass;
  }

  if (field === 'type') {
    const normalizedType = String(value ?? '').trim();

    if (!normalizedType) {
      throw new HttpError(400, 'Type is invalid');
    }

    return normalizedType;
  }

  if (field === 'currency') {
    const normalizedCurrency = String(value ?? '').trim().toUpperCase();

    if (!/^[A-Z]{3,5}$/.test(normalizedCurrency)) {
      throw new HttpError(400, 'Currency is invalid');
    }

    return normalizedCurrency;
  }

  const parsedValue = parseEditableInput(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new HttpError(400, 'Value must be a valid positive number');
  }

  return parsedValue;
}

function normalizeInvestmentClassInput(value) {
  const normalizedValue = String(value ?? '').trim();
  const allowedValues = new Set(['RF', 'RV', 'Mixto', 'Otro']);
  return allowedValues.has(normalizedValue) ? normalizedValue : null;
}

function normalizeCreateFundPayload(payload) {
  const totalInvestedValue = parseEditableInput(payload?.totalInvested);
  const sharesValue = parseEditableInput(payload?.shares);

  return {
    name: String(payload?.name ?? '').trim(),
    isin: String(payload?.isin ?? '')
      .trim()
      .toUpperCase(),
    type: String(payload?.type ?? '').trim(),
    currency: String(payload?.currency ?? '').trim().toUpperCase(),
    totalInvestedValue,
    sharesValue
  };
}

function normalizeOperationPayload(payload, asset) {
  const operationType = String(payload?.operationType ?? '').trim().toLowerCase();
  const validTypes = new Set(['buy', 'sell', 'dividend', 'fee']);

  if (!validTypes.has(operationType)) {
    throw new HttpError(400, 'Operation type is invalid');
  }

  const operationDate = normalizeIsoDate(String(payload?.operationDate ?? '').trim());

  if (!operationDate) {
    throw new HttpError(400, 'Operation date is invalid');
  }

  const quantity = payload?.quantity === '' || payload?.quantity === null || payload?.quantity === undefined
    ? null
    : parseEditableInput(payload.quantity);
  const unitPrice = payload?.unitPrice === '' || payload?.unitPrice === null || payload?.unitPrice === undefined
    ? null
    : parseEditableInput(payload.unitPrice);
  const amountInput = payload?.amount === '' || payload?.amount === null || payload?.amount === undefined
    ? null
    : parseEditableInput(payload.amount);
  const feeAmount = payload?.feeAmount === '' || payload?.feeAmount === null || payload?.feeAmount === undefined
    ? 0
    : parseEditableInput(payload.feeAmount);

  if (!Number.isFinite(feeAmount) || feeAmount < 0) {
    throw new HttpError(400, 'Fee amount is invalid');
  }

  if (operationType === 'buy' || operationType === 'sell') {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(400, 'Quantity must be a positive number');
    }

    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new HttpError(400, 'Unit price must be a positive number');
    }

    if (operationType === 'sell' && quantity > asset.sharesValue) {
      throw new HttpError(400, 'Cannot sell more shares than the current position');
    }

    return {
      operationType,
      operationDate,
      quantity: round(quantity, 6),
      unitPrice: roundMoney(unitPrice),
      amount: roundMoney(quantity * unitPrice),
      feeAmount: roundMoney(feeAmount),
      notes: String(payload?.notes ?? '').trim()
    };
  }

  if (!Number.isFinite(amountInput) || amountInput <= 0) {
    throw new HttpError(400, 'Amount must be a positive number');
  }

  return {
    operationType,
    operationDate,
    quantity: null,
    unitPrice: null,
    amount: roundMoney(amountInput),
    feeAmount: roundMoney(feeAmount),
    notes: String(payload?.notes ?? '').trim()
  };
}

function createFundRow(input) {
  const unitValueNumber = input.totalInvestedValue / input.sharesValue;
  const marketDate = new Date().toISOString().slice(0, 10);
  const derivedMetrics = buildDerivedMetrics({
    sharesValue: input.sharesValue,
    unitValueNumber,
    totalInvestedValue: input.totalInvestedValue
  });

  return {
    id: slugify(`FONDOS-${input.name}-${input.isin}-${Date.now()}`),
    section: 'FONDOS',
    assetKind: 'fund',
    name: input.name,
    isin: input.isin,
    ticker: undefined,
    symbol: undefined,
    performanceId: undefined,
    shares: formatEditableShares(input.sharesValue, String(input.sharesValue)),
    currency: input.currency,
    type: input.type,
    investmentClass: undefined,
    totalInvested: formatCurrency(input.totalInvestedValue),
    investedWeight: formatPercent(0),
    marketDate,
    unitValue: formatNumber(unitValueNumber, Math.max(4, countDecimals(unitValueNumber))),
    totalValuation: derivedMetrics.totalValuation,
    profitEuros: derivedMetrics.profitEuros,
    valuationWeight: formatPercent(0),
    totalReturn: derivedMetrics.totalReturn,
    totalInvestedValue: roundMoney(input.totalInvestedValue),
    totalValuationValue: derivedMetrics.totalValuationValue,
    profitEurosValue: derivedMetrics.profitEurosValue,
    totalReturnValue: derivedMetrics.totalReturnValue,
    sharesValue: input.sharesValue,
    unitValueNumber,
    navHistory: undefined
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createOperationId() {
  return slugify(`op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function formatEditableShares(value, currentDisplayValue) {
  const digits = Math.max(countDisplayedDecimals(currentDisplayValue), countDecimals(value));
  return formatNumber(value, digits);
}

function buildDerivedMetrics(row) {
  const totalValuationValue = roundMoney((row.sharesValue ?? 0) * (row.unitValueNumber ?? 0));
  const profitEurosValue = roundMoney(totalValuationValue - (row.totalInvestedValue ?? 0));
  const totalReturnValue =
    row.totalInvestedValue > 0 ? roundPercent((profitEurosValue / row.totalInvestedValue) * 100) : 0;

  return {
    totalValuationValue,
    totalValuation: formatCurrency(totalValuationValue),
    profitEurosValue,
    profitEuros: formatCurrency(profitEurosValue),
    totalReturnValue,
    totalReturn: formatPercent(totalReturnValue)
  };
}

function roundMoney(value) {
  return round(value, 2);
}

function roundNumber(value, digits = 6) {
  return round(value, digits);
}

function roundPercent(value) {
  return round(value, 2);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms))
  ]);
}

module.exports = { PortfolioQueryService };
