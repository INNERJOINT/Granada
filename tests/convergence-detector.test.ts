/**
 * Tests for Convergence Detector Module
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeConvergence,
  createIterationSnapshot,
  type IterationSnapshot,
} from '../skills/aosp-plan/utils/convergence-detector';

describe('Convergence Detector', () => {
  describe('analyzeConvergence', () => {
    it('should recommend continue with insufficient history', () => {
      const history: IterationSnapshot[] = [
        {
          iteration: 1,
          planContent: 'Step 1: Do something\nStep 2: Do another thing',
          planHash: 'abc123',
          architectFeedback: 'Initial feedback',
          criticFeedback: 'Needs work',
          evidenceIndexIds: ['E1', 'E2'],
          verdict: 'ITERATE',
        },
      ];

      const result = analyzeConvergence(history, 1, 5);

      expect(result.isConverged).toBe(false);
      expect(result.shouldTerminateEarly).toBe(false);
      expect(result.recommendation).toBe('continue');
    });

    it('should detect early approval', () => {
      const history: IterationSnapshot[] = [
        {
          iteration: 1,
          planContent: 'Step 1: Initial plan',
          planHash: 'abc123',
          architectFeedback: 'Initial feedback',
          criticFeedback: 'Good start',
          evidenceIndexIds: ['E1', 'E2'],
          verdict: 'ITERATE',
        },
        {
          iteration: 2,
          planContent: 'Step 1: Revised plan',
          planHash: 'abc456',
          architectFeedback: 'Much better',
          criticFeedback: 'Approved',
          evidenceIndexIds: ['E1', 'E2', 'E3'],
          verdict: 'APPROVE',
        },
      ];

      const result = analyzeConvergence(history, 2, 5);

      expect(result.shouldTerminateEarly).toBe(true);
      expect(result.recommendation).toBe('terminate-approved');
      expect(result.reason).toContain('early');
    });

    it('should detect convergence with approval', () => {
      // Use nearly identical plans (>95% similarity)
      const plan1 = 'Step 1: Implement feature A\nStep 2: Add tests\nStep 3: Update docs\nStep 4: Review changes';
      const plan2 = 'Step 1: Implement feature A\nStep 2: Add tests\nStep 3: Update docs\nStep 4: Review changes';

      const history: IterationSnapshot[] = [
        {
          iteration: 1,
          planContent: 'Initial plan content',
          planHash: 'hash1',
          architectFeedback: 'Check evidence',
          criticFeedback: 'Evidence gaps',
          evidenceIndexIds: ['E1', 'E2'],
          verdict: 'ITERATE',
        },
        createIterationSnapshot(2, plan1, 'Good progress great work', 'Almost there looking good', 'ITERATE'),
        createIterationSnapshot(3, plan2, 'Good progress great work', 'Almost there looking good approved', 'APPROVE'),
      ];

      const result = analyzeConvergence(history, 3, 5);

      // Since plan1 and plan2 are identical, and feedback is very similar, convergence should be detected
      expect(result.shouldTerminateEarly).toBe(true);
      expect(result.recommendation).toBe('terminate-approved');
    });

    it('should detect oscillation', () => {
      const plan1 = 'Step 1: Approach A\nStep 2: Test A';
      const plan2 = 'Step 1: Approach B\nStep 2: Test B';
      const plan3 = 'Step 1: Approach A\nStep 2: Test A'; // Back to plan1

      const history: IterationSnapshot[] = [
        createIterationSnapshot(1, plan1, 'Feedback 1', 'Try different approach', 'ITERATE'),
        createIterationSnapshot(2, plan2, 'Feedback 2', 'Original was better', 'ITERATE'),
        createIterationSnapshot(3, plan3, 'Feedback 3', 'Still not right', 'ITERATE'),
      ];

      const result = analyzeConvergence(history, 3, 5);

      expect(result.isOscillating).toBe(true);
      expect(result.shouldTerminateEarly).toBe(true);
      expect(result.recommendation).toBe('escalate-to-human');
      expect(result.reason).toContain('Oscillation');
    });

    it('should handle max iterations', () => {
      const history: IterationSnapshot[] = [];
      for (let i = 1; i <= 5; i++) {
        history.push(
          createIterationSnapshot(
            i,
            `Plan version ${i}`,
            `Feedback ${i}`,
            `Verdict ${i}`,
            'ITERATE'
          )
        );
      }

      const result = analyzeConvergence(history, 5, 5);

      expect(result.shouldTerminateEarly).toBe(true);
      expect(result.recommendation).toBe('terminate-max-iterations');
      expect(result.reason).toContain('Maximum iterations');
    });
  });

  describe('createIterationSnapshot', () => {
    it('should extract Evidence Index IDs from plan', () => {
      const plan = `
        Step 1: Do something [E1]
        Step 2: Do another thing [E3] [E5]
        Step 3: Final step [E1] [E3]
      `;

      const snapshot = createIterationSnapshot(
        1,
        plan,
        'Architect feedback',
        'Critic feedback',
        'ITERATE'
      );

      expect(snapshot.evidenceIndexIds).toEqual(['E1', 'E3', 'E5']);
      expect(snapshot.evidenceIndexIds.length).toBe(3); // Deduplicated
    });

    it('should create valid snapshot structure', () => {
      const snapshot = createIterationSnapshot(
        2,
        'Plan content',
        'Arch feedback',
        'Crit feedback',
        'APPROVE'
      );

      expect(snapshot.iteration).toBe(2);
      expect(snapshot.planHash).toBeDefined();
      expect(snapshot.architectFeedback).toBe('Arch feedback');
      expect(snapshot.criticFeedback).toBe('Crit feedback');
      expect(snapshot.verdict).toBe('APPROVE');
    });
  });
});
