import { generateTaxLotReport } from '../engines/tax-lot-report-engine'

describe('TaxLotReportEngine', () => {
  describe('generateTaxLotReport', () => {
    it('should separate short-term and long-term gains', () => {
      const input = {
        realizedGains: [
          {
            transactionId: 't1',
            holdingId: 'h1',
            ticker: 'AAPL',
            sellDate: new Date(2026, 0, 15),
            shares: 10,
            proceeds: 150000,
            costBasis: 100000,
            gain: 50000,
            gainPercent: 50,
            holdingPeriodDays: 400,
            isLongTerm: true,
          },
          {
            transactionId: 't2',
            holdingId: 'h2',
            ticker: 'MSFT',
            sellDate: new Date(2026, 0, 20),
            shares: 5,
            proceeds: 100000,
            costBasis: 90000,
            gain: 10000,
            gainPercent: 11.11,
            holdingPeriodDays: 200,
            isLongTerm: false,
          },
        ],
        investmentTransactions: [],
        holdings: [
          { id: 'h1', ticker: 'AAPL' },
          { id: 'h2', ticker: 'MSFT' },
        ],
        taxYear: 2026,
      }

      const report = generateTaxLotReport(input)

      expect(report.longTermGains.entries.length).toBe(1)
      expect(report.shortTermGains.entries.length).toBe(1)
      expect(report.longTermGains.totalGain).toBe(50000)
      expect(report.shortTermGains.totalGain).toBe(10000)
    })

    it('should detect wash sales within 30-day window', () => {
      const sellDate = new Date(2026, 0, 15)
      const repurchaseDate = new Date(2026, 0, 25)

      const input = {
        realizedGains: [
          {
            transactionId: 't1',
            holdingId: 'h1',
            ticker: 'AAPL',
            sellDate,
            shares: 10,
            proceeds: 80000,
            costBasis: 100000,
            gain: -20000,
            gainPercent: -20,
            holdingPeriodDays: 200,
            isLongTerm: false,
          },
        ],
        investmentTransactions: [
          {
            id: 'buy1',
            holdingId: 'h1',
            type: 'buy' as const,
            date: repurchaseDate,
            shares: 10,
            totalAmount: 85000,
          },
        ],
        holdings: [{ id: 'h1', ticker: 'AAPL' }],
        taxYear: 2026,
      }

      const report = generateTaxLotReport(input)

      expect(report.washSaleFlags.length).toBe(1)
      expect(report.washSaleFlags[0].disallowedLoss).toBe(20000)
      expect(report.shortTermGains.entries[0].hasWashSale).toBe(true)
    })

    it('should filter by tax year', () => {
      const input = {
        realizedGains: [
          {
            transactionId: 't1',
            holdingId: 'h1',
            ticker: 'AAPL',
            sellDate: new Date(2025, 0, 15),
            shares: 10,
            proceeds: 150000,
            costBasis: 100000,
            gain: 50000,
            gainPercent: 50,
            holdingPeriodDays: 400,
            isLongTerm: true,
          },
          {
            transactionId: 't2',
            holdingId: 'h2',
            ticker: 'MSFT',
            sellDate: new Date(2026, 0, 20),
            shares: 5,
            proceeds: 100000,
            costBasis: 90000,
            gain: 10000,
            gainPercent: 11.11,
            holdingPeriodDays: 200,
            isLongTerm: false,
          },
        ],
        investmentTransactions: [],
        holdings: [
          { id: 'h1', ticker: 'AAPL' },
          { id: 'h2', ticker: 'MSFT' },
        ],
        taxYear: 2026,
      }

      const report = generateTaxLotReport(input)

      expect(report.shortTermGains.entries.length).toBe(1)
      expect(report.longTermGains.entries.length).toBe(0)
    })
  })
})
