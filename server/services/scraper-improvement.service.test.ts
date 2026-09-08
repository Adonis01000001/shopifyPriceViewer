import { describe, expect, it } from "vitest";
import { LLMValidationError } from "../_core/llm";
import { validateImprovementProposal } from "./scraper-improvement.service";

function validProposal() {
  return {
    title: "Extract reusable custom product state",
    problem:
      "Repeated pages expose product and selected variant data in a stable application-state object that is not currently recognized.",
    detectedPattern:
      "The sanitized examples consistently contain window.__PRODUCT_STATE__ with product, variants, and selectedVariantId fields.",
    affectedFailureCount: 12,
    confidence: 0.9,
    platform: "custom",
    extractionStrategy:
      "Parse the JSON assignment safely, emit field-level evidence, and resolve a price only when the selected variant identifier matches.",
    filesToModify: ["server/services/product-content-extraction.ts"],
    implementationPlan:
      "Add a narrowly scoped structured-state reader, feed its candidates into the existing resolver, and retain all current conflict checks.",
    testCases: [
      {
        name: "selected variant is extracted",
        kind: "positive" as const,
        fixtureDescription:
          "A product-state object with two variants and an explicit selectedVariantId.",
        expectedEvidence: ["product_id", "variant_id", "price", "currency"],
        expectedDecision: "confident" as const,
      },
      {
        name: "unselected variant is rejected",
        kind: "negative" as const,
        fixtureDescription:
          "A product-state object with multiple prices but no selected variant signal.",
        expectedEvidence: ["variant_option", "price"],
        expectedDecision: "ambiguous" as const,
      },
      {
        name: "subscription remains excluded",
        kind: "regression" as const,
        fixtureDescription:
          "A known subscription-only price fixture that must remain unresolved.",
        expectedEvidence: ["price"],
        expectedDecision: "unresolved" as const,
      },
    ],
    regressionRisks: [
      "Generic state objects may describe related recommendations rather than the requested product.",
    ],
    expectedImprovement:
      "Resolve the repeated custom-state cluster without increasing related-product or variant false positives.",
  };
}

describe("scraper improvement proposals", () => {
  it("accepts a bounded proposal with positive, negative, and regression tests", () => {
    const proposal = validateImprovementProposal(validProposal());
    expect(proposal.testCases).toHaveLength(3);
    expect(proposal.filesToModify).toEqual([
      "server/services/product-content-extraction.ts",
    ]);
  });

  it("rejects attempts to modify unrelated or security-sensitive files", () => {
    const proposal = validProposal();
    proposal.filesToModify = ["server/_core/auth/session.ts"];
    expect(() => validateImprovementProposal(proposal)).toThrow(
      LLMValidationError
    );
  });

  it("rejects proposals without complete regression coverage", () => {
    const proposal = validProposal();
    proposal.testCases = proposal.testCases.filter(
      testCase => testCase.kind !== "negative"
    );
    expect(() => validateImprovementProposal(proposal)).toThrow(
      /at least one negative test is required/
    );
  });
});
