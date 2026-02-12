/**
 * Debt Payoff Engine
 *
 * Calculates minimum payment amortization.
 * Implements snowball strategy (smallest balance first).
 * Implements avalanche strategy (highest interest first).
 * Calculates extra payment impact.
 */

export interface DebtData {
  id: string;
  name: string;
  balance: number;
  interestRate: number; // Annual percentage rate (e.g., 18 for 18%)
  minimumPayment: number;
  type?: string; // credit_card, loan, mortgage, etc.
}

export type PayoffStrategy = 'minimum' | 'snowball' | 'avalanche';

export interface MonthlyPayment {
  month: number;
  date: Date;
  debtId: string;
  debtName: string;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

export interface DebtPayoffPlan {
  debtId: string;
  debtName: string;
  originalBalance: number;
  interestRate: number;
  minimumPayment: number;
  totalInterestPaid: number;
  totalPaid: number;
  payoffDate: Date;
  monthsToPayoff: number;
  schedule: MonthlyPayment[];
}

export interface PayoffStrategyResult {
  strategy: PayoffStrategy;
  label: string;
  totalInterestPaid: number;
  totalPaid: number;
  payoffDate: Date;
  monthsToPayoff: number;
  debtPayoffPlans: DebtPayoffPlan[];
  payoffOrder: string[];
}

export interface ExtraPaymentImpact {
  extraMonthlyAmount: number;
  monthsSaved: number;
  interestSaved: number;
  newPayoffDate: Date;
  newTotalPaid: number;
}

export interface DebtPayoffReport {
  debts: DebtData[];
  totalDebt: number;
  totalMinimumPayments: number;
  strategies: PayoffStrategyResult[];
  recommended: PayoffStrategy;
  recommendationReason: string;
  extraPaymentImpacts: ExtraPaymentImpact[];
}

export interface DebtPayoffDependencies {
  getLiabilities: () => DebtData[] | Promise<DebtData[]>;
}

/**
 * Calculate monthly interest for a given balance and annual rate
 */
function calculateMonthlyInterest(balance: number, annualRate: number): number {
  const monthlyRate = annualRate / 100 / 12;
  return balance * monthlyRate;
}

/**
 * Calculate amortization schedule for a single debt with minimum payments
 */
export function calculateMinimumPaymentSchedule(
  debt: DebtData,
  startDate: Date = new Date()
): DebtPayoffPlan {
  const schedule: MonthlyPayment[] = [];
  let balance = debt.balance;
  let month = 0;
  let totalInterestPaid = 0;
  let totalPaid = 0;
  const maxMonths = 600; // 50 years cap

  while (balance > 0.01 && month < maxMonths) {
    month++;
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + month);

    const interest = calculateMonthlyInterest(balance, debt.interestRate);
    const payment = Math.min(debt.minimumPayment, balance + interest);
    const principal = Math.max(0, payment - interest);

    balance = Math.max(0, balance - principal);
    totalInterestPaid += interest;
    totalPaid += payment;

    schedule.push({
      month,
      date,
      debtId: debt.id,
      debtName: debt.name,
      payment,
      principal,
      interest,
      remainingBalance: balance,
    });

    // Detect if we're not making progress (minimum payment less than interest)
    if (principal <= 0 && balance > 0) {
      break;
    }
  }

  const payoffDate = schedule.length > 0 ? schedule[schedule.length - 1].date : startDate;

  return {
    debtId: debt.id,
    debtName: debt.name,
    originalBalance: debt.balance,
    interestRate: debt.interestRate,
    minimumPayment: debt.minimumPayment,
    totalInterestPaid,
    totalPaid,
    payoffDate,
    monthsToPayoff: month,
    schedule,
  };
}

/**
 * Calculate payoff with extra payments using a specific strategy
 */
export function calculateStrategyPayoff(
  debts: DebtData[],
  strategy: PayoffStrategy,
  extraMonthlyPayment: number = 0,
  startDate: Date = new Date()
): PayoffStrategyResult {
  if (debts.length === 0) {
    return {
      strategy,
      label: getStrategyLabel(strategy),
      totalInterestPaid: 0,
      totalPaid: 0,
      payoffDate: startDate,
      monthsToPayoff: 0,
      debtPayoffPlans: [],
      payoffOrder: [],
    };
  }

  // Sort debts according to strategy
  let sortedDebts = [...debts];
  if (strategy === 'snowball') {
    // Smallest balance first
    sortedDebts.sort((a, b) => a.balance - b.balance);
  } else if (strategy === 'avalanche') {
    // Highest interest rate first
    sortedDebts.sort((a, b) => b.interestRate - a.interestRate);
  }

  const payoffOrder = sortedDebts.map(d => d.id);
  const debtPlans: Map<string, DebtPayoffPlan> = new Map();
  const currentBalances: Map<string, number> = new Map();
  const schedules: Map<string, MonthlyPayment[]> = new Map();

  // Initialize
  for (const debt of sortedDebts) {
    currentBalances.set(debt.id, debt.balance);
    schedules.set(debt.id, []);
    debtPlans.set(debt.id, {
      debtId: debt.id,
      debtName: debt.name,
      originalBalance: debt.balance,
      interestRate: debt.interestRate,
      minimumPayment: debt.minimumPayment,
      totalInterestPaid: 0,
      totalPaid: 0,
      payoffDate: startDate,
      monthsToPayoff: 0,
      schedule: [],
    });
  }

  let month = 0;
  const maxMonths = 600;
  let availableExtra = extraMonthlyPayment;

  while (month < maxMonths) {
    month++;
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + month);

    // Track freed-up minimum payments from paid-off debts
    let freedMinimum = 0;
    let anyRemaining = false;

    // Calculate minimum payments and interest for all remaining debts
    for (const debt of sortedDebts) {
      const balance = currentBalances.get(debt.id)!;
      if (balance <= 0.01) continue;
      anyRemaining = true;

      const interest = calculateMonthlyInterest(balance, debt.interestRate);
      const minPayment = Math.min(debt.minimumPayment, balance + interest);
      const principal = Math.max(0, minPayment - interest);
      const newBalance = Math.max(0, balance - principal);

      currentBalances.set(debt.id, newBalance);

      const plan = debtPlans.get(debt.id)!;
      plan.totalInterestPaid += interest;
      plan.totalPaid += minPayment;

      schedules.get(debt.id)!.push({
        month,
        date,
        debtId: debt.id,
        debtName: debt.name,
        payment: minPayment,
        principal,
        interest,
        remainingBalance: newBalance,
      });

      if (newBalance <= 0.01) {
        freedMinimum += debt.minimumPayment;
        plan.payoffDate = date;
        plan.monthsToPayoff = month;
      }
    }

    if (!anyRemaining) break;

    // Apply extra payments (including snowballed freed minimums) to target debt
    const totalExtra = availableExtra + freedMinimum;
    availableExtra = totalExtra; // Snowball effect

    for (const debt of sortedDebts) {
      const balance = currentBalances.get(debt.id)!;
      if (balance <= 0.01 || availableExtra <= 0) continue;

      // Apply extra to this debt
      const extraToApply = Math.min(availableExtra, balance);
      const newBalance = Math.max(0, balance - extraToApply);
      currentBalances.set(debt.id, newBalance);
      availableExtra -= extraToApply;

      const plan = debtPlans.get(debt.id)!;
      plan.totalPaid += extraToApply;

      // Update last schedule entry
      const schedule = schedules.get(debt.id)!;
      if (schedule.length > 0) {
        const lastEntry = schedule[schedule.length - 1];
        lastEntry.payment += extraToApply;
        lastEntry.principal += extraToApply;
        lastEntry.remainingBalance = newBalance;
      }

      if (newBalance <= 0.01) {
        plan.payoffDate = date;
        plan.monthsToPayoff = month;
      }

      break; // Only apply extra to first unpaid debt in order
    }
  }

  // Finalize plans
  const finalPlans: DebtPayoffPlan[] = [];
  let totalInterestPaid = 0;
  let totalPaid = 0;
  let maxPayoffDate = startDate;
  let maxMonthsToPayoff = 0;

  for (const debt of sortedDebts) {
    const plan = debtPlans.get(debt.id)!;
    plan.schedule = schedules.get(debt.id)!;
    finalPlans.push(plan);

    totalInterestPaid += plan.totalInterestPaid;
    totalPaid += plan.totalPaid;

    if (plan.payoffDate > maxPayoffDate) {
      maxPayoffDate = plan.payoffDate;
    }
    if (plan.monthsToPayoff > maxMonthsToPayoff) {
      maxMonthsToPayoff = plan.monthsToPayoff;
    }
  }

  return {
    strategy,
    label: getStrategyLabel(strategy),
    totalInterestPaid,
    totalPaid,
    payoffDate: maxPayoffDate,
    monthsToPayoff: maxMonthsToPayoff,
    debtPayoffPlans: finalPlans,
    payoffOrder,
  };
}

function getStrategyLabel(strategy: PayoffStrategy): string {
  switch (strategy) {
    case 'minimum':
      return 'Minimum Payments Only';
    case 'snowball':
      return 'Debt Snowball (Smallest First)';
    case 'avalanche':
      return 'Debt Avalanche (Highest Interest First)';
    default:
      return strategy;
  }
}

/**
 * Calculate the impact of extra payments
 */
export function calculateExtraPaymentImpact(
  debts: DebtData[],
  strategy: PayoffStrategy,
  extraAmounts: number[]
): ExtraPaymentImpact[] {
  const baseline = calculateStrategyPayoff(debts, strategy, 0);

  return extraAmounts.map(extraAmount => {
    const withExtra = calculateStrategyPayoff(debts, strategy, extraAmount);

    return {
      extraMonthlyAmount: extraAmount,
      monthsSaved: baseline.monthsToPayoff - withExtra.monthsToPayoff,
      interestSaved: baseline.totalInterestPaid - withExtra.totalInterestPaid,
      newPayoffDate: withExtra.payoffDate,
      newTotalPaid: withExtra.totalPaid,
    };
  });
}

/**
 * Generate full debt payoff report
 */
export async function generateDebtPayoffReport(
  deps: DebtPayoffDependencies,
  options: { extraPaymentAmounts?: number[] } = {}
): Promise<DebtPayoffReport> {
  const { extraPaymentAmounts = [5000, 10000, 20000, 50000] } = options;

  const liabilities = await deps.getLiabilities();

  // Filter to debts with interest (not just static liabilities)
  const debts: DebtData[] = liabilities
    .filter(l => l.interestRate > 0 || l.minimumPayment > 0)
    .map(l => ({
      id: l.id,
      name: l.name,
      balance: l.balance,
      interestRate: l.interestRate || 0,
      minimumPayment: l.minimumPayment || l.balance * 0.02, // Default 2% minimum
      type: l.type,
    }));

  if (debts.length === 0) {
    return {
      debts: [],
      totalDebt: 0,
      totalMinimumPayments: 0,
      strategies: [],
      recommended: 'minimum',
      recommendationReason: 'No interest-bearing debts found.',
      extraPaymentImpacts: [],
    };
  }

  const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
  const totalMinimumPayments = debts.reduce((sum, d) => sum + d.minimumPayment, 0);

  // Calculate all strategies
  const strategies: PayoffStrategyResult[] = [
    calculateStrategyPayoff(debts, 'minimum'),
    calculateStrategyPayoff(debts, 'snowball'),
    calculateStrategyPayoff(debts, 'avalanche'),
  ];

  // Determine recommended strategy
  let recommended: PayoffStrategy = 'avalanche';
  let recommendationReason = '';

  const avalanche = strategies.find(s => s.strategy === 'avalanche')!;
  const snowball = strategies.find(s => s.strategy === 'snowball')!;

  const interestDifference = snowball.totalInterestPaid - avalanche.totalInterestPaid;
  const timeDifference = snowball.monthsToPayoff - avalanche.monthsToPayoff;

  if (interestDifference > 50000) {
    recommended = 'avalanche';
    recommendationReason = `The avalanche method saves $${(interestDifference / 100).toFixed(0)} in interest compared to snowball.`;
  } else if (debts.length > 3) {
    recommended = 'snowball';
    recommendationReason = `With ${debts.length} debts, the snowball method provides quicker wins to stay motivated. Interest difference is only $${(interestDifference / 100).toFixed(0)}.`;
  } else {
    recommended = 'avalanche';
    recommendationReason = `The avalanche method is mathematically optimal and saves $${(interestDifference / 100).toFixed(0)} in interest.`;
  }

  // Calculate extra payment impacts
  const extraPaymentImpacts = calculateExtraPaymentImpact(debts, recommended, extraPaymentAmounts);

  return {
    debts,
    totalDebt,
    totalMinimumPayments,
    strategies,
    recommended,
    recommendationReason,
    extraPaymentImpacts,
  };
}

/**
 * DebtPayoffEngine class for dependency injection
 */
export class DebtPayoffEngine {
  constructor(private deps: DebtPayoffDependencies) {}

  async generateReport(options?: { extraPaymentAmounts?: number[] }): Promise<DebtPayoffReport> {
    return generateDebtPayoffReport(this.deps, options);
  }

  async calculateStrategy(strategy: PayoffStrategy, extraMonthly: number = 0): Promise<PayoffStrategyResult> {
    const liabilities = await this.deps.getLiabilities();
    const debts: DebtData[] = liabilities
      .filter(l => l.interestRate > 0 || l.minimumPayment > 0)
      .map(l => ({
        id: l.id,
        name: l.name,
        balance: l.balance,
        interestRate: l.interestRate || 0,
        minimumPayment: l.minimumPayment || l.balance * 0.02,
        type: l.type,
      }));

    return calculateStrategyPayoff(debts, strategy, extraMonthly);
  }
}
