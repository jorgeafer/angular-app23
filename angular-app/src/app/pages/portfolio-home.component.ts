import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  CreateFundPayload,
  EditablePortfolioField,
  PortfolioNavPoint,
  PortfolioDataset,
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

@Component({
  selector: 'app-portfolio-home',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './portfolio-home.component.html',
  styleUrl: './portfolio-home.component.css'
})
export class PortfolioHomeComponent implements OnInit {
  protected readonly investmentClassOptions = ['RF', 'RV', 'Mixto', 'Otro'];
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
  protected sortField: SortField = 'totalValuationValue';
  protected sortDirection: 'asc' | 'desc' = 'desc';
  protected lastUpdated = '';
  protected portfolioTotals: PortfolioTotals | null = null;
  protected filteredSections: PortfolioSection[] = [];
  protected summaryByType: PortfolioSummaryItem[] = [];
  protected summaryByAsset: PortfolioSummaryItem[] = [];
  protected availableTypes: string[] = [];
  protected isFundEditMode = false;
  protected isAddFundModalOpen = false;
  protected isCreatingFund = false;
  protected isDeleteFundModalOpen = false;
  protected isDeletingFund = false;
  protected createFundErrorMessage = '';
  protected deleteFundErrorMessage = '';
  protected fundPendingDeletion: PortfolioRow | null = null;
  protected editingCell: { rowId: string; field: EditablePortfolioField; draftValue: string } | null = null;
  protected savingCellKey = '';
  protected newFundForm: CreateFundPayload = this.createEmptyFundForm();
  protected portfolioTrendHoveredPointIndex: number | null = null;

  private sourceDataset: PortfolioDataset | null = null;
  private displayDataset: PortfolioDataset | null = null;
  private allowedSections: Array<PortfolioSection['title']> = ['FONDOS', 'ACCIONES'];

  constructor(
    private readonly portfolioDataService: PortfolioDataService,
    private readonly route: ActivatedRoute
  ) {}

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
    await this.loadPortfolio();
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

  protected setPortfolioTrendRange(range: PortfolioTrendRange): void {
    this.selectedPortfolioTrendRange = range;
    this.portfolioTrendHoveredPointIndex = null;
  }

  protected setPortfolioTrendScope(scope: PortfolioTrendScope): void {
    this.selectedPortfolioTrendScope = scope;
    this.portfolioTrendHoveredPointIndex = null;
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

  protected get hasPendingDateChange(): boolean {
    return this.selectedDate !== this.appliedDate;
  }

  protected toggleFundEditMode(): void {
    this.isFundEditMode = !this.isFundEditMode;

    if (!this.isFundEditMode) {
      this.editingCell = null;
      this.savingCellKey = '';
      this.closeDeleteFundModal();
    }
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

    const value = this.editingCell.draftValue.trim();

    if (!value) {
      this.errorMessage = 'El valor no puede estar vacio.';
      return;
    }

    this.savingCellKey = this.getCellKey(row.id, field);
    this.errorMessage = '';

    try {
      await this.portfolioDataService.updateAssetValue(row.id, field, value, this.portfolioKey);
      this.applyEditedValueLocally(row.id, field, value);
      this.editingCell = null;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo guardar el cambio.';
    } finally {
      this.savingCellKey = '';
    }
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

  private async loadPortfolio(forceRefresh = false): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      this.sourceDataset = forceRefresh
        ? await this.portfolioDataService.refreshPortfolio(this.portfolioKey)
        : await this.portfolioDataService.getPortfolio(this.portfolioKey);
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
    this.updateFilters();
  }

  private recalculateDatasetForDate(dataset: PortfolioDataset, asOfDate: string): PortfolioDataset {
    const sections = dataset.sections.map((section) => {
      const rows = section.rows.map((row) => this.recalculateRowForDate(row, asOfDate));
      return {
        ...section,
        rows,
        totals: this.buildTotals(rows)
      };
    });

    const rows = sections.flatMap((section) => section.rows);
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
      summaryByAsset: [...rows]
        .sort((left, right) => right.totalValuationValue - left.totalValuationValue)
        .slice(0, 8)
        .map((row) => ({
          label: row.name,
          value: row.totalValuationValue,
          formattedValue: formatCurrencyEs(row.totalValuationValue),
          percentage: portfolioTotal > 0 ? (row.totalValuationValue / portfolioTotal) * 100 : 0
        }))
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

  private get filteredPortfolioTrendSeries(): Array<{ date: string; profitEuros: number }> {
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
    const startDate = this.resolvePortfolioTrendStartDate(lastDate);
    const pointsByRow = rows.map((row) => ({
      row,
      history: [...(row.navHistory ?? [])].sort((left, right) => left.date.localeCompare(right.date)),
      historyIndex: 0,
      latestClose: null as number | null
    }));

    const series: Array<{ date: string; profitEuros: number }> = [];

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
        totalProfitEuros += this.round((pointState.row.sharesValue * pointState.latestClose) - pointState.row.totalInvestedValue, 2);
      }

      if (hasValue) {
        series.push({
          date,
          profitEuros: this.round(totalProfitEuros, 2)
        });
      }
    }

    return series;
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

  private resolvePortfolioTrendStartDate(lastDate: Date): Date {
    switch (this.selectedPortfolioTrendRange) {
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
      summaryByAsset: dataset.summaryByAsset.map((item) => ({ ...item }))
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

    this.sourceDataset = {
      ...this.sourceDataset,
      sections: this.sourceDataset.sections.map((section) => ({
        ...section,
        rows: section.rows.map((row) => row.id === rowId ? this.getUpdatedRow(row, field, rawValue) : row),
        totals: section.totals ? { ...section.totals } : null
      })),
      rows: this.sourceDataset.rows.map((row) => row.id === rowId ? this.getUpdatedRow(row, field, rawValue) : row)
    };

    this.applyDateToDataset();
  }

  private getUpdatedRow(row: PortfolioRow, field: EditablePortfolioField, rawValue: string): PortfolioRow {
    if (field === 'investmentClass') {
      return {
        ...row,
        investmentClass: rawValue
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

    return row.investmentClass || 'Otro';
  }

  private createEmptyFundForm(): CreateFundPayload {
    return {
      name: '',
      isin: '',
      type: '',
      currency: 'EUR',
      totalInvested: '',
      shares: ''
    };
  }
}
