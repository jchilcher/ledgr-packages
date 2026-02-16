import { auditSubscriptions } from '../engines/subscription-audit-engine'

function makeRecurringItem(overrides: any = {}): any {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    description: 'Test Subscription',
    amount: -1000,
    frequency: 'monthly' as const,
    nextOccurrence: new Date(),
    isActive: true,
    itemType: 'subscription' as const,
    ...overrides,
  }
}

describe('SubscriptionAuditEngine', () => {
  describe('auditSubscriptions', () => {
    it('should calculate monthly equivalent for different frequencies', () => {
      const items = [
        makeRecurringItem({ description: 'Weekly Sub', amount: -1000, frequency: 'weekly' }),
        makeRecurringItem({ description: 'Monthly Sub', amount: -1000, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Yearly Sub', amount: -12000, frequency: 'yearly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.subscriptions.length).toBe(3)
      const weeklySub = report.subscriptions.find(s => s.frequency === 'weekly')
      const monthlySub = report.subscriptions.find(s => s.frequency === 'monthly')
      const yearlySub = report.subscriptions.find(s => s.frequency === 'yearly')

      expect(weeklySub?.monthlyEquivalent).toBeCloseTo(1000 * 4.33, 0)
      expect(monthlySub?.monthlyEquivalent).toBe(1000)
      expect(yearlySub?.monthlyEquivalent).toBeCloseTo(12000 / 12, 0)
    })

    it('should calculate annual cost correctly', () => {
      const items = [
        makeRecurringItem({ description: 'Monthly Sub', amount: -1000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.subscriptions[0].annualCost).toBe(12000)
    })

    it('should skip inactive subscriptions by default', () => {
      const items = [
        makeRecurringItem({ description: 'Active Sub', amount: -1000, isActive: true }),
        makeRecurringItem({ description: 'Inactive Sub', amount: -1000, isActive: false }),
      ]

      const report = auditSubscriptions(items)

      expect(report.subscriptions.length).toBe(1)
      expect(report.subscriptions[0].name).toBe('Active Sub')
    })

    it('should include inactive subscriptions when requested', () => {
      const items = [
        makeRecurringItem({ description: 'Active Sub', amount: -1000, isActive: true }),
        makeRecurringItem({ description: 'Inactive Sub', amount: -1000, isActive: false }),
      ]

      const report = auditSubscriptions(items, { includeInactive: true })

      expect(report.subscriptions.length).toBe(2)
    })

    it('should identify potentially unused streaming services', () => {
      const items = [
        makeRecurringItem({ description: 'Netflix Premium', amount: -2000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.subscriptions[0].isPotentiallyUnused).toBe(true)
      expect(report.subscriptions[0].unusedIndicators.length).toBeGreaterThan(0)
    })

    it('should identify gym memberships as commonly unused', () => {
      const items = [
        makeRecurringItem({ description: 'Planet Fitness', amount: -2500, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.subscriptions[0].isPotentiallyUnused).toBe(true)
      expect(report.subscriptions[0].unusedIndicators.some(i => i.includes('Gym'))).toBe(true)
    })

    it('should calculate potential savings from unused subscriptions', () => {
      const items = [
        makeRecurringItem({ description: 'Netflix', amount: -1500, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Gym', amount: -3000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.summary.potentialSavings).toBeGreaterThan(0)
      expect(report.summary.potentiallyUnusedCount).toBe(2)
    })

    it('should recommend reviewing expensive subscriptions', () => {
      const items = [
        makeRecurringItem({ description: 'Expensive Service', amount: -25000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.recommendations.some(r => r.includes('$200/year'))).toBe(true)
    })

    it('should recommend consolidating when total cost is high', () => {
      const items = [
        makeRecurringItem({ description: 'Sub 1', amount: -30000, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Sub 2', amount: -30000, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Sub 3', amount: -30000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.summary.totalAnnual).toBeGreaterThan(100000)
      expect(report.recommendations.some(r => r.includes('consolidating'))).toBe(true)
    })

    it('should recommend rotating streaming services when multiple exist', () => {
      const items = [
        makeRecurringItem({ description: 'Netflix', amount: -1500, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Hulu', amount: -1500, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Disney Plus', amount: -1000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.recommendations.some(r => r.includes('rotating'))).toBe(true)
    })

    it('should sort subscriptions by annual cost', () => {
      const items = [
        makeRecurringItem({ description: 'Cheap Sub', amount: -500, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Expensive Sub', amount: -5000, frequency: 'monthly' }),
        makeRecurringItem({ description: 'Medium Sub', amount: -2000, frequency: 'monthly' }),
      ]

      const report = auditSubscriptions(items)

      expect(report.subscriptions.length).toBe(3)
      expect(report.subscriptions[0].annualCost).toBeGreaterThanOrEqual(report.subscriptions[1].annualCost)
      expect(report.subscriptions[1].annualCost).toBeGreaterThanOrEqual(report.subscriptions[2].annualCost)
    })
  })
})
