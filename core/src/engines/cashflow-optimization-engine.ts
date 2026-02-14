/**
 * Cash Flow Optimization Engine
 *
 * Builds on existing cashflow-engine projections.
 * Identifies low-balance risk windows.
 * Suggests optimal bill due date distribution.
 */

export interface RecurringItemData {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  nextDueDate: Date | string;
  dayOfMonth?: number | null;
  isActive: boolean;
  type: 'income' | 'expense';
  accountId?: string | null;
}

export interface AccountData {
  id: string;
  name: string;
  balance: number;
  type?: string;
}

export interface BillPreferenceData {
  id: string;
  recurringItemId: string;
  preferredDueDay: number | null;
  notes: string | null;
}

export interface CashFlowProjectionPoint {
  date: Date;
  balance: number;
  inflows: number;
  outflows: number;
  items: Array<{
    name: string;
    amount: number;
    type: 'income' | 'expense';
    accountId?: string | null;
  }>;
  // Per-account balance tracking
  accountBalances?: Record<string, number>;
}

export interface TransferRecommendation {
  date: Date;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  amount: number;
  reason: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface LowBalanceWindow {
  startDate: Date;
  endDate: Date;
  lowestBalance: number;
  lowestDate: Date;
  daysAtRisk: number;
  severity: 'warning' | 'critical';
  triggeringItems: string[];
}

export interface BillCluster {
  dayRange: [number, number];
  bills: Array<{
    id: string;
    name: string;
    amount: number;
    dayOfMonth: number;
  }>;
  totalAmount: number;
  percentOfMonthlyBills: number;
}

export interface DueDateRecommendation {
  recurringItemId: string;
  recurringItemName: string;
  currentDayOfMonth: number | null;
  recommendedDayOfMonth: number;
  reason: string;
  projectedImpact: number;
}

export interface CashFlowOptimizationReport {
  projectionDays: number;
  projections: CashFlowProjectionPoint[];
  lowBalanceWindows: LowBalanceWindow[];
  billClusters: BillCluster[];
  recommendations: DueDateRecommendation[];
  transferRecommendations: TransferRecommendation[];
  summary: {
    lowestProjectedBalance: number;
    lowestBalanceDate: Date | null;
    averageBalance: number;
    daysAtRisk: number;
    billClusteringScore: number; // 0-100, higher = more clustered (bad)
    optimizationPotential: number; // estimated balance improvement
  };
  insights: string[];
}

export interface CashFlowOptimizationDependencies {
  getRecurringItems: () => RecurringItemData[] | Promise<RecurringItemData[]>;
  getAccounts: () => AccountData[] | Promise<AccountData[]>;
  getBillPreferences: () => BillPreferenceData[] | Promise<BillPreferenceData[]>;
}

/**
 * Calculate next occurrence of a recurring item
 */
function getNextOccurrences(
  item: RecurringItemData,
  startDate: Date,
  endDate: Date
): Date[] {
  const occurrences: Date[] = [];
  const nextDue = new Date(item.nextDueDate);
  let current = new Date(nextDue);

  // Ensure we start from the beginning of the projection period
  while (current < startDate) {
    current = advanceDate(current, item.frequency);
  }

  while (current <= endDate) {
    occurrences.push(new Date(current));
    current = advanceDate(current, item.frequency);
  }

  return occurrences;
}

function advanceDate(date: Date, frequency: string): Date {
  const result = new Date(date);
  switch (frequency) {
    case 'daily':
      result.setDate(result.getDate() + 1);
      break;
    case 'weekly':
      result.setDate(result.getDate() + 7);
      break;
    case 'biweekly':
      result.setDate(result.getDate() + 14);
      break;
    case 'monthly':
      result.setMonth(result.getMonth() + 1);
      break;
    case 'quarterly':
      result.setMonth(result.getMonth() + 3);
      break;
    case 'yearly':
      result.setFullYear(result.getFullYear() + 1);
      break;
    default:
      result.setMonth(result.getMonth() + 1);
  }
  return result;
}

/**
 * Project cash flow over a period with per-account tracking
 */
export function projectCashFlow(
  recurringItems: RecurringItemData[],
  startingBalance: number,
  days: number,
  accounts?: AccountData[]
): CashFlowProjectionPoint[] {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + days);

  // Build list of all events
  interface CashFlowEvent {
    date: Date;
    name: string;
    amount: number;
    type: 'income' | 'expense';
    accountId?: string | null;
  }

  const events: CashFlowEvent[] = [];
  const activeItems = recurringItems.filter(item => item.isActive);

  for (const item of activeItems) {
    const occurrences = getNextOccurrences(item, startDate, endDate);
    for (const date of occurrences) {
      events.push({
        date,
        name: item.name,
        amount: Math.abs(item.amount),
        type: item.type,
        accountId: item.accountId,
      });
    }
  }

  // Sort events by date
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Initialize per-account balances
  const accountBalances: Record<string, number> = {};
  if (accounts) {
    for (const account of accounts) {
      accountBalances[account.id] = account.balance;
    }
  }

  // Group events by day and calculate running balance
  const projections: CashFlowProjectionPoint[] = [];
  let balance = startingBalance;

  // Create daily projections
  for (let d = 0; d <= days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);

    const dayEvents = events.filter(e =>
      e.date.getFullYear() === date.getFullYear() &&
      e.date.getMonth() === date.getMonth() &&
      e.date.getDate() === date.getDate()
    );

    let inflows = 0;
    let outflows = 0;
    const items: Array<{ name: string; amount: number; type: 'income' | 'expense'; accountId?: string | null }> = [];

    for (const event of dayEvents) {
      if (event.type === 'income') {
        inflows += event.amount;
        balance += event.amount;
        // Update per-account balance
        if (event.accountId && accountBalances[event.accountId] !== undefined) {
          accountBalances[event.accountId] += event.amount;
        }
      } else {
        outflows += event.amount;
        balance -= event.amount;
        // Update per-account balance
        if (event.accountId && accountBalances[event.accountId] !== undefined) {
          accountBalances[event.accountId] -= event.amount;
        }
      }
      items.push({ name: event.name, amount: event.amount, type: event.type, accountId: event.accountId });
    }

    projections.push({
      date,
      balance,
      inflows,
      outflows,
      items,
      accountBalances: accounts ? { ...accountBalances } : undefined,
    });
  }

  return projections;
}

/**
 * Identify periods of low balance
 */
export function identifyLowBalanceWindows(
  projections: CashFlowProjectionPoint[],
  warningThreshold: number = 50000,
  criticalThreshold: number = 10000
): LowBalanceWindow[] {
  const windows: LowBalanceWindow[] = [];
  let currentWindow: LowBalanceWindow | null = null;

  for (let i = 0; i < projections.length; i++) {
    const point = projections[i];
    const isAtRisk = point.balance < warningThreshold;

    if (isAtRisk) {
      if (!currentWindow) {
        currentWindow = {
          startDate: point.date,
          endDate: point.date,
          lowestBalance: point.balance,
          lowestDate: point.date,
          daysAtRisk: 1,
          severity: point.balance < criticalThreshold ? 'critical' : 'warning',
          triggeringItems: point.items.filter(i => i.type === 'expense').map(i => i.name),
        };
      } else {
        currentWindow.endDate = point.date;
        currentWindow.daysAtRisk++;
        if (point.balance < currentWindow.lowestBalance) {
          currentWindow.lowestBalance = point.balance;
          currentWindow.lowestDate = point.date;
        }
        if (point.balance < criticalThreshold) {
          currentWindow.severity = 'critical';
        }
        // Add any new triggering items
        for (const item of point.items.filter(i => i.type === 'expense')) {
          if (!currentWindow.triggeringItems.includes(item.name)) {
            currentWindow.triggeringItems.push(item.name);
          }
        }
      }
    } else if (currentWindow) {
      windows.push(currentWindow);
      currentWindow = null;
    }
  }

  if (currentWindow) {
    windows.push(currentWindow);
  }

  return windows;
}

/**
 * Analyze bill clustering
 */
export function analyzeBillClusters(
  recurringItems: RecurringItemData[]
): BillCluster[] {
  const monthlyBills = recurringItems.filter(
    item => item.isActive && item.type === 'expense' && item.dayOfMonth
  );

  if (monthlyBills.length === 0) return [];

  // Group bills by day-of-month ranges
  const ranges: [number, number][] = [
    [1, 7],   // Week 1
    [8, 14],  // Week 2
    [15, 21], // Week 3
    [22, 31], // Week 4
  ];

  const totalMonthlyBills = monthlyBills.reduce((sum, b) => sum + Math.abs(b.amount), 0);
  const clusters: BillCluster[] = [];

  for (const range of ranges) {
    const billsInRange = monthlyBills.filter(
      b => b.dayOfMonth! >= range[0] && b.dayOfMonth! <= range[1]
    );

    if (billsInRange.length > 0) {
      const totalAmount = billsInRange.reduce((sum, b) => sum + Math.abs(b.amount), 0);

      clusters.push({
        dayRange: range,
        bills: billsInRange.map(b => ({
          id: b.id,
          name: b.name,
          amount: Math.abs(b.amount),
          dayOfMonth: b.dayOfMonth!,
        })),
        totalAmount,
        percentOfMonthlyBills: totalMonthlyBills > 0 ? (totalAmount / totalMonthlyBills) * 100 : 0,
      });
    }
  }

  return clusters.sort((a, b) => b.totalAmount - a.totalAmount);
}

/**
 * Generate due date recommendations
 */
export function generateDueDateRecommendations(
  recurringItems: RecurringItemData[],
  projections: CashFlowProjectionPoint[],
  lowBalanceWindows: LowBalanceWindow[]
): DueDateRecommendation[] {
  const recommendations: DueDateRecommendation[] = [];

  // Find bills that trigger or contribute to low balance windows
  for (const window of lowBalanceWindows) {
    for (const itemName of window.triggeringItems) {
      const item = recurringItems.find(i => i.name === itemName);
      if (!item || !item.dayOfMonth) continue;

      // Already have a recommendation for this item?
      if (recommendations.find(r => r.recurringItemId === item.id)) continue;

      // Find the day with highest projected balance in the month
      const monthProjections = projections.filter(p => {
        const date = new Date(p.date);
        return date.getDate() >= 1 && date.getDate() <= 28;
      });

      let bestDay = 15; // Default to mid-month
      let highestBalance = -Infinity;

      for (const proj of monthProjections) {
        const dayOfMonth = new Date(proj.date).getDate();
        if (proj.balance > highestBalance) {
          highestBalance = proj.balance;
          bestDay = dayOfMonth;
        }
      }

      // Only recommend if the day is significantly different
      if (Math.abs(bestDay - item.dayOfMonth) >= 5) {
        recommendations.push({
          recurringItemId: item.id,
          recurringItemName: item.name,
          currentDayOfMonth: item.dayOfMonth,
          recommendedDayOfMonth: bestDay,
          reason: `Moving from day ${item.dayOfMonth} to day ${bestDay} could help avoid low balance periods`,
          projectedImpact: Math.abs(item.amount),
        });
      }
    }
  }

  return recommendations.sort((a, b) => b.projectedImpact - a.projectedImpact);
}

/**
 * Calculate bill clustering score (0-100, higher = more clustered)
 */
function calculateClusteringScore(clusters: BillCluster[]): number {
  if (clusters.length === 0) return 0;

  // Ideal distribution would be 25% in each week
  const deviations = clusters.map(c => Math.abs(c.percentOfMonthlyBills - 25));
  const avgDeviation = deviations.reduce((a, b) => a + b, 0) / clusters.length;

  // Convert to 0-100 scale (max deviation is 75, min is 0)
  return Math.min(100, (avgDeviation / 75) * 100);
}

/**
 * Generate transfer recommendations when total balance or specific accounts go negative
 * but other accounts have funds available
 */
export function generateTransferRecommendations(
  projections: CashFlowProjectionPoint[],
  accounts: AccountData[],
  bufferAmount: number = 10000
): TransferRecommendation[] {
  const recommendations: TransferRecommendation[] = [];
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // Track which dates we've already recommended transfers for
  const recommendedDates = new Set<string>();

  // Find the primary checking account (for unassigned transactions)
  // Exclude credit card accounts — their negative balances are expected debt
  const nonCreditAccounts = accounts.filter(a => a.type !== 'credit');
  // Prefer checking accounts, then the one with highest balance
  const sortedAccounts = [...nonCreditAccounts].sort((a, b) => {
    // Checking accounts first
    if (a.name.toLowerCase().includes('checking') && !b.name.toLowerCase().includes('checking')) return -1;
    if (!a.name.toLowerCase().includes('checking') && b.name.toLowerCase().includes('checking')) return 1;
    // Then by balance (highest first)
    return b.balance - a.balance;
  });
  const primaryAccount = sortedAccounts[0];

  for (const projection of projections) {
    const dateKey = projection.date.toISOString().split('T')[0];
    if (recommendedDates.has(dateKey)) continue;

    // Check if total balance is negative - this catches unassigned transactions
    const totalBalanceNegative = projection.balance < 0;

    // Get per-account balances, or estimate from total if not tracked
    let accountsAtRisk: Array<{ id: string; balance: number; shortfall: number }> = [];
    let accountsWithFunds: Array<{ id: string; balance: number; available: number }> = [];

    if (projection.accountBalances && Object.keys(projection.accountBalances).length > 0) {
      // Use tracked per-account balances
      for (const [accountId, balance] of Object.entries(projection.accountBalances)) {
        const account = accountMap.get(accountId);
        // Skip credit card accounts — negative balances are expected debt,
        // not a shortfall that needs an immediate transfer
        if (account?.type === 'credit') continue;

        if (balance < 0) {
          accountsAtRisk.push({
            id: accountId,
            balance,
            shortfall: Math.abs(balance) + bufferAmount,
          });
        } else if (balance > bufferAmount * 2) {
          accountsWithFunds.push({
            id: accountId,
            balance,
            available: balance - bufferAmount,
          });
        }
      }
    }

    // If total is negative but no specific account is tracked as negative,
    // attribute the shortfall to the primary account
    if (totalBalanceNegative && accountsAtRisk.length === 0 && primaryAccount) {
      const shortfall = Math.abs(projection.balance) + bufferAmount;
      accountsAtRisk.push({
        id: primaryAccount.id,
        balance: projection.balance,
        shortfall,
      });

      // Find other accounts that might have funds
      // Use initial balances as estimate since per-account tracking may not be working
      for (const account of nonCreditAccounts) {
        if (account.id === primaryAccount.id) continue;
        if (account.balance > bufferAmount * 2) {
          // Check if this account isn't already in the list
          if (!accountsWithFunds.find(a => a.id === account.id)) {
            accountsWithFunds.push({
              id: account.id,
              balance: account.balance,
              available: account.balance - bufferAmount,
            });
          }
        }
      }
    }

    // Generate transfer recommendations
    for (const atRisk of accountsAtRisk) {
      const toAccount = accountMap.get(atRisk.id);
      if (!toAccount) continue;

      // Find best source account (one with most available funds)
      const sortedSources = accountsWithFunds
        .filter(a => a.available > 0 && a.id !== atRisk.id)
        .sort((a, b) => b.available - a.available);

      if (sortedSources.length === 0) continue;

      const source = sortedSources[0];
      const fromAccount = accountMap.get(source.id);
      if (!fromAccount) continue;

      const transferAmount = Math.min(atRisk.shortfall, source.available);
      if (transferAmount <= 0) continue;

      // Determine urgency based on how negative the balance will go
      let urgency: 'low' | 'medium' | 'high' = 'low';
      if (atRisk.balance < -500) {
        urgency = 'high';
      } else if (atRisk.balance < -100) {
        urgency = 'medium';
      }

      recommendations.push({
        date: projection.date,
        fromAccountId: source.id,
        fromAccountName: fromAccount.name,
        toAccountId: atRisk.id,
        toAccountName: toAccount.name,
        amount: Math.ceil(transferAmount),
        reason: `Projected balance of ${formatCurrency(atRisk.balance)} on this date`,
        urgency,
      });

      // Reduce available funds from source for subsequent calculations
      source.available -= transferAmount;
      recommendedDates.add(dateKey);
    }
  }

  return recommendations;
}

/**
 * Generate full cash flow optimization report
 */
export async function optimizeCashFlow(
  deps: CashFlowOptimizationDependencies,
  options: {
    projectionDays?: number;
    warningThreshold?: number;
    criticalThreshold?: number;
  } = {}
): Promise<CashFlowOptimizationReport> {
  const { projectionDays = 90, warningThreshold = 50000, criticalThreshold = 10000 } = options;

  const [recurringItems, accounts, _billPreferences] = await Promise.all([
    deps.getRecurringItems(),
    deps.getAccounts(),
    deps.getBillPreferences(),
  ]);

  // Use total balance from all accounts
  const startingBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

  // Project cash flow with per-account tracking
  const projections = projectCashFlow(recurringItems, startingBalance, projectionDays, accounts);

  // Identify low balance windows
  const lowBalanceWindows = identifyLowBalanceWindows(projections, warningThreshold, criticalThreshold);

  // Analyze bill clusters
  const billClusters = analyzeBillClusters(recurringItems);

  // Generate due date recommendations
  const recommendations = generateDueDateRecommendations(recurringItems, projections, lowBalanceWindows);

  // Generate transfer recommendations for accounts at risk
  const transferRecommendations = generateTransferRecommendations(projections, accounts, criticalThreshold);

  // Calculate summary statistics
  const lowestProjectedBalance = Math.min(...projections.map(p => p.balance));
  const lowestBalancePoint = projections.find(p => p.balance === lowestProjectedBalance);
  const averageBalance = projections.reduce((sum, p) => sum + p.balance, 0) / projections.length;
  const daysAtRisk = lowBalanceWindows.reduce((sum, w) => sum + w.daysAtRisk, 0);
  const billClusteringScore = calculateClusteringScore(billClusters);
  const optimizationPotential = recommendations.reduce((sum, r) => sum + r.projectedImpact, 0);

  // Generate insights
  const insights: string[] = [];

  if (lowestProjectedBalance < criticalThreshold) {
    insights.push(
      `Your balance is projected to drop to ${formatCurrency(lowestProjectedBalance)} on ${formatDate(lowestBalancePoint?.date)}. Consider adjusting bill due dates.`
    );
  } else if (lowestProjectedBalance < warningThreshold) {
    insights.push(
      `Your balance may get low (${formatCurrency(lowestProjectedBalance)}) around ${formatDate(lowestBalancePoint?.date)}.`
    );
  } else {
    insights.push(`Your cash flow looks healthy over the next ${projectionDays} days.`);
  }

  if (billClusteringScore > 50) {
    const heaviestCluster = billClusters[0];
    if (heaviestCluster) {
      insights.push(
        `${heaviestCluster.percentOfMonthlyBills.toFixed(0)}% of your bills are due during days ${heaviestCluster.dayRange[0]}-${heaviestCluster.dayRange[1]}. Spreading them out could improve cash flow.`
      );
    }
  }

  if (recommendations.length > 0) {
    insights.push(
      `We found ${recommendations.length} bill(s) that could be moved to improve your cash flow.`
    );
  }

  // Add insights about transfer recommendations
  if (transferRecommendations.length > 0) {
    const highUrgency = transferRecommendations.filter(t => t.urgency === 'high');
    const totalTransferAmount = transferRecommendations.reduce((sum, t) => sum + t.amount, 0);

    if (highUrgency.length > 0) {
      const firstHighUrgency = highUrgency[0];
      insights.push(
        `⚠️ ${firstHighUrgency.toAccountName} is projected to go negative. Consider transferring ${formatCurrency(firstHighUrgency.amount)} from ${firstHighUrgency.fromAccountName} before ${formatDate(firstHighUrgency.date)}.`
      );
    } else {
      insights.push(
        `We recommend ${transferRecommendations.length} transfer(s) totaling ${formatCurrency(totalTransferAmount)} to prevent low balances.`
      );
    }
  } else if (lowestProjectedBalance < 0) {
    // Balance goes negative but no transfer recommendations - explain why
    if (accounts.length <= 1) {
      insights.push(
        `💡 You only have one account. Consider adding income or reducing expenses before ${formatDate(lowestBalancePoint?.date)}.`
      );
    } else {
      const totalAvailable = accounts.reduce((sum, a) => sum + Math.max(0, a.balance - 10000), 0);
      const shortfall = Math.abs(lowestProjectedBalance);
      if (totalAvailable < shortfall) {
        insights.push(
          `💡 Your combined account balances won't cover the projected shortfall of ${formatCurrency(shortfall)}. You'll need an additional ${formatCurrency(shortfall - totalAvailable)}.`
        );
      }
    }
  }

  return {
    projectionDays,
    projections,
    lowBalanceWindows,
    billClusters,
    recommendations,
    transferRecommendations,
    summary: {
      lowestProjectedBalance,
      lowestBalanceDate: lowestBalancePoint?.date || null,
      averageBalance,
      daysAtRisk,
      billClusteringScore,
      optimizationPotential,
    },
    insights,
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function formatDate(date: Date | undefined): string {
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * CashFlowOptimizationEngine class for dependency injection
 */
export class CashFlowOptimizationEngine {
  constructor(private deps: CashFlowOptimizationDependencies) {}

  async optimize(options?: {
    projectionDays?: number;
    warningThreshold?: number;
    criticalThreshold?: number;
  }): Promise<CashFlowOptimizationReport> {
    return optimizeCashFlow(this.deps, options);
  }

  async getProjections(days: number = 90): Promise<CashFlowProjectionPoint[]> {
    const [recurringItems, accounts] = await Promise.all([
      this.deps.getRecurringItems(),
      this.deps.getAccounts(),
    ]);

    // Use total balance from all accounts (consistent with optimize())
    const startingBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

    return projectCashFlow(recurringItems, startingBalance, days, accounts);
  }
}
