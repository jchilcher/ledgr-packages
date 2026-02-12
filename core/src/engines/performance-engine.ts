import type {
  PositionGainLoss,
  RealizedGain,
  PortfolioPerformance,
  ReturnMetrics,
  PerformanceMetrics,
  PerformanceOptions,
  CashFlowEvent,
} from '../types';

export interface HoldingData {
  id: string;
  ticker: string;
  name: string;
  shares: number;           // Total shares (from lots sum)
  avgCostPerShare: number;  // Average cost in cents
  currentPrice: number;     // Current price in cents
  previousClose?: number;   // Yesterday's close for day change (cents)
}

export interface SellTransaction {
  id: string;
  holdingId: string;
  ticker: string;
  date: Date;
  shares: number;
  pricePerShare: number;    // Sale price in cents
  fees: number;             // Transaction fees in cents
  costBasis: number;        // Cost basis of sold shares in cents
  purchaseDate: Date;       // Original purchase date for holding period
}

export interface PortfolioSnapshot {
  date: Date;
  value: number;            // Total value in cents
}

export class PerformanceEngine {
  /**
   * Calculate unrealized gain/loss for a single position.
   */
  calculatePositionGainLoss(holding: HoldingData): PositionGainLoss {
    const costBasis = Math.round(holding.shares * holding.avgCostPerShare);
    const currentValue = Math.round(holding.shares * holding.currentPrice);
    const unrealizedGain = currentValue - costBasis;
    const unrealizedGainPercent = costBasis > 0
      ? (unrealizedGain / costBasis) * 100
      : 0;

    // Day change calculation
    const previousClose = holding.previousClose ?? holding.currentPrice;
    const dayChange = Math.round(holding.shares * (holding.currentPrice - previousClose));
    const previousValue = Math.round(holding.shares * previousClose);
    const dayChangePercent = previousValue > 0
      ? (dayChange / previousValue) * 100
      : 0;

    return {
      holdingId: holding.id,
      ticker: holding.ticker,
      name: holding.name,
      shares: holding.shares,
      costBasis,
      currentValue,
      unrealizedGain,
      unrealizedGainPercent,
      dayChange,
      dayChangePercent,
    };
  }

  /**
   * Calculate realized gain from a sell transaction.
   */
  calculateRealizedGain(transaction: SellTransaction): RealizedGain {
    const proceeds = Math.round(transaction.shares * transaction.pricePerShare) - transaction.fees;
    const gain = proceeds - transaction.costBasis;
    const gainPercent = transaction.costBasis > 0
      ? (gain / transaction.costBasis) * 100
      : 0;

    const holdingPeriodDays = Math.floor(
      (transaction.date.getTime() - transaction.purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      transactionId: transaction.id,
      holdingId: transaction.holdingId,
      ticker: transaction.ticker,
      sellDate: transaction.date,
      shares: transaction.shares,
      proceeds,
      costBasis: transaction.costBasis,
      gain,
      gainPercent,
      holdingPeriodDays,
      isLongTerm: holdingPeriodDays > 365,
    };
  }

  /**
   * Calculate portfolio-level performance from holdings and transactions.
   */
  calculatePortfolioPerformance(
    holdings: HoldingData[],
    sellTransactions: SellTransaction[],
    yearStart: Date = new Date(new Date().getFullYear(), 0, 1)
  ): PortfolioPerformance {
    // Calculate position-level metrics
    const positions = holdings.map(h => this.calculatePositionGainLoss(h));

    // Aggregate portfolio metrics
    const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
    const totalCostBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);
    const unrealizedGain = totalValue - totalCostBasis;
    const unrealizedGainPercent = totalCostBasis > 0
      ? (unrealizedGain / totalCostBasis) * 100
      : 0;

    // Calculate realized gains
    const realizedGains = sellTransactions.map(t => this.calculateRealizedGain(t));
    const realizedGainTotal = realizedGains.reduce((sum, g) => sum + g.gain, 0);
    const realizedGainYTD = realizedGains
      .filter(g => g.sellDate >= yearStart)
      .reduce((sum, g) => sum + g.gain, 0);

    // Day change
    const dayChange = positions.reduce((sum, p) => sum + p.dayChange, 0);
    const previousTotalValue = positions.reduce(
      (sum, p) => sum + p.currentValue - p.dayChange,
      0
    );
    const dayChangePercent = previousTotalValue > 0
      ? (dayChange / previousTotalValue) * 100
      : 0;

    return {
      totalValue,
      totalCostBasis,
      unrealizedGain,
      unrealizedGainPercent,
      realizedGainYTD,
      realizedGainTotal,
      dayChange,
      dayChangePercent,
    };
  }

  /**
   * Calculate Time-Weighted Return (TWR) using Modified Dietz method.
   * TWR eliminates the impact of cash flows to show investment performance.
   */
  calculateTWR(
    startValue: number,
    endValue: number,
    cashFlows: CashFlowEvent[],
    startDate: Date,
    endDate: Date
  ): number {
    if (startValue === 0 && cashFlows.length === 0) {
      return 0;
    }

    const totalDays = Math.max(1, Math.floor(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    ));

    // Calculate weighted cash flows (Modified Dietz)
    let weightedCashFlow = 0;
    let totalCashFlow = 0;

    for (const cf of cashFlows) {
      const daysFromStart = Math.floor(
        (cf.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const weight = (totalDays - daysFromStart) / totalDays;
      weightedCashFlow += cf.amount * weight;
      totalCashFlow += cf.amount;
    }

    // Modified Dietz formula
    const adjustedStartValue = startValue + weightedCashFlow;

    if (adjustedStartValue <= 0) {
      // Handle edge case: all contributions, use simple return
      if (totalCashFlow > 0) {
        return (endValue - totalCashFlow) / totalCashFlow;
      }
      return 0;
    }

    return (endValue - startValue - totalCashFlow) / adjustedStartValue;
  }

  /**
   * Calculate Money-Weighted Return (MWR) using Newton-Raphson IRR approximation.
   * MWR accounts for the timing and size of cash flows.
   */
  calculateMWR(
    startValue: number,
    endValue: number,
    cashFlows: CashFlowEvent[],
    startDate: Date,
    endDate: Date
  ): number {
    const totalDays = Math.max(1, Math.floor(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    ));

    // Build cash flow array for IRR calculation
    // Initial investment is negative (outflow)
    const flows: Array<{ amount: number; dayOffset: number }> = [
      { amount: -startValue, dayOffset: 0 }
    ];

    // Add intermediate cash flows (contributions negative, withdrawals positive for IRR)
    for (const cf of cashFlows) {
      const dayOffset = Math.floor(
        (cf.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      // Contributions are negative cash flows (money in), withdrawals are positive (money out)
      flows.push({ amount: -cf.amount, dayOffset });
    }

    // Final value is positive (inflow)
    flows.push({ amount: endValue, dayOffset: totalDays });

    // Newton-Raphson to find daily rate
    let dailyRate = 0.0001; // Initial guess (0.01% daily)
    const maxIterations = 100;
    const tolerance = 0.0000001;

    for (let i = 0; i < maxIterations; i++) {
      let npv = 0;
      let npvDerivative = 0;

      for (const flow of flows) {
        const discountFactor = Math.pow(1 + dailyRate, -flow.dayOffset);
        npv += flow.amount * discountFactor;
        npvDerivative -= flow.dayOffset * flow.amount * Math.pow(1 + dailyRate, -flow.dayOffset - 1);
      }

      if (Math.abs(npv) < tolerance || npvDerivative === 0) {
        break;
      }

      dailyRate = dailyRate - npv / npvDerivative;

      // Clamp to reasonable bounds
      dailyRate = Math.max(-0.5, Math.min(0.5, dailyRate));
    }

    // Annualize: (1 + daily)^365 - 1, then convert to period return
    const annualizedReturn = Math.pow(1 + dailyRate, 365) - 1;

    // Convert back to period return for consistency with TWR
    const periodReturn = Math.pow(1 + annualizedReturn, totalDays / 365) - 1;

    return periodReturn;
  }

  /**
   * Calculate full performance metrics for a portfolio.
   */
  calculatePerformanceMetrics(
    holdings: HoldingData[],
    sellTransactions: SellTransaction[],
    cashFlows: CashFlowEvent[],
    options: PerformanceOptions,
    historicalSnapshots?: PortfolioSnapshot[]
  ): PerformanceMetrics {
    const { startDate, endDate } = this.resolvePeriodDates(options);

    // Filter transactions to period
    const periodSells = sellTransactions.filter(
      t => t.date >= startDate && t.date <= endDate
    );
    const periodCashFlows = cashFlows.filter(
      cf => cf.date >= startDate && cf.date <= endDate
    );

    // Calculate position and portfolio metrics
    const positions = holdings.map(h => this.calculatePositionGainLoss(h));
    const portfolio = this.calculatePortfolioPerformance(holdings, sellTransactions);
    const realizedGains = periodSells.map(t => this.calculateRealizedGain(t));

    // Get start value from snapshots or calculate
    const startSnapshot = historicalSnapshots?.find(
      s => s.date.getTime() <= startDate.getTime()
    );
    const startValue = startSnapshot?.value ?? portfolio.totalCostBasis;
    const endValue = portfolio.totalValue;

    // Calculate returns
    const twr = this.calculateTWR(startValue, endValue, periodCashFlows, startDate, endDate);
    const mwr = this.calculateMWR(startValue, endValue, periodCashFlows, startDate, endDate);

    const netCashFlow = periodCashFlows.reduce((sum, cf) => sum + cf.amount, 0);
    const periodDays = Math.floor(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      portfolio,
      positions,
      realizedGains,
      returns: {
        twr,
        mwr,
        periodDays,
        startDate,
        endDate,
        startValue,
        endValue,
        netCashFlow,
      },
      calculatedAt: new Date(),
    };
  }

  /**
   * Resolve period dates from options.
   */
  private resolvePeriodDates(options: PerformanceOptions): { startDate: Date; endDate: Date } {
    const endDate = options.customEndDate ?? new Date();
    let startDate: Date;

    switch (options.period) {
      case '1D':
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '1W':
        startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '1M':
        startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case '3M':
        startDate = new Date(endDate);
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'YTD':
        startDate = new Date(endDate.getFullYear(), 0, 1);
        break;
      case '1Y':
        startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'ALL':
        startDate = new Date(0); // Beginning of time
        break;
      case 'CUSTOM':
        startDate = options.customStartDate ?? new Date(0);
        break;
      default:
        startDate = new Date(endDate.getFullYear(), 0, 1); // Default to YTD
    }

    return { startDate, endDate };
  }
}
