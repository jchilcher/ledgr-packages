import { Transaction, Category } from '../types';

// Types for spending velocity analysis
export type VelocityStatus = 'safe' | 'warning' | 'danger';

export interface SpendingVelocity {
  categoryId: string;
  categoryName: string;
  budgetAmount: number;
  currentSpent: number;
  dailyBurnRate: number;
  projectedTotal: number;
  daysRemaining: number;
  depletionDate: Date | null;
  percentUsed: number;
  status: VelocityStatus;
  paceVsBudget: number;
}

export interface SpendingVelocityReport {
  period: {
    startDate: Date;
    endDate: Date;
    daysElapsed: number;
    daysRemaining: number;
  };
  velocities: SpendingVelocity[];
  summary: {
    categoriesAtRisk: number;
    totalBudget: number;
    totalProjectedSpending: number;
    overallStatus: VelocityStatus;
  };
}

export interface BudgetGoal {
  id: string;
  categoryId: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
}

/**
 * Get the start and end dates for the current budget period
 */
function getPeriodDates(period: 'weekly' | 'monthly' | 'yearly'): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  switch (period) {
    case 'weekly':
      // Start of current week (Sunday)
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      // End of current week (Saturday)
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case 'monthly':
      // Start of current month
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      // End of current month
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'yearly':
      // Start of current year
      start.setMonth(0);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      // End of current year
      end.setMonth(11);
      end.setDate(31);
      end.setHours(23, 59, 59, 999);
      break;
  }

  return { start, end };
}

/**
 * Calculate spending velocity for a single category
 */
export function calculateCategoryVelocity(
  categoryId: string,
  categoryName: string,
  budgetAmount: number,
  transactions: Transaction[],
  periodStart: Date,
  periodEnd: Date
): SpendingVelocity {
  const now = new Date();
  const totalDays = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  // Calculate current spending in this category for the period
  const categoryTransactions = transactions.filter(t => {
    const txDate = new Date(t.date);
    return (
      t.categoryId === categoryId &&
      t.amount < 0 &&
      txDate >= periodStart &&
      txDate <= now
    );
  });

  const currentSpent = categoryTransactions.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0
  );

  // Calculate daily burn rate
  const dailyBurnRate = currentSpent / daysElapsed;

  // Project total spending for the period
  const projectedTotal = dailyBurnRate * totalDays;

  // Calculate percent of budget used
  const percentUsed = budgetAmount > 0 ? (currentSpent / budgetAmount) * 100 : 0;

  // Expected spending at this point in the period
  const expectedAtThisPoint = (budgetAmount / totalDays) * daysElapsed;
  const paceVsBudget = expectedAtThisPoint > 0 ? currentSpent / expectedAtThisPoint : 1;

  // Calculate depletion date (when budget will run out at current rate)
  let depletionDate: Date | null = null;
  if (dailyBurnRate > 0 && currentSpent < budgetAmount) {
    const daysUntilDepletion = (budgetAmount - currentSpent) / dailyBurnRate;
    depletionDate = new Date(now.getTime() + daysUntilDepletion * 24 * 60 * 60 * 1000);
    if (depletionDate > periodEnd) {
      depletionDate = null; // Won't deplete within period
    }
  } else if (currentSpent >= budgetAmount) {
    depletionDate = now; // Already depleted
  }

  // Determine status
  let status: VelocityStatus;
  if (percentUsed >= 100 || projectedTotal > budgetAmount * 1.1) {
    status = 'danger';
  } else if (percentUsed >= 80 || projectedTotal > budgetAmount * 0.95) {
    status = 'warning';
  } else {
    status = 'safe';
  }

  return {
    categoryId,
    categoryName,
    budgetAmount,
    currentSpent,
    dailyBurnRate,
    projectedTotal,
    daysRemaining,
    depletionDate,
    percentUsed,
    status,
    paceVsBudget,
  };
}

/**
 * Calculate spending velocity for all categories with budgets
 */
export function calculateSpendingVelocity(
  transactions: Transaction[],
  budgetGoals: BudgetGoal[],
  categories: Category[],
  period: 'weekly' | 'monthly' | 'yearly' = 'monthly'
): SpendingVelocityReport {
  const { start, end } = getPeriodDates(period);
  const now = new Date();
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const categoryMap = new Map(categories.map(c => [c.id, c]));

  const velocities: SpendingVelocity[] = [];

  for (const goal of budgetGoals) {
    if (goal.period !== period) continue;

    const category = categoryMap.get(goal.categoryId);
    if (!category) continue;

    const velocity = calculateCategoryVelocity(
      goal.categoryId,
      category.name,
      goal.amount,
      transactions,
      start,
      end
    );

    velocities.push(velocity);
  }

  // Sort by status (danger first) then by percent used
  velocities.sort((a, b) => {
    const statusOrder = { danger: 0, warning: 1, safe: 2 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return b.percentUsed - a.percentUsed;
  });

  // Calculate summary
  const categoriesAtRisk = velocities.filter(
    v => v.status === 'danger' || v.status === 'warning'
  ).length;
  const totalBudget = velocities.reduce((sum, v) => sum + v.budgetAmount, 0);
  const totalProjectedSpending = velocities.reduce((sum, v) => sum + v.projectedTotal, 0);

  let overallStatus: VelocityStatus = 'safe';
  if (velocities.some(v => v.status === 'danger')) {
    overallStatus = 'danger';
  } else if (velocities.some(v => v.status === 'warning')) {
    overallStatus = 'warning';
  }

  return {
    period: {
      startDate: start,
      endDate: end,
      daysElapsed,
      daysRemaining,
    },
    velocities,
    summary: {
      categoriesAtRisk,
      totalBudget,
      totalProjectedSpending,
      overallStatus,
    },
  };
}

// Legacy class-based API for backward compatibility
export class SpendingVelocityEngine {
  private getTransactions: () => Transaction[];
  private getBudgetGoals: () => BudgetGoal[];
  private getCategories: () => Category[];

  constructor(dataSource: {
    getTransactions: () => Transaction[];
    getBudgetGoals: () => BudgetGoal[];
    getCategories: () => Category[];
  }) {
    this.getTransactions = dataSource.getTransactions;
    this.getBudgetGoals = dataSource.getBudgetGoals;
    this.getCategories = dataSource.getCategories;
  }

  calculateSpendingVelocity(
    period: 'weekly' | 'monthly' | 'yearly' = 'monthly'
  ): SpendingVelocityReport {
    return calculateSpendingVelocity(
      this.getTransactions(),
      this.getBudgetGoals(),
      this.getCategories(),
      period
    );
  }

  calculateCategoryVelocity(
    categoryId: string,
    period: 'weekly' | 'monthly' | 'yearly' = 'monthly'
  ): SpendingVelocity | null {
    const budgetGoals = this.getBudgetGoals();
    const goal = budgetGoals.find(g => g.categoryId === categoryId && g.period === period);
    if (!goal) return null;

    const categories = this.getCategories();
    const category = categories.find(c => c.id === categoryId);
    if (!category) return null;

    const { start, end } = getPeriodDates(period);
    return calculateCategoryVelocity(
      categoryId,
      category.name,
      goal.amount,
      this.getTransactions(),
      start,
      end
    );
  }
}
