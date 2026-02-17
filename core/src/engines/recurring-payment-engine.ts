import { RecurringItem, RecurringPayment, RecurringFrequency } from '../types';

export interface RecurringPaymentDependencies {
  getActiveRecurringItems: () => RecurringItem[];
  getPaymentsForItem: (itemId: string) => RecurringPayment[];
  createPayment: (payment: Omit<RecurringPayment, 'id' | 'createdAt'>) => RecurringPayment;
  updatePayment: (id: string, updates: Partial<RecurringPayment>) => void;
}

/**
 * Calculate the next due date for a recurring item based on its frequency
 */
function calculateNextDueDate(
  currentDate: Date,
  frequency: RecurringFrequency,
  dayOfMonth?: number | null,
  startDate?: Date
): Date {
  const next = new Date(currentDate);

  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14);
      break;
    case 'monthly':
      if (dayOfMonth) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      } else if (startDate) {
        next.setMonth(next.getMonth() + 1);
        const targetDay = startDate.getDate();
        next.setDate(Math.min(targetDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      } else {
        next.setMonth(next.getMonth() + 1);
      }
      break;
    case 'quarterly':
      if (dayOfMonth) {
        next.setMonth(next.getMonth() + 3);
        next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      } else {
        next.setMonth(next.getMonth() + 3);
      }
      break;
    case 'yearly':
      if (dayOfMonth) {
        next.setFullYear(next.getFullYear() + 1);
        next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      } else {
        next.setFullYear(next.getFullYear() + 1);
      }
      break;
  }

  return next;
}

/**
 * Generate payment records for all active items with enableReminders=true.
 * Generates for current period + 1 month ahead.
 * Idempotent: skip if payment already exists for same recurringItemId + due month.
 * Mark past-due pending payments as overdue.
 */
export function generatePayments(deps: RecurringPaymentDependencies): { generated: number; overdue: number } {
  const now = new Date();
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + 1);

  const items = deps.getActiveRecurringItems();
  const activeItems = items.filter(item => item.enableReminders && item.isActive);

  let generated = 0;
  let overdue = 0;

  // Process each active recurring item
  for (const item of activeItems) {
    const existingPayments = deps.getPaymentsForItem(item.id);

    // Generate payments from nextOccurrence through endDate
    let currentDueDate = new Date(item.nextOccurrence);

    while (currentDueDate <= endDate) {
      // Check if payment already exists for this month/year
      const existingForPeriod = existingPayments.find(p => {
        const pDueDate = new Date(p.dueDate);
        return pDueDate.getMonth() === currentDueDate.getMonth() &&
               pDueDate.getFullYear() === currentDueDate.getFullYear();
      });

      if (!existingForPeriod) {
        // Create new payment
        deps.createPayment({
          recurringItemId: item.id,
          dueDate: new Date(currentDueDate),
          paidDate: null,
          amount: item.amount,
          status: 'pending',
          transactionId: null,
        });
        generated++;
      }

      // Calculate next due date
      currentDueDate = calculateNextDueDate(
        currentDueDate,
        item.frequency,
        item.dayOfMonth,
        item.startDate
      );
    }
  }

  // Mark overdue payments
  const allItems = items.filter(item => item.enableReminders);
  for (const item of allItems) {
    const payments = deps.getPaymentsForItem(item.id);
    for (const payment of payments) {
      if (payment.status === 'pending' && new Date(payment.dueDate) < now) {
        deps.updatePayment(payment.id, { status: 'overdue' });
        overdue++;
      }
    }
  }

  return { generated, overdue };
}
