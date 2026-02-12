import { RecurringFrequency, RecurringItemType } from '../types';

// Types for subscription audit
export interface RecurringItem {
  id: string;
  description: string;
  amount: number;
  frequency: RecurringFrequency;
  nextOccurrence: Date;
  categoryId?: string | null;
  isActive: boolean;
  itemType?: RecurringItemType;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  frequency: RecurringFrequency;
  monthlyEquivalent: number;
  annualCost: number;
  lastCharged: Date;
  categoryId?: string | null;
  daysSinceLastCharge: number;
  isActive: boolean;
  isPotentiallyUnused: boolean;
  unusedIndicators: string[];
  itemType?: RecurringItemType;
}

export interface SubscriptionAuditReport {
  subscriptions: Subscription[];
  summary: {
    totalMonthly: number;
    totalAnnual: number;
    activeCount: number;
    potentiallyUnusedCount: number;
    potentialSavings: number;
  };
  recommendations: string[];
}

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
 * Calculate expected interval in days for a frequency
 */
function getExpectedIntervalDays(frequency: RecurringFrequency): number {
  switch (frequency) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'biweekly':
      return 14;
    case 'monthly':
      return 30;
    case 'quarterly':
      return 90;
    case 'yearly':
      return 365;
    default:
      return 30;
  }
}

/**
 * Check if a subscription might be unused based on various indicators
 */
function checkUnusedIndicators(
  item: RecurringItem,
  daysSinceLastCharge: number
): { isPotentiallyUnused: boolean; indicators: string[] } {
  const indicators: string[] = [];
  const expectedInterval = getExpectedIntervalDays(item.frequency);

  // Check if significantly overdue
  if (daysSinceLastCharge > expectedInterval * 2) {
    indicators.push(`No charge in ${daysSinceLastCharge} days (expected every ${expectedInterval} days)`);
  }

  // Check for common unused subscription patterns
  const nameLower = item.description.toLowerCase();

  // Streaming services often go unused
  const streamingPatterns = ['netflix', 'hulu', 'disney', 'hbo', 'paramount', 'peacock', 'spotify', 'apple music', 'youtube premium'];
  if (streamingPatterns.some(p => nameLower.includes(p))) {
    // These are commonly unused - flag for review if annual cost is significant
    const annualCost = calculateMonthlyEquivalent(item.amount, item.frequency) * 12;
    if (annualCost > 10000) {
      indicators.push('Streaming service - consider if actively used');
    }
  }

  // Gym memberships are notoriously unused
  if (nameLower.includes('gym') || nameLower.includes('fitness') || nameLower.includes('planet')) {
    indicators.push('Gym/fitness membership - commonly underutilized');
  }

  // Magazine/news subscriptions
  if (nameLower.includes('magazine') || nameLower.includes('news') || nameLower.includes('times') || nameLower.includes('journal')) {
    indicators.push('News/magazine subscription - review reading habits');
  }

  // Software subscriptions
  if (nameLower.includes('adobe') || nameLower.includes('microsoft') || nameLower.includes('dropbox') || nameLower.includes('cloud')) {
    indicators.push('Software subscription - verify active usage');
  }

  return {
    isPotentiallyUnused: indicators.length > 0,
    indicators,
  };
}

/**
 * Audit recurring items to identify subscriptions and potential savings
 */
export function auditSubscriptions(
  recurringItems: RecurringItem[],
  options: {
    includeInactive?: boolean;
    minMonthlyCost?: number;
  } = {}
): SubscriptionAuditReport {
  const { includeInactive = false, minMonthlyCost = 0 } = options;
  const now = new Date();

  const subscriptions: Subscription[] = [];

  for (const item of recurringItems) {
    // Skip inactive unless requested
    if (!item.isActive && !includeInactive) continue;

    // Skip income (positive amounts)
    if (item.amount >= 0) continue;

    // Skip non-subscription items (bills and cashflow have their own sections)
    if (item.itemType && item.itemType !== 'subscription') continue;

    const monthlyEquivalent = calculateMonthlyEquivalent(item.amount, item.frequency);

    // Filter by minimum cost
    if (monthlyEquivalent < minMonthlyCost) continue;

    const annualCost = monthlyEquivalent * 12;
    const daysSinceLastCharge = Math.floor(
      (now.getTime() - new Date(item.nextOccurrence).getTime()) / (1000 * 60 * 60 * 24)
    );
    // nextOccurrence is in the future, so calculate from when it should have last occurred
    const expectedInterval = getExpectedIntervalDays(item.frequency);
    const lastCharged = new Date(new Date(item.nextOccurrence).getTime() - expectedInterval * 24 * 60 * 60 * 1000);
    const actualDaysSinceLastCharge = Math.floor(
      (now.getTime() - lastCharged.getTime()) / (1000 * 60 * 60 * 24)
    );

    const { isPotentiallyUnused, indicators } = checkUnusedIndicators(item, actualDaysSinceLastCharge);

    subscriptions.push({
      id: item.id,
      name: item.description,
      amount: Math.abs(item.amount),
      frequency: item.frequency,
      monthlyEquivalent,
      annualCost,
      lastCharged,
      categoryId: item.categoryId,
      daysSinceLastCharge: actualDaysSinceLastCharge,
      isActive: item.isActive,
      isPotentiallyUnused,
      unusedIndicators: indicators,
      itemType: item.itemType,
    });
  }

  // Sort by annual cost (highest first)
  subscriptions.sort((a, b) => b.annualCost - a.annualCost);

  // Calculate summary
  const activeSubscriptions = subscriptions.filter(s => s.isActive);
  const potentiallyUnused = subscriptions.filter(s => s.isPotentiallyUnused);
  const totalMonthly = activeSubscriptions.reduce((sum, s) => sum + s.monthlyEquivalent, 0);
  const totalAnnual = totalMonthly * 12;
  const potentialSavings = potentiallyUnused.reduce((sum, s) => sum + s.annualCost, 0);

  // Generate recommendations
  const recommendations: string[] = [];

  if (potentiallyUnused.length > 0) {
    recommendations.push(
      `Review ${potentiallyUnused.length} subscription(s) that may be unused - potential savings of $${(potentialSavings / 100).toFixed(0)}/year`
    );
  }

  // Find expensive subscriptions (exclude bills - utilities/mortgages aren't substitutable)
  const expensiveSubscriptions = subscriptions.filter(s => s.annualCost > 20000);
  if (expensiveSubscriptions.length > 0) {
    recommendations.push(
      `${expensiveSubscriptions.length} subscription(s) cost more than $200/year - consider if there are cheaper alternatives`
    );
  }

  // Total subscription cost recommendation
  if (totalAnnual > 100000) {
    recommendations.push(
      `Your subscriptions total $${(totalAnnual / 100).toFixed(0)}/year - consider consolidating or canceling some services`
    );
  }

  // Check for duplicate services
  const streamingServices = subscriptions.filter(s =>
    ['netflix', 'hulu', 'disney', 'hbo', 'paramount', 'peacock', 'prime video']
      .some(p => s.name.toLowerCase().includes(p))
  );
  if (streamingServices.length > 2) {
    recommendations.push(
      `You have ${streamingServices.length} streaming services - consider rotating subscriptions instead of keeping all active`
    );
  }

  return {
    subscriptions,
    summary: {
      totalMonthly,
      totalAnnual,
      activeCount: activeSubscriptions.length,
      potentiallyUnusedCount: potentiallyUnused.length,
      potentialSavings,
    },
    recommendations,
  };
}

// Legacy class-based API for backward compatibility
export class SubscriptionAuditEngine {
  private getRecurringItems: () => RecurringItem[];

  constructor(dataSource: { getRecurringItems: () => RecurringItem[] }) {
    this.getRecurringItems = dataSource.getRecurringItems;
  }

  auditSubscriptions(options?: {
    includeInactive?: boolean;
    minMonthlyCost?: number;
  }): SubscriptionAuditReport {
    return auditSubscriptions(this.getRecurringItems(), options);
  }
}
