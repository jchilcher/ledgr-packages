import { PerformanceEngine, HoldingData, SellTransaction } from '../engines/performance-engine';
import type { CashFlowEvent } from '../types';

describe('PerformanceEngine', () => {
  let engine: PerformanceEngine;

  beforeEach(() => {
    engine = new PerformanceEngine();
  });

  describe('calculatePositionGainLoss', () => {
    it('calculates unrealized gain correctly', () => {
      const holding: HoldingData = {
        id: 'h1',
        ticker: 'AAPL',
        name: 'Apple Inc.',
        shares: 100,
        avgCostPerShare: 15000, // $150.00
        currentPrice: 17500,    // $175.00
        previousClose: 17000,   // $170.00
      };

      const result = engine.calculatePositionGainLoss(holding);

      expect(result.costBasis).toBe(1500000);      // $15,000
      expect(result.currentValue).toBe(1750000);   // $17,500
      expect(result.unrealizedGain).toBe(250000);  // $2,500
      expect(result.unrealizedGainPercent).toBeCloseTo(16.67, 1);
      expect(result.dayChange).toBe(50000);        // $500
      expect(result.dayChangePercent).toBeCloseTo(2.94, 1);
    });

    it('handles zero cost basis', () => {
      const holding: HoldingData = {
        id: 'h1',
        ticker: 'FREE',
        name: 'Free Stock',
        shares: 10,
        avgCostPerShare: 0,
        currentPrice: 1000,
      };

      const result = engine.calculatePositionGainLoss(holding);

      expect(result.unrealizedGainPercent).toBe(0);
    });

    it('calculates unrealized loss correctly', () => {
      const holding: HoldingData = {
        id: 'h1',
        ticker: 'TSLA',
        name: 'Tesla Inc.',
        shares: 50,
        avgCostPerShare: 30000, // $300.00
        currentPrice: 25000,    // $250.00
      };

      const result = engine.calculatePositionGainLoss(holding);

      expect(result.costBasis).toBe(1500000);      // $15,000
      expect(result.currentValue).toBe(1250000);   // $12,500
      expect(result.unrealizedGain).toBe(-250000); // -$2,500
      expect(result.unrealizedGainPercent).toBeCloseTo(-16.67, 1);
    });

    it('defaults previousClose to currentPrice when not provided', () => {
      const holding: HoldingData = {
        id: 'h1',
        ticker: 'AAPL',
        name: 'Apple Inc.',
        shares: 100,
        avgCostPerShare: 15000,
        currentPrice: 17500,
        // No previousClose
      };

      const result = engine.calculatePositionGainLoss(holding);

      expect(result.dayChange).toBe(0);
      expect(result.dayChangePercent).toBe(0);
    });
  });

  describe('calculateRealizedGain', () => {
    it('calculates realized gain with fees', () => {
      const transaction: SellTransaction = {
        id: 't1',
        holdingId: 'h1',
        ticker: 'AAPL',
        date: new Date('2024-06-15'),
        shares: 50,
        pricePerShare: 18000,  // $180.00
        fees: 500,             // $5.00
        costBasis: 750000,     // $7,500.00
        purchaseDate: new Date('2023-01-15'),
      };

      const result = engine.calculateRealizedGain(transaction);

      expect(result.proceeds).toBe(899500);  // $8,995.00 (9000 - 5)
      expect(result.gain).toBe(149500);      // $1,495.00
      expect(result.isLongTerm).toBe(true);  // Held > 365 days
    });

    it('identifies short-term gains', () => {
      const transaction: SellTransaction = {
        id: 't1',
        holdingId: 'h1',
        ticker: 'AAPL',
        date: new Date('2024-06-15'),
        shares: 50,
        pricePerShare: 18000,
        fees: 0,
        costBasis: 750000,
        purchaseDate: new Date('2024-03-15'), // Only 3 months
      };

      const result = engine.calculateRealizedGain(transaction);

      expect(result.isLongTerm).toBe(false);
      expect(result.holdingPeriodDays).toBeLessThan(365);
    });

    it('calculates realized loss correctly', () => {
      const transaction: SellTransaction = {
        id: 't1',
        holdingId: 'h1',
        ticker: 'TSLA',
        date: new Date('2024-06-15'),
        shares: 10,
        pricePerShare: 20000,  // $200.00
        fees: 500,
        costBasis: 300000,     // $3,000.00
        purchaseDate: new Date('2024-01-15'),
      };

      const result = engine.calculateRealizedGain(transaction);

      expect(result.proceeds).toBe(199500);   // $1,995.00
      expect(result.gain).toBe(-100500);      // -$1,005.00 loss
      expect(result.gainPercent).toBeCloseTo(-33.5, 1);
    });
  });

  describe('calculatePortfolioPerformance', () => {
    it('aggregates multiple holdings correctly', () => {
      const holdings: HoldingData[] = [
        {
          id: 'h1',
          ticker: 'AAPL',
          name: 'Apple Inc.',
          shares: 100,
          avgCostPerShare: 15000,
          currentPrice: 17500,
        },
        {
          id: 'h2',
          ticker: 'GOOGL',
          name: 'Alphabet Inc.',
          shares: 50,
          avgCostPerShare: 14000,
          currentPrice: 15000,
        },
      ];

      const result = engine.calculatePortfolioPerformance(holdings, []);

      expect(result.totalValue).toBe(2500000);     // $25,000 (17500 + 7500)
      expect(result.totalCostBasis).toBe(2200000); // $22,000 (15000 + 7000)
      expect(result.unrealizedGain).toBe(300000);  // $3,000
    });

    it('includes realized gains in total', () => {
      const holdings: HoldingData[] = [
        {
          id: 'h1',
          ticker: 'AAPL',
          name: 'Apple Inc.',
          shares: 50,
          avgCostPerShare: 15000,
          currentPrice: 17500,
        },
      ];

      const sellTransactions: SellTransaction[] = [
        {
          id: 't1',
          holdingId: 'h1',
          ticker: 'AAPL',
          date: new Date('2024-06-15'),
          shares: 50,
          pricePerShare: 18000,
          fees: 0,
          costBasis: 750000,
          purchaseDate: new Date('2023-01-15'),
        },
      ];

      const result = engine.calculatePortfolioPerformance(holdings, sellTransactions);

      expect(result.realizedGainTotal).toBe(150000); // $1,500
    });
  });

  describe('calculateTWR', () => {
    it('calculates TWR with no cash flows', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const twr = engine.calculateTWR(
        10000000,  // $100,000 start
        11500000,  // $115,000 end
        [],
        startDate,
        endDate
      );

      expect(twr).toBeCloseTo(0.15, 2); // 15% return
    });

    it('calculates TWR with mid-period contribution', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const cashFlows: CashFlowEvent[] = [
        { date: new Date('2024-07-01'), amount: 1000000, type: 'contribution' }
      ];

      const twr = engine.calculateTWR(
        10000000,  // $100,000 start
        12150000,  // $121,500 end (10% growth on 100k, then 10% on 110k)
        cashFlows,
        startDate,
        endDate
      );

      // TWR should be around 10% (removes cash flow impact)
      expect(twr).toBeCloseTo(0.10, 1);
    });

    it('handles zero start value', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const twr = engine.calculateTWR(0, 0, [], startDate, endDate);

      expect(twr).toBe(0);
    });

    it('handles all contributions scenario', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const cashFlows: CashFlowEvent[] = [
        { date: new Date('2024-03-01'), amount: 5000000, type: 'contribution' },
        { date: new Date('2024-06-01'), amount: 5000000, type: 'contribution' }
      ];

      const twr = engine.calculateTWR(
        0,          // Start with nothing
        11000000,   // End with $110,000
        cashFlows,
        startDate,
        endDate
      );

      // 10% gain on $100,000 contributed
      expect(twr).toBeCloseTo(0.10, 1);
    });
  });

  describe('calculateMWR', () => {
    it('calculates MWR with no cash flows', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const mwr = engine.calculateMWR(
        10000000,  // $100,000 start
        11000000,  // $110,000 end
        [],
        startDate,
        endDate
      );

      expect(mwr).toBeCloseTo(0.10, 1); // ~10% return
    });

    it('calculates MWR with contribution', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const cashFlows: CashFlowEvent[] = [
        { date: new Date('2024-07-01'), amount: 5000000, type: 'contribution' }
      ];

      const mwr = engine.calculateMWR(
        10000000,  // $100,000 start
        16500000,  // $165,000 end (10% return on average balance)
        cashFlows,
        startDate,
        endDate
      );

      // MWR reflects timing of cash flows
      expect(mwr).toBeGreaterThan(0);
    });

    it('calculates MWR with withdrawal', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const cashFlows: CashFlowEvent[] = [
        { date: new Date('2024-06-01'), amount: -2000000, type: 'withdrawal' }
      ];

      const mwr = engine.calculateMWR(
        10000000,  // $100,000 start
        8800000,   // $88,000 end (after $20k withdrawal + 10% gain on remaining)
        cashFlows,
        startDate,
        endDate
      );

      expect(mwr).toBeGreaterThan(0);
    });
  });

  describe('calculatePerformanceMetrics', () => {
    it('calculates full metrics for portfolio', () => {
      const holdings: HoldingData[] = [
        {
          id: 'h1',
          ticker: 'AAPL',
          name: 'Apple Inc.',
          shares: 100,
          avgCostPerShare: 15000,
          currentPrice: 17500,
        },
        {
          id: 'h2',
          ticker: 'GOOGL',
          name: 'Alphabet Inc.',
          shares: 50,
          avgCostPerShare: 14000,
          currentPrice: 15000,
        },
      ];

      const result = engine.calculatePerformanceMetrics(
        holdings,
        [],
        [],
        { period: 'YTD' }
      );

      expect(result.positions).toHaveLength(2);
      expect(result.portfolio.totalValue).toBe(2500000); // $25,000
      expect(result.portfolio.totalCostBasis).toBe(2200000); // $22,000
      expect(result.portfolio.unrealizedGain).toBe(300000); // $3,000
      expect(result.returns.twr).toBeDefined();
      expect(result.returns.mwr).toBeDefined();
      expect(result.calculatedAt).toBeInstanceOf(Date);
    });

    it('filters transactions by period', () => {
      const holdings: HoldingData[] = [
        {
          id: 'h1',
          ticker: 'AAPL',
          name: 'Apple Inc.',
          shares: 100,
          avgCostPerShare: 15000,
          currentPrice: 17500,
        },
      ];

      const sellTransactions: SellTransaction[] = [
        {
          id: 't1',
          holdingId: 'h1',
          ticker: 'AAPL',
          date: new Date('2023-06-15'), // Last year
          shares: 10,
          pricePerShare: 16000,
          fees: 0,
          costBasis: 150000,
          purchaseDate: new Date('2022-01-15'),
        },
        {
          id: 't2',
          holdingId: 'h1',
          ticker: 'AAPL',
          date: new Date(), // This year
          shares: 10,
          pricePerShare: 17000,
          fees: 0,
          costBasis: 150000,
          purchaseDate: new Date('2023-01-15'),
        },
      ];

      const result = engine.calculatePerformanceMetrics(
        holdings,
        sellTransactions,
        [],
        { period: 'YTD' }
      );

      // Should only include current year's realized gains in period results
      expect(result.realizedGains.length).toBe(1);
      expect(result.realizedGains[0].transactionId).toBe('t2');
    });

    it('supports custom date range', () => {
      const holdings: HoldingData[] = [];

      const result = engine.calculatePerformanceMetrics(
        holdings,
        [],
        [],
        {
          period: 'CUSTOM',
          customStartDate: new Date('2024-01-15'),
          customEndDate: new Date('2024-06-15'),
        }
      );

      expect(result.returns.startDate.getTime()).toBe(new Date('2024-01-15').getTime());
      expect(result.returns.endDate.getTime()).toBe(new Date('2024-06-15').getTime());
      expect(result.returns.periodDays).toBe(152); // Jan 15 to Jun 15
    });
  });
});
