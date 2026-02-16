import { calculateAgeOfMoney } from '../engines/age-of-money-engine'

describe('AgeOfMoneyEngine', () => {
  describe('calculateAgeOfMoney', () => {
    it('should calculate age using FIFO queue method', () => {
      const now = new Date()

      const input = {
        transactions: [
          {
            id: 't1',
            date: new Date(now.getTime() - 60 * 86400000),
            amount: 100000,
            description: 'Income',
          },
          {
            id: 't2',
            date: new Date(now.getTime() - 10 * 86400000),
            amount: -50000,
            description: 'Expense',
          },
        ],
        reimbursementIncomeIds: new Set<string>(),
      }

      const result = calculateAgeOfMoney(input)

      expect(result.currentAge).toBeGreaterThan(0)
    })

    it('should detect trend when previous month exists', () => {
      const now = new Date()

      const input = {
        transactions: [
          {
            id: 't1',
            date: new Date(now.getTime() - 90 * 86400000),
            amount: 100000,
            description: 'Income',
          },
          {
            id: 't2',
            date: new Date(now.getTime() - 80 * 86400000),
            amount: 100000,
            description: 'Income',
          },
          {
            id: 't3',
            date: new Date(now.getTime() - 10 * 86400000),
            amount: -50000,
            description: 'Expense',
          },
        ],
        reimbursementIncomeIds: new Set<string>(),
      }

      const result = calculateAgeOfMoney(input)

      expect(['up', 'down', 'stable']).toContain(result.trend)
    })

    it('should return zero for no data', () => {
      const input = {
        transactions: [],
        reimbursementIncomeIds: new Set<string>(),
      }

      const result = calculateAgeOfMoney(input)

      expect(result.currentAge).toBe(0)
    })
  })
})
