export type PaycheckAllocationType = 'recurring_item' | 'budget_category' | 'savings_goal';

export interface PaycheckAllocationData {
  id: string;
  incomeStreamId: string;
  incomeDescription: string;
  allocationType: PaycheckAllocationType;
  targetId: string;
  amount: number;
  createdAt: Date;
}

export interface PaycheckBudgetViewInput {
  incomeStreams: Array<{
    id: string;
    description: string;
    averageAmount: number;
    frequency: string;
  }>;
  allocations: PaycheckAllocationData[];
  targets: {
    recurringItems: Array<{ id: string; description: string }>;
    budgetCategories: Array<{ id: string; name: string }>;
    savingsGoals: Array<{ id: string; name: string }>;
  };
}

export interface PaycheckAllocation {
  id: string;
  incomeStreamId: string;
  incomeDescription: string;
  allocationType: PaycheckAllocationType;
  targetId: string;
  targetName: string;
  amount: number;
  createdAt: Date;
}

export interface PaycheckBudgetView {
  incomeStream: {
    id: string;
    description: string;
    averageAmount: number;
    frequency: string;
  };
  allocations: PaycheckAllocation[];
  totalAllocated: number;
  unallocated: number;
}

export interface PaycheckValidationResult {
  valid: boolean;
  errors: string[];
}

export function buildPaycheckView(
  input: PaycheckBudgetViewInput,
  streamId: string
): PaycheckBudgetView | null {
  const stream = input.incomeStreams.find(s => s.id === streamId);
  if (!stream) {
    return null;
  }

  const streamAllocations = input.allocations.filter(a => a.incomeStreamId === streamId);

  const allocations: PaycheckAllocation[] = streamAllocations.map(allocation => {
    let targetName = '';

    switch (allocation.allocationType) {
      case 'recurring_item': {
        const target = input.targets.recurringItems.find(t => t.id === allocation.targetId);
        targetName = target?.description ?? '';
        break;
      }
      case 'budget_category': {
        const target = input.targets.budgetCategories.find(t => t.id === allocation.targetId);
        targetName = target?.name ?? '';
        break;
      }
      case 'savings_goal': {
        const target = input.targets.savingsGoals.find(t => t.id === allocation.targetId);
        targetName = target?.name ?? '';
        break;
      }
    }

    return {
      id: allocation.id,
      incomeStreamId: allocation.incomeStreamId,
      incomeDescription: allocation.incomeDescription,
      allocationType: allocation.allocationType,
      targetId: allocation.targetId,
      targetName,
      amount: allocation.amount,
      createdAt: allocation.createdAt,
    };
  });

  const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  const unallocated = stream.averageAmount - totalAllocated;

  return {
    incomeStream: {
      id: stream.id,
      description: stream.description,
      averageAmount: stream.averageAmount,
      frequency: stream.frequency,
    },
    allocations,
    totalAllocated,
    unallocated,
  };
}

export function buildAllPaycheckViews(input: PaycheckBudgetViewInput): PaycheckBudgetView[] {
  const views: PaycheckBudgetView[] = [];

  for (const stream of input.incomeStreams) {
    const view = buildPaycheckView(input, stream.id);
    if (view) {
      views.push(view);
    }
  }

  return views;
}

export function validatePaycheckAllocations(
  input: PaycheckBudgetViewInput,
  streamId: string
): PaycheckValidationResult {
  const errors: string[] = [];

  const stream = input.incomeStreams.find(s => s.id === streamId);
  if (!stream) {
    errors.push(`Income stream with id ${streamId} not found`);
    return { valid: false, errors };
  }

  const streamAllocations = input.allocations.filter(a => a.incomeStreamId === streamId);

  const totalAllocated = streamAllocations.reduce((sum, a) => sum + a.amount, 0);
  if (totalAllocated > stream.averageAmount) {
    errors.push(
      `Total allocations (${totalAllocated}) exceed income stream average amount (${stream.averageAmount})`
    );
  }

  for (const allocation of streamAllocations) {
    let targetExists = false;

    switch (allocation.allocationType) {
      case 'recurring_item':
        targetExists = input.targets.recurringItems.some(t => t.id === allocation.targetId);
        break;
      case 'budget_category':
        targetExists = input.targets.budgetCategories.some(t => t.id === allocation.targetId);
        break;
      case 'savings_goal':
        targetExists = input.targets.savingsGoals.some(t => t.id === allocation.targetId);
        break;
    }

    if (!targetExists) {
      errors.push(
        `Allocation ${allocation.id}: target ${allocation.targetId} of type ${allocation.allocationType} not found`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export class PaycheckBudgetEngine {
  buildView(input: PaycheckBudgetViewInput, streamId: string): PaycheckBudgetView | null {
    return buildPaycheckView(input, streamId);
  }

  buildAllViews(input: PaycheckBudgetViewInput): PaycheckBudgetView[] {
    return buildAllPaycheckViews(input);
  }

  validate(input: PaycheckBudgetViewInput, streamId: string): PaycheckValidationResult {
    return validatePaycheckAllocations(input, streamId);
  }
}
