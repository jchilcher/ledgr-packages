import { Transaction } from './types';

export function excludeTransfers<T extends Pick<Transaction, 'isInternalTransfer'> & Partial<Pick<Transaction, 'isHidden'>>>(
  transactions: T[]
): T[] {
  return transactions.filter(t => !t.isInternalTransfer && !t.isHidden);
}
