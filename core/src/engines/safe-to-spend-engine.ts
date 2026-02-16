export interface SafeToSpendInput {
  accounts: Array<{ id: string; balance: number }>;
  recurringItems: Array<{ description: string; amount: number; nextOccurrence: Date; isActive: boolean }>;
  savingsGoals: Array<{ name: string; targetAmount: number; currentAmount: number; targetDate: Date | null; isActive: boolean }>;
  budgetGoals: Array<{ categoryId: string; amount: number; period: 'weekly' | 'monthly' | 'yearly' }>;
  categorySpending: Map<string, number>;
  categories: Array<{ id: string; name: string }>;
  monthlyIncome: number;
}

export interface SafeToSpendBreakdownBill {
  description: string;
  amount: number;
  dueDate: Date;
}

export interface SafeToSpendBreakdownSavings {
  goalName: string;
  monthlyNeeded: number;
}

export interface SafeToSpendBreakdownBudget {
  categoryName: string;
  remaining: number;
}

export interface SafeToSpendResult {
  safeAmount: number;
  totalBalance: number;
  upcomingBills: number;
  savingsCommitments: number;
  budgetRemaining: number;
  status: 'healthy' | 'caution' | 'low';
  breakdown: {
    bills: SafeToSpendBreakdownBill[];
    savings: SafeToSpendBreakdownSavings[];
    budgetItems: SafeToSpendBreakdownBudget[];
  };
}

function getEndOfMonth(date: Date): Date {
  const end = new Date(date);
  end.setMonth(end.getMonth() + 1);
  end.setDate(0);
  end.setHours(23, 59, 59, 999);
  return end;
}

function getMonthsBetween(startDate: Date, endDate: Date): number {
  const yearsDiff = endDate.getFullYear() - startDate.getFullYear();
  const monthsDiff = endDate.getMonth() - startDate.getMonth();
  return yearsDiff * 12 + monthsDiff;
}

function normalizeToMonthly(amount: number, period: 'weekly' | 'monthly' | 'yearly'): number {
  switch (period) {
    case 'weekly':
      return amount * 52 / 12;
    case 'yearly':
      return amount / 12;
    case 'monthly':
    default:
      return amount;
  }
}

export function calculateSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const now = new Date();
  const endOfMonth = getEndOfMonth(now);

  const totalBalance = input.accounts.reduce((sum, acc) => sum + acc.balance, 0);

  const billsBreakdown: SafeToSpendBreakdownBill[] = [];
  const upcomingBills = input.recurringItems
    .filter(item => {
      if (!item.isActive) return false;
      if (item.amount >= 0) return false;
      const occurrenceDate = new Date(item.nextOccurrence);
      return occurrenceDate >= now && occurrenceDate <= endOfMonth;
    })
    .reduce((sum, item) => {
      const amount = Math.abs(item.amount);
      billsBreakdown.push({
        description: item.description,
        amount,
        dueDate: new Date(item.nextOccurrence),
      });
      return sum + amount;
    }, 0);

  const savingsBreakdown: SafeToSpendBreakdownSavings[] = [];
  const savingsCommitments = input.savingsGoals
    .filter(goal => {
      if (!goal.isActive) return false;
      if (!goal.targetDate) return false;
      if (goal.currentAmount >= goal.targetAmount) return false;
      return true;
    })
    .reduce((sum, goal) => {
      const remaining = goal.targetAmount - goal.currentAmount;
      const monthsRemaining = Math.max(1, getMonthsBetween(now, goal.targetDate!));
      const monthlyNeeded = remaining / monthsRemaining;
      savingsBreakdown.push({
        goalName: goal.name,
        monthlyNeeded,
      });
      return sum + monthlyNeeded;
    }, 0);

  const categoryMap = new Map(input.categories.map(c => [c.id, c]));
  const budgetBreakdown: SafeToSpendBreakdownBudget[] = [];
  const budgetRemaining = input.budgetGoals.reduce((sum, goal) => {
    const monthlyAmount = normalizeToMonthly(goal.amount, goal.period);
    const spent = input.categorySpending.get(goal.categoryId) || 0;
    const remaining = Math.max(0, monthlyAmount - spent);

    const category = categoryMap.get(goal.categoryId);
    if (category && remaining > 0) {
      budgetBreakdown.push({
        categoryName: category.name,
        remaining,
      });
    }

    return sum + remaining;
  }, 0);

  const safeAmount = totalBalance - upcomingBills - savingsCommitments - budgetRemaining;

  let status: 'healthy' | 'caution' | 'low';
  if (safeAmount > input.monthlyIncome * 0.2) {
    status = 'healthy';
  } else if (safeAmount > 0) {
    status = 'caution';
  } else {
    status = 'low';
  }

  return {
    safeAmount,
    totalBalance,
    upcomingBills,
    savingsCommitments,
    budgetRemaining,
    status,
    breakdown: {
      bills: billsBreakdown,
      savings: savingsBreakdown,
      budgetItems: budgetBreakdown,
    },
  };
}

export class SafeToSpendEngine {
  calculate(input: SafeToSpendInput): SafeToSpendResult {
    return calculateSafeToSpend(input);
  }
}
