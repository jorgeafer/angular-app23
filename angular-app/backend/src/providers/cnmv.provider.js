const { HttpError } = require('../errors/http-error');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Origin': 'https://www.cnmv.es',
  'Referer': 'https://www.cnmv.es/'
};

// ── Public interface ──────────────────────────────────────────────────────────

class CnmvProvider {
  async getFundSnapshot(request) {
    const isin = request.idType === 'isin' ? request.id : null;

    if (!isin) {
      throw new HttpError(400, 'CNMV: se requiere ISIN para consultar datos de fondo');
    }

    const history = await this.fetchNavHistory(isin);
    const latestPoint = history.at(-1);

    if (!latestPoint) {
      throw new HttpError(404, `CNMV: sin datos VL para ${isin}`);
    }

    return {
      assetType: 'fund',
      requestedId: request.id,
      resolvedId: isin,
      resolvedIdType: 'isin',
      name: request.name,
      isin,
      nav: latestPoint.close,
      navDate: latestPoint.date,
      dailyPerformance: history,
      topHoldings: [],
      geographicExposure: [],
      annualReturns: [],
      trailingReturns: {},
      portfolioBreakdown: {},
      riskIndicator: {}
    };
  }

  // Devuelve todos los intentos con su resultado para el endpoint de debug
  async debugAllEndpoints(isin) {
    const endDate = today();
    const startDate = daysAgo(30);
    const results = {};

    // Intento 1: API REST CNMV (apied.cnmv.es)
    results.apiRest = await this.tryApiRest(isin, startDate, endDate);

    // Intento 2: Export CSV estadísticas (www.cnmv.es)
    results.csvExport = await this.tryCsvExport(isin, startDate, endDate);

    // Intento 3: API pública de datos abiertos CNMV
    results.datosAbiertos = await this.tryDatosAbiertos(isin);

    return results;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  async fetchNavHistory(isin) {
    const endDate = today();
    const startDate = daysAgo(30);

    // Intento 1: API REST moderna de CNMV
    const apiResult = await this.tryApiRest(isin, startDate, endDate);
    if (apiResult.ok && apiResult.history?.length > 0) return apiResult.history;

    // Intento 2: Export CSV de estadísticas
    const csvResult = await this.tryCsvExport(isin, startDate, endDate);
    if (csvResult.ok && csvResult.history?.length > 0) return csvResult.history;

    // Intento 3: Datos abiertos CNMV
    const daResult = await this.tryDatosAbiertos(isin);
    if (daResult.ok && daResult.history?.length > 0) return daResult.history;

    return [];
  }

  async tryApiRest(isin, startDate, endDate) {
    // API EdificioTech de CNMV — endpoint para valores liquidativos
    // Documentación: https://apied.cnmv.es/
    const url = [
      'https://apied.cnmv.es/EdificioTech/api/v1/iic/valoresliquidativos',
      `?isin=${encodeURIComponent(isin)}`,
      `&fechaDesde=${startDate}`,
      `&fechaHasta=${endDate}`
    ].join('');

    return this.tryFetch(url, 'apiRest', (data) => {
      // Posibles formatos de respuesta: array de {fecha, vl} o {data: [...]}
      const rows = Array.isArray(data) ? data : (data?.data ?? data?.valores ?? data?.items ?? []);
      return rows
        .map((r) => ({
          date: parseIsoOrEs(r.fecha ?? r.date ?? r.navDate ?? r.Date),
          close: parseFloat(r.vl ?? r.nav ?? r.valor ?? r.VL ?? r.Nav)
        }))
        .filter((p) => p.date && Number.isFinite(p.close))
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  async tryCsvExport(isin, startDate, endDate) {
    // Export CSV estadísticas CNMV
    const fechaInicio = isoToEs(startDate);
    const fechaFin = isoToEs(endDate);
    const url = [
      'https://www.cnmv.es/datosgenerales/exportacion/VL_exportacion.aspx',
      `?isin=${encodeURIComponent(isin)}`,
      `&fechaInicio=${encodeURIComponent(fechaInicio)}`,
      `&fechaFin=${encodeURIComponent(fechaFin)}`
    ].join('');

    return this.tryFetchText(url, 'csvExport', (text) => {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return [];

      // Formato CSV CNMV: ISIN;Nombre;Fecha;VL;Patrimonio (separador ; o ,)
      const sep = lines[0].includes(';') ? ';' : ',';
      return lines
        .slice(1)
        .map((line) => {
          const cols = line.split(sep).map((c) => c.replace(/"/g, '').trim());
          // Buscar columna de fecha (DD/MM/YYYY) y VL
          const fecha = cols.find((c) => /^\d{2}\/\d{2}\/\d{4}$/.test(c));
          const vl = cols.find((c) => /^\d+[,.]?\d*$/.test(c) && parseFloat(c.replace(',', '.')) > 1);
          return {
            date: fecha ? esDateToIso(fecha) : null,
            close: vl ? parseFloat(vl.replace(',', '.')) : NaN
          };
        })
        .filter((p) => p.date && Number.isFinite(p.close))
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  async tryDatosAbiertos(isin) {
    // Portal de datos abiertos CNMV — endpoint alternativo
    const url = [
      'https://www.cnmv.es/datosgenerales/exportacion/ListaIIC_exportacion.aspx',
      `?isin=${encodeURIComponent(isin)}&tipo=FI`
    ].join('');

    return this.tryFetchText(url, 'datosAbiertos', (text) => {
      // Este endpoint devuelve datos del fondo, no el VL histórico
      // Si llega aquí, al menos confirma que el ISIN existe en CNMV
      return [];
    });
  }

  async tryFetch(url, label, parser) {
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(12000)
      });

      if (response.status === 404) {
        return { ok: false, label, status: 404, error: 'CNMV: recurso no encontrado' };
      }

      if (!response.ok) {
        return { ok: false, label, status: response.status, error: `CNMV HTTP ${response.status}` };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const data = contentType.includes('json')
        ? await response.json()
        : await response.text();

      const history = parser(data);
      return { ok: true, label, status: response.status, history, latestPoint: history.at(-1) };
    } catch (error) {
      return { ok: false, label, error: error.message };
    }
  }

  async tryFetchText(url, label, parser) {
    try {
      const response = await fetch(url, {
        headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' },
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        return { ok: false, label, status: response.status, error: `CNMV HTTP ${response.status}` };
      }

      const text = await response.text();
      const history = parser(text);
      return { ok: true, label, status: response.status, history, latestPoint: history.at(-1), rawPreview: text.slice(0, 500) };
    } catch (error) {
      return { ok: false, label, error: error.message };
    }
  }
}

// ── Helpers de fecha ──────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoToEs(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function esDateToIso(es) {
  const [d, m, y] = es.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseIsoOrEs(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return esDateToIso(str);
  return null;
}

module.exports = { CnmvProvider };
