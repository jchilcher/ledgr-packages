/**
 * Enhanced Forecast Engine
 *
 * Provides long-term category spending forecasts (up to 5 years)
 * using seasonally-adjusted means with trend dampening.
 */

import {
  Transaction,
  Category,
  RecurringItem,
  ForecastGranularity,
  CategoryTrendProjection,
  ExtendedForecastOptions,
} from '../types';
import { SeasonalPattern, buildSeasonalIndices, calculateSeasonalPatterns, calculateCategoryAverages } from './seasonal-analysis-engine';

// Default configuration
const DEFAULT_TREND_DAMPENING_FACTOR = 0.95;
const DEFAULT_HISTORY_MONTHS = 12;
const DEFAULT_BASE_CONFIDENCE = 0.85;

export interface LongTermCategoryForecast {
  categoryId: string;
  categoryName: string;
  projections: CategoryTrendProjection[];
  summary: {
    totalProjected: number;
    averageMonthly: number;
    averageConfidence: number;
    trendDirection: 'increasing' | 'decreasing' | 'stable';
    seasonalVariation: number; // How much spending varies by season (0-1)
  };
}

export interface EnhancedForecastDependencies {
  getTransactions: () => Transaction[];
  getCategories: () => Category[];
  getRecurringItems: () => RecurringItem[];
}

/**
 * Calculate trend dampening factor at a given time
 * Trend influence decays exponentially over time
 *
 * @param monthsInFuture Number of months from now
 * @param dampeningFactor Base dampening factor (default 0.95)
 * @returns Multiplier for trend component (0-1)
 */
export function calculateTrendDampening(
  monthsInFuture: number,
  dampeningFactor: number = DEFAULT_TREND_DAMPENING_FACTOR
): number {
  return Math.pow(dampeningFactor, monthsInFuture);
}

/**
 * Calculate confidence decay over time
 * Confidence intervals widen as we project further into the future
 *
 * @param monthsInFuture Number of months from now
 * @param baseConfidence Starting confidence level
 * @returns Width multiplier for confidence interval
 */
export function calculateConfidenceDecay(
  monthsInFuture: number,
  baseConfidence: number = DEFAULT_BASE_CONFIDENCE
): number {
  // Confidence width = baseConfidence * sqrt(1 + t/90)
  // This means confidence intervals widen with square root of time
  const daysInFuture = monthsInFuture * 30;
  return baseConfidence / Math.sqrt(1 + daysInFuture / 90);
}

/**
 * Get annual seasonal indices for a category (12-month pattern)
 * Returns indices for months 1-12, where 1.0 = average spending
 *
 * @param patterns Seasonal patterns from analysis
 * @param categoryId Category to get indices for
 * @returns Record of month (1-12) to seasonal index
 */
export function getAnnualSeasonalIndices(
  patterns: SeasonalPattern[],
  categoryId: string
): Record<number, number> {
  const indices: Record<number, number> = {};
  const categoryPatterns = patterns.filter(p => p.categoryId === categoryId);

  // Initialize all months to 1.0 (neutral)
  for (let month = 1; month <= 12; month++) {
    indices[month] = 1.0;
  }

  // Override with actual indices where we have data
  for (const pattern of categoryPatterns) {
    indices[pattern.month] = pattern.seasonalIndex;
  }

  return indices;
}

/**
 * Calculate trend from historical data using linear regression
 *
 * @param monthlyTotals Array of monthly totals in chronological order
 * @returns Slope (change per month) and baseline
 */
function calculateTrend(monthlyTotals: number[]): { slope: number; baseline: number } {
  if (monthlyTotals.length < 2) {
    return { slope: 0, baseline: monthlyTotals[0] || 0 };
  }

  const n = monthlyTotals.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += monthlyTotals[i];
    sumXY += i * monthlyTotals[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return { slope: 0, baseline: sumY / n };
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const baseline = (sumY - slope * sumX) / n;

  return { slope, baseline };
}

/**
 * Calculate the amount from recurring items that should be subtracted
 * from category trend forecasts to avoid double-counting
 *
 * @param recurringItems Active recurring items
 * @param categoryId Category to calculate for
 * @param month Month number (1-12)
 * @returns Monthly amount from recurring items in this category
 */
export function calculateRecurringCategoryAmount(
  recurringItems: RecurringItem[],
  categoryId: string,
  month: number
): number {
  let monthlyAmount = 0;

  const categoryRecurring = recurringItems.filter(
    item => item.categoryId === categoryId && item.isActive && item.amount < 0
  );

  for (const item of categoryRecurring) {
    const amount = Math.abs(item.amount);

    switch (item.frequency) {
      case 'daily':
        monthlyAmount += amount * 30;
        break;
      case 'weekly':
        monthlyAmount += amount * 4.33;
        break;
      case 'biweekly':
        monthlyAmount += amount * 2.17;
        break;
      case 'monthly':
        monthlyAmount += amount;
        break;
      case 'quarterly':
        // Only add if this month is a quarter month
        const quarterMonths = [1, 4, 7, 10]; // Jan, Apr, Jul, Oct typical quarters
        if (quarterMonths.includes(month)) {
          monthlyAmount += amount;
        }
        break;
      case 'yearly':
        // Distribute yearly across all months
        monthlyAmount += amount / 12;
        break;
    }
  }

  return monthlyAmount;
}

/**
 * Calculate historical monthly totals for a category
 */
function calculateHistoricalMonthlyTotals(
  transactions: Transaction[],
  categoryId: string,
  historyMonths: number
): Map<string, number> {
  const monthlyTotals = new Map<string, number>();
  const now = new Date();
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - historyMonths);

  for (const tx of transactions) {
    if (tx.categoryId !== categoryId || tx.amount >= 0) continue;

    const txDate = new Date(tx.date);
    if (txDate < startDate || txDate > now) continue;

    const monthKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
    const current = monthlyTotals.get(monthKey) || 0;
    monthlyTotals.set(monthKey, current + Math.abs(tx.amount));
  }

  return monthlyTotals;
}

/**
 * Forecast category spending for the long term (up to 5 years)
 * Uses seasonally-adjusted mean with trend dampening
 *
 * Formula: Monthly Projection = BaselineMonthlyAvg × SeasonalIndex[month] × TrendFactor(t)
 *
 * @param transactions Historical transactions
 * @param categories All categories
 * @param recurringItems Active recurring items
 * @param categoryId Category to forecast
 * @param options Forecast options
 * @returns Long-term forecast for the category
 */
export function forecastCategorySpendingLongTerm(
  transactions: Transaction[],
  categories: Category[],
  recurringItems: RecurringItem[],
  categoryId: string,
  options: ExtendedForecastOptions
): LongTermCategoryForecast | null {
  const category = categories.find(c => c.id === categoryId);
  if (!category) return null;

  const {
    forecastDays,
    trendDampeningFactor = DEFAULT_TREND_DAMPENING_FACTOR,
    historyMonths = DEFAULT_HISTORY_MONTHS,
  } = options;

  // Calculate seasonal patterns
  const patterns = calculateSeasonalPatterns(transactions, categories, 3);
  const seasonalIndices = getAnnualSeasonalIndices(patterns, categoryId);

  // Calculate category average
  const categoryAverages = calculateCategoryAverages(transactions);
  const baselineMonthlyAvg = categoryAverages[categoryId] || 0;

  if (baselineMonthlyAvg === 0) {
    return null; // No spending history for this category
  }

  // Calculate historical monthly totals for trend
  const monthlyTotals = calculateHistoricalMonthlyTotals(transactions, categoryId, historyMonths);
  const sortedMonths = Array.from(monthlyTotals.keys()).sort();
  const totalsArray = sortedMonths.map(m => monthlyTotals.get(m)!);

  // Calculate trend
  const { slope, baseline } = calculateTrend(totalsArray);

  // Determine trend direction
  let trendDirection: 'increasing' | 'decreasing' | 'stable' = 'stable';
  const trendThreshold = baselineMonthlyAvg * 0.02; // 2% threshold
  if (slope > trendThreshold) trendDirection = 'increasing';
  else if (slope < -trendThreshold) trendDirection = 'decreasing';

  // Calculate seasonal variation (coefficient of variation of seasonal indices)
  const indexValues = Object.values(seasonalIndices);
  const meanIndex = indexValues.reduce((a, b) => a + b, 0) / indexValues.length;
  const varianceIndex = indexValues.reduce((sum, v) => sum + Math.pow(v - meanIndex, 2), 0) / indexValues.length;
  const seasonalVariation = Math.sqrt(varianceIndex) / meanIndex;

  // Generate projections
  const projections: CategoryTrendProjection[] = [];
  const startDate = new Date();
  let totalProjected = 0;
  let totalConfidence = 0;

  // Determine granularity
  const granularity = options.granularity || selectGranularity(forecastDays);

  // Generate projection points based on granularity
  const projectionDates = generateProjectionDates(startDate, forecastDays, granularity);

  for (const projDate of projectionDates) {
    const month = projDate.getMonth() + 1;
    const monthsInFuture = monthsSince(startDate, projDate);

    // Get seasonal index for this month
    const seasonalIndex = seasonalIndices[month] || 1.0;

    // Calculate trend dampening
    const trendFactor = calculateTrendDampening(monthsInFuture, trendDampeningFactor);

    // Calculate trend adjustment (dampened over time)
    const trendAdjustment = slope * monthsInFuture * trendFactor;

    // Base projection: average * seasonal adjustment + trend (dampened)
    let projectedAmount = (baselineMonthlyAvg + trendAdjustment) * seasonalIndex;

    // Subtract recurring items to avoid double-counting
    const recurringAmount = calculateRecurringCategoryAmount(recurringItems, categoryId, month);
    projectedAmount = Math.max(0, projectedAmount - recurringAmount);

    // Scale by period (daily/weekly projections are partial month)
    if (granularity === 'daily') {
      projectedAmount = projectedAmount / 30;
    } else if (granularity === 'weekly') {
      projectedAmount = projectedAmount / 4.33;
    }

    // Calculate confidence
    const confidence = calculateConfidenceDecay(monthsInFuture);

    // Calculate confidence interval
    const errorMargin = projectedAmount * (1 - confidence) * 0.3;
    const confidenceLower = Math.max(0, projectedAmount - errorMargin);
    const confidenceUpper = projectedAmount + errorMargin;

    projections.push({
      date: projDate,
      categoryId,
      categoryName: category.name,
      projectedAmount,
      confidence,
      confidenceLower,
      confidenceUpper,
      source: 'trend',
      seasonalIndex,
    });

    totalProjected += projectedAmount;
    totalConfidence += confidence;
  }

  const avgConfidence = projections.length > 0 ? totalConfidence / projections.length : 0;
  const avgMonthly = forecastDays > 0 ? (totalProjected / forecastDays) * 30 : 0;

  return {
    categoryId,
    categoryName: category.name,
    projections,
    summary: {
      totalProjected,
      averageMonthly: avgMonthly,
      averageConfidence: avgConfidence,
      trendDirection,
      seasonalVariation,
    },
  };
}

/**
 * Select appropriate granularity based on forecast horizon
 */
export function selectGranularity(forecastDays: number): ForecastGranularity {
  if (forecastDays <= 90) {
    return 'daily';
  } else if (forecastDays <= 365) {
    return 'weekly';
  } else {
    return 'monthly';
  }
}

/**
 * Generate projection dates based on granularity
 */
function generateProjectionDates(
  startDate: Date,
  forecastDays: number,
  granularity: ForecastGranularity
): Date[] {
  const dates: Date[] = [];
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + forecastDays);

  let current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    dates.push(new Date(current));

    switch (granularity) {
      case 'daily':
        current.setDate(current.getDate() + 1);
        break;
      case 'weekly':
        current.setDate(current.getDate() + 7);
        break;
      case 'monthly':
        current.setMonth(current.getMonth() + 1);
        break;
    }
  }

  return dates;
}

/**
 * Calculate months between two dates
 */
function monthsSince(startDate: Date, endDate: Date): number {
  return (
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth())
  );
}

/**
 * Forecast all categories for long-term
 * @param options.selectedCategoryIds - If provided, only forecast these categories
 */
export function forecastAllCategoriesLongTerm(
  transactions: Transaction[],
  categories: Category[],
  recurringItems: RecurringItem[],
  options: ExtendedForecastOptions
): LongTermCategoryForecast[] {
  let expenseCategories = categories.filter(c => c.type === 'expense');

  // Filter by selected categories if specified
  if (options.selectedCategoryIds && options.selectedCategoryIds.length > 0) {
    const selectedSet = new Set(options.selectedCategoryIds);
    expenseCategories = expenseCategories.filter(c => selectedSet.has(c.id));
  }

  const forecasts: LongTermCategoryForecast[] = [];

  for (const category of expenseCategories) {
    const forecast = forecastCategorySpendingLongTerm(
      transactions,
      categories,
      recurringItems,
      category.id,
      options
    );
    if (forecast) {
      forecasts.push(forecast);
    }
  }

  return forecasts.sort((a, b) => b.summary.totalProjected - a.summary.totalProjected);
}

/**
 * EnhancedForecastEngine class for dependency injection
 */
export class EnhancedForecastEngine {
  constructor(private deps: EnhancedForecastDependencies) {}

  forecastCategorySpendingLongTerm(
    categoryId: string,
    options: ExtendedForecastOptions
  ): LongTermCategoryForecast | null {
    return forecastCategorySpendingLongTerm(
      this.deps.getTransactions(),
      this.deps.getCategories(),
      this.deps.getRecurringItems(),
      categoryId,
      options
    );
  }

  forecastAllCategoriesLongTerm(
    options: ExtendedForecastOptions
  ): LongTermCategoryForecast[] {
    return forecastAllCategoriesLongTerm(
      this.deps.getTransactions(),
      this.deps.getCategories(),
      this.deps.getRecurringItems(),
      options
    );
  }

  selectGranularity(forecastDays: number): ForecastGranularity {
    return selectGranularity(forecastDays);
  }

  calculateTrendDampening(monthsInFuture: number, dampeningFactor?: number): number {
    return calculateTrendDampening(monthsInFuture, dampeningFactor);
  }

  calculateConfidenceDecay(monthsInFuture: number, baseConfidence?: number): number {
    return calculateConfidenceDecay(monthsInFuture, baseConfidence);
  }
}
