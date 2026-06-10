/**
 * AOSP Risk Scoring Module
 *
 * Quantifies risk level (0-100) for AOSP changes to automatically trigger
 * deliberate mode when appropriate.
 */

export interface RiskFactors {
  // Code impact scope
  singleFileModification: boolean;
  crossModuleModification: boolean;
  crossProcessBoundary: boolean;

  // Stability risks
  modifiesSystemApi: boolean;
  modifiesSELinux: boolean;
  modifiesBootSequence: boolean;
  modifiesBinder: boolean;
  modifiesAIDL: boolean;
  modifiesHIDL: boolean;
  modifiesTrebleBoundary: boolean;
  modifiesPublicApi: boolean;

  // Test coverage gaps
  noUnitTests: boolean;
  noCTSCoverage: boolean;
  noVTSCoverage: boolean;

  // Additional factors
  multiPartitionChanges: boolean;
  kernelOrDTModification: boolean;
  affectsMultiUser: boolean;
  affectsMultiDisplay: boolean;
}

export interface RiskScore {
  total: number;           // 0-100
  recommendation: 'short' | 'suggest-deliberate' | 'force-deliberate';
  breakdown: {
    codeImpact: number;    // 0-50
    stability: number;      // 0-50
    testCoverage: number;   // 0-30
  };
  triggeredFactors: string[];
}

/**
 * Calculate risk score from evidence and query context
 */
export function calculateRiskScore(factors: RiskFactors): RiskScore {
  let codeImpact = 0;
  let stability = 0;
  let testCoverage = 0;
  const triggered: string[] = [];

  // Code impact scope (0-50)
  if (factors.singleFileModification) {
    codeImpact += 10;
    triggered.push('Single file modification');
  }
  if (factors.crossModuleModification) {
    codeImpact += 30;
    triggered.push('Cross-module modification');
  }
  if (factors.crossProcessBoundary) {
    codeImpact += 50;
    triggered.push('Cross-process boundary');
  }

  // Stability risks (0-50, max out at 50)
  if (factors.modifiesSystemApi) {
    stability += 40;
    triggered.push('@SystemApi modification');
  }
  if (factors.modifiesSELinux) {
    stability += 30;
    triggered.push('SELinux policy change');
  }
  if (factors.modifiesBootSequence) {
    stability += 50;
    triggered.push('Boot sequence modification');
  }
  if (factors.modifiesBinder) {
    stability += 35;
    triggered.push('Binder interface modification');
  }
  if (factors.modifiesAIDL) {
    stability += 35;
    triggered.push('AIDL interface modification');
  }
  if (factors.modifiesHIDL) {
    stability += 35;
    triggered.push('HIDL interface modification');
  }
  if (factors.modifiesTrebleBoundary) {
    stability += 40;
    triggered.push('Treble boundary crossing');
  }
  if (factors.modifiesPublicApi) {
    stability += 45;
    triggered.push('Public API modification');
  }
  if (factors.multiPartitionChanges) {
    stability += 35;
    triggered.push('Multi-partition changes');
  }
  if (factors.kernelOrDTModification) {
    stability += 50;
    triggered.push('Kernel/DT modification');
  }
  if (factors.affectsMultiUser) {
    stability += 20;
    triggered.push('Multi-user impact');
  }
  if (factors.affectsMultiDisplay) {
    stability += 20;
    triggered.push('Multi-display impact');
  }

  // Cap stability at 50
  stability = Math.min(stability, 50);

  // Test coverage gaps (0-30)
  if (factors.noUnitTests) {
    testCoverage += 20;
    triggered.push('Missing unit tests');
  }
  if (factors.noCTSCoverage) {
    testCoverage += 30;
    triggered.push('Missing CTS coverage');
  }
  if (factors.noVTSCoverage) {
    testCoverage += 25;
    triggered.push('Missing VTS coverage');
  }

  // Cap test coverage at 30
  testCoverage = Math.min(testCoverage, 30);

  const total = codeImpact + stability + testCoverage;

  let recommendation: 'short' | 'suggest-deliberate' | 'force-deliberate';
  if (total >= 70) {
    recommendation = 'force-deliberate';
  } else if (total >= 50) {
    recommendation = 'suggest-deliberate';
  } else {
    recommendation = 'short';
  }

  return {
    total,
    recommendation,
    breakdown: {
      codeImpact,
      stability,
      testCoverage,
    },
    triggeredFactors: triggered,
  };
}

/**
 * Extract risk factors from evidence index and query
 */
export function extractRiskFactorsFromEvidence(
  evidenceIndex: Array<{
    id: string;
    path: string;
    type: string;
    facet: string;
    description: string;
  }>,
  queryText: string
): RiskFactors {
  const queryLower = queryText.toLowerCase();
  const allPaths = evidenceIndex.map(e => e.path.toLowerCase()).join(' ');
  const allDescriptions = evidenceIndex.map(e => e.description.toLowerCase()).join(' ');
  const combinedText = `${queryLower} ${allPaths} ${allDescriptions}`;

  // Count unique repos mentioned
  const repos = new Set(evidenceIndex.map(e => e.path.split('/')[0]));
  const hasCrossModule = repos.size > 1;

  // Detect file modification scope
  const fileCount = new Set(evidenceIndex.filter(e => e.type === 'source').map(e => e.path)).size;
  const singleFile = fileCount === 1;

  return {
    singleFileModification: singleFile,
    crossModuleModification: hasCrossModule,
    crossProcessBoundary:
      combinedText.includes('binder') ||
      combinedText.includes('aidl') ||
      combinedText.includes('hidl') ||
      combinedText.includes('ipc'),

    modifiesSystemApi:
      combinedText.includes('@systemapi') ||
      combinedText.includes('systemapi'),
    modifiesSELinux:
      combinedText.includes('selinux') ||
      combinedText.includes('sepolicy') ||
      allPaths.includes('.te'),
    modifiesBootSequence:
      combinedText.includes('boot') ||
      combinedText.includes('init.rc') ||
      combinedText.includes('zygote'),
    modifiesBinder: combinedText.includes('binder'),
    modifiesAIDL: combinedText.includes('aidl') || allPaths.includes('.aidl'),
    modifiesHIDL: combinedText.includes('hidl') || allPaths.includes('.hal'),
    modifiesTrebleBoundary:
      combinedText.includes('treble') ||
      combinedText.includes('vendor/') ||
      combinedText.includes('hal'),
    modifiesPublicApi:
      combinedText.includes('public api') ||
      combinedText.includes('@hide'),

    noUnitTests: !evidenceIndex.some(e => e.type === 'test' && e.path.includes('test')),
    noCTSCoverage: !evidenceIndex.some(e => e.path.includes('cts')),
    noVTSCoverage: !evidenceIndex.some(e => e.path.includes('vts')),

    multiPartitionChanges:
      (combinedText.includes('system/') && combinedText.includes('vendor/')) ||
      (combinedText.includes('system/') && combinedText.includes('product/')),
    kernelOrDTModification:
      combinedText.includes('kernel') ||
      combinedText.includes('device tree') ||
      combinedText.includes('dts'),
    affectsMultiUser: combinedText.includes('multi-user') || combinedText.includes('user id'),
    affectsMultiDisplay: combinedText.includes('multi-display') || combinedText.includes('secondary display'),
  };
}
