import { Transaction } from '../types';

// Types for income analysis
export type IncomeFrequency = 'weekly' | 'biweekly' | 'monthly' | 'irregular';

export interface IncomeStream {
  id: string;
  description: string;
  normalizedDescription: string;
  averageAmount: number;
  frequency: IncomeFrequency;
  lastReceived: Date;
  occurrences: number;
  transactionIds: string[];
  varianceCoefficient: number; // std dev / mean (lower = more consistent)
  reliabilityScore: number; // 0-100
}

export interface IncomeAnalysisSummary {
  totalMonthlyIncome: number;
  totalAnnualIncome: number;
  primaryIncomeStream?: IncomeStream;
  incomeStabilityScore: number; // 0-100
  diversificationScore: number; // 0-100 (higher = more diverse sources)
}

export interface IncomeAnalysisResult {
  streams: IncomeStream[];
  summary: IncomeAnalysisSummary;
  recommendations: string[];
}

interface IncomeGroup {
  normalizedDescription: string;
  transactions: Transaction[];
}

/**
 * Normalize description for grouping income sources
 */
function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[#\d]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Calculate mean of values
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function stdDev(values: number[], avg?: number): number {
  if (values.length < 2) return 0;
  const m = avg ?? mean(values);
  const squaredDiffs = values.map(v => Math.pow(v - m, 2));
  return Math.sqrt(mean(squaredDiffs));
}

/**
 * Calculate the average interval between dates in days
 */
function averageInterval(dates: Date[]): number {
  if (dates.length < 2) return 0;

  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const days = Math.round(
      (sorted[i].getTime() - sorted[i - 1].getTime()) / (1000 * 60 * 60 * 24)
    );
    intervals.push(days);
  }

  return mean(intervals);
}

/**
 * Determine frequency based on average interval
 */
function determineFrequency(avgInterval: number): IncomeFrequency {
  if (avgInterval <= 0) return 'irregular';
  if (avgInterval <= 10) return 'weekly';
  if (avgInterval <= 18) return 'biweekly';
  if (avgInterval <= 45) return 'monthly';
  return 'irregular';
}

/**
 * Calculate frequency multiplier to get monthly equivalent
 */
function frequencyToMonthlyMultiplier(frequency: IncomeFrequency): number {
  switch (frequency) {
    case 'weekly':
      return 4.33; // Average weeks per month
    case 'biweekly':
      return 2.17;
    case 'monthly':
      return 1;
    case 'irregular':
      return 1; // Will be calculated differently
  }
}

/**
 * Calculate reliability score based on consistency
 */
function calculateReliabilityScore(
  varianceCoefficient: number,
  occurrences: number,
  frequency: IncomeFrequency
): number {
  // Base score from variance (lower variance = higher score)
  let score = Math.max(0, 100 - varianceCoefficient * 100);

  // Boost for more occurrences (up to 10 points)
  const occurrenceBoost = Math.min(occurrences / 6, 1) * 10;
  score += occurrenceBoost;

  // Penalty for irregular frequency
  if (frequency === 'irregular') {
    score *= 0.7;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Group income transactions by normalized description
 */
function groupIncomeTransactions(
  transactions: Transaction[],
  historyDays: number = 365
): Map<string, IncomeGroup> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - historyDays);

  const groups = new Map<string, IncomeGroup>();

  // Filter to income transactions only (positive amounts)
  const incomeTransactions = transactions.filter(
    t => t.amount > 0 && new Date(t.date) >= cutoffDate
  );

  for (const tx of incomeTransactions) {
    const normalized = normalizeDescription(tx.description);
    if (normalized.length < 3) continue;

    if (!groups.has(normalized)) {
      groups.set(normalized, {
        normalizedDescription: normalized,
        transactions: [],
      });
    }
    groups.get(normalized)!.transactions.push(tx);
  }

  return groups;
}

/**
 * Identify income streams from transaction data
 */
export function identifyIncomeStreams(
  transactions: Transaction[],
  options: {
    historyDays?: number;
    minOccurrences?: number;
  } = {}
): IncomeStream[] {
  const { historyDays = 365, minOccurrences = 2 } = options;

  const groups = groupIncomeTransactions(transactions, historyDays);
  const streams: IncomeStream[] = [];

  for (const [normalized, group] of groups) {
    if (group.transactions.length < minOccurrences) continue;

    const amounts = group.transactions.map(t => t.amount);
    const dates = group.transactions.map(t => new Date(t.date));
    const avgAmount = mean(amounts);
    const amountStdDev = stdDev(amounts, avgAmount);
    const varianceCoefficient = avgAmount > 0 ? amountStdDev / avgAmount : 1;
    const avgInterval = averageInterval(dates);
    const frequency = determineFrequency(avgInterval);

    // Sort by date to get most recent
    const sorted = [...group.transactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const reliabilityScore = calculateReliabilityScore(
      varianceCoefficient,
      group.transactions.length,
      frequency
    );

    streams.push({
      id: sorted[0].description.replace(/\s+/g, '-').toLowerCase() + '-' + frequency,
      description: sorted[0].description,
      normalizedDescription: normalized,
      averageAmount: avgAmount,
      frequency,
      lastReceived: new Date(sorted[0].date),
      occurrences: group.transactions.length,
      transactionIds: group.transactions.map(t => t.id),
      varianceCoefficient,
      reliabilityScore,
    });
  }

  // Sort by average amount (highest first)
  streams.sort((a, b) => b.averageAmount - a.averageAmount);

  return streams;
}

/**
 * Calculate monthly income from streams
 */
function calculateMonthlyIncome(streams: IncomeStream[]): number {
  let total = 0;

  for (const stream of streams) {
    if (stream.frequency === 'irregular') {
      // For irregular income, calculate monthly average from occurrence rate
      const oldestDate = new Date(Math.min(...stream.transactionIds.map(() => Date.now())));
      // Estimate: spread occurrences over the time period
      const monthsOfData = Math.max(1, stream.occurrences / 12);
      total += (stream.averageAmount * stream.occurrences) / monthsOfData / 12;
    } else {
      const multiplier = frequencyToMonthlyMultiplier(stream.frequency);
      total += stream.averageAmount * multiplier;
    }
  }

  return total;
}

/**
 * Calculate overall income stability score
 */
function calculateStabilityScore(streams: IncomeStream[]): number {
  if (streams.length === 0) return 0;

  // Weight reliability scores by income contribution
  const totalIncome = streams.reduce((sum, s) => sum + s.averageAmount, 0);
  if (totalIncome === 0) return 0;

  let weightedScore = 0;
  for (const stream of streams) {
    const weight = stream.averageAmount / totalIncome;
    weightedScore += stream.reliabilityScore * weight;
  }

  return Math.round(weightedScore);
}

/**
 * Calculate diversification score
 */
function calculateDiversificationScore(streams: IncomeStream[]): number {
  if (streams.length === 0) return 0;
  if (streams.length === 1) return 20; // Low diversification

  const totalIncome = streams.reduce((sum, s) => sum + s.averageAmount, 0);
  if (totalIncome === 0) return 0;

  // Calculate Herfindahl-Hirschman Index (HHI) for concentration
  let hhi = 0;
  for (const stream of streams) {
    const share = stream.averageAmount / totalIncome;
    hhi += share * share;
  }

  // Convert HHI to diversification score (lower HHI = more diversified)
  // HHI ranges from 1/n to 1
  // Score of 100 = perfectly diversified, 0 = single source
  const diversificationScore = (1 - hhi) * 100;

  // Boost score based on number of streams
  const streamBonus = Math.min(streams.length * 5, 20);

  return Math.min(100, Math.round(diversificationScore + streamBonus));
}

/**
 * Generate recommendations based on income analysis
 */
function generateRecommendations(
  streams: IncomeStream[],
  summary: IncomeAnalysisSummary
): string[] {
  const recommendations: string[] = [];

  // Low stability
  if (summary.incomeStabilityScore < 50) {
    recommendations.push(
      'Your income stability is relatively low. Consider building an emergency fund of 6+ months of expenses.'
    );
  }

  // Low diversification
  if (summary.diversificationScore < 30) {
    recommendations.push(
      'Your income is concentrated in few sources. Diversifying income streams can provide more financial security.'
    );
  }

  // Single income source
  if (streams.length === 1) {
    recommendations.push(
      'You have a single income source. Consider developing additional income streams for financial resilience.'
    );
  }

  // Irregular income
  const irregularStreams = streams.filter(s => s.frequency === 'irregular');
  if (irregularStreams.length > 0 && irregularStreams.length === streams.length) {
    recommendations.push(
      'All your income sources are irregular. Budget based on your lowest expected monthly income to avoid shortfalls.'
    );
  }

  // High variance in primary income
  if (summary.primaryIncomeStream && summary.primaryIncomeStream.varianceCoefficient > 0.2) {
    recommendations.push(
      `Your primary income source (${summary.primaryIncomeStream.description}) varies significantly. Build extra buffer in your budget for lower-income months.`
    );
  }

  // Good stability
  if (summary.incomeStabilityScore >= 80) {
    recommendations.push(
      'Your income is highly stable. This is a good foundation for long-term financial planning and investing.'
    );
  }

  return recommendations;
}

/**
 * Perform full income analysis
 */
export function analyzeIncome(
  transactions: Transaction[],
  options: {
    historyDays?: number;
    minOccurrences?: number;
  } = {}
): IncomeAnalysisResult {
  const streams = identifyIncomeStreams(transactions, options);

  const totalMonthlyIncome = calculateMonthlyIncome(streams);
  const incomeStabilityScore = calculateStabilityScore(streams);
  const diversificationScore = calculateDiversificationScore(streams);

  const summary: IncomeAnalysisSummary = {
    totalMonthlyIncome,
    totalAnnualIncome: totalMonthlyIncome * 12,
    primaryIncomeStream: streams.length > 0 ? streams[0] : undefined,
    incomeStabilityScore,
    diversificationScore,
  };

  const recommendations = generateRecommendations(streams, summary);

  return {
    streams,
    summary,
    recommendations,
  };
}

/**
 * Calculate smoothed income (moving average)
 */
export function calculateSmoothedIncome(
  transactions: Transaction[],
  windowMonths: number = 3
): Array<{ month: string; actual: number; smoothed: number }> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

  // Group income by month
  const monthlyIncome = new Map<string, number>();
  const incomeTransactions = transactions.filter(
    t => t.amount > 0 && new Date(t.date) >= cutoffDate
  );

  for (const tx of incomeTransactions) {
    const date = new Date(tx.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    monthlyIncome.set(monthKey, (monthlyIncome.get(monthKey) || 0) + tx.amount);
  }

  // Sort months
  const sortedMonths = Array.from(monthlyIncome.keys()).sort();

  // Calculate moving average
  const result: Array<{ month: string; actual: number; smoothed: number }> = [];

  for (let i = 0; i < sortedMonths.length; i++) {
    const month = sortedMonths[i];
    const actual = monthlyIncome.get(month) || 0;

    // Calculate smoothed value (average of window)
    const windowStart = Math.max(0, i - windowMonths + 1);
    const windowMonthsData = sortedMonths.slice(windowStart, i + 1);
    const windowSum = windowMonthsData.reduce(
      (sum, m) => sum + (monthlyIncome.get(m) || 0),
      0
    );
    const smoothed = windowSum / windowMonthsData.length;

    result.push({ month, actual, smoothed });
  }

  return result;
}

// Legacy class-based API for backward compatibility
export class IncomeAnalysisEngine {
  private getTransactions: () => Transaction[];

  constructor(dataSource: { getTransactions: () => Transaction[] }) {
    this.getTransactions = dataSource.getTransactions;
  }

  analyzeIncome(options?: {
    historyDays?: number;
    minOccurrences?: number;
  }): IncomeAnalysisResult {
    return analyzeIncome(this.getTransactions(), options);
  }

  identifyIncomeStreams(options?: {
    historyDays?: number;
    minOccurrences?: number;
  }): IncomeStream[] {
    return identifyIncomeStreams(this.getTransactions(), options);
  }

  calculateSmoothedIncome(windowMonths?: number): Array<{ month: string; actual: number; smoothed: number }> {
    return calculateSmoothedIncome(this.getTransactions(), windowMonths);
  }
}
