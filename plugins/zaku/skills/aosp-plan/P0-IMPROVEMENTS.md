# P0 Improvements Implementation Summary

## Overview

This document describes the P0 high-priority improvements implemented for the aosp-plan skill:

1. **Consensus Loop Intelligent Early Termination**
2. **Risk Scoring Quantification and Auto-Trigger**
3. **Plan Template Library**

---

## 1. Consensus Loop Intelligent Early Termination

### Implementation

**Location:** `skills/aosp-plan/utils/convergence-detector.ts`

**Key Features:**
- Tracks iteration history with plan hashes, feedback, and evidence IDs
- Calculates convergence metrics:
  - Plan similarity (text-based comparison)
  - Feedback similarity (Architect + Critic feedback)
  - Evidence stability (Evidence Index overlap)
- Detects oscillation (stuck loops)
- Recommends early termination when appropriate

**Integration:** Updated `SKILL.md` Step 5d to run convergence checks after iteration 2+

**Termination Conditions:**
- ✅ Converged (95%+ plan, 80%+ feedback, 90%+ evidence) + APPROVE → Exit immediately
- ⚠️ Oscillating (similar to N-2, different from N-1) after 3+ iterations → Escalate to user
- 📊 Converged but not approved → Log in changelog, continue iterating

**Benefits:**
- Reduces unnecessary iterations (saves time and tokens)
- Detects stuck loops early
- Provides transparency through logged convergence metrics

---

## 2. Risk Scoring Quantification and Auto-Trigger

### Implementation

**Location:** `skills/aosp-plan/utils/risk-scorer.ts`

**Scoring Model:**

| Category | Max Points | Key Factors |
|----------|-----------|-------------|
| Code Impact | 50 | Single file (+10), Cross-module (+30), Cross-process (+50) |
| Stability | 50 | @SystemApi (+40), SELinux (+30), Boot (+50), Binder/AIDL/HIDL (+35), Treble (+40), Public API (+45), Multi-partition (+35), Kernel/DT (+50), Multi-user (+20), Multi-display (+20) |
| Test Coverage | 30 | No unit tests (+20), No CTS (+30), No VTS (+25) |

**Thresholds:**
- **< 50**: Short mode (default)
- **50-69**: Suggest deliberate mode (log recommendation)
- **>= 70**: Force deliberate mode (auto-trigger)

**Integration:** Updated `SKILL.md` Step 4.5 to calculate risk score after evidence synthesis

**Benefits:**
- Replaces keyword-based rules with quantified risk assessment
- Automatically triggers deliberate mode for high-risk changes
- Provides transparent risk breakdown to users
- Reduces false positives/negatives for deliberate mode

---

## 3. Plan Template Library

### Implementation

**Location:** `.granada/plan-templates/`

**Available Templates:**

#### 3.1 HAL Implementation Template
**File:** `hal-implementation.md`  
**Use Cases:**
- Implementing new HAL interfaces
- Modifying AIDL/HIDL definitions
- Vendor code integration
- VTS test creation

**Key Sections:**
- Investigation checklist (interface, vendor, client, SELinux, VTS, Treble)
- 6-step plan structure (interface → vendor impl → SELinux → framework → VTS → build)
- Domain-specific risks (vendor compatibility, SELinux, Treble compliance)

#### 3.2 System Service Modification Template
**File:** `system-service-modification.md`  
**Use Cases:**
- Adding features to framework services
- Modifying AIDL interfaces
- Permission model changes

**Key Sections:**
- Investigation checklist (service class, AIDL, permissions, clients, multi-user)
- 5-step plan structure (AIDL → service logic → permissions → unit tests → CTS)
- Domain-specific risks (API breaking change, permission bypass, race conditions)

#### 3.3 CTS Test Addition Template
**File:** `cts-test-addition.md`  
**Use Cases:**
- Adding new CTS test cases
- Expanding compatibility test coverage

**Key Sections:**
- Investigation checklist (feature, existing coverage, CTS module, test requirements)
- 3-step plan structure (test class → test cases → build config)
- Domain-specific risks (test flakiness, device compatibility)

### Integration

**Updated:** `agents/aosp-planner.md` Investigation_Protocol Step 4

**Template Matching Logic:**
- Reads `.granada/plan-templates/README.md` for available templates
- Matches query keywords to templates:
  - HAL/AIDL/HIDL/vendor/Treble → `hal-implementation.md`
  - system service/framework/manager → `system-service-modification.md`
  - CTS/test → `cts-test-addition.md`
- User can explicitly request: "use the hal-implementation template"

**Template Usage:**
- Planner loads matched template as starting point
- All PLACEHOLDER sections must be filled with evidence during consensus
- Templates provide structure and investigation checklists

**Benefits:**
- Accelerates plan creation with proven patterns
- Ensures comprehensive investigation checklists
- Maintains consistency across similar projects
- Captures domain-specific best practices

---

## Files Modified/Created

### Created Files:
1. `skills/aosp-plan/utils/risk-scorer.ts` - Risk scoring engine
2. `skills/aosp-plan/utils/convergence-detector.ts` - Convergence detection
3. `.granada/plan-templates/hal-implementation.md` - HAL template
4. `.granada/plan-templates/system-service-modification.md` - System service template
5. `.granada/plan-templates/cts-test-addition.md` - CTS test template
6. `.granada/plan-templates/README.md` - Template index

### Modified Files:
1. `skills/aosp-plan/SKILL.md` - Integrated risk scoring (Step 4.5), convergence detection (Step 5d), updated consensus packet
2. `agents/aosp-planner.md` - Added template matching in Investigation_Protocol Step 4

---

## Usage Examples

### Example 1: Risk-Adaptive Mode

```
User query: "Modify Binder interface for power management"

Risk Assessment:
- Cross-process boundary: +50
- Binder interface: +35
- Total: 85/100

Result: DELIBERATE mode auto-triggered
- Requires pre-mortem (3 failure scenarios)
- Requires expanded test plan (unit/integration/e2e/observability)
```

### Example 2: Convergence Detection

```
Iteration 1: Plan draft created
Iteration 2: Minor revisions (plan similarity: 92%)
Iteration 3: Minimal changes (plan similarity: 96%, feedback similarity: 85%, evidence: 95%)
Verdict: APPROVE

Result: Converged, early termination after 3 iterations (saved 2 iterations)
```

### Example 3: Template Matching

```
User query: "Implement audio HAL for new device"

Template matched: hal-implementation.md
Investigation checklist loaded:
- ✓ HAL interface definition
- ✓ Vendor implementation requirements
- ✓ Client-side framework usage
- ✓ SELinux context and policy
- ✓ VTS test requirements
- ✓ Treble compliance checks

Plan structure: 6 steps pre-populated
Planner fills PLACEHOLDER sections with evidence
```

---

## Testing Recommendations

### 1. Convergence Detection
- Test with queries that converge quickly (1-2 iterations)
- Test with queries that oscillate (similar feedback repeating)
- Verify metrics are logged in Consensus Review Changelog

### 2. Risk Scoring
- Test low-risk query (< 50): single file modification
- Test medium-risk query (50-69): cross-module, no tests
- Test high-risk query (>= 70): Binder + SELinux + boot sequence
- Verify deliberate mode auto-triggers for high-risk

### 3. Template Matching
- Test HAL query: "implement camera AIDL HAL"
- Test system service query: "add feature to PackageManagerService"
- Test CTS query: "add CTS test for new permission"
- Verify correct template is loaded and PLACEHOLDER sections are filled

---

## Future Enhancements (P1/P2)

Based on the original analysis, these improvements can be added next:

**P1 (Medium Priority):**
- Evidence gap proactive prediction
- Incremental investigation mode
- Dynamic facet adjustment

**P2 (Lower Priority):**
- Architect/Critic parallelization
- Evidence confidence scoring with time decay
- Multi-perspective Critic parallelization

**Experimental:**
- Interactive evidence exploration mode

---

## Conclusion

The P0 improvements provide:
- **Efficiency**: Convergence detection reduces unnecessary iterations
- **Quality**: Risk scoring ensures appropriate rigor for high-risk changes
- **Speed**: Templates accelerate plan creation with proven patterns
- **Transparency**: Users see risk scores and convergence metrics

These changes maintain backward compatibility while significantly improving the planning process for AOSP development.
