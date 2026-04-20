const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PortfolioRepository } = require('../db/portfolio.repository');

class PortfolioImportService {
  constructor(repository = new PortfolioRepository()) {
    this.repository = repository;
    this.workbookPath = path.resolve(process.cwd(), 'información financiera.xlsx');
  }

  async initialize() {
    await this.repository.initialize();
    await this.syncFromExcelIfNeeded();
  }

  async syncFromExcelIfNeeded(force = false) {
    if (!this.hasWorkbook()) {
      return {
        imported: false,
        sourceMissing: true
      };
    }

    const stat = fs.statSync(this.workbookPath);
    const sourceMtime = String(stat.mtimeMs);
    const storedMtime = await this.repository.getMetadata('source_mtime_ms');

    if (!force && storedMtime === sourceMtime) {
      return { imported: false };
    }

    const dataset = this.readWorkbook();

    await this.repository.clearPortfolio();

    for (const section of dataset.sections) {
      for (const row of section.rows) {
        await this.repository.upsertPosition(row);
      }

      if (section.totals) {
        await this.repository.upsertSectionTotals({
          section: section.title,
          ...section.totals
        });
      }
    }

    await this.repository.setMetadata('source_mtime_ms', sourceMtime);
    await this.repository.setMetadata('last_imported_at', new Date().toISOString());

    return { imported: true, positions: dataset.rows.length };
  }

  hasWorkbook() {
    return fs.existsSync(this.workbookPath);
  }

  readWorkbook() {
    const workbook = XLSX.readFile(this.workbookPath, { cellDates: true });
    const sheet = workbook.Sheets['Cartera'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

    const sections = [];
    let currentSection = null;

    for (const row of rows.slice(1)) {
      const cells = normalizeRow(row);
      const label = cells[0].trim().toUpperCase();

      if (!cells.some((cell) => cell !== '')) {
        continue;
      }

      if (label === 'FONDOS' || label === 'ACCIONES') {
        currentSection = {
          title: label,
          rows: [],
          totals: null
        };
        sections.push(currentSection);
        continue;
      }

      if (!currentSection) {
        continue;
      }

      if (label === 'TOTALES') {
        currentSection.totals = createTotals(cells);
        continue;
      }

      currentSection.rows.push(createRow(currentSection.title, cells));
    }

    return {
      lastUpdated: getLastUpdated(sections.flatMap((section) => section.rows)),
      sections,
      rows: sections.flatMap((section) => section.rows)
    };
  }
}

function createRow(section, cells) {
  const isin = cells[1];
  const ticker = section === 'ACCIONES' ? inferTicker(cells[0], isin) : undefined;

  return {
    id: slugify(`${section}-${cells[0]}-${cells[1] || 'sin-isin'}-${cells[7]}`),
    section,
    assetKind: section === 'FONDOS' ? 'fund' : 'equity',
    name: cells[0],
    isin,
    ticker,
    symbol: ticker,
    performanceId: undefined,
    shares: cells[2],
    currency: cells[3],
    type: normalizePositionType(section, cells[4]),
    investmentClass: undefined,
    totalInvested: cells[5],
    investedWeight: cells[6],
    marketDate: cells[7],
    unitValue: cells[8],
    totalValuation: cells[9],
    profitEuros: cells[10],
    valuationWeight: cells[11],
    totalReturn: cells[12],
    totalInvestedValue: parseLocalizedNumber(cells[5]),
    totalValuationValue: parseLocalizedNumber(cells[9]),
    profitEurosValue: parseLocalizedNumber(cells[10]),
    totalReturnValue: parseLocalizedNumber(cells[12]),
    sharesValue: parseQuantityNumber(cells[2]),
    unitValueNumber: parseLocalizedNumber(cells[8])
  };
}

function createTotals(cells) {
  return {
    totalInvested: cells[5],
    totalValuation: cells[9],
    profitEuros: cells[10],
    totalReturn: cells[12],
    totalInvestedValue: parseLocalizedNumber(cells[5]),
    totalValuationValue: parseLocalizedNumber(cells[9]),
    profitEurosValue: parseLocalizedNumber(cells[10]),
    totalReturnValue: parseLocalizedNumber(cells[12])
  };
}

function normalizeRow(row) {
  const normalized = [...row].slice(0, 13);

  while (normalized.length < 13) {
    normalized.push('');
  }

  return normalized.map((cell) => String(cell ?? '').trim());
}

function parseLocalizedNumber(value) {
  return parseFlexibleNumber(value);
}

function parseQuantityNumber(value) {
  return parseFlexibleNumber(value);
}

function parseFlexibleNumber(value) {
  if (!value) {
    return 0;
  }

  const sanitized = String(value).replace(/[^0-9,.-]/g, '').trim();

  if (!sanitized) {
    return 0;
  }

  const commaCount = (sanitized.match(/,/g) || []).length;
  const dotCount = (sanitized.match(/\./g) || []).length;
  let normalized = sanitized;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = sanitized.lastIndexOf(',');
    const lastDot = sanitized.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = sanitized.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
  } else if (commaCount > 0) {
    normalized = sanitized.replace(/\./g, '').replace(',', '.');
  } else if (dotCount > 1) {
    const lastDot = sanitized.lastIndexOf('.');
    normalized = `${sanitized.slice(0, lastDot).replace(/\./g, '')}.${sanitized.slice(lastDot + 1)}`;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getLastUpdated(rows) {
  return rows
    .map((row) => row.marketDate)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] ?? '';
}

function inferTicker(name, isin) {
  if (isin === 'ES0146309002' || /santander/i.test(name)) {
    return 'SAN';
  }

  return undefined;
}

function normalizePositionType(section, type) {
  const normalizedType = String(type ?? '').trim();

  if (/^acci[óoÃ\?]n$/i.test(normalizedType) || /^acci.n$/i.test(normalizedType)) {
    return 'Acción';
  }

  if (normalizedType) {
    return normalizedType;
  }

  return section === 'ACCIONES' ? 'Acción' : '';
}

module.exports = { PortfolioImportService };
