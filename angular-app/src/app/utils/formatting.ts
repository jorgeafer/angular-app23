export function formatDateEs(value?: string | null): string {
  if (!value) {
    return '';
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

export function formatCurrencyEs(value: number, currency = 'EUR', digits = 2): string {
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${formatDecimalEs(value, digits)} ${symbol}`;
}

export function formatDecimalEs(value: number, digits = 2): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const fixed = absolute.toFixed(digits);
  const [integerPart, decimalPart] = fixed.split('.');
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  if (digits === 0) {
    return `${sign}${groupedInteger}`;
  }

  return `${sign}${groupedInteger},${decimalPart}`;
}

export function formatPercentEs(value: number, digits = 2): string {
  return `${formatDecimalEs(value, digits)}%`;
}

export function normalizeNumericString(value?: string | null, digits = 2): string {
  if (!value) {
    return '';
  }

  const parsed = parseLooseNumber(value);
  return parsed === null ? value : formatDecimalEs(parsed, digits);
}

export function normalizeCurrencyString(value?: string | null, currency = 'EUR', digits = 2): string {
  if (!value) {
    return '';
  }

  const parsed = parseLooseNumber(value);
  return parsed === null ? value : formatCurrencyEs(parsed, currency, digits);
}

export function normalizePercentString(value?: string | null, digits = 2): string {
  if (!value) {
    return '';
  }

  const parsed = parseLooseNumber(value);
  return parsed === null ? value : formatPercentEs(parsed, digits);
}

export function parseLooseNumber(value: string): number | null {
  const cleaned = value.replace(/[^\d,.\-]/g, '').trim();

  if (!cleaned) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;

  let normalized = cleaned;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';

    normalized = cleaned.split(thousandsSeparator).join('');
    normalized = normalized.replace(decimalSeparator, '.');
  } else if (commaCount > 0) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (dotCount > 1) {
    const lastDot = cleaned.lastIndexOf('.');
    normalized = `${cleaned.slice(0, lastDot).replace(/\./g, '')}.${cleaned.slice(lastDot + 1)}`;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
