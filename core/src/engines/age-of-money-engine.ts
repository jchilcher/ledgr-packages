export interface AgeOfMoneyInput {
  transactions: Array<{
    id: string;
    date: Date;
    amount: number;
    isInternalTransfer?: boolean;
    description: string;
  }>;
  reimbursementIncomeIds: Set<string>;
}

export interface AgeOfMoneyResult {
  currentAge: number;
  previousMonthAge: number | null;
  trend: 'up' | 'down' | 'stable';
  explanation: string;
}

interface IncomeQueueItem {
  date: Date;
  remaining: number;
}

function getDaysAgo(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDaysBetween(startDate: Date, endDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((endDate.getTime() - startDate.getTime()) / msPerDay);
}

function calculateAgeForPeriod(
  incomeTransactions: Array<{ date: Date; amount: number }>,
  expenseTransactions: Array<{ date: Date; amount: number }>
): number {
  if (incomeTransactions.length === 0 || expenseTransactions.length === 0) {
    return 0;
  }

  const incomeQueue: IncomeQueueItem[] = incomeTransactions.map(tx => ({
    date: tx.date,
    remaining: Math.round(tx.amount * 100),
  }));

  let totalWeightedAge = 0;
  let totalConsumed = 0;

  for (const expense of expenseTransactions) {
    let expenseRemaining = Math.round(Math.abs(expense.amount) * 100);

    while (expenseRemaining > 0 && incomeQueue.length > 0) {
      const oldestIncome = incomeQueue[0];
      const consumed = Math.min(expenseRemaining, oldestIncome.remaining);

      const age = getDaysBetween(oldestIncome.date, expense.date);
      totalWeightedAge += age * consumed;
      totalConsumed += consumed;

      oldestIncome.remaining -= consumed;
      expenseRemaining -= consumed;

      if (oldestIncome.remaining <= 0) {
        incomeQueue.shift();
      }
    }
  }

  if (totalConsumed === 0) {
    return 0;
  }

  return totalWeightedAge / totalConsumed;
}

export function calculateAgeOfMoney(input: AgeOfMoneyInput): AgeOfMoneyResult {
  const now = new Date();

  const currentIncomeStart = getDaysAgo(90);
  const currentExpenseStart = getDaysAgo(30);
  const previousIncomeStart = getDaysAgo(120);
  const previousIncomeEnd = getDaysAgo(31);
  const previousExpenseStart = getDaysAgo(60);
  const previousExpenseEnd = getDaysAgo(31);

  const currentIncome = input.transactions
    .filter(
      tx =>
        tx.amount > 0 &&
        !tx.isInternalTransfer &&
        !input.reimbursementIncomeIds.has(tx.id) &&
        tx.date >= currentIncomeStart &&
        tx.date <= now
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const currentExpenses = input.transactions
    .filter(
      tx =>
        tx.amount < 0 &&
        !tx.isInternalTransfer &&
        tx.date >= currentExpenseStart &&
        tx.date <= now
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const currentAge = calculateAgeForPeriod(currentIncome, currentExpenses);

  const previousIncome = input.transactions
    .filter(
      tx =>
        tx.amount > 0 &&
        !tx.isInternalTransfer &&
        !input.reimbursementIncomeIds.has(tx.id) &&
        tx.date >= previousIncomeStart &&
        tx.date <= previousIncomeEnd
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const previousExpenses = input.transactions
    .filter(
      tx =>
        tx.amount < 0 &&
        !tx.isInternalTransfer &&
        tx.date >= previousExpenseStart &&
        tx.date <= previousExpenseEnd
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const previousMonthAge =
    previousIncome.length > 0 && previousExpenses.length > 0
      ? calculateAgeForPeriod(previousIncome, previousExpenses)
      : null;

  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (previousMonthAge !== null) {
    if (currentAge > previousMonthAge + 1) {
      trend = 'up';
    } else if (currentAge < previousMonthAge - 1) {
      trend = 'down';
    }
  }

  let explanation: string;
  if (currentAge === 0) {
    explanation = 'Not enough transaction data to calculate';
  } else {
    const days = Math.round(currentAge);
    explanation = `You're spending money received ${days} day${days !== 1 ? 's' : ''} ago on average`;
  }

  return {
    currentAge,
    previousMonthAge,
    trend,
    explanation,
  };
}

export class AgeOfMoneyEngine {
  calculate(input: AgeOfMoneyInput): AgeOfMoneyResult {
    return calculateAgeOfMoney(input);
  }
}
