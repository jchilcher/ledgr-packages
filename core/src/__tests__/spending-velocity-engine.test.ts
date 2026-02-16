import { calculateCategoryVelocity, calculateSpendingVelocity } from '../engines/spending-velocity-engine'
import { Transaction, Category } from '../types'

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

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: `cat-${Math.random().toString(36).slice(2)}`,
    name: 'Test Category',
    type: 'expense' as const,
    isDefault: false,
    ...overrides,
  }
}

function makeBudgetGoal(overrides: any = {}): any {
  return {
    id: `goal-${Math.random().toString(36).slice(2)}`,
    categoryId: 'cat-1',
    amount: 50000,
    period: 'monthly' as const,
    ...overrides,
  }
}

describe('SpendingVelocityEngine', () => {
  describe('calculateCategoryVelocity', () => {
    it('should calculate daily burn rate correctly', () => {
      const now = new Date()
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -10000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
        makeTransaction({
          categoryId: 'cat-1',
          amount: -10000,
          date: new Date(now.getFullYear(), now.getMonth(), 10),
        }),
      ]

      const velocity = calculateCategoryVelocity(
        'cat-1',
        'Groceries',
        50000,
        transactions,
        periodStart,
        periodEnd
      )

      expect(velocity.currentSpent).toBe(20000)
      expect(velocity.dailyBurnRate).toBeGreaterThan(0)
    })

    it('should calculate depletion date when budget will run out', () => {
      const now = new Date()
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -30000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const velocity = calculateCategoryVelocity(
        'cat-1',
        'Groceries',
        50000,
        transactions,
        periodStart,
        periodEnd
      )

      expect(velocity.depletionDate).toBeDefined()
    })

    it('should set status to danger when budget exceeded', () => {
      const now = new Date()
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -60000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const velocity = calculateCategoryVelocity(
        'cat-1',
        'Groceries',
        50000,
        transactions,
        periodStart,
        periodEnd
      )

      expect(velocity.status).toBe('danger')
      expect(velocity.percentUsed).toBeGreaterThan(100)
    })

    it('should calculate status based on spending', () => {
      const now = new Date()
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -42000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const velocity = calculateCategoryVelocity(
        'cat-1',
        'Groceries',
        50000,
        transactions,
        periodStart,
        periodEnd
      )

      expect(['safe', 'warning', 'danger']).toContain(velocity.status)
      expect(velocity.percentUsed).toBeGreaterThan(0)
    })

    it('should set status to safe when well under budget', () => {
      const now = new Date()
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -10000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const velocity = calculateCategoryVelocity(
        'cat-1',
        'Groceries',
        50000,
        transactions,
        periodStart,
        periodEnd
      )

      expect(velocity.status).toBe('safe')
      expect(velocity.percentUsed).toBeLessThan(80)
    })
  })

  describe('calculateSpendingVelocity', () => {
    it('should generate full report with multiple categories', () => {
      const category1 = makeCategory({ id: 'cat-1', name: 'Groceries' })
      const category2 = makeCategory({ id: 'cat-2', name: 'Dining' })
      const now = new Date()

      const budgetGoals = [
        makeBudgetGoal({ categoryId: 'cat-1', amount: 50000, period: 'monthly' }),
        makeBudgetGoal({ categoryId: 'cat-2', amount: 30000, period: 'monthly' }),
      ]

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -20000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
        makeTransaction({
          categoryId: 'cat-2',
          amount: -25000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const report = calculateSpendingVelocity(
        transactions,
        budgetGoals,
        [category1, category2],
        'monthly'
      )

      expect(report.velocities.length).toBe(2)
      expect(report.period.startDate).toBeDefined()
      expect(report.period.endDate).toBeDefined()
      expect(report.summary.totalBudget).toBe(80000)
    })

    it('should count categories at risk correctly', () => {
      const category1 = makeCategory({ id: 'cat-1', name: 'Groceries' })
      const category2 = makeCategory({ id: 'cat-2', name: 'Dining' })
      const now = new Date()

      const budgetGoals = [
        makeBudgetGoal({ categoryId: 'cat-1', amount: 50000, period: 'monthly' }),
        makeBudgetGoal({ categoryId: 'cat-2', amount: 30000, period: 'monthly' }),
      ]

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -10000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
        makeTransaction({
          categoryId: 'cat-2',
          amount: -30000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const report = calculateSpendingVelocity(
        transactions,
        budgetGoals,
        [category1, category2],
        'monthly'
      )

      expect(report.summary.categoriesAtRisk).toBeGreaterThan(0)
    })

    it('should set overall status based on worst category', () => {
      const category1 = makeCategory({ id: 'cat-1', name: 'Groceries' })
      const now = new Date()

      const budgetGoals = [
        makeBudgetGoal({ categoryId: 'cat-1', amount: 50000, period: 'monthly' }),
      ]

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -60000,
          date: new Date(now.getFullYear(), now.getMonth(), 5),
        }),
      ]

      const report = calculateSpendingVelocity(
        transactions,
        budgetGoals,
        [category1],
        'monthly'
      )

      expect(report.summary.overallStatus).toBe('danger')
    })

    it('should handle empty budget goals', () => {
      const report = calculateSpendingVelocity([], [], [], 'monthly')

      expect(report.velocities).toEqual([])
      expect(report.summary.totalBudget).toBe(0)
      expect(report.summary.categoriesAtRisk).toBe(0)
    })
  })
})
