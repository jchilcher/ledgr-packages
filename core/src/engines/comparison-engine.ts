import { Transaction, Category } from '../types';

// Types for comparison reports
export interface SpendingComparison {
  categoryId: string;
  categoryName: string;
  currentPeriod: number;
  previousPeriod: number;
  variance: number;
  variancePercent: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface ComparisonPeriod {
  start: Date;
  end: Date;
  label: string;
}

export interface ComparisonReport {
  type: 'month_over_month' | 'year_over_year';
  currentPeriod: ComparisonPeriod;
  previousPeriod: ComparisonPeriod;
  comparisons: SpendingComparison[];
  totals: {
    currentTotal: number;
    previousTotal: number;
    variance: number;
    variancePercent: number;
  };
  budgetAdherenceScore: number;
  budgetAdherenceTrend: 'improving' | 'declining' | 'stable';
}

export interface BudgetGoal {
  id: string;
  categoryId: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
}

/**
 * Format month for display
 */
function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Get period dates for month-over-month comparison
 */
function getMonthOverMonthPeriods(): { current: ComparisonPeriod; previous: ComparisonPeriod } {
  const now = new Date();

  // Current month
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Previous month
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  return {
    current: {
      start: currentStart,
      end: currentEnd,
      label: formatMonth(currentStart),
    },
    previous: {
      start: previousStart,
      end: previousEnd,
      label: formatMonth(previousStart),
    },
  };
}

/**
 * Get period dates for year-over-year comparison (same month, previous year)
 */
function getYearOverYearPeriods(): { current: ComparisonPeriod; previous: ComparisonPeriod } {
  const now = new Date();

  // Current period (current month this year)
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // Same period last year
  const previousStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const previousEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0, 23, 59, 59, 999);

  return {
    current: {
      start: currentStart,
      end: currentEnd,
      label: formatMonth(currentStart),
    },
    previous: {
      start: previousStart,
      end: previousEnd,
      label: formatMonth(previousStart),
    },
  };
}

/**
 * Calculate spending for a category in a given period
 */
function calculatePeriodSpending(
  transactions: Transaction[],
  categoryId: string,
  start: Date,
  end: Date
): number {
  return transactions
    .filter(t => {
      const txDate = new Date(t.date);
      return (
        t.categoryId === categoryId &&
        t.amount < 0 &&
        txDate >= start &&
        txDate <= end
      );
    })
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

/**
 * Determine trend based on variance percentage
 */
function determineTrend(variancePercent: number): 'increasing' | 'decreasing' | 'stable' {
  if (variancePercent > 5) return 'increasing';
  if (variancePercent < -5) return 'decreasing';
  return 'stable';
}

/**
 * Calculate budget adherence score (0-100)
 */
function calculateBudgetAdherence(
  transactions: Transaction[],
  budgetGoals: BudgetGoal[],
  periodStart: Date,
  periodEnd: Date
): number {
  if (budgetGoals.length === 0) return 100;

  let totalScore = 0;
  let totalWeight = 0;

  for (const goal of budgetGoals) {
    if (goal.period !== 'monthly') continue;

    const spending = calculatePeriodSpending(
      transactions,
      goal.categoryId,
      periodStart,
      periodEnd
    );

    const adherenceRatio = goal.amount > 0 ? spending / goal.amount : 1;

    // Score: 100 if at or under budget, decreasing as over budget
    let score: number;
    if (adherenceRatio <= 1) {
      score = 100;
    } else if (adherenceRatio <= 1.25) {
      score = 100 - (adherenceRatio - 1) * 200; // 50-100
    } else if (adherenceRatio <= 1.5) {
      score = 50 - (adherenceRatio - 1.25) * 200; // 0-50
    } else {
      score = 0;
    }

    // Weight by budget amount
    totalScore += score * goal.amount;
    totalWeight += goal.amount;
  }

  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 100;
}

/**
 * Generate a month-over-month or year-over-year comparison report
 */
export function generateComparisonReport(
  transactions: Transaction[],
  categories: Category[],
  budgetGoals: BudgetGoal[],
  type: 'month_over_month' | 'year_over_year' = 'month_over_month'
): ComparisonReport {
  const periods = type === 'month_over_month'
    ? getMonthOverMonthPeriods()
    : getYearOverYearPeriods();

  const { current, previous } = periods;
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  // Get unique categories with spending in either period
  const expenseCategories = categories.filter(c => c.type === 'expense');

  const comparisons: SpendingComparison[] = [];

  for (const category of expenseCategories) {
    const currentSpending = calculatePeriodSpending(
      transactions,
      category.id,
      current.start,
      current.end
    );
    const previousSpending = calculatePeriodSpending(
      transactions,
      category.id,
      previous.start,
      previous.end
    );

    // Skip categories with no spending in either period
    if (currentSpending === 0 && previousSpending === 0) continue;

    const variance = currentSpending - previousSpending;
    const variancePercent = previousSpending > 0
      ? ((currentSpending - previousSpending) / previousSpending) * 100
      : currentSpending > 0 ? 100 : 0;

    comparisons.push({
      categoryId: category.id,
      categoryName: category.name,
      currentPeriod: currentSpending,
      previousPeriod: previousSpending,
      variance,
      variancePercent,
      trend: determineTrend(variancePercent),
    });
  }

  // Sort by absolute variance (biggest changes first)
  comparisons.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  // Calculate totals
  const currentTotal = comparisons.reduce((sum, c) => sum + c.currentPeriod, 0);
  const previousTotal = comparisons.reduce((sum, c) => sum + c.previousPeriod, 0);
  const totalVariance = currentTotal - previousTotal;
  const totalVariancePercent = previousTotal > 0
    ? ((currentTotal - previousTotal) / previousTotal) * 100
    : currentTotal > 0 ? 100 : 0;

  // Calculate budget adherence
  const currentAdherence = calculateBudgetAdherence(
    transactions,
    budgetGoals,
    current.start,
    current.end
  );
  const previousAdherence = calculateBudgetAdherence(
    transactions,
    budgetGoals,
    previous.start,
    previous.end
  );

  let adherenceTrend: 'improving' | 'declining' | 'stable';
  if (currentAdherence > previousAdherence + 5) {
    adherenceTrend = 'improving';
  } else if (currentAdherence < previousAdherence - 5) {
    adherenceTrend = 'declining';
  } else {
    adherenceTrend = 'stable';
  }

  return {
    type,
    currentPeriod: current,
    previousPeriod: previous,
    comparisons,
    totals: {
      currentTotal,
      previousTotal,
      variance: totalVariance,
      variancePercent: totalVariancePercent,
    },
    budgetAdherenceScore: currentAdherence,
    budgetAdherenceTrend: adherenceTrend,
  };
}

/**
 * Get budget adherence trend over multiple periods
 */
export function getBudgetAdherenceHistory(
  transactions: Transaction[],
  budgetGoals: BudgetGoal[],
  monthsBack: number = 6
): Array<{ month: string; score: number }> {
  const history: Array<{ month: string; score: number }> = [];
  const now = new Date();

  for (let i = monthsBack - 1; i >= 0; i--) {
    const periodStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

    const score = calculateBudgetAdherence(
      transactions,
      budgetGoals,
      periodStart,
      periodEnd
    );

    history.push({
      month: formatMonth(periodStart),
      score,
    });
  }

  return history;
}

// Legacy class-based API for backward compatibility
export class ComparisonEngine {
  private getTransactions: () => Transaction[];
  private getCategories: () => Category[];
  private getBudgetGoals: () => BudgetGoal[];

  constructor(dataSource: {
    getTransactions: () => Transaction[];
    getCategories: () => Category[];
    getBudgetGoals: () => BudgetGoal[];
  }) {
    this.getTransactions = dataSource.getTransactions;
    this.getCategories = dataSource.getCategories;
    this.getBudgetGoals = dataSource.getBudgetGoals;
  }

  generateComparisonReport(
    type: 'month_over_month' | 'year_over_year' = 'month_over_month'
  ): ComparisonReport {
    return generateComparisonReport(
      this.getTransactions(),
      this.getCategories(),
      this.getBudgetGoals(),
      type
    );
  }

  getBudgetAdherenceHistory(monthsBack: number = 6): Array<{ month: string; score: number }> {
    return getBudgetAdherenceHistory(
      this.getTransactions(),
      this.getBudgetGoals(),
      monthsBack
    );
  }
}
