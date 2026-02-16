import { Transaction } from '../types';

// Types for financial health score
export interface FinancialHealthFactor {
  name: string;
  score: number; // 0-100
  weight: number;
  description: string;
  recommendation?: string;
  metric?: { currentValue: string; targetValue: string; unit: string };
}

export interface FinancialHealthScore {
  overallScore: number; // 0-100
  factors: FinancialHealthFactor[];
  trend: 'improving' | 'declining' | 'stable';
  previousScore?: number;
  recommendations: string[];
}

export interface BudgetGoal {
  id: string;
  categoryId: string;
  amount: number;
  period: 'weekly' | 'monthly' | 'yearly';
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  interestRate?: number | null;
  minimumPayment?: number | null;
}

export interface Asset {
  id: string;
  name: string;
  value: number;
  type: string;
}

export interface SavingsGoal {
  id: string;
  targetAmount: number;
  currentAmount: number;
  isActive: boolean;
}

/**
 * Calculate monthly income from transactions
 */
function calculateMonthlyIncome(transactions: Transaction[]): number {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

  const incomeTransactions = transactions.filter(t => {
    const txDate = new Date(t.date);
    return t.amount > 0 && txDate >= threeMonthsAgo && txDate <= now;
  });

  const totalIncome = incomeTransactions.reduce((sum, t) => sum + t.amount, 0);
  const monthsOfData = 3;

  return totalIncome / monthsOfData;
}

/**
 * Calculate monthly expenses from transactions
 */
function calculateMonthlyExpenses(transactions: Transaction[]): number {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

  const expenseTransactions = transactions.filter(t => {
    const txDate = new Date(t.date);
    return t.amount < 0 && txDate >= threeMonthsAgo && txDate <= now;
  });

  const totalExpenses = expenseTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const monthsOfData = 3;

  return totalExpenses / monthsOfData;
}

/**
 * Calculate savings rate factor
 */
function calculateSavingsRateFactor(
  transactions: Transaction[]
): FinancialHealthFactor {
  const monthlyIncome = calculateMonthlyIncome(transactions);
  const monthlyExpenses = calculateMonthlyExpenses(transactions);

  if (monthlyIncome === 0) {
    return {
      name: 'Savings Rate',
      score: 0,
      weight: 0.25,
      description: 'No income data available',
      recommendation: 'Import income transactions to track your savings rate',
    };
  }

  const savingsRate = ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100;

  let score: number;
  let description: string;
  let recommendation: string | undefined;

  if (savingsRate >= 20) {
    score = 100;
    description = `Excellent! You\'re saving ${savingsRate.toFixed(0)}% of your income`;
  } else if (savingsRate >= 15) {
    score = 85;
    description = `Good savings rate of ${savingsRate.toFixed(0)}%`;
    recommendation = 'Aim for 20%+ to build wealth faster';
  } else if (savingsRate >= 10) {
    score = 70;
    description = `Moderate savings rate of ${savingsRate.toFixed(0)}%`;
    recommendation = 'Try to increase savings to 15-20% of income';
  } else if (savingsRate >= 5) {
    score = 50;
    description = `Low savings rate of ${savingsRate.toFixed(0)}%`;
    recommendation = 'Review expenses for areas to cut back';
  } else if (savingsRate >= 0) {
    score = 30;
    description = `Minimal savings (${savingsRate.toFixed(0)}%)`;
    recommendation = 'Prioritize building an emergency fund';
  } else {
    score = 10;
    description = 'Spending exceeds income';
    recommendation = 'Urgent: reduce spending or increase income';
  }

  return {
    name: 'Savings Rate',
    score,
    weight: 0.25,
    description,
    recommendation,
    metric: {
      currentValue: savingsRate.toFixed(1),
      targetValue: '20',
      unit: '%',
    },
  };
}

/**
 * Calculate budget adherence factor
 */
function calculateBudgetAdherenceFactor(
  transactions: Transaction[],
  budgetGoals: BudgetGoal[]
): FinancialHealthFactor {
  if (budgetGoals.length === 0) {
    return {
      name: 'Budget Adherence',
      score: 50,
      weight: 0.20,
      description: 'No budget goals set',
      recommendation: 'Set monthly spending limits for key categories',
    };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let totalScore = 0;
  let categoriesWithBudget = 0;
  let categoriesOnBudget = 0;

  for (const goal of budgetGoals) {
    if (goal.period !== 'monthly') continue;

    const spending = transactions
      .filter(t => {
        const txDate = new Date(t.date);
        return (
          t.categoryId === goal.categoryId &&
          t.amount < 0 &&
          txDate >= monthStart &&
          txDate <= now
        );
      })
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const adherenceRatio = goal.amount > 0 ? spending / goal.amount : 1;

    if (adherenceRatio <= 1.0) {
      categoriesOnBudget++;
    }

    if (adherenceRatio <= 0.9) {
      totalScore += 100;
    } else if (adherenceRatio <= 1.0) {
      totalScore += 90;
    } else if (adherenceRatio <= 1.1) {
      totalScore += 70;
    } else if (adherenceRatio <= 1.25) {
      totalScore += 50;
    } else {
      totalScore += 20;
    }

    categoriesWithBudget++;
  }

  const score = categoriesWithBudget > 0 ? Math.round(totalScore / categoriesWithBudget) : 50;

  let description: string;
  let recommendation: string | undefined;

  if (score >= 90) {
    description = 'Excellent budget discipline';
  } else if (score >= 70) {
    description = 'Good budget adherence';
    recommendation = 'Minor adjustments could improve your score';
  } else if (score >= 50) {
    description = 'Some budget categories over limit';
    recommendation = 'Review categories exceeding budget';
  } else {
    description = 'Multiple categories over budget';
    recommendation = 'Consider adjusting budgets or reducing spending';
  }

  return {
    name: 'Budget Adherence',
    score,
    weight: 0.20,
    description,
    recommendation,
    metric: {
      currentValue: `${categoriesOnBudget}/${categoriesWithBudget}`,
      targetValue: `${categoriesWithBudget}/${categoriesWithBudget}`,
      unit: 'on budget',
    },
  };
}

/**
 * Calculate emergency fund factor
 */
function calculateEmergencyFundFactor(
  assets: Asset[],
  transactions: Transaction[]
): FinancialHealthFactor {
  const monthlyExpenses = calculateMonthlyExpenses(transactions);

  // Calculate liquid assets (cash, savings)
  const liquidAssets = assets
    .filter(a => a.type === 'cash')
    .reduce((sum, a) => sum + a.value, 0);

  if (monthlyExpenses === 0) {
    return {
      name: 'Emergency Fund',
      score: 50,
      weight: 0.20,
      description: 'No expense data to calculate coverage',
      recommendation: 'Import expense transactions for accurate analysis',
    };
  }

  const monthsCovered = liquidAssets / monthlyExpenses;

  let score: number;
  let description: string;
  let recommendation: string | undefined;

  if (monthsCovered >= 6) {
    score = 100;
    description = `${monthsCovered.toFixed(1)} months of expenses covered`;
  } else if (monthsCovered >= 3) {
    score = 75;
    description = `${monthsCovered.toFixed(1)} months covered`;
    recommendation = 'Build to 6 months for full security';
  } else if (monthsCovered >= 1) {
    score = 50;
    description = `Only ${monthsCovered.toFixed(1)} months covered`;
    recommendation = 'Priority: build emergency fund to 3 months';
  } else {
    score = 25;
    description = 'Less than 1 month of expenses saved';
    recommendation = 'Critical: start building emergency fund immediately';
  }

  return {
    name: 'Emergency Fund',
    score,
    weight: 0.20,
    description,
    recommendation,
    metric: {
      currentValue: monthsCovered.toFixed(1),
      targetValue: '6',
      unit: 'months',
    },
  };
}

/**
 * Calculate debt-to-income factor
 */
function calculateDebtToIncomeFactor(
  liabilities: Liability[],
  transactions: Transaction[]
): FinancialHealthFactor {
  const monthlyIncome = calculateMonthlyIncome(transactions);

  const totalDebtPayments = liabilities
    .filter(l => l.minimumPayment)
    .reduce((sum, l) => sum + (l.minimumPayment || 0), 0);

  if (monthlyIncome === 0) {
    return {
      name: 'Debt-to-Income',
      score: 50,
      weight: 0.15,
      description: 'No income data available',
      recommendation: 'Import income transactions for accurate analysis',
    };
  }

  const dtiRatio = (totalDebtPayments / monthlyIncome) * 100;

  let score: number;
  let description: string;
  let recommendation: string | undefined;

  if (dtiRatio === 0) {
    score = 100;
    description = 'No debt payments';
  } else if (dtiRatio <= 20) {
    score = 90;
    description = `Low DTI ratio: ${dtiRatio.toFixed(0)}%`;
  } else if (dtiRatio <= 35) {
    score = 70;
    description = `Moderate DTI ratio: ${dtiRatio.toFixed(0)}%`;
    recommendation = 'Consider paying down high-interest debt';
  } else if (dtiRatio <= 50) {
    score = 40;
    description = `High DTI ratio: ${dtiRatio.toFixed(0)}%`;
    recommendation = 'Focus on debt reduction strategies';
  } else {
    score = 20;
    description = `Very high DTI ratio: ${dtiRatio.toFixed(0)}%`;
    recommendation = 'Urgent: seek debt management assistance';
  }

  return {
    name: 'Debt-to-Income',
    score,
    weight: 0.15,
    description,
    recommendation,
    metric: {
      currentValue: dtiRatio.toFixed(1),
      targetValue: '20',
      unit: '% DTI',
    },
  };
}

/**
 * Calculate net worth trend factor
 */
function calculateNetWorthTrendFactor(
  netWorthHistory: Array<{ date: Date; netWorth: number }>
): FinancialHealthFactor {
  if (netWorthHistory.length < 2) {
    return {
      name: 'Net Worth Trend',
      score: 50,
      weight: 0.10,
      description: 'Not enough history to calculate trend',
      recommendation: 'Track net worth monthly to see progress',
    };
  }

  // Calculate trend over available history
  const sortedHistory = [...netWorthHistory].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const firstValue = sortedHistory[0].netWorth;
  const lastValue = sortedHistory[sortedHistory.length - 1].netWorth;
  const change = lastValue - firstValue;
  const changePercent = firstValue !== 0 ? (change / Math.abs(firstValue)) * 100 : 0;

  let score: number;
  let description: string;
  let recommendation: string | undefined;

  if (changePercent >= 10) {
    score = 100;
    description = `Strong growth: +${changePercent.toFixed(0)}%`;
  } else if (changePercent >= 5) {
    score = 80;
    description = `Good growth: +${changePercent.toFixed(0)}%`;
  } else if (changePercent >= 0) {
    score = 60;
    description = `Modest growth: +${changePercent.toFixed(0)}%`;
    recommendation = 'Look for ways to accelerate wealth building';
  } else if (changePercent >= -5) {
    score = 40;
    description = `Slight decline: ${changePercent.toFixed(0)}%`;
    recommendation = 'Review spending and saving habits';
  } else {
    score = 20;
    description = `Significant decline: ${changePercent.toFixed(0)}%`;
    recommendation = 'Urgent: address financial drains';
  }

  return {
    name: 'Net Worth Trend',
    score,
    weight: 0.10,
    description,
    recommendation,
    metric: {
      currentValue: changePercent >= 0 ? `+${changePercent.toFixed(1)}` : changePercent.toFixed(1),
      targetValue: '+10',
      unit: '% growth',
    },
  };
}

/**
 * Calculate savings goal progress factor
 */
function calculateSavingsGoalFactor(
  savingsGoals: SavingsGoal[]
): FinancialHealthFactor {
  const activeGoals = savingsGoals.filter(g => g.isActive);

  if (activeGoals.length === 0) {
    return {
      name: 'Savings Goals',
      score: 50,
      weight: 0.10,
      description: 'No active savings goals',
      recommendation: 'Set specific savings goals to stay motivated',
    };
  }

  const totalProgress = activeGoals.reduce((sum, g) => {
    const progress = g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0;
    return sum + Math.min(progress, 100);
  }, 0);

  const averageProgress = totalProgress / activeGoals.length;

  let score: number;
  let description: string;
  let recommendation: string | undefined;

  if (averageProgress >= 75) {
    score = 95;
    description = `Goals ${averageProgress.toFixed(0)}% complete on average`;
  } else if (averageProgress >= 50) {
    score = 75;
    description = `Goals ${averageProgress.toFixed(0)}% complete`;
    recommendation = 'Keep up the momentum!';
  } else if (averageProgress >= 25) {
    score = 55;
    description = `Goals ${averageProgress.toFixed(0)}% complete`;
    recommendation = 'Consider increasing contributions';
  } else {
    score = 35;
    description = `Goals only ${averageProgress.toFixed(0)}% complete`;
    recommendation = 'Review and adjust savings strategy';
  }

  return {
    name: 'Savings Goals',
    score,
    weight: 0.10,
    description,
    recommendation,
    metric: {
      currentValue: averageProgress.toFixed(0),
      targetValue: '100',
      unit: '% complete',
    },
  };
}

/**
 * Calculate comprehensive financial health score
 */
export function calculateFinancialHealth(
  transactions: Transaction[],
  budgetGoals: BudgetGoal[],
  assets: Asset[],
  liabilities: Liability[],
  savingsGoals: SavingsGoal[],
  netWorthHistory: Array<{ date: Date; netWorth: number }>,
  previousScore?: number
): FinancialHealthScore {
  const factors: FinancialHealthFactor[] = [
    calculateSavingsRateFactor(transactions),
    calculateBudgetAdherenceFactor(transactions, budgetGoals),
    calculateEmergencyFundFactor(assets, transactions),
    calculateDebtToIncomeFactor(liabilities, transactions),
    calculateNetWorthTrendFactor(netWorthHistory),
    calculateSavingsGoalFactor(savingsGoals),
  ];

  // Calculate weighted overall score
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedScore = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const overallScore = Math.round(weightedScore / totalWeight);

  // Determine trend
  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (previousScore !== undefined) {
    if (overallScore > previousScore + 3) {
      trend = 'improving';
    } else if (overallScore < previousScore - 3) {
      trend = 'declining';
    }
  }

  // Gather recommendations from factors
  const recommendations: string[] = factors
    .filter(f => f.recommendation && f.score < 70)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(f => f.recommendation!)
    .filter(Boolean);

  // Add overall recommendation based on score
  if (overallScore >= 80) {
    recommendations.unshift('Great financial health! Focus on maintaining your habits.');
  } else if (overallScore >= 60) {
    recommendations.unshift('Good foundation - address the areas below to improve.');
  } else if (overallScore >= 40) {
    recommendations.unshift('Several areas need attention - prioritize the key recommendations.');
  } else {
    recommendations.unshift('Financial stress detected - consider seeking professional advice.');
  }

  return {
    overallScore,
    factors,
    trend,
    previousScore,
    recommendations,
  };
}

// Legacy class-based API for backward compatibility
export class FinancialHealthEngine {
  private getTransactions: () => Transaction[];
  private getBudgetGoals: () => BudgetGoal[];
  private getAssets: () => Asset[];
  private getLiabilities: () => Liability[];
  private getSavingsGoals: () => SavingsGoal[];
  private getNetWorthHistory: () => Array<{ date: Date; netWorth: number }>;

  constructor(dataSource: {
    getTransactions: () => Transaction[];
    getBudgetGoals: () => BudgetGoal[];
    getAssets: () => Asset[];
    getLiabilities: () => Liability[];
    getSavingsGoals: () => SavingsGoal[];
    getNetWorthHistory: () => Array<{ date: Date; netWorth: number }>;
  }) {
    this.getTransactions = dataSource.getTransactions;
    this.getBudgetGoals = dataSource.getBudgetGoals;
    this.getAssets = dataSource.getAssets;
    this.getLiabilities = dataSource.getLiabilities;
    this.getSavingsGoals = dataSource.getSavingsGoals;
    this.getNetWorthHistory = dataSource.getNetWorthHistory;
  }

  calculateFinancialHealth(previousScore?: number): FinancialHealthScore {
    return calculateFinancialHealth(
      this.getTransactions(),
      this.getBudgetGoals(),
      this.getAssets(),
      this.getLiabilities(),
      this.getSavingsGoals(),
      this.getNetWorthHistory(),
      previousScore
    );
  }
}
