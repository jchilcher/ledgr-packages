import {
  NetWorthComponent,
  NetWorthCalculation,
  NetWorthChangeSummary,
  NetWorthProjectionConfig,
  NetWorthForecast,
  NetWorthForecastPoint,
  LoanPayoffCalculation,
  LoanExtraPaymentImpact,
} from '../types';

/**
 * NetWorthService - Core business logic for net worth calculations and projections
 *
 * Features:
 * - Aggregate bank accounts, investments, and manual assets/liabilities into net worth
 * - Calculate period-over-period changes with category breakdowns
 * - Project future net worth based on historical trends or manual assumptions
 * - Calculate loan payoff schedules with amortization
 * - Analyze impact of extra payments on loans
 *
 * Note: This service contains pure calculation logic. Database access and snapshot
 * creation are handled by the NetWorthEngine in the desktop app.
 */
export class NetWorthService {
  /**
   * Calculates complete net worth from all components
   *
   * @param bankAccounts Array of bank account components
   * @param investments Array of investment account components
   * @param assets Array of manual asset components
   * @param liabilities Array of manual liability components
   * @param previousSnapshot Optional previous snapshot for change calculation
   * @returns Complete net worth calculation with breakdowns
   */
  calculateNetWorth(
    bankAccounts: NetWorthComponent[],
    investments: NetWorthComponent[],
    assets: NetWorthComponent[],
    liabilities: NetWorthComponent[],
    previousSnapshot?: { netWorth: number; date: Date } | null
  ): NetWorthCalculation {
    const bankAccountsTotal = bankAccounts.reduce((sum, acc) => sum + acc.value, 0);
    const investmentAccountsTotal = investments.reduce((sum, inv) => sum + inv.value, 0);
    const manualAssetsTotal = assets.reduce((sum, asset) => sum + asset.value, 0);
    const manualLiabilitiesTotal = liabilities.reduce((sum, liab) => sum + Math.abs(liab.value), 0);

    const totalAssets = bankAccountsTotal + investmentAccountsTotal + manualAssetsTotal;
    const totalLiabilities = manualLiabilitiesTotal;
    const netWorth = totalAssets - totalLiabilities;

    // Calculate change from previous snapshot
    let changeFromPrevious: number | null = null;
    let changePercentFromPrevious: number | null = null;

    if (previousSnapshot) {
      changeFromPrevious = netWorth - previousSnapshot.netWorth;
      changePercentFromPrevious =
        previousSnapshot.netWorth !== 0
          ? (changeFromPrevious / Math.abs(previousSnapshot.netWorth)) * 100
          : 0;
    }

    return {
      date: new Date(),
      bankAccountsTotal,
      investmentAccountsTotal,
      manualAssetsTotal,
      totalAssets,
      manualLiabilitiesTotal,
      totalLiabilities,
      netWorth,
      bankAccounts,
      investmentAccounts: investments,
      manualAssets: assets,
      liabilities,
      changeFromPrevious,
      changePercentFromPrevious,
    };
  }

  /**
   * Calculates change summary between two time periods
   *
   * @param startSnapshot Snapshot at start of period
   * @param endSnapshot Snapshot at end of period
   * @returns Change summary with category-level breakdowns
   */
  calculateChangeSummary(
    startSnapshot: NetWorthCalculation,
    endSnapshot: NetWorthCalculation
  ): NetWorthChangeSummary {
    const days = Math.floor(
      (endSnapshot.date.getTime() - startSnapshot.date.getTime()) / (1000 * 60 * 60 * 24)
    );

    const change = endSnapshot.netWorth - startSnapshot.netWorth;
    const changePercent =
      startSnapshot.netWorth !== 0
        ? (change / Math.abs(startSnapshot.netWorth)) * 100
        : 0;

    const assetsChange = endSnapshot.totalAssets - startSnapshot.totalAssets;
    const liabilitiesChange = endSnapshot.totalLiabilities - startSnapshot.totalLiabilities;

    // Calculate category-level changes
    const categoryChanges = [
      {
        category: 'Bank Accounts',
        type: 'asset' as const,
        change: endSnapshot.bankAccountsTotal - startSnapshot.bankAccountsTotal,
        changePercent:
          startSnapshot.bankAccountsTotal !== 0
            ? ((endSnapshot.bankAccountsTotal - startSnapshot.bankAccountsTotal) /
                Math.abs(startSnapshot.bankAccountsTotal)) *
              100
            : 0,
      },
      {
        category: 'Investments',
        type: 'asset' as const,
        change: endSnapshot.investmentAccountsTotal - startSnapshot.investmentAccountsTotal,
        changePercent:
          startSnapshot.investmentAccountsTotal !== 0
            ? ((endSnapshot.investmentAccountsTotal - startSnapshot.investmentAccountsTotal) /
                Math.abs(startSnapshot.investmentAccountsTotal)) *
              100
            : 0,
      },
      {
        category: 'Manual Assets',
        type: 'asset' as const,
        change: endSnapshot.manualAssetsTotal - startSnapshot.manualAssetsTotal,
        changePercent:
          startSnapshot.manualAssetsTotal !== 0
            ? ((endSnapshot.manualAssetsTotal - startSnapshot.manualAssetsTotal) /
                Math.abs(startSnapshot.manualAssetsTotal)) *
              100
            : 0,
      },
      {
        category: 'Liabilities',
        type: 'liability' as const,
        change: endSnapshot.manualLiabilitiesTotal - startSnapshot.manualLiabilitiesTotal,
        changePercent:
          startSnapshot.manualLiabilitiesTotal !== 0
            ? ((endSnapshot.manualLiabilitiesTotal - startSnapshot.manualLiabilitiesTotal) /
                Math.abs(startSnapshot.manualLiabilitiesTotal)) *
              100
            : 0,
      },
    ];

    return {
      period: {
        startDate: startSnapshot.date,
        endDate: endSnapshot.date,
        days,
      },
      startNetWorth: startSnapshot.netWorth,
      endNetWorth: endSnapshot.netWorth,
      change,
      changePercent,
      assetsChange,
      liabilitiesChange,
      categoryChanges,
    };
  }

  /**
   * Generates net worth projections based on historical trends or manual assumptions
   *
   * @param currentNetWorth Current net worth in cents
   * @param historicalSnapshots Historical snapshots for trend analysis
   * @param config Projection configuration
   * @returns Net worth projection with confidence intervals
   */
  generateProjections(
    currentNetWorth: number,
    currentAssets: number,
    currentLiabilities: number,
    historicalSnapshots: Array<{ date: Date; netWorth: number; totalAssets: number; totalLiabilities: number }>,
    config: NetWorthProjectionConfig
  ): NetWorthForecast {
    const useTrend = config.useTrendAnalysis !== false;
    const trendMonths = config.trendMonths || 12;
    const confidenceLevel = config.confidenceLevel || 0.90;

    let monthlyGrowthRate = 0;
    let confidence = 100;

    if (useTrend && historicalSnapshots.length >= 2) {
      // Calculate historical growth rate using linear regression
      const result = this.calculateTrendGrowthRate(historicalSnapshots, trendMonths);
      monthlyGrowthRate = result.monthlyGrowthRate;
      confidence = result.confidence;
    } else if (config.monthlyAssetGrowth !== undefined || config.monthlyLiabilityReduction !== undefined) {
      // Use manual assumptions
      const assetGrowth = config.monthlyAssetGrowth || 0;
      const liabilityReduction = config.monthlyLiabilityReduction || 0;
      monthlyGrowthRate = (assetGrowth + liabilityReduction) / (currentNetWorth || 1);
      confidence = 80; // Lower confidence for manual assumptions
    }

    // Generate monthly projections
    const projections: NetWorthForecastPoint[] = [];
    let projectedAssets = currentAssets;
    let projectedLiabilities = currentLiabilities;
    let projectedNetWorth = currentNetWorth;

    for (let month = 1; month <= config.months; month++) {
      const projectionDate = new Date();
      projectionDate.setMonth(projectionDate.getMonth() + month);

      // Calculate projected values
      if (useTrend && historicalSnapshots.length >= 2) {
        // Linear projection based on historical trend
        const monthlyNetWorthGrowth = monthlyGrowthRate * currentNetWorth;
        const monthlyAssetGrowth = monthlyGrowthRate * 0.6 * currentAssets;
        const monthlyLiabilityReduction = monthlyGrowthRate * 0.4 * currentLiabilities;

        projectedNetWorth = currentNetWorth + monthlyNetWorthGrowth * month;
        projectedAssets = currentAssets + monthlyAssetGrowth * month;
        projectedLiabilities = Math.max(0, currentLiabilities - monthlyLiabilityReduction * month);
      } else {
        // Manual assumption-based projection
        const assetGrowth = config.monthlyAssetGrowth || 0;
        const liabilityReduction = config.monthlyLiabilityReduction || 0;

        projectedAssets = currentAssets + (assetGrowth * month);
        projectedLiabilities = Math.max(0, currentLiabilities - (liabilityReduction * month));
        projectedNetWorth = projectedAssets - projectedLiabilities;
      }

      // Calculate confidence interval (wider as we project further)
      const timeDecayFactor = 1 - (month / config.months) * 0.3; // Confidence decreases over time
      const stdDevFactor = 1.96; // 95% confidence interval (z-score)
      const variability = Math.abs(projectedNetWorth) * 0.15 * (1 - timeDecayFactor); // 15% max variability

      const lowerBound = projectedNetWorth - (variability * stdDevFactor);
      const upperBound = projectedNetWorth + (variability * stdDevFactor);

      projections.push({
        date: projectionDate,
        projected: Math.round(projectedNetWorth),
        lowerBound: Math.round(lowerBound),
        upperBound: Math.round(upperBound),
        assets: Math.round(projectedAssets),
        liabilities: Math.round(projectedLiabilities),
      });
    }

    // Generate milestones
    const milestones = this.generateMilestones(currentNetWorth, projections);

    return {
      config,
      currentNetWorth,
      projections,
      historicalGrowthRate: useTrend ? monthlyGrowthRate : undefined,
      confidence: useTrend ? confidence : undefined,
      milestones,
    };
  }

  /**
   * Calculates loan payoff schedule using amortization formula
   *
   * @param liabilityId ID of the liability
   * @param liabilityName Name of the liability
   * @param currentBalance Current balance in cents
   * @param interestRate Annual interest rate as decimal (e.g., 0.065 for 6.5%)
   * @param monthlyPayment Monthly payment in cents
   * @returns Complete payoff calculation with amortization schedule
   */
  calculateLoanPayoff(
    liabilityId: string,
    liabilityName: string,
    currentBalance: number,
    interestRate: number,
    monthlyPayment: number
  ): LoanPayoffCalculation {
    if (monthlyPayment <= 0) {
      throw new Error('Monthly payment must be greater than 0');
    }

    const monthlyRate = interestRate / 12;
    const schedule: LoanPayoffCalculation['schedule'] = [];
    let remainingBalance = currentBalance;
    let month = 0;
    let totalInterestRemaining = 0;

    // Generate amortization schedule
    while (remainingBalance > 0 && month < 600) { // Cap at 50 years
      month++;
      const date = new Date();
      date.setMonth(date.getMonth() + month);

      const interestPayment = Math.round(remainingBalance * monthlyRate);
      let principalPayment = monthlyPayment - interestPayment;

      // Handle final payment
      if (principalPayment >= remainingBalance) {
        principalPayment = remainingBalance;
        const actualPayment = principalPayment + interestPayment;
        remainingBalance = 0;

        schedule.push({
          month,
          date,
          payment: actualPayment,
          principal: principalPayment,
          interest: interestPayment,
          remainingBalance: 0,
        });

        totalInterestRemaining += interestPayment;
        break;
      }

      remainingBalance -= principalPayment;
      totalInterestRemaining += interestPayment;

      schedule.push({
        month,
        date,
        payment: monthlyPayment,
        principal: principalPayment,
        interest: interestPayment,
        remainingBalance,
      });
    }

    // If loan isn't paid off (payment too low), calculate minimum required
    if (remainingBalance > 0) {
      throw new Error(
        `Monthly payment is too low to pay off the loan. Minimum required: $${Math.ceil((currentBalance * monthlyRate) / 100)}`
      );
    }

    const payoffDate = schedule[schedule.length - 1].date;
    const totalAmountToBePaid = currentBalance + totalInterestRemaining;

    return {
      liabilityId,
      liabilityName,
      currentBalance,
      interestRate,
      monthlyPayment,
      monthsRemaining: schedule.length,
      payoffDate,
      totalInterestRemaining,
      totalAmountToBePaid,
      schedule,
    };
  }

  /**
   * Calculates the impact of making extra payments on a loan
   *
   * @param baselinePayoff Baseline payoff calculation
   * @param extraMonthlyPayment Additional monthly payment in cents
   * @returns Impact analysis showing time and interest saved
   */
  calculateExtraPaymentImpact(
    baselinePayoff: LoanPayoffCalculation,
    extraMonthlyPayment: number
  ): LoanExtraPaymentImpact {
    if (extraMonthlyPayment <= 0) {
      throw new Error('Extra payment must be greater than 0');
    }

    const newMonthlyPayment = baselinePayoff.monthlyPayment + extraMonthlyPayment;

    // Calculate new payoff schedule
    const newPayoff = this.calculateLoanPayoff(
      baselinePayoff.liabilityId,
      baselinePayoff.liabilityName,
      baselinePayoff.currentBalance,
      baselinePayoff.interestRate,
      newMonthlyPayment
    );

    const monthsSaved = baselinePayoff.monthsRemaining - newPayoff.monthsRemaining;
    const interestSaved = baselinePayoff.totalInterestRemaining - newPayoff.totalInterestRemaining;
    const totalSavings = interestSaved;

    return {
      extraMonthlyPayment,
      newMonthsRemaining: newPayoff.monthsRemaining,
      newPayoffDate: newPayoff.payoffDate,
      monthsSaved,
      interestSaved,
      totalSavings,
    };
  }

  /**
   * Private: Calculates historical growth rate using linear regression
   */
  private calculateTrendGrowthRate(
    snapshots: Array<{ date: Date; netWorth: number }>,
    trendMonths: number
  ): { monthlyGrowthRate: number; confidence: number } {
    // Filter to recent snapshots within trendMonths
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - trendMonths);

    const recentSnapshots = snapshots
      .filter(s => s.date >= cutoffDate)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (recentSnapshots.length < 2) {
      return { monthlyGrowthRate: 0, confidence: 0 };
    }

    // Calculate monthly growth rate using simple linear regression
    const firstSnapshot = recentSnapshots[0];
    const lastSnapshot = recentSnapshots[recentSnapshots.length - 1];

    const monthsDiff = (lastSnapshot.date.getTime() - firstSnapshot.date.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    const netWorthDiff = lastSnapshot.netWorth - firstSnapshot.netWorth;

    if (monthsDiff === 0 || firstSnapshot.netWorth === 0) {
      return { monthlyGrowthRate: 0, confidence: 0 };
    }

    // Calculate monthly growth rate as percentage
    const totalGrowthRate = netWorthDiff / Math.abs(firstSnapshot.netWorth);
    const monthlyGrowthRate = totalGrowthRate / monthsDiff;

    // Calculate confidence based on data points and consistency
    const confidence = Math.min(
      100,
      (recentSnapshots.length / trendMonths) * 100 * 0.8 + 20 // More data = higher confidence
    );

    return { monthlyGrowthRate, confidence };
  }

  /**
   * Private: Generates milestone projections
   */
  private generateMilestones(
    currentNetWorth: number,
    projections: NetWorthForecastPoint[]
  ): NetWorthForecast['milestones'] {
    const milestones: NetWorthForecast['milestones'] = [];

    // Define milestone amounts based on current net worth
    const milestoneAmounts = [
      10000000,  // $100k
      25000000,  // $250k
      50000000,  // $500k
      100000000, // $1M
      250000000, // $2.5M
      500000000, // $5M
    ].filter(amount => amount > currentNetWorth);

    for (const amount of milestoneAmounts.slice(0, 5)) { // Limit to 5 milestones
      const projection = projections.find(p => p.projected >= amount);

      milestones.push({
        amount,
        label: this.formatCurrency(amount),
        projectedDate: projection?.date || null,
        achieved: false,
      });
    }

    return milestones;
  }

  /**
   * Private: Formats cents to currency string
   */
  private formatCurrency(cents: number): string {
    const dollars = cents / 100;

    if (dollars >= 1000000) {
      return `$${(dollars / 1000000).toFixed(1)}M`;
    } else if (dollars >= 1000) {
      return `$${(dollars / 1000).toFixed(0)}k`;
    } else {
      return `$${dollars.toFixed(0)}`;
    }
  }
}

// Export singleton instance
export const netWorthService = new NetWorthService();
