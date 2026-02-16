import { calculateSafeToSpend } from '../engines/safe-to-spend-engine'

describe('SafeToSpendEngine', () => {
  describe('calculateSafeToSpend', () => {
    it('should calculate safe amount after bills, savings, and budget', () => {
      const now = new Date()

      const input = {
        accounts: [{ id: 'a1', balance: 100000 }],
        recurringItems: [
          { description: 'Rent', amount: -50000, nextOccurrence: new Date(now.getTime() + 5 * 86400000), isActive: true },
        ],
        savingsGoals: [
          { name: 'Vacation', targetAmount: 100000, currentAmount: 0, targetDate: new Date(now.getFullYear(), now.getMonth() + 10, 1), isActive: true },
        ],
        budgetGoals: [{ categoryId: 'c1', amount: 20000, period: 'monthly' as const }],
        categorySpending: new Map([['c1', 5000]]),
        categories: [{ id: 'c1', name: 'Groceries' }],
        monthlyIncome: 150000,
      }

      const result = calculateSafeToSpend(input)

      expect(result.safeAmount).toBeLessThan(100000)
      expect(result.upcomingBills).toBe(50000)
      expect(result.budgetRemaining).toBe(15000)
    })

    it('should set healthy status when safe amount is > 20% of income', () => {
      const input = {
        accounts: [{ id: 'a1', balance: 200000 }],
        recurringItems: [],
        savingsGoals: [],
        budgetGoals: [],
        categorySpending: new Map(),
        categories: [],
        monthlyIncome: 100000,
      }

      const result = calculateSafeToSpend(input)

      expect(result.status).toBe('healthy')
    })

    it('should set low status when safe amount is negative', () => {
      const now = new Date()

      const input = {
        accounts: [{ id: 'a1', balance: 10000 }],
        recurringItems: [
          { description: 'Rent', amount: -50000, nextOccurrence: new Date(now.getTime() + 5 * 86400000), isActive: true },
        ],
        savingsGoals: [],
        budgetGoals: [],
        categorySpending: new Map(),
        categories: [],
        monthlyIncome: 100000,
      }

      const result = calculateSafeToSpend(input)

      expect(result.status).toBe('low')
      expect(result.safeAmount).toBeLessThan(0)
    })
  })
})
