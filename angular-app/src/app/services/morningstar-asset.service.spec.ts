import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MorningstarAssetService } from './morningstar-asset.service';

describe('MorningstarAssetService', () => {
  let service: MorningstarAssetService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MorningstarAssetService, provideHttpClient(), provideHttpClientTesting()]
    });

    service = TestBed.inject(MorningstarAssetService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should map a fund response to the view model used by the detail screen', () => {
    let resultName = '';
    let headlineCount = 0;

    service
      .getAssetDetails({
        assetType: 'fund',
        idType: 'isin',
        id: 'ES0123456789'
      })
      .subscribe((result) => {
        resultName = result.name ?? '';
        headlineCount = result.headlineMetrics.length;
      });

    const request = httpMock.expectOne((req) => req.url === '/api/morningstar/assets');
    expect(request.request.params.get('assetType')).toBe('fund');
    expect(request.request.params.get('idType')).toBe('isin');
    expect(request.request.params.get('id')).toBe('ES0123456789');

    request.flush({
      assetType: 'fund',
      requestedId: 'ES0123456789',
      resolvedId: 'ES0123456789',
      resolvedIdType: 'isin',
      performanceId: 'F0GBR04ABC',
      name: 'Sample Fund',
      isin: 'ES0123456789',
      category: 'RV Global',
      baseCurrency: 'EUR',
      nav: 12.45,
      navDate: '2026-03-31',
      benchmark: 'MSCI World',
      expenseRatio: 0.95,
      trailingReturns: {
        oneYear: 8.4
      }
    });

    expect(resultName).toBe('Sample Fund');
    expect(headlineCount).toBeGreaterThan(0);
  });
});
