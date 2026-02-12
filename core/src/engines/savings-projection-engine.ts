/**
 * Savings Projection Engine
 *
 * Projects goal completion dates based on current savings rate.
 * Calculates required monthly contribution to hit target date.
 * Generates multiple scenarios (current pace, aggressive, conservative).
 */

export interface SavingsGoalData {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: Date | string | null;
  monthlyContribution?: number;
}

export interface SavingsContributionData {
  id: string;
  goalId: string;
  amount: number;
  date: Date | string;
}

export type ScenarioType = 'current_pace' | 'aggressive' | 'conservative';

export interface SavingsScenario {
  type: ScenarioType;
  label: string;
  monthlyContribution: number;
  projectedCompletionDate: Date | null;
  monthsToCompletion: number | null;
  totalContributions: number;
  onTrack: boolean;
}

export interface SavingsProjection {
  goalId: string;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  remainingAmount: number;
  percentComplete: number;
  targetDate: Date | null;
  currentMonthlyRate: number;
  averageContribution: number;
  projectedCompletionDate: Date | null;
  monthsToCompletion: number | null;
  requiredMonthlyToHitTarget: number | null;
  onTrack: boolean;
  scenarios: SavingsScenario[];
  contributionHistory: Array<{
    month: string;
    amount: number;
  }>;
}

export interface SavingsProjectionReport {
  projections: SavingsProjection[];
  summary: {
    totalTargetAmount: number;
    totalCurrentAmount: number;
    totalRemainingAmount: number;
    goalsOnTrack: number;
    goalsAtRisk: number;
    averagePercentComplete: number;
    estimatedTotalMonthlyNeeded: number;
  };
  recommendations: string[];
}

export interface SavingsProjectionDependencies {
  getSavingsGoals: () => SavingsGoalData[] | Promise<SavingsGoalData[]>;
  getSavingsContributions: (goalId: string) => SavingsContributionData[] | Promise<SavingsContributionData[]>;
}

/**
 * Calculate savings projection for a single goal
 */
export function projectSavingsGoal(
  goal: SavingsGoalData,
  contributions: SavingsContributionData[],
  options: { aggressiveMultiplier?: number; conservativeMultiplier?: number } = {}
): SavingsProjection {
  const { aggressiveMultiplier = 1.5, conservativeMultiplier = 0.75 } = options;

  const targetAmount = goal.targetAmount;
  const currentAmount = goal.currentAmount;
  const remainingAmount = Math.max(0, targetAmount - currentAmount);
  const percentComplete = targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0;

  const targetDate = goal.targetDate ? new Date(goal.targetDate) : null;

  // Calculate contribution history
  const contributionsByMonth = new Map<string, number>();
  const sortedContributions = [...contributions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  for (const contrib of sortedContributions) {
    const date = new Date(contrib.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    contributionsByMonth.set(monthKey, (contributionsByMonth.get(monthKey) || 0) + contrib.amount);
  }

  const contributionHistory = Array.from(contributionsByMonth.entries())
    .map(([month, amount]) => ({ month, amount }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Calculate average contribution over the last 6 months
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  let totalRecentContributions = 0;
  let recentMonthCount = 0;

  for (const contrib of sortedContributions) {
    const date = new Date(contrib.date);
    if (date >= sixMonthsAgo) {
      totalRecentContributions += contrib.amount;
    }
  }

  // Count months with activity in the last 6 months
  const monthsWithContributions = new Set<string>();
  for (const [month] of contributionsByMonth) {
    const [year, monthNum] = month.split('-').map(Number);
    const monthDate = new Date(year, monthNum - 1);
    if (monthDate >= sixMonthsAgo) {
      monthsWithContributions.add(month);
      recentMonthCount++;
    }
  }

  const averageContribution = recentMonthCount > 0 ? totalRecentContributions / recentMonthCount : 0;

  // Use the goal's monthly contribution if set, otherwise use the calculated average
  const currentMonthlyRate = goal.monthlyContribution || averageContribution;

  // Calculate projected completion date
  let projectedCompletionDate: Date | null = null;
  let monthsToCompletion: number | null = null;

  if (remainingAmount <= 0) {
    projectedCompletionDate = new Date();
    monthsToCompletion = 0;
  } else if (currentMonthlyRate > 0) {
    monthsToCompletion = Math.ceil(remainingAmount / currentMonthlyRate);
    projectedCompletionDate = new Date();
    projectedCompletionDate.setMonth(projectedCompletionDate.getMonth() + monthsToCompletion);
  }

  // Calculate required monthly to hit target date
  let requiredMonthlyToHitTarget: number | null = null;
  if (targetDate && remainingAmount > 0) {
    const msRemaining = targetDate.getTime() - now.getTime();
    const monthsRemaining = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24 * 30)));
    requiredMonthlyToHitTarget = remainingAmount / monthsRemaining;
  }

  // Determine if on track
  let onTrack = false;
  if (remainingAmount <= 0) {
    onTrack = true;
  } else if (targetDate && projectedCompletionDate) {
    onTrack = projectedCompletionDate <= targetDate;
  } else if (!targetDate && currentMonthlyRate > 0) {
    onTrack = true; // No deadline, making progress is on track
  }

  // Generate scenarios
  const scenarios: SavingsScenario[] = [];

  // Current pace scenario
  scenarios.push(createScenario('current_pace', 'Current Pace', currentMonthlyRate, remainingAmount, targetDate));

  // Aggressive scenario (50% more than current)
  const aggressiveRate = currentMonthlyRate * aggressiveMultiplier;
  scenarios.push(createScenario('aggressive', 'Aggressive', aggressiveRate, remainingAmount, targetDate));

  // Conservative scenario (25% less than current)
  const conservativeRate = currentMonthlyRate * conservativeMultiplier;
  scenarios.push(createScenario('conservative', 'Conservative', conservativeRate, remainingAmount, targetDate));

  return {
    goalId: goal.id,
    goalName: goal.name,
    targetAmount,
    currentAmount,
    remainingAmount,
    percentComplete,
    targetDate,
    currentMonthlyRate,
    averageContribution,
    projectedCompletionDate,
    monthsToCompletion,
    requiredMonthlyToHitTarget,
    onTrack,
    scenarios,
    contributionHistory,
  };
}

function createScenario(
  type: ScenarioType,
  label: string,
  monthlyContribution: number,
  remainingAmount: number,
  targetDate: Date | null
): SavingsScenario {
  let projectedCompletionDate: Date | null = null;
  let monthsToCompletion: number | null = null;

  if (remainingAmount <= 0) {
    projectedCompletionDate = new Date();
    monthsToCompletion = 0;
  } else if (monthlyContribution > 0) {
    monthsToCompletion = Math.ceil(remainingAmount / monthlyContribution);
    projectedCompletionDate = new Date();
    projectedCompletionDate.setMonth(projectedCompletionDate.getMonth() + monthsToCompletion);
  }

  let onTrack = false;
  if (remainingAmount <= 0) {
    onTrack = true;
  } else if (targetDate && projectedCompletionDate) {
    onTrack = projectedCompletionDate <= targetDate;
  } else if (!targetDate && monthlyContribution > 0) {
    onTrack = true;
  }

  return {
    type,
    label,
    monthlyContribution,
    projectedCompletionDate,
    monthsToCompletion,
    totalContributions: monthsToCompletion !== null ? monthlyContribution * monthsToCompletion : 0,
    onTrack,
  };
}

/**
 * Generate savings projection report for all goals
 */
export async function generateSavingsProjections(
  deps: SavingsProjectionDependencies,
  options: { aggressiveMultiplier?: number; conservativeMultiplier?: number } = {}
): Promise<SavingsProjectionReport> {
  const goals = await deps.getSavingsGoals();
  const projections: SavingsProjection[] = [];

  for (const goal of goals) {
    const contributions = await deps.getSavingsContributions(goal.id);
    const projection = projectSavingsGoal(goal, contributions, options);
    projections.push(projection);
  }

  // Calculate summary
  const totalTargetAmount = projections.reduce((sum, p) => sum + p.targetAmount, 0);
  const totalCurrentAmount = projections.reduce((sum, p) => sum + p.currentAmount, 0);
  const totalRemainingAmount = projections.reduce((sum, p) => sum + p.remainingAmount, 0);
  const goalsOnTrack = projections.filter(p => p.onTrack).length;
  const goalsAtRisk = projections.length - goalsOnTrack;
  const averagePercentComplete =
    projections.length > 0
      ? projections.reduce((sum, p) => sum + p.percentComplete, 0) / projections.length
      : 0;
  const estimatedTotalMonthlyNeeded = projections.reduce(
    (sum, p) => sum + (p.requiredMonthlyToHitTarget || p.currentMonthlyRate),
    0
  );

  // Generate recommendations
  const recommendations: string[] = [];

  if (goalsAtRisk > 0) {
    recommendations.push(
      `${goalsAtRisk} savings goal(s) may not be reached by their target date at the current pace.`
    );
  }

  const lowProgressGoals = projections.filter(p => p.percentComplete < 25 && p.targetDate);
  if (lowProgressGoals.length > 0) {
    recommendations.push(
      `Consider increasing contributions to "${lowProgressGoals[0].goalName}" which is only ${lowProgressGoals[0].percentComplete.toFixed(0)}% complete.`
    );
  }

  const noContributionGoals = projections.filter(p => p.currentMonthlyRate === 0 && p.remainingAmount > 0);
  if (noContributionGoals.length > 0) {
    recommendations.push(
      `"${noContributionGoals[0].goalName}" has no recent contributions. Set up automatic contributions to stay on track.`
    );
  }

  if (goalsOnTrack === projections.length && projections.length > 0) {
    recommendations.push('All savings goals are on track! Keep up the great work.');
  }

  return {
    projections,
    summary: {
      totalTargetAmount,
      totalCurrentAmount,
      totalRemainingAmount,
      goalsOnTrack,
      goalsAtRisk,
      averagePercentComplete,
      estimatedTotalMonthlyNeeded,
    },
    recommendations,
  };
}

/**
 * SavingsProjectionEngine class for dependency injection
 */
export class SavingsProjectionEngine {
  constructor(private deps: SavingsProjectionDependencies) {}

  async projectGoal(goalId: string, options?: { aggressiveMultiplier?: number; conservativeMultiplier?: number }): Promise<SavingsProjection | null> {
    const goals = await this.deps.getSavingsGoals();
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return null;

    const contributions = await this.deps.getSavingsContributions(goalId);
    return projectSavingsGoal(goal, contributions, options);
  }

  async generateReport(options?: { aggressiveMultiplier?: number; conservativeMultiplier?: number }): Promise<SavingsProjectionReport> {
    return generateSavingsProjections(this.deps, options);
  }
}
