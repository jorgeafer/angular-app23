import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  PortfolioAlert,
  PortfolioAnalyticsOverview,
  PortfolioBenchmarkSeriesPoint,
  PortfolioBenchmarkOverview,
  CreateFundPayload,
  CreateEquityPayload,
  EditablePortfolioField,
  PortfolioRefreshResult,
  PortfolioImportPreview,
  PortfolioNavPoint,
  PortfolioDataset,
  PortfolioQualityOverview,
  PortfolioRow,
  PortfolioSection,
  PortfolioSummaryItem,
  PortfolioTotals
} from '../models/portfolio.models';
import { PortfolioDataService } from '../services/portfolio-data.service';
import { formatCurrencyEs, formatDateEs, formatDecimalEs, formatPercentEs, parseLooseNumber } from '../utils/formatting';

type SortField =
  | 'name'
  | 'type'
  | 'marketDate'
  | 'totalInvestedValue'
  | 'totalValuationValue'
  | 'profitEurosValue'
  | 'totalReturnValue';

type PortfolioTrendRange = '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | 'all';
type PortfolioTrendScope = 'all' | 'funds' | 'equities';
type ComparatorSide = 'left' | 'right';

@Component({
  selector: 'app-portfolio-home',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './portfolio-home.component.html',
  styleUrl: './portfolio-home.component.css'
})
export class PortfolioHomeComponent implements OnInit, OnDestroy {
  protected readonly formatDateEs = formatDateEs;
  protected readonly investmentClassOptions = ['RF', 'RV', 'Mixto', 'Otro'];
  protected readonly currencyOptions = ['EUR', 'USD', 'GBP', 'CHF'];
  protected readonly portfolioTrendRanges: Array<{ key: PortfolioTrendRange; label: string }> = [
    { key: '1m', label: 'Ultimo mes' },
    { key: '3m', label: '3 meses' },
    { key: '6m', label: '6 meses' },
    { key: 'ytd', label: 'YTD' },
    { key: '1y', label: '1 ano' },
    { key: '3y', label: '3 anos' },
    { key: 'all', label: 'Todo' }
  ];
  protected readonly portfolioTrendScopes: Array<{ key: PortfolioTrendScope; label: string }> = [
    { key: 'all', label: 'Todo' },
    { key: 'funds', label: 'Fondos' },
    { key: 'equities', label: 'Acciones' }
  ];
  protected readonly tableHeaders = [
    'Activo',
    'ISIN',
    'Participaciones',
    'Moneda',
    'Tipo',
    'Total invertido',
    'Peso invertido',
    'Fecha',
    'Valor',
    'Valoracion total',
    'Rentabilidad EUR',
    'Peso valoracion',
    'Rentabilidad total'
  ];

  protected isLoading = true;
  protected errorMessage = '';
  protected pageTitle = 'Mi cartera';
  protected pageEyebrow = 'Cartera financiera';
  protected pageDescription = 'Consulta toda la informacion de tu cartera desde un unico lugar.';
  protected portfolioKey = 'main';
  protected detailRoutePrefix = '/activo';
  protected showDevaLink = false;
  protected showMainLink = false;
  protected devaLink = '/deva';
  protected mainLink = '/';
  protected activeTab: 'posiciones' | 'resumen' = 'posiciones';
  protected searchTerm = '';
  protected selectedType = 'TODOS';
  protected selectedDate = '';
  protected appliedDate = '';
  protected selectedPortfolioTrendRange: PortfolioTrendRange = 'ytd';
  protected selectedPortfolioTrendScope: PortfolioTrendScope = 'all';
  protected selectedBenchmarkRange: PortfolioTrendRange = 'ytd';
  protected sortField: SortField = 'totalValuationValue';
  protected sortDirection: 'asc' | 'desc' = 'desc';
  protected lastUpdated = '';
  protected portfolioTotals: PortfolioTotals | null = null;
  protected filteredSections: PortfolioSection[] = [];
  protected summaryByType: PortfolioSummaryItem[] = [];
  protected summaryByAsset: PortfolioSummaryItem[] = [];
  protected summaryByCurrency: PortfolioSummaryItem[] = [];
  protected summaryByClass: PortfolioSummaryItem[] = [];
  protected summaryBySector: PortfolioSummaryItem[] = [];
  protected summaryByCountry: PortfolioSummaryItem[] = [];
  protected summaryByManager: PortfolioSummaryItem[] = [];
  protected alerts: PortfolioAlert[] = [];
  protected benchmarkOverview: PortfolioBenchmarkOverview | null = null;
  protected analytics: PortfolioAnalyticsOverview = {
    topHoldingName: '-',
    topHoldingWeight: 0,
    topFiveWeight: 0,
    bestPerformerName: '-',
    bestPerformerValue: 0,
    worstPerformerName: '-',
    worstPerformerValue: 0,
    topContributorName: '-',
    topContributorValue: 0,
    annualizedPortfolioReturn: 0,
    positiveCount: 0,
    negativeCount: 0,
    staleCount: 0,
    missingIdentifierCount: 0,
    missingHistoryCount: 0
  };
  protected quality: PortfolioQualityOverview = {
    score: 100,
    staleCount: 0,
    missingIdentifierCount: 0,
    missingHistoryCount: 0
  };
  protected availableTypes: string[] = [];
  protected importPreview: PortfolioImportPreview | null = null;
  protected isImportPreviewLoading = false;
  protected isImportingWorkbook = false;
  protected importActionMessage = '';
  protected importActionError = '';
  protected selectedImportFile: File | null = null;
  protected selectedComparatorLeftId = '';
  protected selectedComparatorRightId = '';
  protected isFundEditMode = false;
  protected isAddFundModalOpen = false;
  protected isCreatingFund = false;
  protected isDeleteFundModalOpen = false;
  protected isDeletingFund = false;
  protected createFundErrorMessage = '';
  protected deleteFundErrorMessage = '';
  protected fundPendingDeletion: PortfolioRow | null = null;
  protected isRefreshingPrices = false;
  protected refreshPricesMessage = '';
  protected refreshPricesError = '';
  protected isEquityEditMode = false;
  protected isAddEquityModalOpen = false;
  protected isCreatingEquity = false;
  protected isDeleteEquityModalOpen = false;
  protected isDeletingEquity = false;
  protected createEquityErrorMessage = '';
  protected deleteEquityErrorMessage = '';
  protected equityPendingDeletion: PortfolioRow | null = null;
  protected editingCell: { rowId: string; field: EditablePortfolioField; draftValue: string } | null = null;
  protected savingCellKey = '';
  protected newFundForm: CreateFundPayload = this.createEmptyFundForm();
  protected newEquityForm: CreateEquityPayload = this.createEmptyEquityForm();
  protected portfolioTrendHoveredPointIndex: number | null = null;
  protected benchmarkHoveredPointIndex: number | null = null;

  private sourceDataset: PortfolioDataset | null = null;
  private displayDataset: PortfolioDataset | null = null;
  private allowedSections: Array<PortfolioSection['title']> = ['FONDOS', 'ACCIONES'];

  constructor(
    private readonly portfolioDataService: PortfolioDataService,
    private readonly route: ActivatedRoute
  ) {}

  private readonly onRefreshPricesEvent = () => this.refreshPrices();

  async ngOnInit(): Promise<void> {
    const routeData = this.route.snapshot.data;
    this.pageTitle = routeData['pageTitle'] ?? this.pageTitle;
    this.pageEyebrow = routeData['pageEyebrow'] ?? this.pageEyebrow;
    this.pageDescription = routeData['pageDescription'] ?? this.pageDescription;
    this.portfolioKey = routeData['portfolioKey'] ?? this.portfolioKey;
    this.detailRoutePrefix = routeData['detailRoutePrefix'] ?? this.detailRoutePrefix;
    this.showDevaLink = routeData['showDevaLink'] ?? this.showDevaLink;
    this.showMainLink = routeData['showMainLink'] ?? this.showMainLink;
    this.allowedSections = routeData['allowedSections'] ?? this.allowedSections;
    window.addEventListener('portfolio:refreshPrices', this.onRefreshPricesEvent);
    await this.loadPortfolio();
  }

  ngOnDestroy(): void {
    window.removeEventListener('portfolio:refreshPrices', this.onRefreshPricesEvent);
  }

  protected trackBySection(_: number, section: PortfolioSection): string {
    return section.title;
  }

  protected trackByRow(_: number, row: PortfolioRow): string {
    return row.id;
  }

  protected getDetailRoute(row: PortfolioRow): string[] {
    return [this.detailRoutePrefix, row.id];
  }

  protected updateFilters(): void {
    if (!this.displayDataset) {
      return;
    }

    this.filteredSections = this.displayDataset.sections
      .filter((section) => this.allowedSections.includes(section.title))
      .map((section) => ({
        ...section,
        rows: this.sortRows(this.filterRows(section.rows))
      }));
  }

  protected setActiveTab(tab: 'posiciones' | 'resumen'): void {
    this.activeTab = tab;
  }

  protected sortBy(field: SortField): void {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = field === 'name' || field === 'type' || field === 'marketDate' ? 'asc' : 'desc';
    }

    this.updateFilters();
  }

  protected getSectionTotalRows(section: PortfolioSection): number {
    return section.rows.length;
  }

  protected getBarWidth(item: PortfolioSummaryItem): string {
    return `${Math.max(item.percentage, 3)}%`;
  }

  protected formatPercentage(value: number, digits = 1): string {
    return `${new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(value)}%`;
  }

  protected formatSignedPercentage(value: number, digits = 2): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${this.formatPercentage(value, digits)}`;
  }

  protected formatSignedCurrency(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${formatCurrencyEs(value)}`;
  }

  protected getSummaryAssetRow(label: string): PortfolioRow | undefined {
    return this.displayDataset?.rows.find((row) => row.name === label);
  }

  protected getAlertSeverityClass(severity: PortfolioAlert['severity']): string {
    return `alert-card--${severity}`;
  }

  protected getQualityTone(score: number): 'positive' | 'negative' | '' {
    if (score >= 85) {
      return 'positive';
    }

    if (score <= 60) {
      return 'negative';
    }

    return '';
  }

  protected setPortfolioTrendRange(range: PortfolioTrendRange): void {
    this.selectedPortfolioTrendRange = range;
    this.portfolioTrendHoveredPointIndex = null;
  }

  protected setPortfolioTrendScope(scope: PortfolioTrendScope): void {
    this.selectedPortfolioTrendScope = scope;
    this.portfolioTrendHoveredPointIndex = null;
  }

  protected setBenchmarkRange(range: PortfolioTrendRange): void {
    this.selectedBenchmarkRange = range;
    this.benchmarkHoveredPointIndex = null;
  }

  protected get hasPortfolioTrend(): boolean {
    return this.portfolioTrendPoints.length > 1;
  }

  protected get portfolioTrendPoints(): Array<{ date: string; profitEuros: number; x: number; y: number }> {
    const points = this.filteredPortfolioTrendSeries;

    if (!points.length) {
      return [];
    }

    const values = points.map((point) => point.profitEuros);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return points.map((point, index) => ({
      ...point,
      x: (index / Math.max(points.length - 1, 1)) * 100,
      y: 100 - ((point.profitEuros - min) / range) * 100
    }));
  }

  protected get portfolioTrendPolylinePoints(): string {
    return this.portfolioTrendPoints
      .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');
  }

  protected get portfolioTrendHoveredPoint(): { date: string; profitEuros: number; x: number; y: number } | null {
    if (this.portfolioTrendHoveredPointIndex === null) {
      return null;
    }

    return this.portfolioTrendPoints[this.portfolioTrendHoveredPointIndex] ?? null;
  }

  protected get portfolioTrendTooltipLeft(): number {
    const point = this.portfolioTrendHoveredPoint;
    return point ? Math.min(Math.max(point.x, 12), 88) : 50;
  }

  protected get portfolioTrendTooltipTop(): number {
    const point = this.portfolioTrendHoveredPoint;
    return point ? Math.max(point.y, 18) : 50;
  }

  protected get portfolioTrendValueLabel(): string {
    const points = this.filteredPortfolioTrendSeries;
    return points.length ? formatCurrencyEs(points[points.length - 1].profitEuros) : formatCurrencyEs(0);
  }

  protected get portfolioTrendSummaryValue(): number {
    return this.portfolioTrendHoveredPoint?.profitEuros ?? this.filteredPortfolioTrendSeries.at(-1)?.profitEuros ?? 0;
  }

  protected get portfolioTrendSummaryDateLabel(): string {
    const date = this.portfolioTrendHoveredPoint?.date;
    return date ? formatDateEs(date) : this.portfolioTrendDateRangeLabel;
  }

  protected formatPortfolioTrendValue(value: number): string {
    return formatCurrencyEs(value);
  }

  protected get portfolioTrendDateRangeLabel(): string {
    const points = this.filteredPortfolioTrendSeries;

    if (points.length < 2) {
      return '';
    }

    return `${formatDateEs(points[0].date)} - ${formatDateEs(points[points.length - 1].date)}`;
  }

  protected get portfolioTrendYTicks(): string[] {
    const values = this.filteredPortfolioTrendSeries.map((point) => point.profitEuros);

    if (!values.length) {
      return [];
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const steps = 4;

    return Array.from({ length: steps + 1 }, (_, index) => formatCurrencyEs(max - ((max - min) / steps) * index));
  }

  protected get portfolioTrendXTicks(): Array<{ label: string; position: number }> {
    const points = this.filteredPortfolioTrendSeries;

    if (points.length < 2) {
      return [];
    }

    const indexes = Array.from(
      new Set([
        0,
        Math.floor((points.length - 1) * 0.25),
        Math.floor((points.length - 1) * 0.5),
        Math.floor((points.length - 1) * 0.75),
        points.length - 1
      ])
    );

    return indexes.map((index) => ({
      label: formatDateEs(points[index].date),
      position: points.length === 1 ? 0 : (index / (points.length - 1)) * 100
    }));
  }

  protected onPortfolioTrendHover(event: MouseEvent): void {
    const currentTarget = event.currentTarget;

    if (!(currentTarget instanceof HTMLElement)) {
      return;
    }

    const rect = currentTarget.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const points = this.portfolioTrendPoints;

    if (!points.length) {
      this.portfolioTrendHoveredPointIndex = null;
      return;
    }

    const index = Math.round((relativeX / Math.max(rect.width, 1)) * (points.length - 1));
    this.portfolioTrendHoveredPointIndex = Math.min(Math.max(index, 0), points.length - 1);
  }

  protected onPortfolioTrendLeave(): void {
    this.portfolioTrendHoveredPointIndex = null;
  }

  protected get hasBenchmarkTrend(): boolean {
    return this.benchmarkChartPoints.portfolio.length > 1 && this.benchmarkChartPoints.benchmark.length > 1;
  }

  protected get benchmarkChartPoints(): {
    portfolio: Array<{ date: string; value: number; x: number; y: number }>;
    benchmark: Array<{ date: string; value: number; x: number; y: number }>;
  } {
    const points = this.filteredBenchmarkSeries;

    if (!points.length) {
      return { portfolio: [], benchmark: [] };
    }

    const values = points.flatMap((point) => [point.portfolioReturn, point.benchmarkReturn]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return {
      portfolio: points.map((point, index) => ({
        date: point.date,
        value: point.portfolioReturn,
        x: (index / Math.max(points.length - 1, 1)) * 100,
        y: 100 - ((point.portfolioReturn - min) / range) * 100
      })),
      benchmark: points.map((point, index) => ({
        date: point.date,
        value: point.benchmarkReturn,
        x: (index / Math.max(points.length - 1, 1)) * 100,
        y: 100 - ((point.benchmarkReturn - min) / range) * 100
      }))
    };
  }

  protected get benchmarkPortfolioPolylinePoints(): string {
    return this.benchmarkChartPoints.portfolio.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  }

  protected get benchmarkReferencePolylinePoints(): string {
    return this.benchmarkChartPoints.benchmark.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  }

  protected get benchmarkHoveredPoint(): PortfolioBenchmarkSeriesPoint | null {
    if (this.benchmarkHoveredPointIndex === null) {
      return null;
    }

    return this.filteredBenchmarkSeries[this.benchmarkHoveredPointIndex] ?? null;
  }

  protected get benchmarkHoveredMarkerPosition():
    | { portfolioY: number; benchmarkY: number; x: number }
    | null {
    if (this.benchmarkHoveredPointIndex === null) {
      return null;
    }

    const portfolioPoint = this.benchmarkChartPoints.portfolio[this.benchmarkHoveredPointIndex];
    const benchmarkPoint = this.benchmarkChartPoints.benchmark[this.benchmarkHoveredPointIndex];

    if (!portfolioPoint || !benchmarkPoint) {
      return null;
    }

    return {
      x: portfolioPoint.x,
      portfolioY: portfolioPoint.y,
      benchmarkY: benchmarkPoint.y
    };
  }

  protected get benchmarkTooltipLeft(): number {
    const point = this.benchmarkHoveredMarkerPosition;
    return point ? Math.min(Math.max(point.x, 14), 86) : 50;
  }

  protected get benchmarkTooltipTop(): number {
    const point = this.benchmarkHoveredMarkerPosition;

    if (!point) {
      return 50;
    }

    return Math.max(Math.min(point.portfolioY, point.benchmarkY), 18);
  }

  protected get benchmarkSummaryDateLabel(): string {
    const date = this.benchmarkHoveredPoint?.date;
    return date ? formatDateEs(date) : this.benchmarkDateRangeLabel;
  }

  protected get benchmarkSummaryPortfolioValue(): number {
    return this.benchmarkHoveredPoint?.portfolioReturn ?? this.filteredBenchmarkSeries.at(-1)?.portfolioReturn ?? 0;
  }

  protected get benchmarkSummaryReferenceValue(): number {
    return this.benchmarkHoveredPoint?.benchmarkReturn ?? this.filteredBenchmarkSeries.at(-1)?.benchmarkReturn ?? 0;
  }

  protected get benchmarkSummaryExcessValue(): number {
    return this.benchmarkHoveredPoint?.excessReturn ?? this.filteredBenchmarkSeries.at(-1)?.excessReturn ?? 0;
  }

  protected get benchmarkDateRangeLabel(): string {
    const points = this.filteredBenchmarkSeries;

    if (points.length < 2) {
      return '';
    }

    return `${formatDateEs(points[0].date)} - ${formatDateEs(points[points.length - 1].date)}`;
  }

  protected get benchmarkYTicks(): string[] {
    const values = this.filteredBenchmarkSeries.flatMap((point) => [point.portfolioReturn, point.benchmarkReturn]);

    if (!values.length) {
      return [];
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const steps = 4;

    return Array.from({ length: steps + 1 }, (_, index) => formatPercentEs(max - ((max - min) / steps) * index));
  }

  protected get benchmarkXTicks(): Array<{ label: string; position: number }> {
    const points = this.filteredBenchmarkSeries;

    if (points.length < 2) {
      return [];
    }

    const indexes = Array.from(
      new Set([
        0,
        Math.floor((points.length - 1) * 0.25),
        Math.floor((points.length - 1) * 0.5),
        Math.floor((points.length - 1) * 0.75),
        points.length - 1
      ])
    );

    return indexes.map((index) => ({
      label: formatDateEs(points[index].date),
      position: points.length === 1 ? 0 : (index / (points.length - 1)) * 100
    }));
  }

  protected onBenchmarkHover(event: MouseEvent): void {
    const currentTarget = event.currentTarget;

    if (!(currentTarget instanceof HTMLElement)) {
      return;
    }

    const rect = currentTarget.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const points = this.filteredBenchmarkSeries;

    if (!points.length) {
      this.benchmarkHoveredPointIndex = null;
      return;
    }

    const index = Math.round((relativeX / Math.max(rect.width, 1)) * (points.length - 1));
    this.benchmarkHoveredPointIndex = Math.min(Math.max(index, 0), points.length - 1);
  }

  protected onBenchmarkLeave(): void {
    this.benchmarkHoveredPointIndex = null;
  }

  protected get hasPendingDateChange(): boolean {
    return this.selectedDate !== this.appliedDate;
  }

  protected get comparatorRows(): PortfolioRow[] {
    return [...(this.displayDataset?.rows ?? [])].sort((left, right) => right.totalValuationValue - left.totalValuationValue);
  }

  protected get comparatorLeftRow(): PortfolioRow | null {
    return this.comparatorRows.find((row) => row.id === this.selectedComparatorLeftId) ?? null;
  }

  protected get comparatorRightRow(): PortfolioRow | null {
    return this.comparatorRows.find((row) => row.id === this.selectedComparatorRightId) ?? null;
  }

  protected get temporalMetrics(): {
    investedCapital: number;
    currentProfit: number;
    monthChange: number;
    ytdChange: number;
    maxDrawdown: number;
    annualizedVolatility: number;
    growthShare: number;
  } {
    const series = this.filteredPortfolioTrendSeries;
    const currentProfit = series.at(-1)?.profitEuros ?? 0;
    const investedCapital = series.at(-1)?.totalInvested ?? this.getPortfolioTrendRows().reduce((sum, row) => sum + row.totalInvestedValue, 0);
    const valuationSeries = series.map((point) => point.totalValuation);
    const monthSeries = this.sliceTrendSeriesByRange(series, '1m');
    const ytdSeries = this.sliceTrendSeriesByRange(series, 'ytd');

    return {
      investedCapital,
      currentProfit,
      monthChange: this.computeTrendDelta(monthSeries),
      ytdChange: this.computeTrendDelta(ytdSeries),
      maxDrawdown: this.computeMaxDrawdown(valuationSeries),
      annualizedVolatility: this.computeAnnualizedVolatility(valuationSeries),
      growthShare: investedCapital + currentProfit > 0
        ? this.round((currentProfit / (investedCapital + currentProfit)) * 100, 2)
        : 0
    };
  }

  protected get monthlySnapshots(): Array<{ label: string; profitEuros: number; delta: number }> {
    const series = this.filteredPortfolioTrendSeries;

    if (!series.length) {
      return [];
    }

    const grouped = new Map<string, { date: string; profitEuros: number }>();

    for (const point of series) {
      const key = point.date.slice(0, 7);
      grouped.set(key, { date: point.date, profitEuros: point.profitEuros });
    }

    const monthEndPoints = Array.from(grouped.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([, value]) => value)
      .slice(-6);

    return monthEndPoints.map((point, index) => ({
      label: formatDateEs(point.date).slice(3),
      profitEuros: point.profitEuros,
      delta: index === 0 ? 0 : this.round(point.profitEuros - monthEndPoints[index - 1].profitEuros, 2)
    }));
  }

  protected updateComparatorSelection(side: ComparatorSide, nextId: string): void {
    if (side === 'left') {
      this.selectedComparatorLeftId = nextId;

      if (nextId && nextId === this.selectedComparatorRightId) {
        this.selectedComparatorRightId = this.comparatorRows.find((row) => row.id !== nextId)?.id ?? '';
      }

      return;
    }

    this.selectedComparatorRightId = nextId;

    if (nextId && nextId === this.selectedComparatorLeftId) {
      this.selectedComparatorLeftId = this.comparatorRows.find((row) => row.id !== nextId)?.id ?? '';
    }
  }

  protected onImportFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedImportFile = input.files?.[0] ?? null;
    this.importActionMessage = '';
    this.importActionError = '';
  }

  protected async runWorkbookImport(): Promise<void> {
    if (this.isImportingWorkbook || !this.selectedImportFile) {
      return;
    }

    this.importActionMessage = '';
    this.importActionError = '';
    this.isImportingWorkbook = true;

    try {
      const result = await this.portfolioDataService.importPortfolio(this.selectedImportFile, this.portfolioKey);
      this.selectedImportFile = null;

      if (result.sourceMissing) {
        this.importActionError = 'No se encontro el fichero base para importar en este entorno.';
        return;
      }

      await this.loadPortfolio(true);
      this.importActionMessage = result.imported
        ? `Importacion completada con ${result.positions ?? 0} posiciones actualizadas.`
        : 'No habia cambios nuevos que aplicar en la importacion.';
    } catch (error) {
      this.importActionError = error instanceof Error ? error.message : 'No se pudo sincronizar el Excel.';
    } finally {
      this.isImportingWorkbook = false;
    }
  }

  protected async toggleFundEditMode(): Promise<void> {
    if (this.isFundEditMode) {
      await this.commitPendingCellEdit();
      this.editingCell = null;
      this.savingCellKey = '';
      this.closeDeleteFundModal();
    }

    this.isFundEditMode = !this.isFundEditMode;
  }

  protected openAddFundModal(): void {
    this.createFundErrorMessage = '';
    this.newFundForm = this.createEmptyFundForm();
    this.isAddFundModalOpen = true;
  }

  protected closeAddFundModal(): void {
    if (this.isCreatingFund) {
      return;
    }

    this.isAddFundModalOpen = false;
    this.createFundErrorMessage = '';
    this.newFundForm = this.createEmptyFundForm();
  }

  protected openDeleteFundModal(row: PortfolioRow, event?: Event): void {
    event?.stopPropagation();
    this.deleteFundErrorMessage = '';
    this.fundPendingDeletion = row;
    this.isDeleteFundModalOpen = true;
  }

  protected closeDeleteFundModal(): void {
    if (this.isDeletingFund) {
      return;
    }

    this.isDeleteFundModalOpen = false;
    this.deleteFundErrorMessage = '';
    this.fundPendingDeletion = null;
  }

  protected async confirmDeleteFund(): Promise<void> {
    if (!this.fundPendingDeletion) {
      return;
    }

    this.isDeletingFund = true;
    this.deleteFundErrorMessage = '';

    try {
      await this.portfolioDataService.deleteFund(this.fundPendingDeletion.id, this.portfolioKey);
      this.isDeleteFundModalOpen = false;
      this.fundPendingDeletion = null;
      await this.loadPortfolio(true);
    } catch (error) {
      this.deleteFundErrorMessage = error instanceof Error ? error.message : 'No se pudo eliminar el fondo.';
    } finally {
      this.isDeletingFund = false;
    }
  }

  protected updateNewFundField(field: keyof CreateFundPayload, value: string): void {
    this.newFundForm = {
      ...this.newFundForm,
      [field]: value
    };
  }

  protected async submitNewFund(): Promise<void> {
    const payload = {
      name: this.newFundForm.name.trim(),
      isin: this.newFundForm.isin.trim().toUpperCase(),
      type: this.newFundForm.type.trim(),
      currency: this.newFundForm.currency.trim().toUpperCase(),
      totalInvested: this.newFundForm.totalInvested.trim(),
      shares: this.newFundForm.shares.trim()
    };

    if (!payload.name || !payload.isin || !payload.type || !payload.currency || !payload.totalInvested || !payload.shares) {
      this.createFundErrorMessage = 'Completa todos los campos para añadir el fondo.';
      return;
    }

    this.isCreatingFund = true;
    this.createFundErrorMessage = '';

    try {
      await this.portfolioDataService.createFund(payload, this.portfolioKey);
      this.isAddFundModalOpen = false;
      this.createFundErrorMessage = '';
      this.newFundForm = this.createEmptyFundForm();
      await this.loadPortfolio(true);
    } catch (error) {
      this.createFundErrorMessage = error instanceof Error ? error.message : 'No se pudo añadir el fondo.';
    } finally {
      this.isCreatingFund = false;
    }
  }

  protected async refreshPrices(): Promise<void> {
    if (this.isRefreshingPrices) return;

    this.isRefreshingPrices = true;
    this.refreshPricesMessage = '';
    this.refreshPricesError = '';
    window.dispatchEvent(new CustomEvent('portfolio:refreshState', { detail: { isRefreshing: true } }));

    try {
      const result = await this.portfolioDataService.refreshPrices(this.portfolioKey);
      this.refreshPricesMessage = `Actualizado: ${result.updatedCount} posiciones. ${result.failedCount > 0 ? result.failedCount + ' sin datos de mercado.' : ''}`;
      await this.loadPortfolio(true);
    } catch (error) {
      this.refreshPricesError = error instanceof Error ? error.message : 'No se pudo actualizar los precios.';
    } finally {
      this.isRefreshingPrices = false;
      window.dispatchEvent(new CustomEvent('portfolio:refreshState', { detail: { isRefreshing: false } }));
    }
  }

  protected isEditMode(sectionTitle: string): boolean {
    if (sectionTitle === 'FONDOS') return this.isFundEditMode;
    if (sectionTitle === 'ACCIONES') return this.isEquityEditMode;
    return false;
  }

  protected async toggleEquityEditMode(): Promise<void> {
    if (this.isEquityEditMode) {
      await this.commitPendingCellEdit();
      this.editingCell = null;
      this.savingCellKey = '';
      this.closeDeleteEquityModal();
    }

    this.isEquityEditMode = !this.isEquityEditMode;
  }

  protected openAddEquityModal(): void {
    this.createEquityErrorMessage = '';
    this.newEquityForm = this.createEmptyEquityForm();
    this.isAddEquityModalOpen = true;
  }

  protected closeAddEquityModal(): void {
    if (this.isCreatingEquity) return;
    this.isAddEquityModalOpen = false;
    this.createEquityErrorMessage = '';
    this.newEquityForm = this.createEmptyEquityForm();
  }

  protected updateNewEquityField(field: keyof CreateEquityPayload, value: string): void {
    this.newEquityForm = { ...this.newEquityForm, [field]: value };
  }

  protected async submitNewEquity(): Promise<void> {
    const payload: CreateEquityPayload = {
      name: this.newEquityForm.name.trim(),
      ticker: this.newEquityForm.ticker.trim().toUpperCase(),
      isin: this.newEquityForm.isin.trim().toUpperCase(),
      currency: this.newEquityForm.currency.trim().toUpperCase(),
      totalInvested: this.newEquityForm.totalInvested.trim(),
      shares: this.newEquityForm.shares.trim()
    };

    if (!payload.name || !payload.ticker || !payload.currency || !payload.totalInvested || !payload.shares) {
      this.createEquityErrorMessage = 'Completa los campos obligatorios para añadir la acción.';
      return;
    }

    this.isCreatingEquity = true;
    this.createEquityErrorMessage = '';

    try {
      await this.portfolioDataService.createEquity(payload, this.portfolioKey);
      this.isAddEquityModalOpen = false;
      this.newEquityForm = this.createEmptyEquityForm();
      await this.loadPortfolio(true);
    } catch (error) {
      this.createEquityErrorMessage = error instanceof Error ? error.message : 'No se pudo añadir la acción.';
    } finally {
      this.isCreatingEquity = false;
    }
  }

  protected openDeleteEquityModal(row: PortfolioRow, event?: Event): void {
    event?.stopPropagation();
    this.deleteEquityErrorMessage = '';
    this.equityPendingDeletion = row;
    this.isDeleteEquityModalOpen = true;
  }

  protected closeDeleteEquityModal(): void {
    if (this.isDeletingEquity) return;
    this.isDeleteEquityModalOpen = false;
    this.deleteEquityErrorMessage = '';
    this.equityPendingDeletion = null;
  }

  protected async confirmDeleteEquity(): Promise<void> {
    if (!this.equityPendingDeletion) return;

    this.isDeletingEquity = true;
    this.deleteEquityErrorMessage = '';

    try {
      await this.portfolioDataService.deleteFund(this.equityPendingDeletion.id, this.portfolioKey);
      this.isDeleteEquityModalOpen = false;
      this.equityPendingDeletion = null;
      await this.loadPortfolio(true);
    } catch (error) {
      this.deleteEquityErrorMessage = error instanceof Error ? error.message : 'No se pudo eliminar la acción.';
    } finally {
      this.isDeletingEquity = false;
    }
  }

  protected isEditingCell(rowId: string, field: EditablePortfolioField): boolean {
    return this.editingCell?.rowId === rowId && this.editingCell.field === field;
  }

  protected startEditingCell(row: PortfolioRow, field: EditablePortfolioField, event?: Event): void {
    event?.stopPropagation();

    this.editingCell = {
      rowId: row.id,
      field,
      draftValue: this.getEditableFieldValue(row, field)
    };
  }

  protected cancelEditingCell(): void {
    this.editingCell = null;
  }

  protected updateEditingValue(value: string): void {
    if (!this.editingCell) {
      return;
    }

    this.editingCell = {
      ...this.editingCell,
      draftValue: value
    };
  }

  protected isSavingCell(rowId: string, field: EditablePortfolioField): boolean {
    return this.savingCellKey === this.getCellKey(rowId, field);
  }

  protected async saveEditingCell(row: PortfolioRow, field: EditablePortfolioField, event?: Event): Promise<void> {
    event?.stopPropagation();

    if (!this.editingCell || !this.isEditingCell(row.id, field)) {
      return;
    }

    await this.commitEditingCell(row.id, field, this.editingCell.draftValue);
  }

  private async commitEditingCell(rowId: string, field: EditablePortfolioField, draftValue: string): Promise<void> {
    const value = draftValue.trim();

    if (!value) {
      this.errorMessage = 'El valor no puede estar vacio.';
      return;
    }

    this.savingCellKey = this.getCellKey(rowId, field);
    this.errorMessage = '';

    try {
      await this.portfolioDataService.updateAssetValue(rowId, field, value, this.portfolioKey);
      this.applyEditedValueLocally(rowId, field, value);
      this.editingCell = null;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo guardar el cambio.';
    } finally {
      this.savingCellKey = '';
    }
  }

  private async commitPendingCellEdit(): Promise<void> {
    if (!this.editingCell) {
      return;
    }

    const { rowId, field, draftValue } = this.editingCell;
    await this.commitEditingCell(rowId, field, draftValue);
  }

  protected async applySelectedDate(): Promise<void> {
    this.appliedDate = this.selectedDate;
    this.applyDateToDataset();
  }

  protected clearSelectedDate(): void {
    if (!this.selectedDate) {
      return;
    }

    this.selectedDate = '';
    this.appliedDate = '';
    this.applyDateToDataset();
  }

  private async loadImportPreview(): Promise<void> {
    this.isImportPreviewLoading = true;

    try {
      this.importPreview = await this.portfolioDataService.getImportPreview(this.portfolioKey);
    } catch {
      this.importPreview = null;
    } finally {
      this.isImportPreviewLoading = false;
    }
  }

  private async loadPortfolio(forceRefresh = false): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const datasetPromise = forceRefresh
        ? this.portfolioDataService.refreshPortfolio(this.portfolioKey)
        : this.portfolioDataService.getPortfolio(this.portfolioKey);

      const [dataset] = await Promise.all([datasetPromise, this.loadImportPreview()]);
      this.sourceDataset = dataset;
      this.availableTypes = ['TODOS', ...new Set(this.sourceDataset.rows.map((row) => row.type).filter(Boolean))];
      this.applyDateToDataset();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Error desconocido al cargar la cartera.';
    } finally {
      this.isLoading = false;
    }
  }

  private applyDateToDataset(): void {
    if (!this.sourceDataset) {
      return;
    }

    this.displayDataset = this.appliedDate
      ? this.recalculateDatasetForDate(this.sourceDataset, this.appliedDate)
      : this.cloneDataset(this.sourceDataset);

    this.lastUpdated = this.displayDataset.lastUpdated;
    this.portfolioTotals = this.buildTotals(this.displayDataset.rows);
    this.summaryByType = this.displayDataset.summaryByType;
    this.summaryByAsset = this.displayDataset.summaryByAsset;
    this.summaryBySector = this.displayDataset.summaryBySector;
    this.summaryByCountry = this.displayDataset.summaryByCountry;
    this.summaryByManager = this.displayDataset.summaryByManager;
    this.summaryByCurrency = this.displayDataset.summaryByCurrency;
    this.summaryByClass = this.displayDataset.summaryByClass;
    this.alerts = this.displayDataset.alerts;
    this.benchmarkOverview = this.displayDataset.benchmarkOverview;
    this.analytics = this.displayDataset.analytics;
    this.quality = this.displayDataset.quality;
    this.ensureComparatorSelection();
    this.updateFilters();
  }

  private recalculateDatasetForDate(dataset: PortfolioDataset, asOfDate: string): PortfolioDataset {
    const recalculatedRows = dataset.sections.flatMap((section) => section.rows.map((row) => this.recalculateRowForDate(row, asOfDate)));
    const rows = this.applyPortfolioInsightMetrics(recalculatedRows);
    const sections = dataset.sections.map((section) => {
      const sectionRows = rows.filter((row) => row.section === section.title);
      return {
        ...section,
        rows: sectionRows,
        totals: this.buildTotals(sectionRows)
      };
    });
    const portfolioTotal = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);

    return {
      ...dataset,
      lastUpdated:
        rows
          .map((row) => row.marketDate)
          .filter(Boolean)
          .sort((left, right) => this.compareDateStrings(right, left))[0] ?? '',
      sections,
      rows,
      summaryByType: this.buildSummary(rows, (row) => row.type || 'Sin tipo'),
      summaryBySector: this.buildSummary(rows, (row) => row.sector || (row.section === 'FONDOS' ? row.categoryName || 'Sin categoria' : 'Sin sector')),
      summaryByCountry: this.buildSummary(rows, (row) => row.country || 'Sin pais'),
      summaryByManager: this.buildSummary(rows, (row) => row.managerName || (row.section === 'ACCIONES' ? 'Directa' : 'Sin gestora')),
      summaryByCurrency: this.buildSummary(rows, (row) => row.currency || 'Sin divisa'),
      summaryByClass: this.buildSummary(rows, (row) => row.investmentClass || 'Sin clase'),
      summaryByAsset: [...rows]
        .sort((left, right) => right.totalValuationValue - left.totalValuationValue)
        .slice(0, 8)
        .map((row) => ({
          label: row.name,
          value: row.totalValuationValue,
          formattedValue: formatCurrencyEs(row.totalValuationValue),
          percentage: portfolioTotal > 0 ? (row.totalValuationValue / portfolioTotal) * 100 : 0
        })),
      alerts: dataset.alerts.map((item) => ({ ...item })),
      benchmarkOverview: dataset.benchmarkOverview
        ? {
            ...dataset.benchmarkOverview,
            series: (dataset.benchmarkOverview.series ?? []).map((item) => ({ ...item })),
            snapshots: dataset.benchmarkOverview.snapshots.map((item) => ({ ...item }))
          }
        : null,
      analytics: { ...dataset.analytics },
      quality: { ...dataset.quality }
    };
  }

  private recalculateRowForDate(row: PortfolioRow, asOfDate: string): PortfolioRow {
    if (!row.navHistory?.length) {
      return { ...row };
    }

    const selectedPoint = this.resolveNavPoint(row.navHistory, asOfDate);

    if (!selectedPoint) {
      return { ...row };
    }

    const unitValueNumber = selectedPoint.close;
    const totalValuationValue = this.round(row.sharesValue * unitValueNumber, 2);
    const profitEurosValue = this.round(totalValuationValue - row.totalInvestedValue, 2);
    const totalReturnValue = row.totalInvestedValue > 0 ? this.round((profitEurosValue / row.totalInvestedValue) * 100, 2) : 0;

    return {
      ...row,
      marketDate: this.formatUiDate(selectedPoint.date),
      unitValueNumber,
      unitValue: formatDecimalEs(unitValueNumber, this.resolveUnitDigits(row, unitValueNumber)),
      totalValuationValue,
      totalValuation: formatCurrencyEs(totalValuationValue),
      profitEurosValue,
      profitEuros: formatCurrencyEs(profitEurosValue),
      totalReturnValue,
      totalReturn: formatPercentEs(totalReturnValue)
    };
  }

  private resolveNavPoint(navHistory: NonNullable<PortfolioRow['navHistory']>, asOfDate: string) {
    const targetDate = this.toIsoDate(asOfDate);

    for (let index = navHistory.length - 1; index >= 0; index -= 1) {
      if (navHistory[index].date <= targetDate) {
        return navHistory[index];
      }
    }

    return null;
  }

  private get filteredPortfolioTrendSeries(): Array<{ date: string; profitEuros: number; totalValuation: number; totalInvested: number }> {
    const rows = this.getPortfolioTrendRows();

    if (!rows.length) {
      return [];
    }

    const allDates = Array.from(
      new Set(
        rows.flatMap((row) => (row.navHistory ?? []).map((point) => point.date))
      )
    ).sort((left, right) => left.localeCompare(right));

    if (!allDates.length) {
      return [];
    }

    const lastDate = new Date(`${allDates[allDates.length - 1]}T00:00:00`);
    const startDate = this.resolveTrendStartDate(lastDate, this.selectedPortfolioTrendRange);
    const totalInvested = this.round(rows.reduce((sum, row) => sum + row.totalInvestedValue, 0), 2);
    const pointsByRow = rows.map((row) => ({
      row,
      history: [...(row.navHistory ?? [])].sort((left, right) => left.date.localeCompare(right.date)),
      historyIndex: 0,
      latestClose: null as number | null
    }));

    const series: Array<{ date: string; profitEuros: number; totalValuation: number; totalInvested: number }> = [];

    for (const date of allDates) {
      const currentDate = new Date(`${date}T00:00:00`);

      if (currentDate < startDate) {
        for (const pointState of pointsByRow) {
          while (
            pointState.historyIndex < pointState.history.length &&
            pointState.history[pointState.historyIndex].date <= date
          ) {
            pointState.latestClose = pointState.history[pointState.historyIndex].close;
            pointState.historyIndex += 1;
          }
        }

        continue;
      }

      let totalProfitEuros = 0;
      let totalValuation = 0;
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
        const rowValuation = this.round(pointState.row.sharesValue * pointState.latestClose, 2);
        totalValuation += rowValuation;
        totalProfitEuros += this.round(rowValuation - pointState.row.totalInvestedValue, 2);
      }

      if (hasValue) {
        series.push({
          date,
          profitEuros: this.round(totalProfitEuros, 2),
          totalValuation: this.round(totalValuation, 2),
          totalInvested
        });
      }
    }

    return series;
  }

  private get filteredBenchmarkSeries(): PortfolioBenchmarkSeriesPoint[] {
    const points = this.benchmarkOverview?.series ?? [];

    if (!points.length) {
      return [];
    }

    const lastDate = new Date(`${points[points.length - 1].date}T00:00:00`);
    const startDate = this.resolveTrendStartDate(lastDate, this.selectedBenchmarkRange);

    return points.filter((point) => new Date(`${point.date}T00:00:00`) >= startDate);
  }

  private getPortfolioTrendRows(): PortfolioRow[] {
    const rows = this.sourceDataset?.rows ?? [];

    return rows.filter((row) => {
      if (!row.navHistory?.length) {
        return false;
      }

      if (this.selectedPortfolioTrendScope === 'funds') {
        return row.section === 'FONDOS';
      }

      if (this.selectedPortfolioTrendScope === 'equities') {
        return row.section === 'ACCIONES';
      }

      return true;
    });
  }

  private resolveTrendStartDate(lastDate: Date, range: PortfolioTrendRange): Date {
    switch (range) {
      case '1m':
        return this.subtractMonths(lastDate, 1);
      case '3m':
        return this.subtractMonths(lastDate, 3);
      case '6m':
        return this.subtractMonths(lastDate, 6);
      case 'ytd':
        return new Date(lastDate.getFullYear(), 0, 1);
      case '1y':
        return this.subtractYears(lastDate, 1);
      case '3y':
        return this.subtractYears(lastDate, 3);
      case 'all':
      default:
        return new Date(0);
    }
  }

  private sliceTrendSeriesByRange(
    series: Array<{ date: string; profitEuros: number; totalValuation: number; totalInvested: number }>,
    range: PortfolioTrendRange
  ): Array<{ date: string; profitEuros: number; totalValuation: number; totalInvested: number }> {
    if (range === 'all' || !series.length) {
      return series;
    }

    const lastDate = new Date(`${series[series.length - 1].date}T00:00:00`);
    const startDate = this.resolveTrendStartDate(lastDate, range);
    return series.filter((point) => new Date(`${point.date}T00:00:00`) >= startDate);
  }

  private computeTrendDelta(
    series: Array<{ date: string; profitEuros: number; totalValuation: number; totalInvested: number }>
  ): number {
    if (series.length < 2) {
      return 0;
    }

    return this.round(series[series.length - 1].profitEuros - series[0].profitEuros, 2);
  }

  private computeMaxDrawdown(valuationSeries: number[]): number {
    if (valuationSeries.length < 2) {
      return 0;
    }

    let peak = valuationSeries[0];
    let maxDrawdown = 0;

    for (const valuation of valuationSeries) {
      peak = Math.max(peak, valuation);

      if (peak <= 0) {
        continue;
      }

      const drawdown = ((valuation - peak) / peak) * 100;
      maxDrawdown = Math.min(maxDrawdown, drawdown);
    }

    return this.round(maxDrawdown, 2);
  }

  private computeAnnualizedVolatility(valuationSeries: number[]): number {
    if (valuationSeries.length < 3) {
      return 0;
    }

    const returns: number[] = [];

    for (let index = 1; index < valuationSeries.length; index += 1) {
      const previous = valuationSeries[index - 1];
      const current = valuationSeries[index];

      if (previous <= 0 || current <= 0) {
        continue;
      }

      returns.push((current - previous) / previous);
    }

    if (returns.length < 2) {
      return 0;
    }

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
    return this.round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
  }

  private buildTotals(rows: PortfolioRow[]): PortfolioSection['totals'] {
    if (!rows.length) {
      return null;
    }

    const totalInvestedValue = rows.reduce((sum, row) => sum + row.totalInvestedValue, 0);
    const totalValuationValue = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);
    const profitEurosValue = this.round(totalValuationValue - totalInvestedValue, 2);
    const totalReturnValue = totalInvestedValue > 0 ? this.round((profitEurosValue / totalInvestedValue) * 100, 2) : 0;

    const sectionTotalInvested = totalInvestedValue;
    const sectionTotalValuation = totalValuationValue;
    rows.forEach((row) => {
      row.investedWeight = sectionTotalInvested > 0
        ? formatPercentEs(this.round((row.totalInvestedValue / sectionTotalInvested) * 100, 2))
        : formatPercentEs(0);
      row.valuationWeight = sectionTotalValuation > 0
        ? formatPercentEs(this.round((row.totalValuationValue / sectionTotalValuation) * 100, 2))
        : formatPercentEs(0);
    });

    return {
      totalInvested: formatCurrencyEs(totalInvestedValue),
      totalValuation: formatCurrencyEs(totalValuationValue),
      profitEuros: formatCurrencyEs(profitEurosValue),
      totalReturn: formatPercentEs(totalReturnValue),
      totalInvestedValue,
      totalValuationValue,
      profitEurosValue,
      totalReturnValue
    };
  }

  private buildSummary(rows: PortfolioRow[], keySelector: (row: PortfolioRow) => string): PortfolioSummaryItem[] {
    const grouped = new Map<string, number>();

    for (const row of rows) {
      const key = keySelector(row);
      grouped.set(key, (grouped.get(key) ?? 0) + row.totalValuationValue);
    }

    const total = Array.from(grouped.values()).reduce((sum, value) => sum + value, 0);

    return Array.from(grouped.entries())
      .map(([label, value]) => ({
        label,
        value,
        formattedValue: formatCurrencyEs(value),
        percentage: total > 0 ? (value / total) * 100 : 0
      }))
      .sort((left, right) => right.value - left.value);
  }

  private ensureComparatorSelection(): void {
    const rows = this.comparatorRows;

    if (!rows.length) {
      this.selectedComparatorLeftId = '';
      this.selectedComparatorRightId = '';
      return;
    }

    const availableIds = new Set(rows.map((row) => row.id));

    if (!availableIds.has(this.selectedComparatorLeftId)) {
      this.selectedComparatorLeftId = rows[0]?.id ?? '';
    }

    if (!availableIds.has(this.selectedComparatorRightId) || this.selectedComparatorRightId === this.selectedComparatorLeftId) {
      this.selectedComparatorRightId = rows.find((row) => row.id !== this.selectedComparatorLeftId)?.id ?? '';
    }
  }

  private cloneDataset(dataset: PortfolioDataset): PortfolioDataset {
    return {
      ...dataset,
      sections: dataset.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) => ({ ...row, navHistory: row.navHistory ? [...row.navHistory] : undefined })),
        totals: section.totals ? { ...section.totals } : null
      })),
      rows: dataset.rows.map((row) => ({ ...row, navHistory: row.navHistory ? [...row.navHistory] : undefined })),
      summaryByType: dataset.summaryByType.map((item) => ({ ...item })),
      summaryByAsset: dataset.summaryByAsset.map((item) => ({ ...item })),
      summaryBySector: dataset.summaryBySector.map((item) => ({ ...item })),
      summaryByCountry: dataset.summaryByCountry.map((item) => ({ ...item })),
      summaryByManager: dataset.summaryByManager.map((item) => ({ ...item })),
      summaryByCurrency: dataset.summaryByCurrency.map((item) => ({ ...item })),
      summaryByClass: dataset.summaryByClass.map((item) => ({ ...item })),
      alerts: dataset.alerts.map((item) => ({ ...item })),
      benchmarkOverview: dataset.benchmarkOverview
        ? {
            ...dataset.benchmarkOverview,
            series: (dataset.benchmarkOverview.series ?? []).map((item) => ({ ...item })),
            snapshots: dataset.benchmarkOverview.snapshots.map((item) => ({ ...item }))
          }
        : null,
      analytics: { ...dataset.analytics },
      quality: { ...dataset.quality }
    };
  }

  private resolveUnitDigits(row: PortfolioRow, unitValueNumber: number): number {
    const currentDigits = this.resolveDisplayedDigits(row.unitValue);
    const numberDigits = this.countDecimals(unitValueNumber);
    return Math.max(4, currentDigits, numberDigits);
  }

  private resolveDisplayedDigits(value?: string): number {
    if (!value) {
      return 0;
    }

    const separatorIndex = Math.max(value.lastIndexOf('.'), value.lastIndexOf(','));
    return separatorIndex === -1 ? 0 : Math.min(Math.max(value.length - separatorIndex - 1, 0), 6);
  }

  private countDecimals(value: number): number {
    const text = value.toString();
    const dotIndex = text.indexOf('.');
    return dotIndex >= 0 ? text.length - dotIndex - 1 : 0;
  }

  private round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private subtractMonths(value: Date, months: number): Date {
    const next = new Date(value);
    next.setMonth(next.getMonth() - months);
    return next;
  }

  private subtractYears(value: Date, years: number): Date {
    const next = new Date(value);
    next.setFullYear(next.getFullYear() - years);
    return next;
  }

  private formatUiDate(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return year && month && day ? `${day}/${month}/${year}` : isoDate;
  }

  private toIsoDate(value: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const [day, month, year] = value.split('/');
    return day && month && year ? `${year}-${month}-${day}` : value;
  }

  private compareDateStrings(left: string, right: string): number {
    return this.toIsoDate(left).localeCompare(this.toIsoDate(right), 'es');
  }

  private filterRows(rows: PortfolioRow[]): PortfolioRow[] {
    const search = this.searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesType = this.selectedType === 'TODOS' || row.type === this.selectedType;
      const matchesSearch =
        search === '' ||
        row.name.toLowerCase().includes(search) ||
        row.isin.toLowerCase().includes(search) ||
        row.type.toLowerCase().includes(search) ||
        (row.investmentClass || '').toLowerCase().includes(search);

      return matchesType && matchesSearch;
    });
  }

  private sortRows(rows: PortfolioRow[]): PortfolioRow[] {
    return [...rows].sort((left, right) => {
      const direction = this.sortDirection === 'asc' ? 1 : -1;
      const leftValue = left[this.sortField];
      const rightValue = right[this.sortField];

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return (leftValue - rightValue) * direction;
      }

      return String(leftValue).localeCompare(String(rightValue), 'es') * direction;
    });
  }

  private applyEditedValueLocally(rowId: string, field: EditablePortfolioField, rawValue: string): void {
    if (!this.sourceDataset) {
      return;
    }

    this.sourceDataset = this.rebuildDatasetInsights({
      ...this.sourceDataset,
      sections: this.sourceDataset.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) => row.id === rowId ? this.getUpdatedRow(row, field, rawValue) : row),
        totals: section.totals ? { ...section.totals } : null
      })),
      rows: this.sourceDataset.rows.map((row) => row.id === rowId ? this.getUpdatedRow(row, field, rawValue) : row)
    });

    this.applyDateToDataset();
  }

  private rebuildDatasetInsights(dataset: PortfolioDataset): PortfolioDataset {
    const rows = this.applyPortfolioInsightMetrics(dataset.rows.map((row) => ({ ...row })));

    return {
      ...dataset,
      rows,
      sections: dataset.sections.map((section) => {
        const sectionRows = rows.filter((row) => row.section === section.title);
        return {
          ...section,
          rows: sectionRows,
          totals: this.buildTotals(sectionRows)
        };
      }),
      summaryByType: this.buildSummary(rows, (row) => row.type || 'Sin tipo'),
      summaryByAsset: [...rows]
        .sort((left, right) => right.totalValuationValue - left.totalValuationValue)
        .slice(0, 8)
        .map((row) => ({
          label: row.name,
          value: row.totalValuationValue,
          formattedValue: formatCurrencyEs(row.totalValuationValue),
          percentage: rows.reduce((sum, item) => sum + item.totalValuationValue, 0) > 0
            ? (row.totalValuationValue / rows.reduce((sum, item) => sum + item.totalValuationValue, 0)) * 100
            : 0
        })),
      summaryBySector: this.buildSummary(rows, (row) => row.sector || (row.section === 'FONDOS' ? row.categoryName || 'Sin categoria' : 'Sin sector')),
      summaryByCountry: this.buildSummary(rows, (row) => row.country || 'Sin pais'),
      summaryByManager: this.buildSummary(rows, (row) => row.managerName || (row.section === 'ACCIONES' ? 'Directa' : 'Sin gestora')),
      summaryByCurrency: this.buildSummary(rows, (row) => row.currency || 'Sin divisa'),
      summaryByClass: this.buildSummary(rows, (row) => row.investmentClass || 'Sin clase')
    };
  }

  private applyPortfolioInsightMetrics(rows: PortfolioRow[]): PortfolioRow[] {
    if (!rows.length) {
      return [];
    }

    const portfolioValuation = rows.reduce((sum, row) => sum + row.totalValuationValue, 0);

    return rows.map((row) => {
      const averageCostValue = row.sharesValue > 0 ? this.round(row.totalInvestedValue / row.sharesValue, 2) : 0;
      const annualizedReturnValue = this.computeAnnualizedReturn(row);
      const contributionValue = portfolioValuation > 0
        ? this.round((row.totalValuationValue / portfolioValuation) * row.totalReturnValue, 2)
        : 0;

      return {
        ...row,
        averageCostValue,
        averageCost: formatCurrencyEs(averageCostValue),
        annualizedReturnValue,
        annualizedReturn: formatPercentEs(annualizedReturnValue),
        contributionValue,
        contribution: formatPercentEs(contributionValue)
      };
    });
  }

  private computeAnnualizedReturn(row: PortfolioRow): number {
    if (row.totalInvestedValue <= 0 || row.totalValuationValue <= 0) {
      return 0;
    }

    const firstDate = this.toIsoDate(row.navHistory?.[0]?.date || '');
    const lastDate = this.toIsoDate(row.navHistory?.at(-1)?.date || row.marketDate);

    if (!firstDate || !lastDate) {
      return row.totalReturnValue;
    }

    const years = this.diffInYears(firstDate, lastDate);

    if (years <= 0) {
      return row.totalReturnValue;
    }

    return this.round((Math.pow(row.totalValuationValue / row.totalInvestedValue, 1 / years) - 1) * 100, 2);
  }

  private diffInYears(startDate: string, endDate: string): number {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return 0;
    }

    return Math.max((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25), 0);
  }

  private getUpdatedRow(row: PortfolioRow, field: EditablePortfolioField, rawValue: string): PortfolioRow {
    if (field === 'investmentClass') {
      return {
        ...row,
        investmentClass: rawValue
      };
    }

    if (field === 'type') {
      return {
        ...row,
        type: rawValue
      };
    }

    if (field === 'currency') {
      return {
        ...row,
        currency: rawValue.toUpperCase()
      };
    }

    const value = parseLooseNumber(rawValue);

    if (value === null) {
      return row;
    }

    const sharesValue = field === 'shares' ? value : row.sharesValue;
    const totalInvestedValue = field === 'totalInvested' ? this.round(value, 2) : row.totalInvestedValue;
    const unitValueNumber = parseLooseNumber(row.unitValue) ?? row.unitValueNumber;
    const totalValuationValue = this.round(sharesValue * unitValueNumber, 2);
    const profitEurosValue = this.round(totalValuationValue - totalInvestedValue, 2);
    const totalReturnValue = totalInvestedValue > 0 ? this.round((profitEurosValue / totalInvestedValue) * 100, 2) : 0;

    return {
      ...row,
      sharesValue,
      unitValueNumber,
      shares: formatDecimalEs(sharesValue, this.resolveDisplayedDigits(row.shares)),
      totalInvestedValue,
      totalInvested: formatCurrencyEs(totalInvestedValue),
      totalValuationValue,
      totalValuation: formatCurrencyEs(totalValuationValue),
      profitEurosValue,
      profitEuros: formatCurrencyEs(profitEurosValue),
      totalReturnValue,
      totalReturn: formatPercentEs(totalReturnValue)
    };
  }

  private getCellKey(rowId: string, field: EditablePortfolioField): string {
    return `${rowId}:${field}`;
  }

  private getEditableFieldValue(row: PortfolioRow, field: EditablePortfolioField): string {
    if (field === 'shares') {
      return row.shares;
    }

    if (field === 'totalInvested') {
      return row.totalInvested;
    }

    if (field === 'type') {
      return row.type;
    }

    if (field === 'currency') {
      return row.currency;
    }

    return row.investmentClass || 'Otro';
  }

  private createEmptyFundForm(): CreateFundPayload {
    return {
      name: '',
      isin: '',
      type: '',
      currency: 'EUR',
      totalInvested: '',
      shares: '',
      yahooSymbol: ''
    };
  }

  private createEmptyEquityForm(): CreateEquityPayload {
    return {
      name: '',
      ticker: '',
      isin: '',
      currency: 'EUR',
      totalInvested: '',
      shares: ''
    };
  }
}
