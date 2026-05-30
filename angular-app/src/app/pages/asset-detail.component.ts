import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import {
  YahooAssetType,
  YahooDetailsViewModel,
  YahooFundChartRange,
  YahooFundDetailsViewModel,
  YahooIdentifierType
} from '../models/yahoo.models';
import { PortfolioOperation, PortfolioOperationType, PortfolioRow } from '../models/portfolio.models';
import { PortfolioDataService } from '../services/portfolio-data.service';
import { YahooFinanceAssetService } from '../services/yahoo-finance-asset.service';
import { formatDateEs } from '../utils/formatting';

@Component({
  selector: 'app-asset-detail',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './asset-detail.component.html',
  styleUrl: './asset-detail.component.css'
})
export class AssetDetailComponent implements OnInit {
  protected isLoading = true;
  protected errorMessage = '';
  protected backRoute = '/';
  protected portfolioKey = 'main';
  protected asset: PortfolioRow | null = null;
  protected yahooLoading = false;
  protected yahooError = '';
  protected yahooEmptyMessage = '';
  protected yahooDetails: YahooDetailsViewModel | null = null;
  protected operationsLoading = false;
  protected operationsError = '';
  protected operations: PortfolioOperation[] = [];
  protected operationFormError = '';
  protected isSavingOperation = false;
  protected editingOperationId = '';
  protected showOperationForm = false;
  protected selectedChartRange: YahooFundChartRange = 'ytd';
  protected hoveredChartPointIndex: number | null = null;
  protected hoveredGeographyIndex: number | null = null;
  protected readonly operationTypeOptions: Array<{ key: PortfolioOperationType; label: string }> = [
    { key: 'buy', label: 'Compra' },
    { key: 'sell', label: 'Venta' },
    { key: 'dividend', label: 'Dividendo' },
    { key: 'fee', label: 'Comision' }
  ];
  protected operationForm: {
    operationType: PortfolioOperationType;
    operationDate: string;
    quantity: string;
    unitPrice: string;
    amount: string;
    feeAmount: string;
    notes: string;
  } = this.createEmptyOperationForm();
  protected readonly chartRanges: Array<{ key: YahooFundChartRange; label: string }> = [
    { key: '1m', label: 'Ultimo mes' },
    { key: '3m', label: '3 meses' },
    { key: '6m', label: '6 meses' },
    { key: 'ytd', label: 'YTD' },
    { key: '1y', label: '1 ano' },
    { key: '3y', label: '3 anos' },
    { key: 'all', label: 'Todo' }
  ];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly portfolioDataService: PortfolioDataService,
    private readonly yahooFinanceAssetService: YahooFinanceAssetService
  ) {}

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    const routeData = this.route.snapshot.data;
    this.backRoute = routeData['backRoute'] ?? this.backRoute;
    this.portfolioKey = routeData['portfolioKey'] ?? this.portfolioKey;

    if (!id) {
      this.errorMessage = 'No se ha indicado el activo.';
      this.isLoading = false;
      return;
    }

    try {
      const asset = await this.portfolioDataService.getAssetById(id, this.portfolioKey);

      if (!asset) {
        throw new Error('No se encontro el activo seleccionado.');
      }

      this.asset = asset;
      await this.loadOperations(asset.id);
      await this.loadYahooDetails(asset);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Error al cargar el detalle del activo.';
    } finally {
      this.isLoading = false;
    }
  }

  protected get hasYahooContent(): boolean {
    return !!this.yahooDetails;
  }

  protected get yahooFundDetails(): YahooFundDetailsViewModel | null {
    return this.yahooDetails?.assetType === 'fund' ? this.yahooDetails : null;
  }

  protected get hasFundEnhancements(): boolean {
    const fund = this.yahooFundDetails;

    return !!fund && (
      fund.topHoldings.length > 0 ||
      fund.geographicExposure.length > 0 ||
      fund.annualReturns.length > 0 ||
      fund.dailyPerformance.length > 1 ||
      !!fund.riskIndicator
    );
  }

  protected setChartRange(range: YahooFundChartRange): void {
    this.selectedChartRange = range;
  }

  protected get filteredChartPoints(): Array<{ date: string; close: number }> {
    const fund = this.yahooFundDetails;

    if (!fund?.dailyPerformance.length) {
      return [];
    }

    const sortedPoints = [...fund.dailyPerformance].sort((left, right) => left.date.localeCompare(right.date));
    const lastPoint = sortedPoints[sortedPoints.length - 1];
    const lastDate = new Date(`${lastPoint.date}T00:00:00`);
    const startDate = this.resolveChartStartDate(lastDate);

    return sortedPoints.filter((point) => new Date(`${point.date}T00:00:00`) >= startDate);
  }

  protected get chartPolylinePoints(): string {
    const points = this.chartPlotPoints;

    if (points.length < 2) {
      return '';
    }

    return points
      .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
      .join(' ');
  }

  protected get chartMinLabel(): string {
    const values = this.filteredChartPoints.map((point) => point.close);
    return values.length ? this.formatNavValue(Math.min(...values)) : '0,0000 €';
  }

  protected get chartMaxLabel(): string {
    const values = this.filteredChartPoints.map((point) => point.close);
    return values.length ? this.formatNavValue(Math.max(...values)) : '0,0000 €';
  }

  protected get chartValueLabel(): string {
    const points = this.filteredChartPoints;

    if (!points.length) {
      return '0,0000 €';
    }

    return this.formatNavValue(points[points.length - 1].close);
  }

  protected get chartDateRangeLabel(): string {
    const points = this.filteredChartPoints;

    if (points.length < 2) {
      return '';
    }

    return `${formatDateEs(points[0].date)} - ${formatDateEs(points[points.length - 1].date)}`;
  }

  protected get chartStartDateLabel(): string {
    const points = this.filteredChartPoints;
    return points.length ? this.formatDate(points[0].date) : '';
  }

  protected get chartEndDateLabel(): string {
    const points = this.filteredChartPoints;
    return points.length ? this.formatDate(points[points.length - 1].date) : '';
  }

  protected get chartYTicks(): string[] {
    const values = this.filteredChartPoints.map((point) => point.close);

    if (!values.length) {
      return [];
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const steps = 4;

    return Array.from({ length: steps + 1 }, (_, index) => {
      const value = max - ((max - min) / steps) * index;
      return this.formatNavValue(value);
    });
  }

  protected get chartXTicks(): Array<{ label: string; position: number }> {
    const points = this.filteredChartPoints;

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
      label: this.formatDate(points[index].date),
      position: points.length === 1 ? 0 : (index / (points.length - 1)) * 100
    }));
  }

  protected get chartPlotPoints(): Array<{ date: string; close: number; x: number; y: number }> {
    const points = this.filteredChartPoints;

    if (!points.length) {
      return [];
    }

    const width = 100;
    const height = 100;
    const values = points.map((point) => point.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return points.map((point, index) => ({
      ...point,
      x: (index / Math.max(points.length - 1, 1)) * width,
      y: height - ((point.close - min) / range) * height
    }));
  }

  protected get hoveredChartPoint(): { date: string; close: number; x: number; y: number } | null {
    if (this.hoveredChartPointIndex === null) {
      return null;
    }

    return this.chartPlotPoints[this.hoveredChartPointIndex] ?? null;
  }

  protected get chartTooltipLeft(): number {
    const point = this.hoveredChartPoint;
    return point ? Math.min(Math.max(point.x, 12), 88) : 50;
  }

  protected get chartTooltipTop(): number {
    const point = this.hoveredChartPoint;
    return point ? Math.max(point.y, 18) : 50;
  }

  protected onChartHover(event: MouseEvent): void {
    const currentTarget = event.currentTarget;

    if (!(currentTarget instanceof HTMLElement)) {
      return;
    }

    const rect = currentTarget.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const points = this.chartPlotPoints;

    if (!points.length) {
      this.hoveredChartPointIndex = null;
      return;
    }

    const index = Math.round((relativeX / Math.max(rect.width, 1)) * (points.length - 1));
    this.hoveredChartPointIndex = Math.min(Math.max(index, 0), points.length - 1);
  }

  protected onChartLeave(): void {
    this.hoveredChartPointIndex = null;
  }

  protected get geographyGradient(): string {
    const items = this.yahooFundDetails?.geographicExposure ?? [];

    if (!items.length) {
      return 'conic-gradient(#d7dfdd 0 100%)';
    }

    let cursor = 0;
    const segments = items.map((item) => {
      const start = cursor;
      cursor += item.weight;
      return `${item.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });

    return `conic-gradient(${segments.join(', ')})`;
  }

  protected get hoveredGeography(): YahooFundDetailsViewModel['geographicExposure'][number] | null {
    if (this.hoveredGeographyIndex === null) {
      return null;
    }

    return this.yahooFundDetails?.geographicExposure[this.hoveredGeographyIndex] ?? null;
  }

  protected onGeographyHover(event: MouseEvent): void {
    const currentTarget = event.currentTarget;
    const items = this.yahooFundDetails?.geographicExposure ?? [];

    if (!(currentTarget instanceof HTMLElement) || !items.length) {
      this.hoveredGeographyIndex = null;
      return;
    }

    const rect = currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    const normalizedAngle = (angle + 90 + 360) % 360;

    let cursor = 0;

    for (let index = 0; index < items.length; index += 1) {
      const segment = (items[index].weight / 100) * 360;
      const nextCursor = cursor + segment;

      if (normalizedAngle >= cursor && normalizedAngle < nextCursor) {
        this.hoveredGeographyIndex = index;
        return;
      }

      cursor = nextCursor;
    }

    this.hoveredGeographyIndex = items.length - 1;
  }

  protected onGeographyLeave(): void {
    this.hoveredGeographyIndex = null;
  }

  protected get riskScoreDots(): number[] {
    const scaleMax = this.yahooFundDetails?.riskIndicator?.scaleMax ?? 5;
    return Array.from({ length: scaleMax }, (_, index) => index + 1);
  }

  protected isRiskDotActive(position: number): boolean {
    const rating = this.yahooFundDetails?.riskIndicator?.rating;
    return typeof rating === 'number' && position <= rating;
  }

  protected formatTooltipDate(value: string): string {
    return formatDateEs(value);
  }

  protected formatTooltipValue(value: number): string {
    return this.formatNavValue(value);
  }

  protected get canManageOperations(): boolean {
    return this.portfolioKey === 'main';
  }

  protected get isOperationFormVisible(): boolean {
    return this.showOperationForm || !!this.editingOperationId;
  }

  protected get operationAmountLabel(): string {
    if (this.operationForm.operationType === 'buy' || this.operationForm.operationType === 'sell') {
      return 'Importe calculado';
    }

    return this.operationForm.operationType === 'dividend' ? 'Importe del dividendo' : 'Importe de la comision';
  }

  protected get operationGrossAmountPreview(): string {
    if (this.operationForm.operationType !== 'buy' && this.operationForm.operationType !== 'sell') {
      return this.operationForm.amount || '-';
    }

    const quantity = Number(this.operationForm.quantity.replace(',', '.'));
    const unitPrice = Number(this.operationForm.unitPrice.replace(',', '.'));

    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
      return '-';
    }

    return this.formatCurrency(quantity * unitPrice);
  }

  protected startEditOperation(operation: PortfolioOperation): void {
    this.showOperationForm = true;
    this.editingOperationId = operation.id;
    this.operationFormError = '';
    this.operationForm = {
      operationType: operation.operationType,
      operationDate: this.toIsoDate(operation.operationDate),
      quantity: operation.quantity === null ? '' : String(operation.quantity).replace('.', ','),
      unitPrice: operation.unitPrice === null ? '' : String(operation.unitPrice).replace('.', ','),
      amount: operation.amount === null ? '' : String(operation.amount).replace('.', ','),
      feeAmount: operation.feeAmount === null ? '' : String(operation.feeAmount).replace('.', ','),
      notes: operation.notes || ''
    };
  }

  protected cancelEditOperation(): void {
    this.editingOperationId = '';
    this.showOperationForm = false;
    this.operationFormError = '';
    this.operationForm = this.createEmptyOperationForm();
  }

  protected openOperationForm(): void {
    this.showOperationForm = true;
    this.editingOperationId = '';
    this.operationFormError = '';
    this.operationForm = this.createEmptyOperationForm();
  }

  protected async submitOperation(): Promise<void> {
    if (!this.asset) {
      return;
    }

    this.isSavingOperation = true;
    this.operationFormError = '';

    const payload = {
      operationType: this.operationForm.operationType,
      operationDate: this.operationForm.operationDate,
      quantity: this.operationForm.quantity,
      unitPrice: this.operationForm.unitPrice,
      amount: this.operationForm.amount,
      feeAmount: this.operationForm.feeAmount,
      notes: this.operationForm.notes
    };

    try {
      if (this.editingOperationId) {
        this.operations = await this.portfolioDataService.updateAssetOperation(
          this.asset.id,
          this.editingOperationId,
          payload,
          this.portfolioKey
        );
      } else {
        this.operations = await this.portfolioDataService.createAssetOperation(this.asset.id, payload, this.portfolioKey);
      }

      this.cancelEditOperation();
      await this.refreshAsset();
    } catch (error) {
      this.operationFormError = error instanceof Error ? error.message : 'No se pudo guardar el movimiento.';
    } finally {
      this.isSavingOperation = false;
    }
  }

  protected async deleteOperation(operation: PortfolioOperation): Promise<void> {
    if (!this.asset) {
      return;
    }

    this.operationFormError = '';
    this.isSavingOperation = true;

    try {
      this.operations = await this.portfolioDataService.deleteAssetOperation(this.asset.id, operation.id, this.portfolioKey);
      if (this.editingOperationId === operation.id) {
        this.cancelEditOperation();
      }
      await this.refreshAsset();
    } catch (error) {
      this.operationFormError = error instanceof Error ? error.message : 'No se pudo borrar el movimiento.';
    } finally {
      this.isSavingOperation = false;
    }
  }

  private async loadYahooDetails(asset: PortfolioRow): Promise<void> {
    const lookup = this.resolveLookup(asset);

    if (!lookup) {
      this.yahooEmptyMessage = 'No hay un identificador disponible para consultar datos de mercado en este activo.';
      return;
    }

    this.yahooLoading = true;
    this.yahooError = '';
    this.yahooEmptyMessage = '';

    try {
      this.yahooDetails = await firstValueFrom(this.yahooFinanceAssetService.getAssetDetails(lookup));

      if (!this.yahooDetails) {
        this.yahooEmptyMessage = 'No se encontro informacion de mercado para este activo.';
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 0)) {
        this.yahooEmptyMessage = 'Este activo no esta disponible en el proveedor de datos de mercado configurado.';
      } else {
        const msg = (error instanceof HttpErrorResponse ? error.error?.error : null)
          ?? (error instanceof Error ? error.message : null)
          ?? 'No se pudo recuperar la informacion de mercado.';
        this.yahooError = msg;
      }
    } finally {
      this.yahooLoading = false;
    }
  }

  private async loadOperations(assetId: string): Promise<void> {
    this.operationsLoading = true;
    this.operationsError = '';

    try {
      this.operations = await this.portfolioDataService.getAssetOperations(assetId, this.portfolioKey);
    } catch (error) {
      this.operationsError = error instanceof Error ? error.message : 'No se pudieron cargar los movimientos.';
    } finally {
      this.operationsLoading = false;
    }
  }

  private async refreshAsset(): Promise<void> {
    if (!this.asset) {
      return;
    }

    const refreshed = await this.portfolioDataService.getAssetById(this.asset.id, this.portfolioKey);
    if (refreshed) {
      this.asset = refreshed;
      await this.loadYahooDetails(refreshed);
    }
  }

  private resolveLookup(
    asset: PortfolioRow
  ): { assetType: YahooAssetType; idType: YahooIdentifierType; id: string } | null {
    const assetType: YahooAssetType = asset.section === 'FONDOS' ? 'fund' : 'equity';

    if (assetType === 'fund') {
      return asset.isin ? { assetType, idType: 'isin', id: asset.isin } : null;
    }

    if (asset.isin) {
      return { assetType, idType: 'isin', id: asset.isin };
    }

    if (asset.ticker) {
      return { assetType, idType: 'ticker', id: asset.ticker };
    }

    if (asset.symbol) {
      return { assetType, idType: 'symbol', id: asset.symbol };
    }

    if (asset.performanceId) {
      return { assetType, idType: 'performanceId', id: asset.performanceId };
    }

    return null;
  }

  private resolveChartStartDate(lastDate: Date): Date {
    switch (this.selectedChartRange) {
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

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: this.asset?.currency || 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  private formatNavValue(value: number): string {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: this.asset?.currency || 'EUR',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(value);
  }

  private formatDate(value: string): string {
    return formatDateEs(value);
  }

  private createEmptyOperationForm() {
    return {
      operationType: 'buy' as PortfolioOperationType,
      operationDate: new Date().toISOString().slice(0, 10),
      quantity: '',
      unitPrice: '',
      amount: '',
      feeAmount: '',
      notes: ''
    };
  }

  private toIsoDate(value: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    const [day, month, year] = value.split('/');
    return day && month && year ? `${year}-${month}-${day}` : value;
  }
}
