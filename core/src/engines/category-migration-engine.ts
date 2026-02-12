/**
 * Category Migration Engine
 *
 * Calculates spending proportions by category over rolling periods.
 * Identifies significant shifts (>5% proportion change).
 * Detects trends in category proportions.
 */

export interface TransactionData {
  id: string;
  date: Date | string;
  amount: number;
  categoryId: string | null;
  type: 'income' | 'expense';
}

export interface CategoryData {
  id: string;
  name: string;
  color?: string;
}

export interface CategoryProportion {
  categoryId: string;
  categoryName: string;
  amount: number;
  proportion: number;
  transactionCount: number;
}

export interface PeriodCategoryBreakdown {
  period: string;
  startDate: Date;
  endDate: Date;
  totalSpending: number;
  categories: CategoryProportion[];
}

export interface CategoryShift {
  categoryId: string;
  categoryName: string;
  previousProportion: number;
  currentProportion: number;
  proportionChange: number;
  amountChange: number;
  direction: 'increasing' | 'decreasing';
  significance: 'minor' | 'moderate' | 'significant';
}

export interface CategoryTrendPoint {
  period: string;
  proportion: number;
  amount: number;
}

export interface CategoryTrend {
  categoryId: string;
  categoryName: string;
  trend: 'increasing' | 'decreasing' | 'stable';
  averageProportion: number;
  volatility: number;
  history: CategoryTrendPoint[];
}

export interface CategoryMigrationReport {
  periods: PeriodCategoryBreakdown[];
  shifts: CategoryShift[];
  trends: CategoryTrend[];
  summary: {
    totalPeriodsAnalyzed: number;
    significantShifts: number;
    mostGrowingCategory: string | null;
    mostDecliningCategory: string | null;
    mostVolatileCategory: string | null;
    mostStableCategory: string | null;
  };
  recommendations: string[];
}

export interface CategoryMigrationDependencies {
  getTransactions: () => TransactionData[] | Promise<TransactionData[]>;
  getCategories: () => CategoryData[] | Promise<CategoryData[]>;
}

/**
 * Group transactions into monthly periods
 */
function groupByMonth(transactions: TransactionData[]): Map<string, TransactionData[]> {
  const groups = new Map<string, TransactionData[]>();

  for (const tx of transactions) {
    const date = new Date(tx.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!groups.has(monthKey)) {
      groups.set(monthKey, []);
    }
    groups.get(monthKey)!.push(tx);
  }

  return groups;
}

/**
 * Calculate category proportions for a period
 */
function calculateProportions(
  transactions: TransactionData[],
  categories: CategoryData[]
): CategoryProportion[] {
  const categoryMap = new Map(categories.map(c => [c.id, c]));
  const spending = new Map<string, { amount: number; count: number }>();

  let totalSpending = 0;

  for (const tx of transactions) {
    if (tx.type === 'expense' && tx.categoryId) {
      const current = spending.get(tx.categoryId) || { amount: 0, count: 0 };
      const amount = Math.abs(tx.amount);
      current.amount += amount;
      current.count += 1;
      spending.set(tx.categoryId, current);
      totalSpending += amount;
    }
  }

  const proportions: CategoryProportion[] = [];

  for (const [categoryId, data] of spending) {
    const category = categoryMap.get(categoryId);
    proportions.push({
      categoryId,
      categoryName: category?.name || 'Unknown',
      amount: data.amount,
      proportion: totalSpending > 0 ? (data.amount / totalSpending) * 100 : 0,
      transactionCount: data.count,
    });
  }

  return proportions.sort((a, b) => b.proportion - a.proportion);
}

/**
 * Build period breakdowns
 */
export function buildPeriodBreakdowns(
  transactions: TransactionData[],
  categories: CategoryData[],
  monthsBack: number = 12
): PeriodCategoryBreakdown[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  // Filter to expense transactions in date range
  const filtered = transactions.filter(tx => {
    const date = new Date(tx.date);
    return tx.type === 'expense' && date >= cutoff && date <= now;
  });

  const monthGroups = groupByMonth(filtered);
  const periods: PeriodCategoryBreakdown[] = [];

  // Sort months chronologically
  const sortedMonths = Array.from(monthGroups.keys()).sort();

  for (const monthKey of sortedMonths) {
    const txs = monthGroups.get(monthKey)!;
    const [year, month] = monthKey.split('-').map(Number);

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    const totalSpending = txs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    periods.push({
      period: monthKey,
      startDate,
      endDate,
      totalSpending,
      categories: calculateProportions(txs, categories),
    });
  }

  return periods;
}

/**
 * Detect significant category shifts between periods
 */
export function detectCategoryShifts(
  periods: PeriodCategoryBreakdown[],
  shiftThreshold: number = 5 // percentage points
): CategoryShift[] {
  if (periods.length < 2) return [];

  const shifts: CategoryShift[] = [];
  const currentPeriod = periods[periods.length - 1];
  const previousPeriod = periods[periods.length - 2];

  // Build maps for quick lookup
  const currentMap = new Map(currentPeriod.categories.map(c => [c.categoryId, c]));
  const previousMap = new Map(previousPeriod.categories.map(c => [c.categoryId, c]));

  // Check all categories from both periods
  const allCategoryIds = new Set([
    ...currentPeriod.categories.map(c => c.categoryId),
    ...previousPeriod.categories.map(c => c.categoryId),
  ]);

  for (const categoryId of allCategoryIds) {
    const current = currentMap.get(categoryId);
    const previous = previousMap.get(categoryId);

    const currentProportion = current?.proportion || 0;
    const previousProportion = previous?.proportion || 0;
    const proportionChange = currentProportion - previousProportion;

    if (Math.abs(proportionChange) >= shiftThreshold) {
      const significance =
        Math.abs(proportionChange) >= 15 ? 'significant' :
        Math.abs(proportionChange) >= 10 ? 'moderate' : 'minor';

      shifts.push({
        categoryId,
        categoryName: current?.categoryName || previous?.categoryName || 'Unknown',
        previousProportion,
        currentProportion,
        proportionChange,
        amountChange: (current?.amount || 0) - (previous?.amount || 0),
        direction: proportionChange > 0 ? 'increasing' : 'decreasing',
        significance,
      });
    }
  }

  return shifts.sort((a, b) => Math.abs(b.proportionChange) - Math.abs(a.proportionChange));
}

/**
 * Calculate category trends over time
 */
export function calculateCategoryTrends(
  periods: PeriodCategoryBreakdown[]
): CategoryTrend[] {
  if (periods.length < 3) return [];

  // Collect all categories seen
  const allCategories = new Map<string, string>();
  for (const period of periods) {
    for (const cat of period.categories) {
      allCategories.set(cat.categoryId, cat.categoryName);
    }
  }

  const trends: CategoryTrend[] = [];

  for (const [categoryId, categoryName] of allCategories) {
    const history: CategoryTrendPoint[] = [];

    for (const period of periods) {
      const cat = period.categories.find(c => c.categoryId === categoryId);
      history.push({
        period: period.period,
        proportion: cat?.proportion || 0,
        amount: cat?.amount || 0,
      });
    }

    // Calculate average and volatility
    const proportions = history.map(h => h.proportion);
    const avgProportion = proportions.reduce((a, b) => a + b, 0) / proportions.length;

    const squaredDiffs = proportions.map(p => (p - avgProportion) ** 2);
    const volatility = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / proportions.length);

    // Determine trend using simple linear regression slope
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < proportions.length; i++) {
      sumX += i;
      sumY += proportions[i];
      sumXY += i * proportions[i];
      sumXX += i * i;
    }
    const n = proportions.length;
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (slope > 0.5) {
      trend = 'increasing';
    } else if (slope < -0.5) {
      trend = 'decreasing';
    } else {
      trend = 'stable';
    }

    trends.push({
      categoryId,
      categoryName,
      trend,
      averageProportion: avgProportion,
      volatility,
      history,
    });
  }

  return trends.sort((a, b) => b.averageProportion - a.averageProportion);
}

/**
 * Generate full category migration report
 */
export async function analyzeCategoryMigration(
  deps: CategoryMigrationDependencies,
  options: { monthsBack?: number; shiftThreshold?: number } = {}
): Promise<CategoryMigrationReport> {
  const { monthsBack = 12, shiftThreshold = 5 } = options;

  const [transactions, categories] = await Promise.all([
    deps.getTransactions(),
    deps.getCategories(),
  ]);

  const periods = buildPeriodBreakdowns(transactions, categories, monthsBack);
  const shifts = detectCategoryShifts(periods, shiftThreshold);
  const trends = calculateCategoryTrends(periods);

  // Build summary
  const significantShifts = shifts.filter(s => s.significance === 'significant').length;

  let mostGrowingCategory: string | null = null;
  let mostDecliningCategory: string | null = null;
  let mostVolatileCategory: string | null = null;
  let mostStableCategory: string | null = null;

  if (trends.length > 0) {
    const growing = trends.filter(t => t.trend === 'increasing');
    const declining = trends.filter(t => t.trend === 'decreasing');

    if (growing.length > 0) {
      mostGrowingCategory = growing.reduce((max, t) =>
        t.averageProportion > max.averageProportion ? t : max
      ).categoryName;
    }

    if (declining.length > 0) {
      mostDecliningCategory = declining.reduce((max, t) =>
        t.averageProportion > max.averageProportion ? t : max
      ).categoryName;
    }

    mostVolatileCategory = trends.reduce((max, t) =>
      t.volatility > max.volatility ? t : max
    ).categoryName;

    mostStableCategory = trends.reduce((min, t) =>
      t.volatility < min.volatility ? t : min
    ).categoryName;
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (significantShifts > 0) {
    const increasingShifts = shifts.filter(s => s.direction === 'increasing' && s.significance === 'significant');
    if (increasingShifts.length > 0) {
      recommendations.push(
        `"${increasingShifts[0].categoryName}" spending has increased significantly (+${increasingShifts[0].proportionChange.toFixed(1)}%). Consider reviewing this category.`
      );
    }
  }

  if (mostVolatileCategory && mostVolatileCategory !== mostStableCategory) {
    const volatile = trends.find(t => t.categoryName === mostVolatileCategory);
    if (volatile && volatile.volatility > 10) {
      recommendations.push(
        `"${mostVolatileCategory}" has high spending volatility. Consider setting a budget to stabilize this category.`
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Your spending distribution has been relatively stable over the analyzed period.');
  }

  return {
    periods,
    shifts,
    trends,
    summary: {
      totalPeriodsAnalyzed: periods.length,
      significantShifts,
      mostGrowingCategory,
      mostDecliningCategory,
      mostVolatileCategory,
      mostStableCategory,
    },
    recommendations,
  };
}

/**
 * CategoryMigrationEngine class for dependency injection
 */
export class CategoryMigrationEngine {
  constructor(private deps: CategoryMigrationDependencies) {}

  async analyze(options?: { monthsBack?: number; shiftThreshold?: number }): Promise<CategoryMigrationReport> {
    return analyzeCategoryMigration(this.deps, options);
  }

  async getPeriodBreakdowns(monthsBack: number = 12): Promise<PeriodCategoryBreakdown[]> {
    const [transactions, categories] = await Promise.all([
      this.deps.getTransactions(),
      this.deps.getCategories(),
    ]);
    return buildPeriodBreakdowns(transactions, categories, monthsBack);
  }
}
