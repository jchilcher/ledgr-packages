import { Transaction } from './types';

export function excludeTransfers<T extends Pick<Transaction, 'isInternalTransfer'>>(
  transactions: T[]
): T[] {
  return transactions.filter(t => !t.isInternalTransfer);
}
