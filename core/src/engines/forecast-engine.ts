import { Transaction, Category } from '../types';

export interface DataPoint {
  x: number;
  y: number;
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

export interface SpendingForecast {
  period: number;
  projectedSpending: number;
  confidence: number;
  historicalAverage: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidenceInterval: {
    lower: number;
    upper: number;
  };
}

export interface CategorySpendingForecast {
  categoryId: string;
  period: number;
  projectedSpending: number;
  confidence: number;
  historicalAverage: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  seasonalityFactor: number;
  transactionCount: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
}

/**
 * Calculate linear regression coefficients from data points
 * Returns null if insufficient data points (need at least 2)
 */
export function calculateLinearRegression(dataPoints: DataPoint[]): LinearRegressionResult | null {
  if (dataPoints.length < 2) {
    return null;
  }

  const n = dataPoints.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (const point of dataPoints) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumX2 += point.x * point.x;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R-squared (coefficient of determination)
  const meanY = sumY / n;
  let ssTotal = 0;
  let ssResidual = 0;

  for (const point of dataPoints) {
    const predicted = slope * point.x + intercept;
    ssTotal += (point.y - meanY) ** 2;
    ssResidual += (point.y - predicted) ** 2;
  }

  const rSquared = ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal;

  return {
    slope: isNaN(slope) ? 0 : slope,
    intercept: isNaN(intercept) ? 0 : intercept,
    rSquared: isNaN(rSquared) ? 0 : Math.max(0, Math.min(1, rSquared)),
  };
}

/**
 * Forecast spending for a future period based on historical data
 * @param transactions Array of transactions to analyze
 * @param forecastDays Number of days to forecast
 * @param historyDays Number of historical days to analyze (default 90)
 * @returns SpendingForecast or null if insufficient data
 */
export function forecastSpending(
  transactions: Transaction[],
  forecastDays: number,
  historyDays: number = 90
): SpendingForecast | null {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - historyDays);

  // Get all expense transactions in the history window
  const expenseTransactions = transactions.filter(
    t => t.amount < 0 && t.date >= startDate && t.date <= today
  );

  if (expenseTransactions.length < 7) {
    // Need at least a week of data
    return null;
  }

  // Group transactions by day and calculate daily spending
  const dailySpending = new Map<string, number>();

  for (const transaction of expenseTransactions) {
    const dateKey = transaction.date.toISOString().split('T')[0];
    const current = dailySpending.get(dateKey) || 0;
    dailySpending.set(dateKey, current + Math.abs(transaction.amount));
  }

  // Create data points for linear regression (x = day index, y = spending)
  const dataPoints: DataPoint[] = [];
  const sortedDates = Array.from(dailySpending.keys()).sort();

  sortedDates.forEach((dateKey, index) => {
    dataPoints.push({
      x: index,
      y: dailySpending.get(dateKey)!,
    });
  });

  const regression = calculateLinearRegression(dataPoints);

  if (!regression) {
    return null;
  }

  // Calculate historical average daily spending
  const totalSpending = Array.from(dailySpending.values()).reduce((a, b) => a + b, 0);
  const historicalAverage = totalSpending / sortedDates.length;

  // Project spending for the forecast period
  const lastDayIndex = dataPoints[dataPoints.length - 1].x;
  const futureDayIndices = Array.from({ length: forecastDays }, (_, i) => lastDayIndex + i + 1);

  let projectedSpending = 0;
  for (const dayIndex of futureDayIndices) {
    const predictedDailySpending = regression.slope * dayIndex + regression.intercept;
    projectedSpending += Math.max(0, predictedDailySpending);
  }

  // Determine trend
  let trend: 'increasing' | 'decreasing' | 'stable';
  const slopeThreshold = historicalAverage * 0.001;

  if (regression.slope > slopeThreshold) {
    trend = 'increasing';
  } else if (regression.slope < -slopeThreshold) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  // Calculate confidence interval
  const errorMargin = projectedSpending * (1 - regression.rSquared) * 0.15;

  return {
    period: forecastDays,
    projectedSpending,
    confidence: regression.rSquared,
    historicalAverage,
    trend,
    confidenceInterval: {
      lower: Math.max(0, projectedSpending - errorMargin),
      upper: projectedSpending + errorMargin,
    },
  };
}

/**
 * Generate forecasts for multiple periods
 */
export function generateMultiPeriodForecasts(
  transactions: Transaction[],
  periods: number[]
): SpendingForecast[] {
  const forecasts: SpendingForecast[] = [];

  for (const period of periods) {
    const forecast = forecastSpending(transactions, period);
    if (forecast) {
      forecasts.push(forecast);
    }
  }

  return forecasts;
}

/**
 * Forecast spending for a specific category
 * @param transactions Array of transactions to analyze
 * @param categoryId Category ID to forecast
 * @param forecastDays Number of days to forecast
 * @param historyDays Number of historical days to analyze (default 90)
 * @returns CategorySpendingForecast or null if insufficient data
 */
export function forecastCategorySpending(
  transactions: Transaction[],
  categoryId: string,
  forecastDays: number,
  historyDays: number = 90
): CategorySpendingForecast | null {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - historyDays);

  // Get historical transactions for this category
  const categoryTransactions = transactions.filter(tx => {
    const txDate = new Date(tx.date);
    return (
      tx.categoryId === categoryId &&
      tx.amount < 0 &&
      txDate >= startDate &&
      txDate <= endDate
    );
  });

  if (categoryTransactions.length < 7) {
    return null;
  }

  // Calculate daily spending
  const dailySpending = new Map<string, number>();
  categoryTransactions.forEach(tx => {
    const dateKey = new Date(tx.date).toISOString().split('T')[0];
    const current = dailySpending.get(dateKey) || 0;
    dailySpending.set(dateKey, current + Math.abs(tx.amount));
  });

  // Create data points for regression
  const dataPoints: DataPoint[] = [];
  let dayIndex = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateKey = d.toISOString().split('T')[0];
    const spending = dailySpending.get(dateKey) || 0;
    dataPoints.push({ x: dayIndex, y: spending });
    dayIndex++;
  }

  const regression = calculateLinearRegression(dataPoints);
  if (!regression) {
    return null;
  }

  // Calculate average daily spending
  const totalSpending = categoryTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const avgDailySpending = totalSpending / historyDays;

  // Detect seasonality
  const midPoint = Math.floor(dataPoints.length / 2);
  const firstHalfAvg = dataPoints.slice(0, midPoint).reduce((sum, p) => sum + p.y, 0) / midPoint;
  const secondHalfAvg = dataPoints.slice(midPoint).reduce((sum, p) => sum + p.y, 0) / (dataPoints.length - midPoint);
  const seasonalityFactor = firstHalfAvg > 0 ? secondHalfAvg / firstHalfAvg : 1;

  // Project spending
  const lastDayIndex = dataPoints.length - 1;
  let projectedSpending = 0;

  for (let i = 1; i <= forecastDays; i++) {
    const futureDayIndex = lastDayIndex + i;
    const trendValue = regression.slope * futureDayIndex + regression.intercept;
    const dailyForecast = Math.max(0, trendValue * seasonalityFactor);
    projectedSpending += dailyForecast;
  }

  // Determine trend
  const threshold = avgDailySpending * 0.05;
  let trend: 'increasing' | 'decreasing' | 'stable';
  if (regression.slope > threshold) {
    trend = 'increasing';
  } else if (regression.slope < -threshold) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  // Calculate confidence interval
  const errorMargin = projectedSpending * (1 - regression.rSquared) * 0.2;

  return {
    categoryId,
    period: forecastDays,
    projectedSpending,
    confidence: regression.rSquared,
    historicalAverage: avgDailySpending * forecastDays,
    trend,
    seasonalityFactor,
    transactionCount: categoryTransactions.length,
    confidenceInterval: {
      lower: Math.max(0, projectedSpending - errorMargin),
      upper: projectedSpending + errorMargin,
    },
  };
}

/**
 * Generate category forecasts for all expense categories with sufficient data
 */
export function forecastAllCategories(
  transactions: Transaction[],
  categories: Category[],
  forecastDays: number = 30,
  historyDays: number = 90
): CategorySpendingForecast[] {
  const expenseCategories = categories.filter(c => c.type === 'expense');
  const forecasts: CategorySpendingForecast[] = [];

  for (const category of expenseCategories) {
    const forecast = forecastCategorySpending(transactions, category.id, forecastDays, historyDays);
    if (forecast) {
      forecasts.push(forecast);
    }
  }

  return forecasts.sort((a, b) => b.projectedSpending - a.projectedSpending);
}

// Legacy class-based API for backward compatibility with desktop app
export class ForecastEngine {
  private getTransactions: () => Transaction[];
  private getCategories: () => Category[];

  constructor(dataSource: {
    getTransactions: () => Transaction[];
    getCategories: () => Category[];
  }) {
    this.getTransactions = dataSource.getTransactions;
    this.getCategories = dataSource.getCategories;
  }

  calculateLinearRegression(dataPoints: DataPoint[]): LinearRegressionResult | null {
    return calculateLinearRegression(dataPoints);
  }

  async forecastSpending(
    forecastDays: number,
    historyDays: number = 90
  ): Promise<SpendingForecast | null> {
    return forecastSpending(this.getTransactions(), forecastDays, historyDays);
  }

  async generateMultiPeriodForecasts(periods: number[]): Promise<SpendingForecast[]> {
    return generateMultiPeriodForecasts(this.getTransactions(), periods);
  }

  async forecastCategorySpending(
    categoryId: string,
    forecastDays: number,
    historyDays: number = 90
  ): Promise<CategorySpendingForecast | null> {
    return forecastCategorySpending(this.getTransactions(), categoryId, forecastDays, historyDays);
  }

  async forecastAllCategories(
    forecastDays: number = 30,
    historyDays: number = 90
  ): Promise<CategorySpendingForecast[]> {
    return forecastAllCategories(
      this.getTransactions(),
      this.getCategories(),
      forecastDays,
      historyDays
    );
  }
}
