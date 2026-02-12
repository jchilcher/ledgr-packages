/**
 * Budget Suggestion Engine
 * Provides intelligent budget suggestions based on historical spending patterns.
 */

import { Transaction, BudgetGoal, Category, BudgetPeriod } from '../types';

export type SuggestionType = 'new_budget' | 'increase' | 'decrease';

export type SuggestionReason =
  | 'no_budget_set'
  | 'consistently_over_budget'
  | 'consistently_under_budget'
  | 'goal_based_reduction';

export interface BudgetSuggestion {
  categoryId: string;
  categoryName: string;
  type: SuggestionType;
  currentBudget: number | null;
  suggestedAmount: number;
  confidence: number; // 0-100
  reason: SuggestionReason;
  explanation: string;
  period: BudgetPeriod;
}

export interface BudgetSuggestionOptions {
  historyMonths?: number; // Default: 6
  bufferPercent?: number; // Default: 10
  minTransactions?: number; // Minimum transactions needed for suggestion
  overBudgetThreshold?: number; // Months over budget to suggest increase
  underBudgetPercent?: number; // Percentage under budget to suggest decrease
  reductionPercent?: number; // Goal-based reduction percentage
}

const DEFAULT_OPTIONS: Required<BudgetSuggestionOptions> = {
  historyMonths: 6,
  bufferPercent: 10,
  minTransactions: 3,
  overBudgetThreshold: 3,
  underBudgetPercent: 70,
  reductionPercent: 15,
};

/**
 * Groups transactions by month and calculates monthly totals for a category
 */
function calculateMonthlyTotals(
  transactions: Transaction[],
  categoryId: string,
  historyMonths: number
): Map<string, number> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - historyMonths, 1);

  const monthlyTotals = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.categoryId !== categoryId) continue;
    if (tx.amount >= 0) continue; // Only expenses (negative amounts)

    const txDate = tx.date instanceof Date ? tx.date : new Date(tx.date);
    if (txDate < startDate) continue;

    const monthKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
    const current = monthlyTotals.get(monthKey) || 0;
    monthlyTotals.set(monthKey, current + Math.abs(tx.amount));
  }

  return monthlyTotals;
}

/**
 * Calculates average monthly spending from monthly totals
 */
function calculateAverageMonthlySpending(monthlyTotals: Map<string, number>): number {
  if (monthlyTotals.size === 0) return 0;

  let total = 0;
  for (const amount of monthlyTotals.values()) {
    total += amount;
  }

  return total / monthlyTotals.size;
}

/**
 * Calculates confidence based on data quality
 */
function calculateConfidence(
  monthlyTotals: Map<string, number>,
  historyMonths: number,
  transactionCount: number
): number {
  // Base confidence from months of data (max 50 points)
  const monthsCoverage = Math.min(monthlyTotals.size / historyMonths, 1);
  const monthsScore = monthsCoverage * 50;

  // Confidence from transaction count (max 30 points)
  const txScore = Math.min(transactionCount / 10, 1) * 30;

  // Confidence from consistency (max 20 points)
  const amounts = Array.from(monthlyTotals.values());
  if (amounts.length < 2) {
    return Math.round(monthsScore + txScore);
  }

  const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = avg > 0 ? stdDev / avg : 1;

  // Lower CV = higher consistency = higher score
  const consistencyScore = Math.max(0, (1 - coefficientOfVariation) * 20);

  return Math.round(monthsScore + txScore + consistencyScore);
}

/**
 * Suggests a new budget for a category without one
 */
export function suggestNewBudget(
  categoryId: string,
  categoryName: string,
  transactions: Transaction[],
  options: BudgetSuggestionOptions = {}
): BudgetSuggestion | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const monthlyTotals = calculateMonthlyTotals(transactions, categoryId, opts.historyMonths);

  // Count transactions for this category
  const txCount = transactions.filter(
    (tx) => tx.categoryId === categoryId && tx.amount < 0
  ).length;

  if (txCount < opts.minTransactions) {
    return null; // Not enough data
  }

  const averageSpending = calculateAverageMonthlySpending(monthlyTotals);

  if (averageSpending === 0) {
    return null; // No spending in this category
  }

  // Add buffer to average
  const suggestedAmount = averageSpending * (1 + opts.bufferPercent / 100);
  const confidence = calculateConfidence(monthlyTotals, opts.historyMonths, txCount);

  return {
    categoryId,
    categoryName,
    type: 'new_budget',
    currentBudget: null,
    suggestedAmount: Math.round(suggestedAmount),
    confidence,
    reason: 'no_budget_set',
    explanation: `Based on ${monthlyTotals.size} month(s) of spending (avg $${(averageSpending / 100).toFixed(2)}/mo) plus ${opts.bufferPercent}% buffer`,
    period: 'monthly',
  };
}

/**
 * Analyzes budget vs actual spending over recent months
 */
function analyzeBudgetPerformance(
  monthlyTotals: Map<string, number>,
  budgetAmount: number,
  budgetPeriod: BudgetPeriod
): { overCount: number; underCount: number; avgSpending: number } {
  // Convert budget to monthly for comparison
  let monthlyBudget = budgetAmount;
  if (budgetPeriod === 'weekly') {
    monthlyBudget = budgetAmount * 4.33;
  } else if (budgetPeriod === 'yearly') {
    monthlyBudget = budgetAmount / 12;
  }

  let overCount = 0;
  let underCount = 0;
  let total = 0;

  for (const spent of monthlyTotals.values()) {
    total += spent;
    if (spent > monthlyBudget) {
      overCount++;
    } else if (spent < monthlyBudget * 0.7) {
      underCount++;
    }
  }

  const avgSpending = monthlyTotals.size > 0 ? total / monthlyTotals.size : 0;

  return { overCount, underCount, avgSpending };
}

/**
 * Suggests an adjustment to an existing budget
 */
export function suggestBudgetAdjustment(
  categoryId: string,
  categoryName: string,
  currentBudget: BudgetGoal,
  transactions: Transaction[],
  userGoal?: 'reduce_spending',
  options: BudgetSuggestionOptions = {}
): BudgetSuggestion | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const monthlyTotals = calculateMonthlyTotals(transactions, categoryId, opts.historyMonths);

  if (monthlyTotals.size < 2) {
    return null; // Need at least 2 months of data
  }

  const txCount = transactions.filter(
    (tx) => tx.categoryId === categoryId && tx.amount < 0
  ).length;

  const { overCount, underCount, avgSpending } = analyzeBudgetPerformance(
    monthlyTotals,
    currentBudget.amount,
    currentBudget.period
  );

  const confidence = calculateConfidence(monthlyTotals, opts.historyMonths, txCount);

  // User wants to reduce spending - suggest goal-based reduction
  if (userGoal === 'reduce_spending') {
    const reductionTarget = avgSpending * (1 - opts.reductionPercent / 100);

    // Convert to budget period
    let suggestedAmount = reductionTarget;
    if (currentBudget.period === 'weekly') {
      suggestedAmount = reductionTarget / 4.33;
    } else if (currentBudget.period === 'yearly') {
      suggestedAmount = reductionTarget * 12;
    }

    return {
      categoryId,
      categoryName,
      type: 'decrease',
      currentBudget: currentBudget.amount,
      suggestedAmount: Math.round(suggestedAmount),
      confidence,
      reason: 'goal_based_reduction',
      explanation: `Reduce ${opts.reductionPercent}% from current spending of $${(avgSpending / 100).toFixed(2)}/mo to help you spend less`,
      period: currentBudget.period,
    };
  }

  // Consistently over budget - suggest realistic increase
  if (overCount >= opts.overBudgetThreshold) {
    const realisticBudget = avgSpending * (1 + opts.bufferPercent / 100);

    // Convert to budget period
    let suggestedAmount = realisticBudget;
    if (currentBudget.period === 'weekly') {
      suggestedAmount = realisticBudget / 4.33;
    } else if (currentBudget.period === 'yearly') {
      suggestedAmount = realisticBudget * 12;
    }

    // Only suggest increase if it's actually higher
    if (suggestedAmount <= currentBudget.amount) {
      return null;
    }

    return {
      categoryId,
      categoryName,
      type: 'increase',
      currentBudget: currentBudget.amount,
      suggestedAmount: Math.round(suggestedAmount),
      confidence,
      reason: 'consistently_over_budget',
      explanation: `You've been over budget ${overCount} of the last ${monthlyTotals.size} months. Consider a more realistic budget based on avg spending of $${(avgSpending / 100).toFixed(2)}/mo`,
      period: currentBudget.period,
    };
  }

  // Consistently under budget - suggest decrease
  if (underCount >= opts.overBudgetThreshold) {
    const tighterBudget = avgSpending * 1.15; // 15% buffer above actual

    // Convert to budget period
    let suggestedAmount = tighterBudget;
    if (currentBudget.period === 'weekly') {
      suggestedAmount = tighterBudget / 4.33;
    } else if (currentBudget.period === 'yearly') {
      suggestedAmount = tighterBudget * 12;
    }

    // Only suggest decrease if it's actually lower
    if (suggestedAmount >= currentBudget.amount) {
      return null;
    }

    return {
      categoryId,
      categoryName,
      type: 'decrease',
      currentBudget: currentBudget.amount,
      suggestedAmount: Math.round(suggestedAmount),
      confidence,
      reason: 'consistently_under_budget',
      explanation: `You've been under 70% of budget ${underCount} of the last ${monthlyTotals.size} months. You could lower this budget.`,
      period: currentBudget.period,
    };
  }

  return null; // No suggestion needed
}

/**
 * Generates suggestions for all categories
 */
export function generateAllSuggestions(
  transactions: Transaction[],
  categories: Category[],
  budgets: BudgetGoal[],
  options: BudgetSuggestionOptions = {}
): BudgetSuggestion[] {
  const suggestions: BudgetSuggestion[] = [];
  const budgetsByCategory = new Map(budgets.map((b) => [b.categoryId, b]));

  // Only process expense categories
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  for (const category of expenseCategories) {
    const existingBudget = budgetsByCategory.get(category.id);

    if (existingBudget) {
      // Has budget - check for adjustment suggestion
      const suggestion = suggestBudgetAdjustment(
        category.id,
        category.name,
        existingBudget,
        transactions,
        undefined,
        options
      );
      if (suggestion) {
        suggestions.push(suggestion);
      }
    } else {
      // No budget - suggest new one
      const suggestion = suggestNewBudget(category.id, category.name, transactions, options);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }
  }

  // Sort by confidence (highest first)
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return suggestions;
}

/**
 * Budget Suggestion Engine class for dependency injection
 */
export interface BudgetSuggestionDependencies {
  getTransactions: (startDate?: Date, endDate?: Date) => Transaction[] | Promise<Transaction[]>;
  getCategories: () => Category[] | Promise<Category[]>;
  getBudgetGoals: () => BudgetGoal[] | Promise<BudgetGoal[]>;
}

export class BudgetSuggestionEngine {
  constructor(private deps: BudgetSuggestionDependencies) {}

  async generateSuggestions(options?: BudgetSuggestionOptions): Promise<BudgetSuggestion[]> {
    const historyMonths = options?.historyMonths ?? DEFAULT_OPTIONS.historyMonths;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - historyMonths);

    const [transactions, categories, budgets] = await Promise.all([
      this.deps.getTransactions(startDate),
      this.deps.getCategories(),
      this.deps.getBudgetGoals(),
    ]);

    return generateAllSuggestions(transactions, categories, budgets, options);
  }

  async suggestForCategory(
    categoryId: string,
    userGoal?: 'reduce_spending',
    options?: BudgetSuggestionOptions
  ): Promise<BudgetSuggestion | null> {
    const historyMonths = options?.historyMonths ?? DEFAULT_OPTIONS.historyMonths;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - historyMonths);

    const [transactions, categories, budgets] = await Promise.all([
      this.deps.getTransactions(startDate),
      this.deps.getCategories(),
      this.deps.getBudgetGoals(),
    ]);

    const category = categories.find((c) => c.id === categoryId);
    if (!category) return null;

    const existingBudget = budgets.find((b) => b.categoryId === categoryId);

    if (existingBudget) {
      return suggestBudgetAdjustment(
        categoryId,
        category.name,
        existingBudget,
        transactions,
        userGoal,
        options
      );
    } else {
      return suggestNewBudget(categoryId, category.name, transactions, options);
    }
  }
}
