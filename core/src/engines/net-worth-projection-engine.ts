/**
 * Net Worth Projection Engine
 *
 * Calculates growth rate from historical data.
 * Projects future net worth with confidence intervals.
 * Tracks milestones (100k, 250k, 500k, 1M).
 */

export interface NetWorthHistoryData {
  id: string;
  date: Date | string;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

export interface NetWorthMilestone {
  amount: number;
  label: string;
  achieved: boolean;
  achievedDate?: Date | null;
  projectedDate?: Date | null;
  monthsAway?: number | null;
}

export interface NetWorthProjectionPoint {
  date: Date;
  projectedNetWorth: number;
  confidenceLower: number;
  confidenceUpper: number;
  monthsFromNow: number;
}

export interface NetWorthTrend {
  direction: 'increasing' | 'decreasing' | 'stable';
  monthlyGrowthRate: number;
  monthlyGrowthAmount: number;
  annualizedGrowthRate: number;
  volatility: number;
}

export interface NetWorthProjection {
  currentNetWorth: number;
  trend: NetWorthTrend;
  projections: NetWorthProjectionPoint[];
  milestones: NetWorthMilestone[];
  historicalData: Array<{
    date: Date;
    netWorth: number;
  }>;
  summary: {
    oneYearProjection: number;
    fiveYearProjection: number;
    tenYearProjection: number;
    nextMilestone: NetWorthMilestone | null;
  };
}

export interface NetWorthProjectionDependencies {
  getNetWorthHistory: (limit?: number) => NetWorthHistoryData[] | Promise<NetWorthHistoryData[]>;
  getCurrentNetWorth: () => number | Promise<number>;
}

const DEFAULT_MILESTONES = [
  { amount: 10000, label: '$10K' },
  { amount: 25000, label: '$25K' },
  { amount: 50000, label: '$50K' },
  { amount: 100000, label: '$100K' },
  { amount: 250000, label: '$250K' },
  { amount: 500000, label: '$500K' },
  { amount: 750000, label: '$750K' },
  { amount: 1000000, label: '$1M' },
  { amount: 2000000, label: '$2M' },
  { amount: 5000000, label: '$5M' },
];

/**
 * Calculate linear regression for trend analysis
 */
function calculateLinearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
  rSquared: number;
} {
  if (points.length < 2) {
    return { slope: 0, intercept: points[0]?.y || 0, rSquared: 0 };
  }

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXY += point.x * point.y;
    sumXX += point.x * point.x;
    sumYY += point.y * point.y;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared calculation
  const meanY = sumY / n;
  let ssTotal = 0;
  let ssResidual = 0;

  for (const point of points) {
    const predicted = slope * point.x + intercept;
    ssTotal += (point.y - meanY) ** 2;
    ssResidual += (point.y - predicted) ** 2;
  }

  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  return { slope, intercept, rSquared };
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);

  return Math.sqrt(variance);
}

/**
 * Analyze net worth trend from historical data
 */
export function analyzeNetWorthTrend(history: NetWorthHistoryData[]): NetWorthTrend {
  if (history.length < 2) {
    return {
      direction: 'stable',
      monthlyGrowthRate: 0,
      monthlyGrowthAmount: 0,
      annualizedGrowthRate: 0,
      volatility: 0,
    };
  }

  // Sort by date ascending
  const sorted = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Convert to months from first data point
  const firstDate = new Date(sorted[0].date);
  const points = sorted.map(h => {
    const date = new Date(h.date);
    const monthsFromStart =
      (date.getFullYear() - firstDate.getFullYear()) * 12 +
      (date.getMonth() - firstDate.getMonth());
    return { x: monthsFromStart, y: h.netWorth };
  });

  const regression = calculateLinearRegression(points);
  const monthlyGrowthAmount = regression.slope;

  // Calculate growth rate (percentage)
  const avgNetWorth = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const monthlyGrowthRate = avgNetWorth !== 0 ? (monthlyGrowthAmount / avgNetWorth) * 100 : 0;
  const annualizedGrowthRate = ((1 + monthlyGrowthRate / 100) ** 12 - 1) * 100;

  // Calculate volatility (standard deviation of monthly changes)
  const monthlyChanges: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const change = sorted[i].netWorth - sorted[i - 1].netWorth;
    monthlyChanges.push(change);
  }
  const volatility = calculateStdDev(monthlyChanges);

  // Determine direction
  let direction: 'increasing' | 'decreasing' | 'stable';
  if (monthlyGrowthRate > 1) {
    direction = 'increasing';
  } else if (monthlyGrowthRate < -1) {
    direction = 'decreasing';
  } else {
    direction = 'stable';
  }

  return {
    direction,
    monthlyGrowthRate,
    monthlyGrowthAmount,
    annualizedGrowthRate,
    volatility,
  };
}

/**
 * Project future net worth
 */
export function projectNetWorth(
  currentNetWorth: number,
  trend: NetWorthTrend,
  monthsAhead: number,
  confidenceLevel: number = 0.95
): NetWorthProjectionPoint[] {
  const projections: NetWorthProjectionPoint[] = [];
  const now = new Date();

  // Z-score for confidence interval (1.96 for 95%)
  const zScore = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.90 ? 1.645 : 1.96;

  for (let month = 1; month <= monthsAhead; month++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() + month);

    // Simple linear projection
    const projectedNetWorth = currentNetWorth + trend.monthlyGrowthAmount * month;

    // Confidence interval widens with time
    const uncertaintyFactor = Math.sqrt(month);
    const margin = zScore * trend.volatility * uncertaintyFactor;

    projections.push({
      date,
      projectedNetWorth,
      confidenceLower: projectedNetWorth - margin,
      confidenceUpper: projectedNetWorth + margin,
      monthsFromNow: month,
    });
  }

  return projections;
}

/**
 * Calculate milestone progress
 */
export function calculateMilestones(
  currentNetWorth: number,
  trend: NetWorthTrend,
  history: NetWorthHistoryData[],
  customMilestones?: { amount: number; label: string }[]
): NetWorthMilestone[] {
  const milestoneAmounts = customMilestones || DEFAULT_MILESTONES;
  const now = new Date();

  // Sort history by date
  const sorted = [...history].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return milestoneAmounts.map(({ amount, label }) => {
    const achieved = currentNetWorth >= amount;

    // Find when milestone was achieved
    let achievedDate: Date | null = null;
    if (achieved) {
      for (const h of sorted) {
        if (h.netWorth >= amount) {
          achievedDate = new Date(h.date);
          break;
        }
      }
      // If not found in history but currently achieved, use now
      if (!achievedDate) {
        achievedDate = now;
      }
    }

    // Project when milestone will be achieved
    let projectedDate: Date | null = null;
    let monthsAway: number | null = null;

    if (!achieved && trend.monthlyGrowthAmount > 0) {
      const remaining = amount - currentNetWorth;
      monthsAway = Math.ceil(remaining / trend.monthlyGrowthAmount);
      projectedDate = new Date(now);
      projectedDate.setMonth(projectedDate.getMonth() + monthsAway);
    }

    return {
      amount,
      label,
      achieved,
      achievedDate,
      projectedDate,
      monthsAway,
    };
  });
}

/**
 * Generate full net worth projection report
 */
export async function generateNetWorthProjection(
  deps: NetWorthProjectionDependencies,
  options: {
    projectionMonths?: number;
    confidenceLevel?: number;
    customMilestones?: { amount: number; label: string }[];
  } = {}
): Promise<NetWorthProjection> {
  const { projectionMonths = 60, confidenceLevel = 0.95, customMilestones } = options;

  const [history, currentNetWorth] = await Promise.all([
    deps.getNetWorthHistory(36), // Get up to 3 years of history
    deps.getCurrentNetWorth(),
  ]);

  // Analyze trend
  const trend = analyzeNetWorthTrend(history);

  // Generate projections
  const projections = projectNetWorth(currentNetWorth, trend, projectionMonths, confidenceLevel);

  // Calculate milestones
  const milestones = calculateMilestones(currentNetWorth, trend, history, customMilestones);

  // Convert history to simpler format
  const historicalData = history.map(h => ({
    date: new Date(h.date),
    netWorth: h.netWorth,
  })).sort((a, b) => a.date.getTime() - b.date.getTime());

  // Find next milestone
  const nextMilestone = milestones.find(m => !m.achieved) || null;

  // Get key projections
  const oneYearProjection = projections.find(p => p.monthsFromNow === 12)?.projectedNetWorth || currentNetWorth;
  const fiveYearProjection = projections.find(p => p.monthsFromNow === 60)?.projectedNetWorth || currentNetWorth;
  const tenYearIdx = Math.min(projectionMonths, 120);
  const tenYearProjection =
    projectionMonths >= 120
      ? projections.find(p => p.monthsFromNow === 120)?.projectedNetWorth ||
        currentNetWorth + trend.monthlyGrowthAmount * 120
      : currentNetWorth + trend.monthlyGrowthAmount * 120;

  return {
    currentNetWorth,
    trend,
    projections,
    milestones,
    historicalData,
    summary: {
      oneYearProjection,
      fiveYearProjection,
      tenYearProjection,
      nextMilestone,
    },
  };
}

/**
 * NetWorthProjectionEngine class for dependency injection
 */
export class NetWorthProjectionEngine {
  constructor(private deps: NetWorthProjectionDependencies) {}

  async generateProjection(options?: {
    projectionMonths?: number;
    confidenceLevel?: number;
    customMilestones?: { amount: number; label: string }[];
  }): Promise<NetWorthProjection> {
    return generateNetWorthProjection(this.deps, options);
  }

  async getTrend(): Promise<NetWorthTrend> {
    const history = await this.deps.getNetWorthHistory(36);
    return analyzeNetWorthTrend(history);
  }

  async getMilestones(): Promise<NetWorthMilestone[]> {
    const [history, currentNetWorth] = await Promise.all([
      this.deps.getNetWorthHistory(36),
      this.deps.getCurrentNetWorth(),
    ]);
    const trend = analyzeNetWorthTrend(history);
    return calculateMilestones(currentNetWorth, trend, history);
  }
}
