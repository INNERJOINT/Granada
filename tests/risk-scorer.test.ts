/**
 * Tests for Risk Scorer Module
 */

import { describe, it, expect } from 'vitest';
import {
  calculateRiskScore,
  extractRiskFactorsFromEvidence,
  type RiskFactors,
} from '../skills/aosp-plan/utils/risk-scorer';

describe('Risk Scorer', () => {
  describe('calculateRiskScore', () => {
    it('should score low-risk single file modification', () => {
      const factors: RiskFactors = {
        singleFileModification: true,
        crossModuleModification: false,
        crossProcessBoundary: false,
        modifiesSystemApi: false,
        modifiesSELinux: false,
        modifiesBootSequence: false,
        modifiesBinder: false,
        modifiesAIDL: false,
        modifiesHIDL: false,
        modifiesTrebleBoundary: false,
        modifiesPublicApi: false,
        noUnitTests: false,
        noCTSCoverage: false,
        noVTSCoverage: false,
        multiPartitionChanges: false,
        kernelOrDTModification: false,
        affectsMultiUser: false,
        affectsMultiDisplay: false,
      };

      const result = calculateRiskScore(factors);

      expect(result.total).toBe(10);
      expect(result.recommendation).toBe('short');
      expect(result.breakdown.codeImpact).toBe(10);
      expect(result.breakdown.stability).toBe(0);
      expect(result.breakdown.testCoverage).toBe(0);
      expect(result.triggeredFactors).toContain('Single file modification');
    });

    it('should score high-risk Binder + SELinux + boot modification', () => {
      const factors: RiskFactors = {
        singleFileModification: false,
        crossModuleModification: true,
        crossProcessBoundary: true,
        modifiesSystemApi: false,
        modifiesSELinux: true,
        modifiesBootSequence: true,
        modifiesBinder: true,
        modifiesAIDL: false,
        modifiesHIDL: false,
        modifiesTrebleBoundary: false,
        modifiesPublicApi: false,
        noUnitTests: true,
        noCTSCoverage: true,
        noVTSCoverage: false,
        multiPartitionChanges: false,
        kernelOrDTModification: false,
        affectsMultiUser: false,
        affectsMultiDisplay: false,
      };

      const result = calculateRiskScore(factors);

      // Code impact: 30 (cross-module) + 50 (cross-process) = 50 (capped)
      // Stability: 30 (SELinux) + 50 (boot) + 35 (Binder) = 50 (capped)
      // Test coverage: 20 (no unit) + 30 (no CTS) = 30 (capped)
      // Total: 130 capped at actual = 50 + 50 + 30 = 130, but code impact capped at 50
      expect(result.total).toBeGreaterThanOrEqual(70);
      expect(result.recommendation).toBe('force-deliberate');
      expect(result.triggeredFactors).toContain('SELinux policy change');
      expect(result.triggeredFactors).toContain('Boot sequence modification');
      expect(result.triggeredFactors).toContain('Binder interface modification');
    });

    it('should score medium-risk cross-module without tests', () => {
      const factors: RiskFactors = {
        singleFileModification: false,
        crossModuleModification: true,
        crossProcessBoundary: false,
        modifiesSystemApi: false,
        modifiesSELinux: false,
        modifiesBootSequence: false,
        modifiesBinder: false,
        modifiesAIDL: false,
        modifiesHIDL: false,
        modifiesTrebleBoundary: false,
        modifiesPublicApi: false,
        noUnitTests: true,
        noCTSCoverage: true,
        noVTSCoverage: false,
        multiPartitionChanges: false,
        kernelOrDTModification: false,
        affectsMultiUser: false,
        affectsMultiDisplay: false,
      };

      const result = calculateRiskScore(factors);

      // Code impact: 30
      // Stability: 0
      // Test coverage: 20 + 30 = 30 (capped)
      // Total: 60
      expect(result.total).toBe(60);
      expect(result.recommendation).toBe('suggest-deliberate');
    });
  });

  describe('extractRiskFactorsFromEvidence', () => {
    it('should detect Binder modification from evidence', () => {
      const evidence = [
        {
          id: 'E1',
          path: 'frameworks/base/core/java/android/os/IServiceManager.aidl',
          type: 'source',
          facet: 'boundary',
          description: 'Binder service manager interface',
        },
      ];

      const factors = extractRiskFactorsFromEvidence(
        evidence,
        'Modify Binder interface for power management'
      );

      expect(factors.modifiesBinder).toBe(true);
      expect(factors.modifiesAIDL).toBe(true);
      expect(factors.crossProcessBoundary).toBe(true);
    });

    it('should detect SELinux modification from file extension', () => {
      const evidence = [
        {
          id: 'E1',
          path: 'system/sepolicy/public/system_server.te',
          type: 'config',
          facet: 'config',
          description: 'System server SELinux policy',
        },
      ];

      const factors = extractRiskFactorsFromEvidence(evidence, 'Update SELinux policy');

      expect(factors.modifiesSELinux).toBe(true);
    });

    it('should detect cross-module modification', () => {
      const evidence = [
        {
          id: 'E1',
          path: 'frameworks/base/services/core/java/PowerManager.java',
          type: 'source',
          facet: 'owner',
          description: 'Power manager service',
        },
        {
          id: 'E2',
          path: 'hardware/interfaces/power/aidl/IPower.aidl',
          type: 'source',
          facet: 'boundary',
          description: 'Power HAL interface',
        },
      ];

      const factors = extractRiskFactorsFromEvidence(evidence, 'Modify power HAL');

      expect(factors.crossModuleModification).toBe(true);
      expect(factors.singleFileModification).toBe(false);
    });

    it('should detect missing test coverage', () => {
      const evidence = [
        {
          id: 'E1',
          path: 'frameworks/base/services/core/java/NewFeature.java',
          type: 'source',
          facet: 'owner',
          description: 'New feature implementation',
        },
      ];

      const factors = extractRiskFactorsFromEvidence(evidence, 'Add new feature');

      expect(factors.noUnitTests).toBe(true);
      expect(factors.noCTSCoverage).toBe(true);
      expect(factors.noVTSCoverage).toBe(true);
    });
  });
});
