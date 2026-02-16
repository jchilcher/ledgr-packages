import { calculateMinimumPaymentSchedule, calculateStrategyPayoff, calculateExtraPaymentImpact } from '../engines/debt-payoff-engine'

function makeDebt(overrides: any = {}): any {
  return {
    id: `debt-${Math.random().toString(36).slice(2)}`,
    name: 'Test Debt',
    balance: 100000,
    interestRate: 18,
    minimumPayment: 5000,
    ...overrides,
  }
}

describe('DebtPayoffEngine', () => {
  describe('calculateMinimumPaymentSchedule', () => {
    it('should calculate amortization schedule with interest and principal', () => {
      const debt = makeDebt({
        balance: 100000,
        interestRate: 18,
        minimumPayment: 10000,
      })

      const plan = calculateMinimumPaymentSchedule(debt)

      expect(plan.schedule.length).toBeGreaterThan(0)
      expect(plan.schedule[0].interest).toBeGreaterThan(0)
      expect(plan.schedule[0].principal).toBeGreaterThan(0)
      expect(plan.monthsToPayoff).toBeGreaterThan(0)
    })

    it('should reduce balance to zero when paid off', () => {
      const debt = makeDebt({
        balance: 50000,
        interestRate: 12,
        minimumPayment: 10000,
      })

      const plan = calculateMinimumPaymentSchedule(debt)

      const lastPayment = plan.schedule[plan.schedule.length - 1]
      expect(lastPayment.remainingBalance).toBeLessThan(1)
    })

    it('should respect max months cap of 600', () => {
      const debt = makeDebt({
        balance: 1000000,
        interestRate: 20,
        minimumPayment: 500,
      })

      const plan = calculateMinimumPaymentSchedule(debt)

      expect(plan.monthsToPayoff).toBeLessThanOrEqual(600)
    })

    it('should calculate total interest paid', () => {
      const debt = makeDebt({
        balance: 100000,
        interestRate: 15,
        minimumPayment: 10000,
      })

      const plan = calculateMinimumPaymentSchedule(debt)

      expect(plan.totalInterestPaid).toBeGreaterThan(0)
      expect(plan.totalPaid).toBe(plan.originalBalance + plan.totalInterestPaid)
    })

    it('should handle zero interest debt', () => {
      const debt = makeDebt({
        balance: 100000,
        interestRate: 0,
        minimumPayment: 10000,
      })

      const plan = calculateMinimumPaymentSchedule(debt)

      expect(plan.totalInterestPaid).toBe(0)
      expect(plan.monthsToPayoff).toBe(10)
    })
  })

  describe('calculateStrategyPayoff', () => {
    it('should implement snowball strategy (smallest balance first)', () => {
      const debts = [
        makeDebt({ id: 'd1', balance: 50000, interestRate: 10, minimumPayment: 2000 }),
        makeDebt({ id: 'd2', balance: 100000, interestRate: 15, minimumPayment: 3000 }),
        makeDebt({ id: 'd3', balance: 20000, interestRate: 12, minimumPayment: 1000 }),
      ]

      const result = calculateStrategyPayoff(debts, 'snowball')

      expect(result.strategy).toBe('snowball')
      expect(result.payoffOrder[0]).toBe('d3')
      expect(result.payoffOrder[2]).toBe('d2')
    })

    it('should implement avalanche strategy (highest interest first)', () => {
      const debts = [
        makeDebt({ id: 'd1', balance: 50000, interestRate: 10, minimumPayment: 2000 }),
        makeDebt({ id: 'd2', balance: 100000, interestRate: 20, minimumPayment: 3000 }),
        makeDebt({ id: 'd3', balance: 20000, interestRate: 15, minimumPayment: 1000 }),
      ]

      const result = calculateStrategyPayoff(debts, 'avalanche')

      expect(result.strategy).toBe('avalanche')
      expect(result.payoffOrder[0]).toBe('d2')
      expect(result.payoffOrder[1]).toBe('d3')
    })

    it('should snowball freed minimum payments to next debt', () => {
      const debts = [
        makeDebt({ id: 'd1', balance: 10000, interestRate: 10, minimumPayment: 5000 }),
        makeDebt({ id: 'd2', balance: 100000, interestRate: 10, minimumPayment: 5000 }),
      ]

      const result = calculateStrategyPayoff(debts, 'snowball', 0)

      const firstDebt = result.debtPayoffPlans.find(p => p.debtId === 'd1')
      const secondDebt = result.debtPayoffPlans.find(p => p.debtId === 'd2')

      expect(firstDebt?.monthsToPayoff).toBeLessThan(secondDebt?.monthsToPayoff || 1000)
    })

    it('should apply extra payments to accelerate payoff', () => {
      const debts = [
        makeDebt({ balance: 100000, interestRate: 15, minimumPayment: 5000 }),
      ]

      const withoutExtra = calculateStrategyPayoff(debts, 'minimum', 0)
      const withExtra = calculateStrategyPayoff(debts, 'minimum', 5000)

      expect(withExtra.monthsToPayoff).toBeLessThan(withoutExtra.monthsToPayoff)
      expect(withExtra.totalInterestPaid).toBeLessThan(withoutExtra.totalInterestPaid)
    })

    it('should handle single debt scenario', () => {
      const debts = [
        makeDebt({ balance: 50000, interestRate: 12, minimumPayment: 5000 }),
      ]

      const result = calculateStrategyPayoff(debts, 'snowball')

      expect(result.debtPayoffPlans.length).toBe(1)
      expect(result.payoffOrder.length).toBe(1)
    })

    it('should handle empty debt array', () => {
      const result = calculateStrategyPayoff([], 'snowball')

      expect(result.debtPayoffPlans).toEqual([])
      expect(result.totalInterestPaid).toBe(0)
      expect(result.monthsToPayoff).toBe(0)
    })
  })

  describe('calculateExtraPaymentImpact', () => {
    it('should calculate months saved with extra payments', () => {
      const debts = [
        makeDebt({ balance: 100000, interestRate: 15, minimumPayment: 5000 }),
      ]

      const impacts = calculateExtraPaymentImpact(debts, 'minimum', [5000, 10000])

      expect(impacts.length).toBe(2)
      expect(impacts[0].monthsSaved).toBeGreaterThan(0)
      expect(impacts[1].monthsSaved).toBeGreaterThan(impacts[0].monthsSaved)
    })

    it('should calculate interest saved with extra payments', () => {
      const debts = [
        makeDebt({ balance: 100000, interestRate: 15, minimumPayment: 5000 }),
      ]

      const impacts = calculateExtraPaymentImpact(debts, 'minimum', [5000, 10000])

      expect(impacts[0].interestSaved).toBeGreaterThan(0)
      expect(impacts[1].interestSaved).toBeGreaterThan(impacts[0].interestSaved)
    })

    it('should provide new payoff date with extra payments', () => {
      const debts = [
        makeDebt({ balance: 100000, interestRate: 15, minimumPayment: 5000 }),
      ]

      const impacts = calculateExtraPaymentImpact(debts, 'minimum', [10000])

      expect(impacts[0].newPayoffDate).toBeDefined()
      expect(impacts[0].newPayoffDate.getTime()).toBeLessThan(new Date().getTime() + 365 * 86400000 * 10)
    })

    it('should handle multiple extra payment scenarios', () => {
      const debts = [
        makeDebt({ balance: 100000, interestRate: 15, minimumPayment: 5000 }),
      ]

      const amounts = [2000, 5000, 10000, 20000]
      const impacts = calculateExtraPaymentImpact(debts, 'avalanche', amounts)

      expect(impacts.length).toBe(4)

      for (let i = 0; i < impacts.length - 1; i++) {
        expect(impacts[i + 1].monthsSaved).toBeGreaterThanOrEqual(impacts[i].monthsSaved)
        expect(impacts[i + 1].interestSaved).toBeGreaterThanOrEqual(impacts[i].interestSaved)
      }
    })

    it('should work with zero extra payment', () => {
      const debts = [
        makeDebt({ balance: 50000, interestRate: 12, minimumPayment: 5000 }),
      ]

      const impacts = calculateExtraPaymentImpact(debts, 'minimum', [0])

      expect(impacts[0].monthsSaved).toBe(0)
      expect(impacts[0].interestSaved).toBe(0)
    })
  })
})
