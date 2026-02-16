import { suggestNewBudget, suggestBudgetAdjustment } from '../engines/budget-suggestion-engine'
import { Transaction } from '../types'

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    accountId: 'acc-1',
    date: new Date(),
    description: 'Test Transaction',
    amount: -5000,
    categoryId: null,
    isRecurring: false,
    importSource: 'file' as const,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('BudgetSuggestionEngine', () => {
  describe('suggestNewBudget', () => {
    it('should suggest budget based on historical spending', () => {
      const now = new Date()
      const transactions = []

      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -10000,
          })
        )
      }

      const suggestion = suggestNewBudget('cat-1', 'Groceries', transactions)

      expect(suggestion).not.toBeNull()
      expect(suggestion?.type).toBe('new_budget')
      expect(suggestion?.suggestedAmount).toBeGreaterThan(10000)
    })

    it('should add buffer to average spending', () => {
      const now = new Date()
      const transactions = []

      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -10000,
          })
        )
      }

      const suggestion = suggestNewBudget('cat-1', 'Groceries', transactions, { bufferPercent: 10 })

      expect(suggestion?.suggestedAmount).toBeCloseTo(11000, -2)
    })

    it('should return null for insufficient transactions', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          date: now,
          amount: -10000,
        }),
      ]

      const suggestion = suggestNewBudget('cat-1', 'Groceries', transactions, { minTransactions: 3 })

      expect(suggestion).toBeNull()
    })

    it('should calculate confidence score', () => {
      const now = new Date()
      const transactions = []

      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -10000,
          })
        )
      }

      const suggestion = suggestNewBudget('cat-1', 'Groceries', transactions)

      expect(suggestion?.confidence).toBeGreaterThan(0)
      expect(suggestion?.confidence).toBeLessThanOrEqual(100)
    })
  })

  describe('suggestBudgetAdjustment', () => {
    it('should suggest increase when consistently over budget', () => {
      const now = new Date()
      const transactions = []

      for (let i = 0; i < 4; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -15000,
          })
        )
      }

      const budget = {
        id: 'goal-1',
        categoryId: 'cat-1',
        amount: 10000,
        period: 'monthly' as const,
        rolloverEnabled: false,
        rolloverAmount: 0,
        startDate: new Date(),
        createdAt: new Date(),
      }

      const suggestion = suggestBudgetAdjustment('cat-1', 'Groceries', budget, transactions)

      expect(suggestion).not.toBeNull()
      expect(suggestion?.type).toBe('increase')
      expect(suggestion?.suggestedAmount).toBeGreaterThan(10000)
    })

    it('should suggest decrease when consistently under budget', () => {
      const now = new Date()
      const transactions = []

      for (let i = 0; i < 4; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -6000,
          })
        )
      }

      const budget = {
        id: 'goal-1',
        categoryId: 'cat-1',
        amount: 15000,
        period: 'monthly' as const,
        rolloverEnabled: false,
        rolloverAmount: 0,
        startDate: new Date(),
        createdAt: new Date(),
      }

      const suggestion = suggestBudgetAdjustment('cat-1', 'Groceries', budget, transactions)

      expect(suggestion).not.toBeNull()
      expect(suggestion?.type).toBe('decrease')
    })

    it('should suggest goal-based reduction', () => {
      const now = new Date()
      const transactions = []

      for (let i = 0; i < 4; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -10000,
          })
        )
      }

      const budget = {
        id: 'goal-1',
        categoryId: 'cat-1',
        amount: 10000,
        period: 'monthly' as const,
        rolloverEnabled: false,
        rolloverAmount: 0,
        startDate: new Date(),
        createdAt: new Date(),
      }

      const suggestion = suggestBudgetAdjustment('cat-1', 'Groceries', budget, transactions, 'reduce_spending')

      expect(suggestion).not.toBeNull()
      expect(suggestion?.type).toBe('decrease')
      expect(suggestion?.reason).toBe('goal_based_reduction')
    })
  })
})
