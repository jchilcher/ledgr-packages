import {
  RecurringFrequency,
  RecurringTransaction,
  Account,
  Transaction,
  Category,
  RecurringItem,
  ForecastGranularity,
  ExtendedForecastOptions,
  EnhancedBalanceProjection,
  EnhancedCashFlowForecast,
  EnhancedProjectedTransaction,
  CategoryTrendProjection,
} from '../types';
import {
  forecastAllCategoriesLongTerm,
  selectGranularity,
  LongTermCategoryForecast,
} from './enhanced-forecast-engine';

export interface ProjectedTransaction {
  date: Date;
  description: string;
  amount: number;
  categoryId: string | null;
  source: 'recurring';
}

export interface CashFlowWarning {
  type: 'negative_balance' | 'low_balance';
  date: Date;
  balance: number;
  message: string;
}

export interface BalanceProjection {
  date: Date;
  balance: number;
  transactions: ProjectedTransaction[];
}

export interface CashFlowForecast {
  accountId: string;
  startingBalance: number;
  projections: BalanceProjection[];
  warnings: CashFlowWarning[];
}

/**
 * Calculate the next occurrence date based on frequency
 * Uses setUTC* methods to preserve the original time component,
 * avoiding off-by-one display errors from UTC midnight → local timezone conversion.
 */
export function calculateNextOccurrence(currentDate: Date, frequency: RecurringFrequency): Date {
  const result = new Date(currentDate.getTime());

  switch (frequency) {
    case 'daily':
      result.setUTCDate(result.getUTCDate() + 1);
      break;
    case 'weekly':
      result.setUTCDate(result.getUTCDate() + 7);
      break;
    case 'biweekly':
      result.setUTCDate(result.getUTCDate() + 14);
      break;
    case 'monthly':
      result.setUTCMonth(result.getUTCMonth() + 1);
      break;
    case 'quarterly':
      result.setUTCMonth(result.getUTCMonth() + 3);
      break;
    case 'yearly':
      result.setUTCFullYear(result.getUTCFullYear() + 1);
      break;
  }

  return result;
}

/**
 * Project all recurring transactions within a date range
 */
export function projectRecurringTransactions(
  recurringTransactions: RecurringTransaction[],
  startDate: Date,
  endDate: Date
): ProjectedTransaction[] {
  const projectedTransactions: ProjectedTransaction[] = [];

  for (const recurring of recurringTransactions) {
    let currentOccurrence = new Date(recurring.nextOccurrence);

    // Project all occurrences within the date range
    while (currentOccurrence <= endDate) {
      // Check if we've passed the recurring transaction's end date
      if (recurring.endDate && currentOccurrence > recurring.endDate) {
        break;
      }

      // Only include if within start date
      if (currentOccurrence >= startDate) {
        projectedTransactions.push({
          date: new Date(currentOccurrence),
          description: recurring.description,
          amount: recurring.amount,
          categoryId: recurring.categoryId || null,
          source: 'recurring',
        });
      }

      // Calculate next occurrence
      currentOccurrence = calculateNextOccurrence(currentOccurrence, recurring.frequency);
    }
  }

  // Sort by date
  projectedTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

  return projectedTransactions;
}

/**
 * Forecast account balance over time with recurring transactions
 */
export function forecastCashFlow(
  account: Account,
  recurringTransactions: RecurringTransaction[],
  startDate: Date,
  endDate: Date,
  lowBalanceThreshold: number = 50000
): CashFlowForecast {
  const startingBalance = account.balance;
  const projectedTransactions = projectRecurringTransactions(
    recurringTransactions.filter(r => r.accountId === account.id),
    startDate,
    endDate
  );

  // Group transactions by date
  const transactionsByDate = new Map<string, ProjectedTransaction[]>();
  for (const tx of projectedTransactions) {
    const dateKey = tx.date.toISOString().split('T')[0];
    if (!transactionsByDate.has(dateKey)) {
      transactionsByDate.set(dateKey, []);
    }
    transactionsByDate.get(dateKey)!.push(tx);
  }

  // Create balance projections
  const projections: BalanceProjection[] = [];
  const warnings: CashFlowWarning[] = [];
  let currentBalance = startingBalance;

  // Sort dates
  const sortedDates = Array.from(transactionsByDate.keys()).sort();

  for (const dateKey of sortedDates) {
    const transactions = transactionsByDate.get(dateKey)!;
    const date = new Date(dateKey);

    // Apply all transactions for this date
    for (const tx of transactions) {
      currentBalance += tx.amount;
    }

    projections.push({
      date,
      balance: currentBalance,
      transactions,
    });

    // Check for warnings (skip for credit accounts — negative balances are normal)
    if (account.type !== 'credit') {
      if (currentBalance < 0) {
        warnings.push({
          type: 'negative_balance',
          date,
          balance: currentBalance,
          message: `Balance will be negative ($${(currentBalance / 100).toFixed(2)}) on ${date.toLocaleDateString()}`,
        });
      } else if (currentBalance < lowBalanceThreshold) {
        warnings.push({
          type: 'low_balance',
          date,
          balance: currentBalance,
          message: `Low balance ($${(currentBalance / 100).toFixed(2)}) on ${date.toLocaleDateString()}`,
        });
      }
    }
  }

  return {
    accountId: account.id,
    startingBalance,
    projections,
    warnings,
  };
}

// ==================== Enhanced Cash Flow Forecasting ====================

export interface EnhancedCashFlowDependencies {
  getAccountById: (id: string) => Account | null;
  getRecurringTransactionsByAccount: (accountId: string) => RecurringTransaction[];
  getTransactions: () => Transaction[];
  getCategories: () => Category[];
  getRecurringItems: () => RecurringItem[];
}

/**
 * Project recurring items (unified model) within a date range
 */
export function projectRecurringItems(
  recurringItems: RecurringItem[],
  startDate: Date,
  endDate: Date
): EnhancedProjectedTransaction[] {
  const projectedTransactions: EnhancedProjectedTransaction[] = [];

  for (const item of recurringItems) {
    if (!item.isActive) continue;

    let currentOccurrence = new Date(item.nextOccurrence);

    while (currentOccurrence <= endDate) {
      if (item.endDate && currentOccurrence > item.endDate) {
        break;
      }

      if (currentOccurrence >= startDate) {
        projectedTransactions.push({
          date: new Date(currentOccurrence),
          description: item.description,
          amount: item.amount,
          categoryId: item.categoryId || null,
          source: 'recurring',
          confidence: 1.0,
        });
      }

      currentOccurrence = calculateNextOccurrence(currentOccurrence, item.frequency);
    }
  }

  projectedTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());
  return projectedTransactions;
}

/**
 * Merge recurring transactions with category trend projections
 * Aggregates by the appropriate granularity
 */
export function mergeRecurringAndTrends(
  recurringTransactions: EnhancedProjectedTransaction[],
  categoryForecasts: LongTermCategoryForecast[],
  granularity: ForecastGranularity
): EnhancedProjectedTransaction[] {
  const merged: EnhancedProjectedTransaction[] = [...recurringTransactions];

  // Add trend projections as transactions
  for (const forecast of categoryForecasts) {
    for (const projection of forecast.projections) {
      if (projection.projectedAmount > 0) {
        merged.push({
          date: projection.date,
          description: `${forecast.categoryName} (projected)`,
          amount: -projection.projectedAmount, // Expenses are negative
          categoryId: projection.categoryId,
          source: 'trend',
          confidence: projection.confidence,
        });
      }
    }
  }

  // Sort by date
  merged.sort((a, b) => a.date.getTime() - b.date.getTime());

  return merged;
}

/**
 * Aggregate transactions by granularity (group daily into weekly/monthly)
 */
function aggregateByGranularity(
  projections: EnhancedBalanceProjection[],
  granularity: ForecastGranularity
): EnhancedBalanceProjection[] {
  if (granularity === 'daily') {
    return projections;
  }

  const aggregated: EnhancedBalanceProjection[] = [];
  let currentGroup: EnhancedBalanceProjection | null = null;
  let currentPeriodKey = '';

  for (const proj of projections) {
    const periodKey = getPeriodKey(proj.date, granularity);

    if (periodKey !== currentPeriodKey) {
      if (currentGroup) {
        aggregated.push(currentGroup);
      }

      currentPeriodKey = periodKey;
      currentGroup = {
        date: getPeriodStartDate(proj.date, granularity),
        balance: proj.balance,
        balanceLower: proj.balanceLower,
        balanceUpper: proj.balanceUpper,
        confidence: proj.confidence,
        recurringTotal: 0,
        trendTotal: 0,
        transactions: [],
        categoryTrends: [],
      };
    }

    if (currentGroup) {
      currentGroup.balance = proj.balance;
      currentGroup.balanceLower = proj.balanceLower;
      currentGroup.balanceUpper = proj.balanceUpper;
      currentGroup.confidence = Math.min(currentGroup.confidence, proj.confidence);
      currentGroup.recurringTotal += proj.recurringTotal;
      currentGroup.trendTotal += proj.trendTotal;
      currentGroup.transactions.push(...proj.transactions);
      if (proj.categoryTrends) {
        currentGroup.categoryTrends = currentGroup.categoryTrends || [];
        currentGroup.categoryTrends.push(...proj.categoryTrends);
      }
    }
  }

  if (currentGroup) {
    aggregated.push(currentGroup);
  }

  return aggregated;
}

function getPeriodKey(date: Date, granularity: ForecastGranularity): string {
  if (granularity === 'weekly') {
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return weekStart.toISOString().split('T')[0];
  } else {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
}

function getPeriodStartDate(date: Date, granularity: ForecastGranularity): Date {
  if (granularity === 'weekly') {
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  } else {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
}

/**
 * Enhanced cash flow forecast combining recurring items with category trends
 */
export function forecastCashFlowEnhanced(
  account: Account,
  recurringItems: RecurringItem[],
  transactions: Transaction[],
  categories: Category[],
  options: ExtendedForecastOptions,
  lowBalanceThreshold: number = 50000
): EnhancedCashFlowForecast {
  const {
    forecastDays,
    includeCategoryTrends = false,
    granularity: requestedGranularity,
  } = options;

  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + forecastDays);

  const granularity = requestedGranularity || selectGranularity(forecastDays);

  // Get recurring transactions for this account
  const accountRecurring = recurringItems.filter(
    item => item.accountId === account.id || item.accountId === null
  );
  const recurringTxs = projectRecurringItems(accountRecurring, startDate, endDate);

  // Get category trend forecasts if enabled
  let categoryForecasts: LongTermCategoryForecast[] = [];
  if (includeCategoryTrends) {
    categoryForecasts = forecastAllCategoriesLongTerm(
      transactions,
      categories,
      recurringItems,
      options
    );
  }

  // Merge recurring and trends
  const allTransactions = includeCategoryTrends
    ? mergeRecurringAndTrends(recurringTxs, categoryForecasts, granularity)
    : recurringTxs;

  // Group transactions by date
  const transactionsByDate = new Map<string, EnhancedProjectedTransaction[]>();
  for (const tx of allTransactions) {
    const dateKey = tx.date.toISOString().split('T')[0];
    if (!transactionsByDate.has(dateKey)) {
      transactionsByDate.set(dateKey, []);
    }
    transactionsByDate.get(dateKey)!.push(tx);
  }

  // Create balance projections
  const projections: EnhancedBalanceProjection[] = [];
  const warnings: EnhancedCashFlowForecast['warnings'] = [];

  let currentBalance = account.balance;
  let currentBalanceLower = account.balance;
  let currentBalanceUpper = account.balance;

  let totalRecurringIncome = 0;
  let totalRecurringExpenses = 0;
  let totalTrendExpenses = 0;
  let totalConfidence = 0;
  let lowestBalance = account.balance;
  let lowestBalanceDate: Date | null = null;

  // Generate daily projections
  for (let d = 0; d <= forecastDays; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dateKey = date.toISOString().split('T')[0];

    const dayTransactions = transactionsByDate.get(dateKey) || [];

    let dayRecurringTotal = 0;
    let dayTrendTotal = 0;
    let dayConfidences: number[] = [];
    const categoryTrends: CategoryTrendProjection[] = [];

    for (const tx of dayTransactions) {
      currentBalance += tx.amount;

      if (tx.source === 'recurring') {
        if (tx.amount > 0) {
          totalRecurringIncome += tx.amount;
        } else {
          totalRecurringExpenses += Math.abs(tx.amount);
        }
        dayRecurringTotal += tx.amount;
      } else {
        totalTrendExpenses += Math.abs(tx.amount);
        dayTrendTotal += tx.amount;

        // Calculate confidence bounds
        const confidence = tx.confidence || 0.5;
        const errorMargin = Math.abs(tx.amount) * (1 - confidence) * 0.3;

        currentBalanceLower += tx.amount - errorMargin;
        currentBalanceUpper += tx.amount + errorMargin;
        dayConfidences.push(confidence);

        // Add to category trends
        if (tx.categoryId) {
          categoryTrends.push({
            date,
            categoryId: tx.categoryId,
            projectedAmount: Math.abs(tx.amount),
            confidence,
            confidenceLower: Math.abs(tx.amount) - errorMargin,
            confidenceUpper: Math.abs(tx.amount) + errorMargin,
            source: 'trend',
          });
        }
      }
    }

    // Calculate daily confidence
    const dayConfidence = dayConfidences.length > 0
      ? dayConfidences.reduce((a, b) => a + b, 0) / dayConfidences.length
      : 1.0;

    totalConfidence += dayConfidence;

    // Track lowest balance
    if (currentBalance < lowestBalance) {
      lowestBalance = currentBalance;
      lowestBalanceDate = new Date(date);
    }

    projections.push({
      date: new Date(date),
      balance: currentBalance,
      balanceLower: currentBalanceLower,
      balanceUpper: currentBalanceUpper,
      confidence: dayConfidence,
      recurringTotal: dayRecurringTotal,
      trendTotal: dayTrendTotal,
      transactions: dayTransactions,
      categoryTrends: categoryTrends.length > 0 ? categoryTrends : undefined,
    });

    // Check for warnings (skip for credit accounts — negative balances are normal)
    if (account.type !== 'credit') {
      if (currentBalance < 0) {
        warnings.push({
          type: 'negative_balance',
          date: new Date(date),
          balance: currentBalance,
          message: `Balance will be negative ($${(currentBalance / 100).toFixed(2)}) on ${date.toLocaleDateString()}`,
        });
      } else if (currentBalance < lowBalanceThreshold) {
        warnings.push({
          type: 'low_balance',
          date: new Date(date),
          balance: currentBalance,
          message: `Low balance ($${(currentBalance / 100).toFixed(2)}) on ${date.toLocaleDateString()}`,
        });
      }
    }

    // Warn about high uncertainty
    if (dayConfidence < 0.5 && includeCategoryTrends) {
      warnings.push({
        type: 'high_uncertainty',
        date: new Date(date),
        balance: currentBalance,
        message: `High forecast uncertainty (${(dayConfidence * 100).toFixed(0)}% confidence) on ${date.toLocaleDateString()}`,
      });
    }
  }

  // Aggregate by granularity if not daily
  const finalProjections = aggregateByGranularity(projections, granularity);

  const avgConfidence = forecastDays > 0 ? totalConfidence / (forecastDays + 1) : 1.0;
  const endingProjection = finalProjections[finalProjections.length - 1];

  return {
    accountId: account.id,
    startingBalance: account.balance,
    forecastDays,
    granularity,
    includedCategoryTrends: includeCategoryTrends,
    projections: finalProjections,
    warnings,
    summary: {
      endingBalance: endingProjection?.balance || account.balance,
      endingBalanceLower: endingProjection?.balanceLower || account.balance,
      endingBalanceUpper: endingProjection?.balanceUpper || account.balance,
      totalRecurringIncome,
      totalRecurringExpenses,
      totalTrendExpenses,
      averageConfidence: avgConfidence,
      lowestBalance,
      lowestBalanceDate,
    },
  };
}

// Legacy class-based API for backward compatibility with desktop app
export class CashFlowEngine {
  private getAccountById: (id: string) => Account | null;
  private getRecurringTransactionsByAccount: (accountId: string) => RecurringTransaction[];

  constructor(dataSource: {
    getAccountById: (id: string) => Account | null;
    getRecurringTransactionsByAccount: (accountId: string) => RecurringTransaction[];
  }) {
    this.getAccountById = dataSource.getAccountById;
    this.getRecurringTransactionsByAccount = dataSource.getRecurringTransactionsByAccount;
  }

  calculateNextOccurrence(currentDate: Date, frequency: RecurringFrequency): Date {
    return calculateNextOccurrence(currentDate, frequency);
  }

  projectRecurringTransactions(
    accountId: string,
    startDate: Date,
    endDate: Date
  ): ProjectedTransaction[] {
    const recurringTxs = this.getRecurringTransactionsByAccount(accountId);
    return projectRecurringTransactions(recurringTxs, startDate, endDate);
  }

  forecastCashFlow(accountId: string, startDate: Date, endDate: Date): CashFlowForecast {
    const account = this.getAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const recurringTxs = this.getRecurringTransactionsByAccount(accountId);
    return forecastCashFlow(account, recurringTxs, startDate, endDate);
  }
}

/**
 * Enhanced CashFlowEngine with category trend support
 */
export class EnhancedCashFlowEngine {
  constructor(private deps: EnhancedCashFlowDependencies) {}

  calculateNextOccurrence(currentDate: Date, frequency: RecurringFrequency): Date {
    return calculateNextOccurrence(currentDate, frequency);
  }

  projectRecurringItems(
    accountId: string,
    startDate: Date,
    endDate: Date
  ): EnhancedProjectedTransaction[] {
    const items = this.deps.getRecurringItems().filter(
      item => item.accountId === accountId || item.accountId === null
    );
    return projectRecurringItems(items, startDate, endDate);
  }

  forecastCashFlow(accountId: string, startDate: Date, endDate: Date): CashFlowForecast {
    const account = this.deps.getAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    const recurringTxs = this.deps.getRecurringTransactionsByAccount(accountId);
    return forecastCashFlow(account, recurringTxs, startDate, endDate);
  }

  forecastCashFlowEnhanced(
    accountId: string,
    options: ExtendedForecastOptions,
    lowBalanceThreshold?: number
  ): EnhancedCashFlowForecast {
    const account = this.deps.getAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    return forecastCashFlowEnhanced(
      account,
      this.deps.getRecurringItems(),
      this.deps.getTransactions(),
      this.deps.getCategories(),
      options,
      lowBalanceThreshold
    );
  }

  selectGranularity(forecastDays: number): ForecastGranularity {
    return selectGranularity(forecastDays);
  }
}
