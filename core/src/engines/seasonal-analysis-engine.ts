import { Transaction, Category } from '../types';

// Types for seasonal analysis
export interface SeasonalPattern {
  id: string;
  categoryId: string;
  year: number;
  month: number; // 1-12
  averageSpending: number;
  transactionCount: number;
  seasonalIndex: number; // ratio to overall average
  calculatedAt: Date;
}

export interface HolidaySpike {
  categoryId: string;
  categoryName: string;
  month: number;
  spike: number; // percentage above average
  description: string;
}

export interface SeasonalAnalysisResult {
  patterns: SeasonalPattern[];
  categoryAverages: Record<string, number>;
  seasonalIndices: Record<string, Record<number, number>>; // categoryId -> month -> index
  holidaySpikes: HolidaySpike[];
}

// Holiday periods by month
const HOLIDAY_DESCRIPTIONS: Record<number, string[]> = {
  1: ['New Year', 'Post-holiday'],
  2: ["Valentine's Day"],
  3: ['Spring Break'],
  4: ['Easter', 'Spring'],
  5: ["Mother's Day", 'Memorial Day'],
  6: ["Father's Day", 'Summer Start'],
  7: ['Independence Day', 'Summer'],
  8: ['Back to School'],
  9: ['Labor Day', 'Fall'],
  10: ['Halloween'],
  11: ['Thanksgiving', 'Black Friday'],
  12: ['Christmas', 'Holiday Season'],
};

// Categories typically affected by holidays
const HOLIDAY_SENSITIVE_CATEGORIES = [
  'gifts',
  'shopping',
  'entertainment',
  'dining',
  'restaurants',
  'travel',
  'groceries',
  'food',
  'clothing',
  'retail',
];

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `seasonal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate mean of values
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Group transactions by category and month
 */
function groupTransactionsByCategoryMonth(
  transactions: Transaction[]
): Map<string, Map<string, Transaction[]>> {
  // Map: categoryId -> (year-month key -> transactions)
  const groups = new Map<string, Map<string, Transaction[]>>();

  for (const tx of transactions) {
    if (!tx.categoryId || tx.amount >= 0) continue; // Only expenses with categories

    const date = new Date(tx.date);
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!groups.has(tx.categoryId)) {
      groups.set(tx.categoryId, new Map());
    }
    const categoryGroup = groups.get(tx.categoryId)!;

    if (!categoryGroup.has(yearMonth)) {
      categoryGroup.set(yearMonth, []);
    }
    categoryGroup.get(yearMonth)!.push(tx);
  }

  return groups;
}

/**
 * Calculate monthly spending totals for a category
 */
function calculateMonthlyTotals(
  monthlyTransactions: Map<string, Transaction[]>
): Map<string, { total: number; count: number }> {
  const totals = new Map<string, { total: number; count: number }>();

  for (const [yearMonth, txs] of monthlyTransactions) {
    const total = txs.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    totals.set(yearMonth, { total, count: txs.length });
  }

  return totals;
}

/**
 * Calculate seasonal patterns for all categories
 */
export function calculateSeasonalPatterns(
  transactions: Transaction[],
  categories: Category[],
  minMonths: number = 3
): SeasonalPattern[] {
  const patterns: SeasonalPattern[] = [];
  const grouped = groupTransactionsByCategoryMonth(transactions);
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  for (const [categoryId, monthlyTxs] of grouped) {
    const monthlyTotals = calculateMonthlyTotals(monthlyTxs);

    if (monthlyTotals.size < minMonths) continue;

    // Calculate overall average for this category
    const allTotals = Array.from(monthlyTotals.values()).map(m => m.total);
    const overallAvg = mean(allTotals);

    if (overallAvg === 0) continue;

    // Group by month (1-12) to get seasonal averages
    const monthlyAverages = new Map<number, { totals: number[]; counts: number[] }>();

    for (const [yearMonth, data] of monthlyTotals) {
      const month = parseInt(yearMonth.split('-')[1]);
      const year = parseInt(yearMonth.split('-')[0]);

      if (!monthlyAverages.has(month)) {
        monthlyAverages.set(month, { totals: [], counts: [] });
      }
      monthlyAverages.get(month)!.totals.push(data.total);
      monthlyAverages.get(month)!.counts.push(data.count);
    }

    // Create patterns for each month
    for (const [month, data] of monthlyAverages) {
      const avgSpending = mean(data.totals);
      const avgCount = mean(data.counts);
      const seasonalIndex = avgSpending / overallAvg;

      // Get the most recent year for this month
      const years = Array.from(monthlyTotals.keys())
        .filter(ym => parseInt(ym.split('-')[1]) === month)
        .map(ym => parseInt(ym.split('-')[0]));
      const mostRecentYear = Math.max(...years);

      patterns.push({
        id: generateId(),
        categoryId,
        year: mostRecentYear,
        month,
        averageSpending: avgSpending,
        transactionCount: Math.round(avgCount),
        seasonalIndex,
        calculatedAt: new Date(),
      });
    }
  }

  return patterns;
}

/**
 * Calculate category-level overall averages
 */
export function calculateCategoryAverages(
  transactions: Transaction[]
): Record<string, number> {
  const categoryTotals = new Map<string, { total: number; months: Set<string> }>();

  for (const tx of transactions) {
    if (!tx.categoryId || tx.amount >= 0) continue;

    const date = new Date(tx.date);
    const yearMonth = `${date.getFullYear()}-${date.getMonth() + 1}`;

    if (!categoryTotals.has(tx.categoryId)) {
      categoryTotals.set(tx.categoryId, { total: 0, months: new Set() });
    }

    const data = categoryTotals.get(tx.categoryId)!;
    data.total += Math.abs(tx.amount);
    data.months.add(yearMonth);
  }

  const averages: Record<string, number> = {};
  for (const [categoryId, data] of categoryTotals) {
    averages[categoryId] = data.months.size > 0 ? data.total / data.months.size : 0;
  }

  return averages;
}

/**
 * Build seasonal indices by category and month
 */
export function buildSeasonalIndices(
  patterns: SeasonalPattern[]
): Record<string, Record<number, number>> {
  const indices: Record<string, Record<number, number>> = {};

  for (const pattern of patterns) {
    if (!indices[pattern.categoryId]) {
      indices[pattern.categoryId] = {};
    }
    indices[pattern.categoryId][pattern.month] = pattern.seasonalIndex;
  }

  return indices;
}

/**
 * Detect holiday spending spikes
 */
export function detectHolidaySpikes(
  patterns: SeasonalPattern[],
  categories: Category[],
  spikeThreshold: number = 0.25 // 25% above average
): HolidaySpike[] {
  const spikes: HolidaySpike[] = [];
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  // Group patterns by category
  const patternsByCategory = new Map<string, SeasonalPattern[]>();
  for (const pattern of patterns) {
    if (!patternsByCategory.has(pattern.categoryId)) {
      patternsByCategory.set(pattern.categoryId, []);
    }
    patternsByCategory.get(pattern.categoryId)!.push(pattern);
  }

  for (const [categoryId, categoryPatterns] of patternsByCategory) {
    const category = categoryMap.get(categoryId);
    if (!category) continue;

    // Check if this category is holiday-sensitive
    const categoryNameLower = category.name.toLowerCase();
    const isHolidaySensitive = HOLIDAY_SENSITIVE_CATEGORIES.some(
      hc => categoryNameLower.includes(hc)
    );

    for (const pattern of categoryPatterns) {
      // Check for spike (seasonal index significantly above 1.0)
      const spikeAmount = pattern.seasonalIndex - 1.0;

      if (spikeAmount >= spikeThreshold) {
        const holidayDescriptions = HOLIDAY_DESCRIPTIONS[pattern.month] || [];
        const description = isHolidaySensitive && holidayDescriptions.length > 0
          ? `${holidayDescriptions[0]} spending spike`
          : `Seasonal spending increase`;

        spikes.push({
          categoryId,
          categoryName: category.name,
          month: pattern.month,
          spike: spikeAmount * 100, // Convert to percentage
          description,
        });
      }
    }
  }

  // Sort by spike magnitude
  spikes.sort((a, b) => b.spike - a.spike);

  return spikes;
}

/**
 * Get the month name
 */
export function getMonthName(month: number): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[month - 1] || 'Unknown';
}

/**
 * Predict spending for a future month based on seasonal patterns
 */
export function predictMonthlySpending(
  categoryId: string,
  month: number,
  categoryAverage: number,
  seasonalIndices: Record<string, Record<number, number>>
): number {
  const categoryIndices = seasonalIndices[categoryId];
  if (!categoryIndices || !categoryIndices[month]) {
    return categoryAverage; // Fall back to average
  }

  return categoryAverage * categoryIndices[month];
}

/**
 * Run full seasonal analysis
 */
export function analyzeSeasonalPatterns(
  transactions: Transaction[],
  categories: Category[],
  options: {
    minMonths?: number;
    spikeThreshold?: number;
  } = {}
): SeasonalAnalysisResult {
  const { minMonths = 3, spikeThreshold = 0.25 } = options;

  const patterns = calculateSeasonalPatterns(transactions, categories, minMonths);
  const categoryAverages = calculateCategoryAverages(transactions);
  const seasonalIndices = buildSeasonalIndices(patterns);
  const holidaySpikes = detectHolidaySpikes(patterns, categories, spikeThreshold);

  return {
    patterns,
    categoryAverages,
    seasonalIndices,
    holidaySpikes,
  };
}

// Legacy class-based API for backward compatibility
export class SeasonalAnalysisEngine {
  private getTransactions: () => Transaction[];
  private getCategories: () => Category[];

  constructor(dataSource: {
    getTransactions: () => Transaction[];
    getCategories: () => Category[];
  }) {
    this.getTransactions = dataSource.getTransactions;
    this.getCategories = dataSource.getCategories;
  }

  analyzeSeasonalPatterns(options?: {
    minMonths?: number;
    spikeThreshold?: number;
  }): SeasonalAnalysisResult {
    return analyzeSeasonalPatterns(
      this.getTransactions(),
      this.getCategories(),
      options
    );
  }

  calculateSeasonalPatterns(minMonths?: number): SeasonalPattern[] {
    return calculateSeasonalPatterns(
      this.getTransactions(),
      this.getCategories(),
      minMonths
    );
  }

  detectHolidaySpikes(spikeThreshold?: number): HolidaySpike[] {
    const patterns = this.calculateSeasonalPatterns();
    return detectHolidaySpikes(patterns, this.getCategories(), spikeThreshold);
  }

  predictMonthlySpending(categoryId: string, month: number): number {
    const result = this.analyzeSeasonalPatterns();
    const categoryAvg = result.categoryAverages[categoryId] || 0;
    return predictMonthlySpending(categoryId, month, categoryAvg, result.seasonalIndices);
  }
}
