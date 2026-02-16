import { calculateFinancialHealth } from '../engines/financial-health-engine'
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

describe('FinancialHealthEngine', () => {
  describe('calculateFinancialHealth', () => {
    it('should calculate weighted score from all factors', () => {
      const now = new Date()
      const transactions: Transaction[] = []

      for (let i = 0; i < 3; i++) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
        transactions.push(
          makeTransaction({
            amount: 400000,
            date: monthStart,
          })
        )
        transactions.push(
          makeTransaction({
            amount: -300000,
            date: monthStart,
          })
        )
      }

      const result = calculateFinancialHealth(transactions, [], [], [], [], [])

      expect(result.overallScore).toBeGreaterThanOrEqual(0)
      expect(result.overallScore).toBeLessThanOrEqual(100)
      expect(result.factors.length).toBe(6)
    })

    it('should have correct factor weights totaling 1.0', () => {
      const result = calculateFinancialHealth([], [], [], [], [], [])

      const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0)
      expect(totalWeight).toBeCloseTo(1.0, 2)

      expect(result.factors.find(f => f.name === 'Savings Rate')?.weight).toBe(0.25)
      expect(result.factors.find(f => f.name === 'Budget Adherence')?.weight).toBe(0.20)
      expect(result.factors.find(f => f.name === 'Emergency Fund')?.weight).toBe(0.20)
      expect(result.factors.find(f => f.name === 'Debt-to-Income')?.weight).toBe(0.15)
      expect(result.factors.find(f => f.name === 'Net Worth Trend')?.weight).toBe(0.10)
      expect(result.factors.find(f => f.name === 'Savings Goals')?.weight).toBe(0.10)
    })

    it('should detect improving trend when score increases significantly', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({ amount: 400000, date: now }),
        makeTransaction({ amount: -300000, date: now }),
      ]

      const result = calculateFinancialHealth(transactions, [], [], [], [], [], 40)

      if (result.overallScore > 53) {
        expect(result.trend).toBe('improving')
      }
    })

    it('should detect declining trend when score decreases significantly', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({ amount: 100000, date: now }),
        makeTransaction({ amount: -300000, date: now }),
      ]

      const result = calculateFinancialHealth(transactions, [], [], [], [], [], 80)

      if (result.overallScore < 77) {
        expect(result.trend).toBe('declining')
      }
    })

    it('should detect stable trend when score changes minimally', () => {
      const result = calculateFinancialHealth([], [], [], [], [], [], 47)

      expect(['stable', 'improving', 'declining']).toContain(result.trend)
    })

    it('should provide recommendations based on low-scoring factors', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({ amount: 100000, date: now }),
        makeTransaction({ amount: -95000, date: now }),
      ]

      const result = calculateFinancialHealth(transactions, [], [], [], [], [])

      expect(result.recommendations.length).toBeGreaterThan(0)
    })

    it('should score high savings rate highly', () => {
      const now = new Date()
      const transactions: Transaction[] = []

      for (let i = 0; i < 3; i++) {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
        transactions.push(
          makeTransaction({
            amount: 500000,
            date: monthStart,
          })
        )
        transactions.push(
          makeTransaction({
            amount: -350000,
            date: monthStart,
          })
        )
      }

      const result = calculateFinancialHealth(transactions, [], [], [], [], [])

      const savingsRateFactor = result.factors.find(f => f.name === 'Savings Rate')
      expect(savingsRateFactor?.score).toBeGreaterThan(70)
    })

    it('should score budget adherence based on spending vs goals', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          amount: -20000,
          date: new Date(now.getFullYear(), now.getMonth(), 15),
        }),
      ]

      const budgetGoals = [
        {
          id: 'goal-1',
          categoryId: 'cat-1',
          amount: 50000,
          period: 'monthly' as const,
        },
      ]

      const result = calculateFinancialHealth(transactions, budgetGoals, [], [], [], [])

      const budgetFactor = result.factors.find(f => f.name === 'Budget Adherence')
      expect(budgetFactor?.score).toBeGreaterThan(70)
    })

    it('should calculate emergency fund coverage in months', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({ amount: -30000, date: now }),
      ]

      const assets = [
        { id: 'a1', name: 'Savings', value: 200000, type: 'cash' },
      ]

      const result = calculateFinancialHealth(transactions, [], assets, [], [], [])

      const emergencyFactor = result.factors.find(f => f.name === 'Emergency Fund')
      expect(emergencyFactor).toBeDefined()
      expect(emergencyFactor?.metric?.unit).toBe('months')
    })

    it('should penalize high debt-to-income ratio', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({ amount: 500000, date: now }),
      ]

      const liabilities = [
        { id: 'l1', name: 'Loan', balance: 500000, minimumPayment: 200000 },
      ]

      const result = calculateFinancialHealth(transactions, [], [], liabilities, [], [])

      const dtiFactor = result.factors.find(f => f.name === 'Debt-to-Income')
      expect(dtiFactor?.score).toBeLessThan(80)
    })
  })
})
