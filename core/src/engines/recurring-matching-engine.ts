import { matchesPattern } from './categorization-engine';
import { RecurringItemRule, RecurringPayment } from '../types';

export interface RecurringMatchResult {
  transactionId: string;
  recurringItemId: string;
  ruleId: string;
  paymentId: string | null;
}

export interface RecurringMatchingDependencies {
  getRules: () => RecurringItemRule[];
  getPendingPayments: (recurringItemId: string) => RecurringPayment[];
}

/**
 * Match a transaction against recurring item rules.
 * Rules are sorted by priority DESC, first match wins.
 * Check pattern match, optional amount range, optional account filter.
 * If matched, find closest pending/overdue payment within ±15 days.
 */
export function matchTransaction(
  transaction: { id: string; description: string; amount: number; accountId: string; date: Date },
  deps: RecurringMatchingDependencies
): RecurringMatchResult | null {
  const rules = deps.getRules().sort((a, b) => b.priority - a.priority);

  for (const rule of rules) {
    // Check pattern match
    if (!matchesPattern(transaction.description, rule.pattern)) {
      continue;
    }

    // Check amount range if specified
    const absAmount = Math.abs(transaction.amount);
    if (rule.amountMin !== null && rule.amountMin !== undefined && absAmount < rule.amountMin) {
      continue;
    }
    if (rule.amountMax !== null && rule.amountMax !== undefined && absAmount > rule.amountMax) {
      continue;
    }

    // Check account filter if specified
    if (rule.accountFilter) {
      try {
        const accountIds: string[] = JSON.parse(rule.accountFilter);
        if (accountIds.length > 0 && !accountIds.includes(transaction.accountId)) {
          continue;
        }
      } catch {
        // Invalid JSON, skip account filter
      }
    }

    // Rule matched! Find closest pending/overdue payment within ±15 days
    const pendingPayments = deps.getPendingPayments(rule.recurringItemId);
    const eligiblePayments = pendingPayments.filter(p =>
      p.status === 'pending' || p.status === 'overdue'
    );

    let closestPayment: RecurringPayment | null = null;
    let closestDistance = Infinity;

    const transactionTime = transaction.date.getTime();
    const fifteenDays = 15 * 24 * 60 * 60 * 1000;

    for (const payment of eligiblePayments) {
      const paymentTime = new Date(payment.dueDate).getTime();
      const distance = Math.abs(paymentTime - transactionTime);

      if (distance <= fifteenDays && distance < closestDistance) {
        closestPayment = payment;
        closestDistance = distance;
      }
    }

    return {
      transactionId: transaction.id,
      recurringItemId: rule.recurringItemId,
      ruleId: rule.id,
      paymentId: closestPayment ? closestPayment.id : null,
    };
  }

  return null;
}
