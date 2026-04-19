const { HttpError } = require('../errors/http-error');
const { PortfolioRepository } = require('../db/portfolio.repository');
const { YahooFinanceService } = require('./yahoo-finance.service');

class PortfolioQueryService {
  constructor(repository = new PortfolioRepository(), yahooFinanceService = new YahooFinanceService()) {
    this.repository = repository;
    this.yahooFinanceService = yahooFinanceService;
    this.yahooSnapshotCache = new Map();
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

    const sections = await this.buildSections(positionRows.map(mapPositionRow), asOfDate);

    const rows = sections.flatMap((section) => section.rows);
    const portfolioTotal = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);

    return {
      lastUpdated: rows
        .map((row) => row.marketDate)
        .filter(Boolean)
        .sort((left, right) => right.localeCompare(left))[0] ?? '',
      lastImportedAt,
      sections,
      rows,
      summaryByType: buildSummary(rows, (row) => row.type || 'Sin tipo'),
      summaryByAsset: [...rows]
        .sort((left, right) => right.totalValuationValue - left.totalValuationValue)
        .slice(0, 8)
        .map((row) => ({
          label: row.name,
          value: row.totalValuationValue,
          formattedValue: formatCurrency(row.totalValuationValue),
          percentage: computePercentage(row.totalValuationValue, portfolioTotal)
        }))
    };
  }

  async getAssetById(id) {
    const rows = await this.repository.getPositions();
    const sections = await this.buildSections(rows.map(mapPositionRow));
    return sections.flatMap((section) => section.rows).find((row) => row.id === id) ?? null;
  }

  async updateAssetValue(id, payload = {}) {
    const storedRow = await this.repository.getPositionById(id);

    if (!storedRow) {
      throw new HttpError(404, 'Asset not found');
    }

    const row = mapPositionRow(storedRow);

    if (row.section !== 'FONDOS') {
      throw new HttpError(400, 'Only fund positions can be edited');
    }

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

    return ['FONDOS', 'ACCIONES'].map((sectionName) => {
      const sectionRows = recalculateSectionRows(enrichedRows.filter((row) => row.section === sectionName));
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
        const snapshot = await this.getFundSnapshot(lookup);
        return snapshot ? applyFundSnapshot(row, snapshot, asOfDate) : row;
      }

      const snapshot = await this.getEquitySnapshot(lookup);
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
    totalValuation: normalizedFundMetrics?.totalValuation ?? row.total_valuation,
    profitEuros: normalizedFundMetrics?.profitEuros ?? row.profit_euros,
    totalReturn: normalizedFundMetrics?.totalReturn ?? row.total_return,
    navHistory: undefined
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
  return value === 'shares' || value === 'totalInvested' || value === 'investmentClass' ? value : null;
}

function normalizeEditableValueInput(field, value) {
  if (field === 'investmentClass') {
    const normalizedClass = normalizeInvestmentClassInput(value);

    if (!normalizedClass) {
      throw new HttpError(400, 'Investment class is invalid');
    }

    return normalizedClass;
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

function roundPercent(value) {
  return round(value, 2);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

module.exports = { PortfolioQueryService };
