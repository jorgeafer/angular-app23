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

    // Intento 1: API REST CNMV (apied.cnmv.es) — bloqueada desde Vercel
    results.apiRest = await this.tryApiRest(isin, startDate, endDate);

    // Intento 2: Export CSV estadísticas (www.cnmv.es)
    results.csvExport = await this.tryCsvExport(isin, startDate, endDate);

    // Intento 3: datos.cnmv.es — portal CKAN de datos abiertos (subdominio distinto)
    results.datosAbiertosApi = await this.tryDatosAbiertosApi(isin);

    // Intento 4: www.cnmv.es portal paths — varias rutas candidatas
    results.portalPaths = await this.tryPortalPaths(isin);

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

    // Intento 3: CKAN datos abiertos
    const ckanResult = await this.tryDatosAbiertosApi(isin);
    if (ckanResult.ok && ckanResult.history?.length > 0) return ckanResult.history;

    return [];
  }

  async tryApiRest(isin, startDate, endDate) {
    // API EdificioTech de CNMV — bloqueada desde Vercel (falla a nivel TCP/DNS)
    const url = [
      'https://apied.cnmv.es/EdificioTech/api/v1/iic/valoresliquidativos',
      `?isin=${encodeURIComponent(isin)}`,
      `&fechaDesde=${startDate}`,
      `&fechaHasta=${endDate}`
    ].join('');

    return this.tryFetch(url, 'apiRest', (data) => {
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

      const sep = lines[0].includes(';') ? ';' : ',';
      return lines
        .slice(1)
        .map((line) => {
          const cols = line.split(sep).map((c) => c.replace(/"/g, '').trim());
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

  // Portal CKAN de datos abiertos en datos.cnmv.es (subdominio distinto a www y apied)
  async tryDatosAbiertosApi(isin) {
    const label = 'datosAbiertosApi';

    // Paso 1: buscar datasets con "valor liquidativo" en el catálogo CKAN
    try {
      const searchUrl = 'https://datos.cnmv.es/api/3/action/package_search?q=valor+liquidativo+iic&rows=10';
      const searchResp = await fetch(searchUrl, {
        headers: { ...HEADERS, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000)
      });

      if (!searchResp.ok) {
        return { ok: false, label, status: searchResp.status, error: `CKAN package_search HTTP ${searchResp.status}` };
      }

      const searchData = await searchResp.json();
      const datasets = searchData?.result?.results ?? [];

      if (datasets.length === 0) {
        return {
          ok: false, label,
          error: 'No hay datasets VL en CKAN',
          ckanReachable: true,
          rawPreview: JSON.stringify(searchData).slice(0, 300)
        };
      }

      // Resumen de datasets encontrados
      const datasetSummary = datasets.map((d) => ({
        name: d.name,
        title: d.title,
        resources: (d.resources ?? []).map((r) => ({ id: r.id, name: r.name, format: r.format }))
      }));

      // Paso 2: intentar consultar el primer dataset por ISIN si tiene resources
      const firstDataset = datasets[0];
      const firstResource = firstDataset?.resources?.[0];

      if (!firstResource?.id) {
        return { ok: false, label, ckanReachable: true, datasetsFound: datasetSummary };
      }

      const queryUrl = [
        `https://datos.cnmv.es/api/3/action/datastore_search`,
        `?resource_id=${encodeURIComponent(firstResource.id)}`,
        `&q=${encodeURIComponent(isin)}`,
        `&limit=30`
      ].join('');

      const queryResp = await fetch(queryUrl, {
        headers: { ...HEADERS, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000)
      });

      if (!queryResp.ok) {
        return {
          ok: false, label,
          ckanReachable: true,
          datasetsFound: datasetSummary,
          datastoreStatus: queryResp.status,
          error: `CKAN datastore_search HTTP ${queryResp.status}`
        };
      }

      const queryData = await queryResp.json();
      const records = queryData?.result?.records ?? [];

      // Intentar parsear los registros como historial de VL
      const history = records
        .map((r) => {
          const dateRaw = r.FECHA ?? r.fecha ?? r.Date ?? r.date;
          const vlRaw = r.VL ?? r.vl ?? r.valor ?? r.NAV ?? r.nav;
          return {
            date: parseIsoOrEs(dateRaw),
            close: parseFloat(String(vlRaw ?? '').replace(',', '.'))
          };
        })
        .filter((p) => p.date && Number.isFinite(p.close))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        ok: true,
        label,
        ckanReachable: true,
        datasetsFound: datasetSummary,
        resourceUsed: { id: firstResource.id, name: firstResource.name },
        recordCount: records.length,
        history,
        sampleRecords: records.slice(0, 3),
        latestPoint: history.at(-1)
      };
    } catch (error) {
      return { ok: false, label, error: error.message };
    }
  }

  // Prueba varias rutas del portal www.cnmv.es para ver cuáles responden con 200
  async tryPortalPaths(isin) {
    const label = 'portalPaths';
    const candidates = [
      // Rutas portal moderno
      `/portal/Consultas/IIC/IICIndividual.aspx?isin=${encodeURIComponent(isin)}`,
      `/portal/inversor/iic/IICIndividual.aspx?isin=${encodeURIComponent(isin)}`,
      // Rutas export alternativas
      `/portal/Estadisticas/IIC/DatosBasicosExport.aspx?isin=${encodeURIComponent(isin)}`,
      `/portal/Consultas/IIC/DatosEconomicos.aspx?isin=${encodeURIComponent(isin)}`,
      // Rutas antiguas sin /portal/
      `/Portal/Inversor/IIC/IICIndividual.aspx?isin=${encodeURIComponent(isin)}`,
      `/Portal/Estadisticas/IIC/Detalle.aspx?isin=${encodeURIComponent(isin)}`
    ];

    const pathResults = [];
    for (const path of candidates) {
      const url = `https://www.cnmv.es${path}`;
      try {
        const resp = await fetch(url, {
          headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow'
        });
        pathResults.push({
          path,
          status: resp.status,
          ok: resp.ok,
          contentType: resp.headers.get('content-type'),
          finalUrl: resp.url !== url ? resp.url : undefined
        });
      } catch (e) {
        pathResults.push({ path, error: e.message });
      }
    }

    const anyOk = pathResults.some((r) => r.ok);
    return { ok: anyOk, label, paths: pathResults };
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
