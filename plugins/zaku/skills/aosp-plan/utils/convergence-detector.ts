/**
 * Consensus Loop Convergence Detector
 *
 * Detects when the consensus loop is converging or oscillating,
 * enabling intelligent early termination.
 */

export interface IterationSnapshot {
  iteration: number;
  planContent: string;         // Full plan markdown (for similarity comparison)
  planHash: string;            // Hash of the plan markdown
  architectFeedback: string;   // Architect review text
  criticFeedback: string;      // Critic verdict and feedback
  evidenceIndexIds: string[];  // Evidence Index IDs referenced
  verdict: 'APPROVE' | 'ITERATE' | 'REJECT' | null;
}

export interface ConvergenceAnalysis {
  isConverged: boolean;
  isOscillating: boolean;
  shouldTerminateEarly: boolean;
  reason: string;
  recommendation: 'continue' | 'terminate-approved' | 'terminate-max-iterations' | 'escalate-to-human';
}

/**
 * Simple string hash for comparing plan content
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Calculate similarity between two strings (0-1)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const set1 = new Set(str1.toLowerCase().split(/\s+/));
  const set2 = new Set(str2.toLowerCase().split(/\s+/));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Analyze convergence based on iteration history
 */
export function analyzeConvergence(
  history: IterationSnapshot[],
  currentIteration: number,
  maxIterations: number = 5
): ConvergenceAnalysis {
  // Need at least 2 iterations to detect convergence
  if (history.length < 2) {
    return {
      isConverged: false,
      isOscillating: false,
      shouldTerminateEarly: false,
      reason: 'Insufficient iteration history',
      recommendation: 'continue',
    };
  }

  const current = history[history.length - 1];
  const previous = history[history.length - 2];

  // Early termination: Approved on first or second iteration
  if (current.verdict === 'APPROVE' && currentIteration <= 2) {
    return {
      isConverged: true,
      isOscillating: false,
      shouldTerminateEarly: true,
      reason: 'Plan approved early with minimal iterations',
      recommendation: 'terminate-approved',
    };
  }

  // Check for convergence: minimal changes between iterations
  const planSimilarity = calculateSimilarity(current.planContent, previous.planContent);
  const feedbackSimilarity = calculateSimilarity(
    current.architectFeedback + current.criticFeedback,
    previous.architectFeedback + previous.criticFeedback
  );

  // Evidence stability: percentage of overlapping Evidence Index IDs
  const evidenceOverlap = calculateSetOverlap(
    new Set(current.evidenceIndexIds),
    new Set(previous.evidenceIndexIds)
  );

  const isConverged =
    planSimilarity > 0.95 &&
    feedbackSimilarity > 0.80 &&
    evidenceOverlap > 0.90;

  // If converged AND approved, terminate early
  if (isConverged && current.verdict === 'APPROVE') {
    return {
      isConverged: true,
      isOscillating: false,
      shouldTerminateEarly: true,
      reason: `Convergence detected (plan: ${(planSimilarity * 100).toFixed(0)}%, feedback: ${(feedbackSimilarity * 100).toFixed(0)}%, evidence: ${(evidenceOverlap * 100).toFixed(0)}%) and approved`,
      recommendation: 'terminate-approved',
    };
  }

  // Check for oscillation: similar to 2 iterations ago but different from previous
  if (history.length >= 3) {
    const twoIterationsAgo = history[history.length - 3];
    const oscillationSimilarity = calculateSimilarity(
      current.planContent,
      twoIterationsAgo.planContent
    );

    const isOscillating =
      oscillationSimilarity > 0.85 &&
      planSimilarity < 0.90 &&
      current.verdict !== 'APPROVE';

    if (isOscillating && currentIteration >= 3) {
      return {
        isConverged: false,
        isOscillating: true,
        shouldTerminateEarly: true,
        reason: `Oscillation detected: current iteration is ${(oscillationSimilarity * 100).toFixed(0)}% similar to iteration ${currentIteration - 2}, suggesting the loop is stuck`,
        recommendation: 'escalate-to-human',
      };
    }
  }

  // Max iterations reached
  if (currentIteration >= maxIterations) {
    return {
      isConverged: false,
      isOscillating: false,
      shouldTerminateEarly: true,
      reason: `Maximum iterations (${maxIterations}) reached without approval`,
      recommendation: 'terminate-max-iterations',
    };
  }

  // Continue iterating
  return {
    isConverged: isConverged,
    isOscillating: false,
    shouldTerminateEarly: false,
    reason: isConverged
      ? `Converged but not yet approved (verdict: ${current.verdict})`
      : `Not yet converged (plan: ${(planSimilarity * 100).toFixed(0)}%, feedback: ${(feedbackSimilarity * 100).toFixed(0)}%, evidence: ${(evidenceOverlap * 100).toFixed(0)}%)`,
    recommendation: 'continue',
  };
}

/**
 * Calculate overlap between two sets (Jaccard similarity)
 */
function calculateSetOverlap<T>(set1: Set<T>, set2: Set<T>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 1 : intersection.size / union.size;
}

/**
 * Create an iteration snapshot from plan and feedback
 */
export function createIterationSnapshot(
  iteration: number,
  planMarkdown: string,
  architectReview: string,
  criticFeedback: string,
  verdict: 'APPROVE' | 'ITERATE' | 'REJECT' | null
): IterationSnapshot {
  // Extract Evidence Index IDs from plan (e.g., [E1], [E2])
  const evidenceIds = Array.from(
    planMarkdown.matchAll(/\[E(\d+)\]/g),
    m => `E${m[1]}`
  );

  return {
    iteration,
    planContent: planMarkdown,
    planHash: hashString(planMarkdown),
    architectFeedback: architectReview,
    criticFeedback: criticFeedback,
    evidenceIndexIds: [...new Set(evidenceIds)], // deduplicate
    verdict,
  };
}
