/**
 * Recovery Plan Engine
 *
 * Orchestrates existing engines to generate actionable quick wins for users
 * facing negative cashflow forecasts. Provides:
 * - Quick Wins Dashboard: Aggregated recommendations from multiple engines
 * - What-If Scenario Simulator: Model changes before committing
 * - Emergency Mode: Proactive alerting when forecast shows <30 days until negative
 */

import {
  CashFlowOptimizationReport,
  CashFlowProjectionPoint,
  TransferRecommendation,
  DueDateRecommendation,
} from './cashflow-optimization-engine';
import { SubscriptionAuditReport, Subscription } from './subscription-audit-engine';
import { BudgetSuggestion } from './budget-suggestion-engine';
import { DebtPayoffReport, PayoffStrategyResult } from './debt-payoff-engine';
import { Account, Category, RecurringFrequency, RecurringItemType } from '../types';

// ============ Types ============

export type QuickWinType =
  | 'cancel_subscription'
  | 'pause_expense'
  | 'move_bill_due_date'
  | 'reduce_budget'
  | 'optimize_debt_payment'
  | 'transfer_funds';

export type QuickWinUrgency = 'immediate' | 'soon' | 'flexible';

export type EmergencyLevel = 'none' | 'caution' | 'warning' | 'critical';

export interface QuickWin {
  id: string;
  type: QuickWinType;
  title: string;
  description: string;
  potentialSavings: number; // Monthly savings
  annualImpact: number;
  urgency: QuickWinUrgency;
  confidence: number; // 0-100
  actionable: boolean;
  sourceEngine: string;
  metadata: Record<string, unknown>;
}

export interface ScenarioModification {
  type: 'cut_category' | 'add_income' | 'cancel_subscription' | 'pause_expense';
  categoryId?: string;
  subscriptionId?: string;
  recurringItemId?: string;
  percentReduction?: number;
  amountChange?: number;
}

export interface ScenarioResult {
  modifications: ScenarioModification[];
  originalProjections: CashFlowProjectionPoint[];
  modifiedProjections: CashFlowProjectionPoint[];
  originalDaysUntilNegative: number | null;
  modifiedDaysUntilNegative: number | null;
  originalLowestBalance: number;
  modifiedLowestBalance: number;
  totalMonthlySavings: number;
  summary: string;
}

export interface EmergencyStatus {
  level: EmergencyLevel;
  daysUntilNegative: number | null;
  projectedNegativeDate: Date | null;
  lowestProjectedBalance: number;
  triggeringExpenses: string[];
}

export interface PausableExpense {
  id: string;
  name: string;
  amount: number;
  frequency: RecurringFrequency;
  monthlyEquivalent: number;
  isEssential: boolean;
  categoryId?: string | null;
  categoryName?: string;
  canPause: boolean;
  pauseReason?: string;
}

export interface SurvivalModeResult {
  essentialExpenses: PausableExpense[];
  pausableExpenses: PausableExpense[];
  totalEssentialMonthly: number;
  totalPausableMonthly: number;
  potentialSavingsIfAllPaused: number;
  recommendations: string[];
}

export interface RecoveryPlanReport {
  emergencyStatus: EmergencyStatus;
  quickWins: QuickWin[];
  totalPotentialMonthlySavings: number;
  survivalMode: SurvivalModeResult | null;
  insights: string[];
  generatedAt: Date;
}

// ============ Dependencies ============

export interface RecurringItemData {
  id: string;
  description: string;
  amount: number;
  frequency: RecurringFrequency;
  nextOccurrence: Date;
  categoryId?: string | null;
  isActive: boolean;
  itemType?: RecurringItemType;
}

export interface RecoveryPlanDependencies {
  getCashFlowOptimization: () => Promise<CashFlowOptimizationReport>;
  getSubscriptionAudit: () => Promise<SubscriptionAuditReport>;
  getBudgetSuggestions: () => Promise<BudgetSuggestion[]>;
  getDebtPayoffReport: () => Promise<DebtPayoffReport>;
  getRecurringItems: () => RecurringItemData[] | Promise<RecurringItemData[]>;
  getAccounts: () => Account[] | Promise<Account[]>;
  getCategories: () => Category[] | Promise<Category[]>;
}

// ============ Helper Functions ============

/**
 * Calculate monthly equivalent for a given amount and frequency
 */
function calculateMonthlyEquivalent(amount: number, frequency: RecurringFrequency): number {
  const absAmount = Math.abs(amount);
  switch (frequency) {
    case 'daily':
      return absAmount * 30;
    case 'weekly':
      return absAmount * 4.33;
    case 'biweekly':
      return absAmount * 2.17;
    case 'monthly':
      return absAmount;
    case 'quarterly':
      return absAmount / 3;
    case 'yearly':
      return absAmount / 12;
    default:
      return absAmount;
  }
}

/**
 * Determine emergency level based on days until negative balance
 */
function determineEmergencyLevel(daysUntilNegative: number | null, lowestBalance: number): EmergencyLevel {
  if (lowestBalance >= 0 && daysUntilNegative === null) {
    return 'none';
  }

  if (daysUntilNegative !== null) {
    if (daysUntilNegative <= 7) return 'critical';
    if (daysUntilNegative <= 14) return 'warning';
    if (daysUntilNegative <= 30) return 'caution';
  }

  // Even if no negative yet, warn if balance gets very low
  if (lowestBalance < 100) return 'warning';
  if (lowestBalance < 500) return 'caution';

  return 'none';
}

/**
 * Find days until balance goes negative
 */
function findDaysUntilNegative(projections: CashFlowProjectionPoint[]): {
  days: number | null;
  date: Date | null;
  triggeringExpenses: string[];
} {
  for (let i = 0; i < projections.length; i++) {
    const point = projections[i];
    if (point.balance < 0) {
      const triggeringExpenses = point.items
        .filter(item => item.type === 'expense')
        .map(item => item.name);
      return {
        days: i,
        date: point.date,
        triggeringExpenses,
      };
    }
  }
  return { days: null, date: null, triggeringExpenses: [] };
}

/**
 * Determine if an expense category is essential
 */
function isEssentialCategory(categoryName: string | undefined): boolean {
  if (!categoryName) return false;
  const essential = [
    'housing', 'rent', 'mortgage',
    'utilities', 'electric', 'gas', 'water',
    'insurance', 'health',
    'groceries', 'food',
    'transportation', 'gas', 'fuel',
    'medical', 'healthcare',
    'childcare', 'education',
    'phone', 'internet', // Often needed for work
  ];
  const lower = categoryName.toLowerCase();
  return essential.some(e => lower.includes(e));
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `qw-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============ Quick Win Generators ============

/**
 * Generate quick wins from subscription audit
 */
function generateSubscriptionQuickWins(audit: SubscriptionAuditReport): QuickWin[] {
  const quickWins: QuickWin[] = [];

  // Potentially unused subscriptions
  for (const sub of audit.subscriptions.filter(s => s.isPotentiallyUnused)) {
    quickWins.push({
      id: generateId(),
      type: 'cancel_subscription',
      title: `Cancel ${sub.name}`,
      description: sub.unusedIndicators.join('. '),
      potentialSavings: sub.monthlyEquivalent,
      annualImpact: sub.annualCost,
      urgency: sub.monthlyEquivalent > 5000 ? 'immediate' : 'soon',
      confidence: 70,
      actionable: true,
      sourceEngine: 'subscription-audit',
      metadata: {
        subscriptionId: sub.id,
        subscriptionName: sub.name,
        frequency: sub.frequency,
        lastCharged: sub.lastCharged,
      },
    });
  }

  // High-cost subscriptions (even if used)
  for (const sub of audit.subscriptions.filter(s => s.annualCost > 20000 && !s.isPotentiallyUnused && s.itemType !== 'bill')) {
    quickWins.push({
      id: generateId(),
      type: 'cancel_subscription',
      title: `Review ${sub.name}`,
      description: `This subscription costs $${(sub.annualCost / 100).toFixed(0)}/year. Consider if cheaper alternatives exist.`,
      potentialSavings: sub.monthlyEquivalent * 0.5, // Assume 50% savings from alternative
      annualImpact: sub.annualCost * 0.5,
      urgency: 'flexible',
      confidence: 50,
      actionable: true,
      sourceEngine: 'subscription-audit',
      metadata: {
        subscriptionId: sub.id,
        subscriptionName: sub.name,
        frequency: sub.frequency,
      },
    });
  }

  return quickWins;
}

/**
 * Generate quick wins from cash flow optimization
 */
function generateCashFlowQuickWins(report: CashFlowOptimizationReport): QuickWin[] {
  const quickWins: QuickWin[] = [];

  // Bill due date recommendations
  for (const rec of report.recommendations) {
    quickWins.push({
      id: generateId(),
      type: 'move_bill_due_date',
      title: `Move ${rec.recurringItemName} to day ${rec.recommendedDayOfMonth}`,
      description: rec.reason,
      potentialSavings: 0, // Doesn't save money directly
      annualImpact: rec.projectedImpact, // Cash flow improvement
      urgency: report.lowBalanceWindows.some(w => w.severity === 'critical') ? 'immediate' : 'soon',
      confidence: 75,
      actionable: true,
      sourceEngine: 'cashflow-optimization',
      metadata: {
        recurringItemId: rec.recurringItemId,
        currentDay: rec.currentDayOfMonth,
        recommendedDay: rec.recommendedDayOfMonth,
      },
    });
  }

  // Transfer recommendations
  for (const transfer of report.transferRecommendations) {
    quickWins.push({
      id: generateId(),
      type: 'transfer_funds',
      title: `Transfer $${(transfer.amount / 100).toFixed(2)} from ${transfer.fromAccountName}`,
      description: `Transfer to ${transfer.toAccountName} by ${transfer.date.toLocaleDateString()} - ${transfer.reason}`,
      potentialSavings: 0,
      annualImpact: 0,
      urgency: transfer.urgency === 'high' ? 'immediate' : transfer.urgency === 'medium' ? 'soon' : 'flexible',
      confidence: 85,
      actionable: true,
      sourceEngine: 'cashflow-optimization',
      metadata: {
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amount: transfer.amount,
        date: transfer.date,
      },
    });
  }

  return quickWins;
}

/**
 * Generate quick wins from budget suggestions
 */
function generateBudgetQuickWins(suggestions: BudgetSuggestion[]): QuickWin[] {
  const quickWins: QuickWin[] = [];

  for (const suggestion of suggestions.filter(s => s.type === 'decrease' || s.type === 'new_budget')) {
    if (suggestion.currentBudget === null) continue;

    const savings = suggestion.currentBudget - suggestion.suggestedAmount;
    if (savings <= 0) continue;

    quickWins.push({
      id: generateId(),
      type: 'reduce_budget',
      title: `Reduce ${suggestion.categoryName} budget`,
      description: suggestion.explanation,
      potentialSavings: savings,
      annualImpact: savings * 12,
      urgency: suggestion.confidence > 70 ? 'soon' : 'flexible',
      confidence: suggestion.confidence,
      actionable: true,
      sourceEngine: 'budget-suggestion',
      metadata: {
        categoryId: suggestion.categoryId,
        currentBudget: suggestion.currentBudget,
        suggestedAmount: suggestion.suggestedAmount,
        reason: suggestion.reason,
      },
    });
  }

  return quickWins;
}

/**
 * Generate quick wins from debt payoff analysis
 */
function generateDebtQuickWins(report: DebtPayoffReport): QuickWin[] {
  const quickWins: QuickWin[] = [];

  if (report.debts.length === 0) return quickWins;

  // Find savings from switching to optimal strategy
  const minimum = report.strategies.find(s => s.strategy === 'minimum');
  const optimal = report.strategies.find(s => s.strategy === report.recommended);

  if (minimum && optimal && optimal.totalInterestPaid < minimum.totalInterestPaid) {
    const interestSaved = minimum.totalInterestPaid - optimal.totalInterestPaid;
    const monthsSaved = minimum.monthsToPayoff - optimal.monthsToPayoff;

    quickWins.push({
      id: generateId(),
      type: 'optimize_debt_payment',
      title: `Switch to ${optimal.label}`,
      description: `Save $${(interestSaved / 100).toFixed(0)} in interest and pay off ${monthsSaved} months earlier`,
      potentialSavings: interestSaved / optimal.monthsToPayoff, // Monthly equivalent
      annualImpact: (interestSaved / optimal.monthsToPayoff) * 12,
      urgency: 'soon',
      confidence: 90,
      actionable: true,
      sourceEngine: 'debt-payoff',
      metadata: {
        currentStrategy: 'minimum',
        recommendedStrategy: report.recommended,
        interestSaved,
        monthsSaved,
      },
    });
  }

  // Extra payment impact
  for (const impact of report.extraPaymentImpacts.slice(0, 2)) {
    if (impact.monthsSaved > 0) {
      quickWins.push({
        id: generateId(),
        type: 'optimize_debt_payment',
        title: `Add $${(impact.extraMonthlyAmount / 100).toFixed(0)}/mo to debt payments`,
        description: `Save $${(impact.interestSaved / 100).toFixed(0)} in interest and pay off ${impact.monthsSaved} months earlier`,
        potentialSavings: -impact.extraMonthlyAmount, // This is a cost, not savings
        annualImpact: impact.interestSaved,
        urgency: 'flexible',
        confidence: 95,
        actionable: true,
        sourceEngine: 'debt-payoff',
        metadata: {
          extraAmount: impact.extraMonthlyAmount,
          interestSaved: impact.interestSaved,
          monthsSaved: impact.monthsSaved,
          newPayoffDate: impact.newPayoffDate,
        },
      });
    }
  }

  return quickWins;
}

// ============ Main Engine ============

/**
 * Generate emergency status from projections
 */
export async function getEmergencyStatus(
  deps: RecoveryPlanDependencies,
  thresholdDays: number = 30
): Promise<EmergencyStatus> {
  const cashFlowReport = await deps.getCashFlowOptimization();
  const projections = cashFlowReport.projections;

  const { days, date, triggeringExpenses } = findDaysUntilNegative(projections);
  const lowestBalance = cashFlowReport.summary.lowestProjectedBalance;
  const level = determineEmergencyLevel(days, lowestBalance);

  return {
    level,
    daysUntilNegative: days,
    projectedNegativeDate: date,
    lowestProjectedBalance: lowestBalance,
    triggeringExpenses,
  };
}

/**
 * Get all quick wins aggregated from various engines
 */
export async function getQuickWins(deps: RecoveryPlanDependencies): Promise<QuickWin[]> {
  const [cashFlowReport, subscriptionAudit, budgetSuggestions, debtReport] = await Promise.all([
    deps.getCashFlowOptimization(),
    deps.getSubscriptionAudit(),
    deps.getBudgetSuggestions(),
    deps.getDebtPayoffReport(),
  ]);

  const quickWins: QuickWin[] = [
    ...generateSubscriptionQuickWins(subscriptionAudit),
    ...generateCashFlowQuickWins(cashFlowReport),
    ...generateBudgetQuickWins(budgetSuggestions),
    ...generateDebtQuickWins(debtReport),
  ];

  // Sort by urgency then by potential savings
  const urgencyOrder: Record<QuickWinUrgency, number> = {
    immediate: 0,
    soon: 1,
    flexible: 2,
  };

  quickWins.sort((a, b) => {
    const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.potentialSavings - a.potentialSavings;
  });

  return quickWins;
}

/**
 * Get survival mode analysis - essential vs pausable expenses
 */
export async function getSurvivalMode(deps: RecoveryPlanDependencies): Promise<SurvivalModeResult> {
  const [recurringItems, categories] = await Promise.all([
    deps.getRecurringItems(),
    deps.getCategories(),
  ]);

  const categoryMap = new Map(categories.map(c => [c.id, c]));

  const essentialExpenses: PausableExpense[] = [];
  const pausableExpenses: PausableExpense[] = [];

  for (const item of recurringItems.filter(i => i.isActive && i.amount < 0)) {
    const category = item.categoryId ? categoryMap.get(item.categoryId) : null;
    const monthlyEquivalent = calculateMonthlyEquivalent(item.amount, item.frequency);
    const isEssential = isEssentialCategory(category?.name);

    const expense: PausableExpense = {
      id: item.id,
      name: item.description,
      amount: Math.abs(item.amount),
      frequency: item.frequency,
      monthlyEquivalent,
      isEssential,
      categoryId: item.categoryId,
      categoryName: category?.name,
      canPause: !isEssential,
      pauseReason: isEssential ? 'Essential expense' : undefined,
    };

    if (isEssential) {
      essentialExpenses.push(expense);
    } else {
      pausableExpenses.push(expense);
    }
  }

  // Sort pausable by monthly equivalent (highest first)
  pausableExpenses.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);

  const totalEssentialMonthly = essentialExpenses.reduce((sum, e) => sum + e.monthlyEquivalent, 0);
  const totalPausableMonthly = pausableExpenses.reduce((sum, e) => sum + e.monthlyEquivalent, 0);

  // Generate recommendations
  const recommendations: string[] = [];

  if (pausableExpenses.length > 0) {
    const topPausable = pausableExpenses.slice(0, 3);
    const topSavings = topPausable.reduce((sum, e) => sum + e.monthlyEquivalent, 0);
    recommendations.push(
      `Pausing your top ${topPausable.length} non-essential expenses would save $${(topSavings / 100).toFixed(0)}/month`
    );
  }

  if (totalPausableMonthly > totalEssentialMonthly * 0.5) {
    recommendations.push(
      `Your non-essential spending ($${(totalPausableMonthly / 100).toFixed(0)}/mo) is significant - consider which items can wait`
    );
  }

  return {
    essentialExpenses,
    pausableExpenses,
    totalEssentialMonthly,
    totalPausableMonthly,
    potentialSavingsIfAllPaused: totalPausableMonthly,
    recommendations,
  };
}

/**
 * Simulate scenario with modifications
 */
export async function simulateScenario(
  deps: RecoveryPlanDependencies,
  modifications: ScenarioModification[],
  projectionDays: number = 90
): Promise<ScenarioResult> {
  const cashFlowReport = await deps.getCashFlowOptimization();
  const originalProjections = cashFlowReport.projections;
  const recurringItems = await deps.getRecurringItems();

  // Calculate monthly reduction from modifications
  let totalMonthlySavings = 0;
  const activeItems = recurringItems.filter(i => i.isActive);

  for (const mod of modifications) {
    switch (mod.type) {
      case 'cancel_subscription':
      case 'pause_expense': {
        const item = activeItems.find(i => i.id === mod.recurringItemId);
        if (item) {
          totalMonthlySavings += calculateMonthlyEquivalent(item.amount, item.frequency);
        }
        break;
      }
      case 'cut_category': {
        if (mod.categoryId && mod.percentReduction) {
          const categoryItems = activeItems.filter(i => i.categoryId === mod.categoryId);
          for (const item of categoryItems) {
            totalMonthlySavings += calculateMonthlyEquivalent(item.amount, item.frequency) * (mod.percentReduction / 100);
          }
        }
        break;
      }
      case 'add_income': {
        if (mod.amountChange) {
          totalMonthlySavings += mod.amountChange;
        }
        break;
      }
    }
  }

  // Create modified projections (simplified - add savings to each day proportionally)
  const dailySavings = totalMonthlySavings / 30;
  const modifiedProjections: CashFlowProjectionPoint[] = originalProjections.map((p, i) => ({
    ...p,
    balance: p.balance + (dailySavings * i),
  }));

  // Find days until negative for both
  const originalNegative = findDaysUntilNegative(originalProjections);
  const modifiedNegative = findDaysUntilNegative(modifiedProjections);

  const originalLowest = Math.min(...originalProjections.map(p => p.balance));
  const modifiedLowest = Math.min(...modifiedProjections.map(p => p.balance));

  // Generate summary
  let summary = '';
  if (originalNegative.days !== null && modifiedNegative.days === null) {
    summary = `These changes would prevent your balance from going negative!`;
  } else if (modifiedNegative.days !== null && originalNegative.days !== null) {
    const daysDiff = modifiedNegative.days - originalNegative.days;
    if (daysDiff > 0) {
      summary = `These changes would give you ${daysDiff} more days before going negative.`;
    } else {
      summary = `These changes would not significantly improve your situation.`;
    }
  } else if (modifiedLowest > originalLowest) {
    summary = `Your lowest projected balance would improve by $${((modifiedLowest - originalLowest) / 100).toFixed(0)}.`;
  } else {
    summary = `These changes would save $${(totalMonthlySavings / 100).toFixed(0)}/month.`;
  }

  return {
    modifications,
    originalProjections,
    modifiedProjections,
    originalDaysUntilNegative: originalNegative.days,
    modifiedDaysUntilNegative: modifiedNegative.days,
    originalLowestBalance: originalLowest,
    modifiedLowestBalance: modifiedLowest,
    totalMonthlySavings,
    summary,
  };
}

/**
 * Generate full recovery plan report
 */
export async function generateRecoveryPlan(
  deps: RecoveryPlanDependencies,
  options: { thresholdDays?: number } = {}
): Promise<RecoveryPlanReport> {
  const { thresholdDays = 30 } = options;

  const [emergencyStatus, quickWins, survivalMode] = await Promise.all([
    getEmergencyStatus(deps, thresholdDays),
    getQuickWins(deps),
    getSurvivalMode(deps),
  ]);

  // Calculate total potential savings (only positive savings)
  const totalPotentialMonthlySavings = quickWins
    .filter(qw => qw.potentialSavings > 0)
    .reduce((sum, qw) => sum + qw.potentialSavings, 0);

  // Generate insights
  const insights: string[] = [];

  if (emergencyStatus.level === 'critical') {
    insights.push(
      `Your balance is projected to go negative in ${emergencyStatus.daysUntilNegative} days. Immediate action is recommended.`
    );
  } else if (emergencyStatus.level === 'warning') {
    insights.push(
      `Your balance may go negative within ${emergencyStatus.daysUntilNegative} days. Consider taking action soon.`
    );
  } else if (emergencyStatus.level === 'caution') {
    insights.push(
      `Cash flow gets tight in about ${emergencyStatus.daysUntilNegative} days. Review the quick wins below.`
    );
  }

  if (totalPotentialMonthlySavings > 0) {
    insights.push(
      `We found $${(totalPotentialMonthlySavings / 100).toFixed(0)}/month in potential savings across ${quickWins.filter(qw => qw.potentialSavings > 0).length} recommendations.`
    );
  }

  const immediateWins = quickWins.filter(qw => qw.urgency === 'immediate');
  if (immediateWins.length > 0) {
    insights.push(
      `${immediateWins.length} recommendation(s) require immediate attention.`
    );
  }

  if (emergencyStatus.level !== 'none' && survivalMode.potentialSavingsIfAllPaused > 0) {
    insights.push(
      `In survival mode, pausing non-essential expenses could free up $${(survivalMode.potentialSavingsIfAllPaused / 100).toFixed(0)}/month.`
    );
  }

  return {
    emergencyStatus,
    quickWins,
    totalPotentialMonthlySavings,
    survivalMode: emergencyStatus.level !== 'none' ? survivalMode : null,
    insights,
    generatedAt: new Date(),
  };
}

// ============ Engine Class ============

export class RecoveryPlanEngine {
  constructor(private deps: RecoveryPlanDependencies) {}

  async generateRecoveryPlan(options?: { thresholdDays?: number }): Promise<RecoveryPlanReport> {
    return generateRecoveryPlan(this.deps, options);
  }

  async getQuickWins(): Promise<QuickWin[]> {
    return getQuickWins(this.deps);
  }

  async simulateScenario(modifications: ScenarioModification[], projectionDays?: number): Promise<ScenarioResult> {
    return simulateScenario(this.deps, modifications, projectionDays);
  }

  async getEmergencyStatus(thresholdDays?: number): Promise<EmergencyStatus> {
    return getEmergencyStatus(this.deps, thresholdDays);
  }

  async getSurvivalMode(): Promise<SurvivalModeResult> {
    return getSurvivalMode(this.deps);
  }
}
