import { Transaction, RecurringItem, Category } from '../types';

// Types for anomaly detection
export type AnomalyType = 'unusual_amount' | 'missing_recurring' | 'duplicate_charge';
export type AnomalySeverity = 'low' | 'medium' | 'high';

export interface Anomaly {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  transactionId?: string | null;
  recurringItemId?: string | null;
  description: string;
  amount?: number | null;
  expectedAmount?: number | null;
  zScore?: number | null;
  relatedTransactionIds?: string[];
  detectedAt: Date;
  acknowledged: boolean;
  dismissedAt?: Date | null;
}

export interface AnomalyDetectionResult {
  anomalies: Anomaly[];
  summary: {
    totalAnomalies: number;
    byType: Record<AnomalyType, number>;
    bySeverity: Record<AnomalySeverity, number>;
  };
}

interface CategoryStats {
  categoryId: string;
  mean: number;
  stdDev: number;
  count: number;
  transactions: Transaction[];
}

/**
 * Calculate mean of an array of numbers
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
 * Generate a unique ID for anomalies
 */
function generateId(): string {
  return `anomaly_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Normalize description for comparison (reusable pattern from recurring-detection)
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
 * Calculate z-score for a value given mean and standard deviation
 */
function calculateZScore(value: number, avg: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - avg) / sd;
}

/**
 * Determine severity based on z-score
 */
function getSeverityFromZScore(zScore: number): AnomalySeverity {
  const absZ = Math.abs(zScore);
  if (absZ >= 3) return 'high';
  if (absZ >= 2.5) return 'medium';
  return 'low';
}

/**
 * Calculate category statistics for anomaly detection
 */
function calculateCategoryStats(
  transactions: Transaction[],
  historyDays: number = 90
): Map<string, CategoryStats> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - historyDays);

  const stats = new Map<string, CategoryStats>();

  // Filter to historical transactions
  const historicalTxs = transactions.filter(
    t => new Date(t.date) >= cutoffDate && t.categoryId
  );

  // Group by category
  const byCategory = new Map<string, Transaction[]>();
  for (const tx of historicalTxs) {
    if (!tx.categoryId) continue;
    if (!byCategory.has(tx.categoryId)) {
      byCategory.set(tx.categoryId, []);
    }
    byCategory.get(tx.categoryId)!.push(tx);
  }

  // Calculate stats for each category
  for (const [categoryId, txs] of byCategory) {
    const amounts = txs.map(t => Math.abs(t.amount));
    const avg = mean(amounts);
    const sd = stdDev(amounts, avg);

    stats.set(categoryId, {
      categoryId,
      mean: avg,
      stdDev: sd,
      count: txs.length,
      transactions: txs,
    });
  }

  return stats;
}

/**
 * Detect unusual transaction amounts using z-scores
 */
export function detectUnusualAmounts(
  transactions: Transaction[],
  categories: Category[],
  zScoreThreshold: number = 2.0,
  historyDays: number = 90,
  lookbackDays: number = 30
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const categoryStats = calculateCategoryStats(transactions, historyDays);
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  // Check recent transactions against historical stats
  const recentTxs = transactions.filter(t => new Date(t.date) >= cutoffDate);

  for (const tx of recentTxs) {
    if (!tx.categoryId) continue;

    const stats = categoryStats.get(tx.categoryId);
    if (!stats || stats.count < 5) continue; // Need enough history

    const amount = Math.abs(tx.amount);
    const zScore = calculateZScore(amount, stats.mean, stats.stdDev);

    if (Math.abs(zScore) >= zScoreThreshold) {
      const category = categoryMap.get(tx.categoryId);
      const isHigh = amount > stats.mean;

      anomalies.push({
        id: generateId(),
        type: 'unusual_amount',
        severity: getSeverityFromZScore(zScore),
        transactionId: tx.id,
        description: `${isHigh ? 'Unusually high' : 'Unusually low'} ${category?.name || 'unknown'} transaction: $${(amount / 100).toFixed(2)} (${isHigh ? '+' : ''}${((zScore) * 100 / zScoreThreshold).toFixed(0)}% from typical)`,
        amount,
        expectedAmount: stats.mean,
        zScore,
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  return anomalies;
}

/**
 * Detect missing recurring transactions
 */
export function detectMissingRecurring(
  transactions: Transaction[],
  recurringItems: RecurringItem[],
  gracePeriodDays: number = 5
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const today = new Date();

  for (const item of recurringItems) {
    if (!item.isActive) continue;

    const expectedDate = new Date(item.nextOccurrence);
    const daysPastDue = Math.floor(
      (today.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Only flag if past grace period
    if (daysPastDue <= gracePeriodDays) continue;

    // Check if there's a matching transaction recently
    const normalized = normalizeDescription(item.description);
    const matchingTx = transactions.find(tx => {
      const txDate = new Date(tx.date);
      const daysDiff = Math.abs(
        (txDate.getTime() - expectedDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const normalizedTx = normalizeDescription(tx.description);
      return (
        daysDiff <= gracePeriodDays + 5 &&
        (normalizedTx.includes(normalized) || normalized.includes(normalizedTx))
      );
    });

    if (!matchingTx) {
      const severity: AnomalySeverity =
        daysPastDue > 14 ? 'high' : daysPastDue > 7 ? 'medium' : 'low';

      anomalies.push({
        id: generateId(),
        type: 'missing_recurring',
        severity,
        recurringItemId: item.id,
        description: `Missing recurring transaction: "${item.description}" was expected on ${expectedDate.toLocaleDateString()} (${daysPastDue} days ago)`,
        expectedAmount: Math.abs(item.amount),
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  return anomalies;
}

/**
 * Detect potential duplicate charges
 */
export function detectDuplicateCharges(
  transactions: Transaction[],
  windowDays: number = 3,
  lookbackDays: number = 30
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  // Filter to recent expense transactions
  const recentTxs = transactions
    .filter(t => new Date(t.date) >= cutoffDate && t.amount < 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const processed = new Set<string>();

  for (let i = 0; i < recentTxs.length; i++) {
    const tx = recentTxs[i];
    if (processed.has(tx.id)) continue;

    const normalized = normalizeDescription(tx.description);
    const duplicates: Transaction[] = [tx];

    // Look for similar transactions within the window
    for (let j = i + 1; j < recentTxs.length; j++) {
      const other = recentTxs[j];
      if (processed.has(other.id)) continue;

      const otherDate = new Date(other.date);
      const txDate = new Date(tx.date);
      const daysDiff = Math.floor(
        (otherDate.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff > windowDays) break;

      const otherNormalized = normalizeDescription(other.description);

      // Check if amounts match and descriptions are similar
      if (
        Math.abs(tx.amount - other.amount) < 0.01 &&
        (otherNormalized.includes(normalized) ||
          normalized.includes(otherNormalized) ||
          otherNormalized === normalized)
      ) {
        duplicates.push(other);
      }
    }

    if (duplicates.length >= 2) {
      // Mark all as processed
      duplicates.forEach(d => processed.add(d.id));

      const severity: AnomalySeverity =
        duplicates.length > 2 ? 'high' : 'medium';

      anomalies.push({
        id: generateId(),
        type: 'duplicate_charge',
        severity,
        transactionId: tx.id,
        description: `Potential duplicate charge: "${tx.description}" appears ${duplicates.length} times within ${windowDays} days for $${(Math.abs(tx.amount) / 100).toFixed(2)}`,
        amount: Math.abs(tx.amount),
        relatedTransactionIds: duplicates.map(d => d.id),
        detectedAt: new Date(),
        acknowledged: false,
      });
    }
  }

  return anomalies;
}

/**
 * Run full anomaly detection and return consolidated results
 */
export function detectAnomalies(
  transactions: Transaction[],
  recurringItems: RecurringItem[],
  categories: Category[],
  options: {
    zScoreThreshold?: number;
    historyDays?: number;
    lookbackDays?: number;
    gracePeriodDays?: number;
    duplicateWindowDays?: number;
  } = {}
): AnomalyDetectionResult {
  const {
    zScoreThreshold = 2.0,
    historyDays = 90,
    lookbackDays = 30,
    gracePeriodDays = 5,
    duplicateWindowDays = 3,
  } = options;

  const unusualAmounts = detectUnusualAmounts(
    transactions,
    categories,
    zScoreThreshold,
    historyDays,
    lookbackDays
  );

  const missingRecurring = detectMissingRecurring(
    transactions,
    recurringItems,
    gracePeriodDays
  );

  const duplicateCharges = detectDuplicateCharges(
    transactions,
    duplicateWindowDays,
    lookbackDays
  );

  const allAnomalies = [...unusualAmounts, ...missingRecurring, ...duplicateCharges];

  // Sort by severity (high first) then by date
  allAnomalies.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.detectedAt.getTime() - a.detectedAt.getTime();
  });

  // Calculate summary
  const byType: Record<AnomalyType, number> = {
    unusual_amount: 0,
    missing_recurring: 0,
    duplicate_charge: 0,
  };
  const bySeverity: Record<AnomalySeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };

  for (const anomaly of allAnomalies) {
    byType[anomaly.type]++;
    bySeverity[anomaly.severity]++;
  }

  return {
    anomalies: allAnomalies,
    summary: {
      totalAnomalies: allAnomalies.length,
      byType,
      bySeverity,
    },
  };
}

// Legacy class-based API for backward compatibility
export class AnomalyDetectionEngine {
  private getTransactions: () => Transaction[];
  private getRecurringItems: () => RecurringItem[];
  private getCategories: () => Category[];

  constructor(dataSource: {
    getTransactions: () => Transaction[];
    getRecurringItems: () => RecurringItem[];
    getCategories: () => Category[];
  }) {
    this.getTransactions = dataSource.getTransactions;
    this.getRecurringItems = dataSource.getRecurringItems;
    this.getCategories = dataSource.getCategories;
  }

  detectAnomalies(options?: {
    zScoreThreshold?: number;
    historyDays?: number;
    lookbackDays?: number;
    gracePeriodDays?: number;
    duplicateWindowDays?: number;
  }): AnomalyDetectionResult {
    return detectAnomalies(
      this.getTransactions(),
      this.getRecurringItems(),
      this.getCategories(),
      options
    );
  }

  detectUnusualAmounts(
    zScoreThreshold?: number,
    historyDays?: number,
    lookbackDays?: number
  ): Anomaly[] {
    return detectUnusualAmounts(
      this.getTransactions(),
      this.getCategories(),
      zScoreThreshold,
      historyDays,
      lookbackDays
    );
  }

  detectMissingRecurring(gracePeriodDays?: number): Anomaly[] {
    return detectMissingRecurring(
      this.getTransactions(),
      this.getRecurringItems(),
      gracePeriodDays
    );
  }

  detectDuplicateCharges(windowDays?: number, lookbackDays?: number): Anomaly[] {
    return detectDuplicateCharges(this.getTransactions(), windowDays, lookbackDays);
  }
}
