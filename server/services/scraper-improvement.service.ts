import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  extractorImprovementProposals,
  type ExtractionFailure,
} from "../../drizzle/schema";
import { requireDb } from "../_core/db-assert";
import { ENV } from "../_core/env";
import {
  invokeLLMWithFallback,
  LLMValidationError,
  type InvokeResult,
} from "../_core/llm";
import { logger } from "../_core/logger";
import {
  clusterExtractionFailures,
  extractionFailureIntelligenceService,
  sanitizeStructuredValue,
  type FailureCluster,
} from "./extraction-failure-intelligence.service";
import {
  compareExtractors,
  type ExtractorComparisonReport,
  type RegisteredExtractor,
} from "./extractor-evaluation.service";
import {
  EXTRACTOR_VERSION,
  extractDeterministicProduct,
} from "./product-content-extraction";

const SAFE_EXTRACTOR_FILES = new Set([
  "server/services/product-content-extraction.ts",
  "server/services/product-content-extraction.test.ts",
  "server/services/extraction-failure-intelligence.service.ts",
  "server/services/extraction-failure-intelligence.service.test.ts",
]);

const proposalTestCaseSchema = z.object({
  name: z.string().min(3).max(160),
  kind: z.enum(["positive", "negative", "regression"]),
  fixtureDescription: z.string().min(10).max(2_000),
  expectedEvidence: z.array(z.string().min(1).max(300)).max(20),
  expectedDecision: z.enum(["confident", "ambiguous", "unresolved"]),
});

const proposalSchema = z
  .object({
    title: z.string().min(5).max(255),
    problem: z.string().min(20).max(4_000),
    detectedPattern: z.string().min(20).max(4_000),
    affectedFailureCount: z.number().int().positive(),
    confidence: z.number().min(0).max(1),
    platform: z.string().min(1).max(32),
    extractionStrategy: z.string().min(20).max(5_000),
    filesToModify: z.array(z.string()).min(1).max(4),
    implementationPlan: z.string().min(20).max(5_000),
    testCases: z.array(proposalTestCaseSchema).min(3).max(30),
    regressionRisks: z.array(z.string().min(3).max(500)).min(1).max(20),
    expectedImprovement: z.string().min(10).max(2_000),
  })
  .superRefine((proposal, context) => {
    for (const file of proposal.filesToModify) {
      if (!SAFE_EXTRACTOR_FILES.has(file)) {
        context.addIssue({
          code: "custom",
          path: ["filesToModify"],
          message: `unsafe or unrelated file requested: ${file}`,
        });
      }
    }
    for (const kind of ["positive", "negative", "regression"] as const) {
      if (!proposal.testCases.some(testCase => testCase.kind === kind)) {
        context.addIssue({
          code: "custom",
          path: ["testCases"],
          message: `at least one ${kind} test is required`,
        });
      }
    }
  });

export type ExtractorImprovementProposal = z.infer<typeof proposalSchema>;

const PROPOSAL_OUTPUT_SCHEMA = {
  name: "scraper_improvement_proposal",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      problem: { type: "string" },
      detectedPattern: { type: "string" },
      affectedFailureCount: { type: "integer" },
      confidence: { type: "number" },
      platform: { type: "string" },
      extractionStrategy: { type: "string" },
      filesToModify: { type: "array", items: { type: "string" } },
      implementationPlan: { type: "string" },
      testCases: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            kind: {
              type: "string",
              enum: ["positive", "negative", "regression"],
            },
            fixtureDescription: { type: "string" },
            expectedEvidence: {
              type: "array",
              items: { type: "string" },
            },
            expectedDecision: {
              type: "string",
              enum: ["confident", "ambiguous", "unresolved"],
            },
          },
          required: [
            "name",
            "kind",
            "fixtureDescription",
            "expectedEvidence",
            "expectedDecision",
          ],
        },
      },
      regressionRisks: { type: "array", items: { type: "string" } },
      expectedImprovement: { type: "string" },
    },
    required: [
      "title",
      "problem",
      "detectedPattern",
      "affectedFailureCount",
      "confidence",
      "platform",
      "extractionStrategy",
      "filesToModify",
      "implementationPlan",
      "testCases",
      "regressionRisks",
      "expectedImprovement",
    ],
  },
};

const improvementMetrics = {
  analysisRuns: 0,
  clustersEligible: 0,
  llmRequests: 0,
  proposalsCreated: 0,
  analysisFailures: 0,
  proposalsRejectedByValidation: 0,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resultContent(result: InvokeResult): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n");
  return "";
}

function jsonFromText(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(withoutFence);
}

export function validateImprovementProposal(
  value: unknown
): ExtractorImprovementProposal {
  const result = proposalSchema.safeParse(value);
  if (!result.success) {
    improvementMetrics.proposalsRejectedByValidation++;
    throw new LLMValidationError(
      `Invalid scraper improvement proposal: ${result.error.issues
        .map(issue => issue.message)
        .join("; ")}`
    );
  }
  return result.data;
}

function validateProposalResult(result: InvokeResult): void {
  try {
    validateImprovementProposal(jsonFromText(resultContent(result)));
  } catch (error) {
    if (error instanceof LLMValidationError) throw error;
    throw new LLMValidationError("Improvement proposal is not valid JSON");
  }
}

function representativeExample(failure: ExtractionFailure) {
  return sanitizeStructuredValue({
    domain: failure.domain,
    platform: failure.platform,
    failureReasons: failure.failureReasons,
    markers: failure.markers,
    productEvidence: Array.isArray(failure.productEvidence)
      ? failure.productEvidence.slice(0, 20)
      : [],
    variantEvidence: Array.isArray(failure.variantEvidence)
      ? failure.variantEvidence.slice(0, 20)
      : [],
    priceEvidence: Array.isArray(failure.priceEvidence)
      ? failure.priceEvidence.slice(0, 30)
      : [],
    deterministicDecision: failure.deterministicDecision,
    reducedContent: failure.reducedContent?.slice(0, 3_500) ?? null,
  });
}

function proposalPrompt(cluster: FailureCluster) {
  return {
    system: [
      "You are the asynchronous analyst for a deterministic ecommerce product extractor.",
      "Analyze repeated sanitized failures and propose one reusable deterministic improvement.",
      "Do not resolve a single page. Do not output source code, a patch, commands, credentials, schema changes, or deployment actions.",
      "Preserve product and variant identity. Never guess conflicting prices or variants.",
      "Every proposal requires positive, negative, and regression fixture specifications.",
      `Files may only be selected from: ${Array.from(SAFE_EXTRACTOR_FILES).join(", ")}.`,
      "Return only the structured JSON object requested by the schema.",
    ].join("\n"),
    user: JSON.stringify({
      extractorVersion: EXTRACTOR_VERSION,
      cluster: {
        domain: cluster.domain,
        platform: cluster.platform,
        failureReason: cluster.failureReason,
        affectedFailureCount: cluster.affectedFailureCount,
        markers: cluster.markers,
      },
      representativeExamples: cluster.representativeFailures.map(
        representativeExample
      ),
    }),
  };
}

function proposalReport(
  cluster: FailureCluster,
  proposal: ExtractorImprovementProposal
): string {
  return [
    "SCRAPER IMPROVEMENT REPORT",
    "",
    `Extractor: v${EXTRACTOR_VERSION}`,
    `Pattern: ${proposal.detectedPattern}`,
    `Platform: ${cluster.platform}`,
    `Failure type: ${cluster.failureReason}`,
    `Affected observations: ${cluster.affectedFailureCount}`,
    `Representative examples: ${cluster.representativeFailures.length}`,
    `Proposed change: ${proposal.extractionStrategy}`,
    `Generated test specifications: ${proposal.testCases.length}`,
    "Evaluation: PENDING REPLAY",
    "Recommendation: HUMAN REVIEW REQUIRED",
  ].join("\n");
}

async function persistProposal(
  cluster: FailureCluster,
  proposal: ExtractorImprovementProposal
) {
  const database = await requireDb();
  const proposalKey = hash(`${cluster.clusterKey}|${EXTRACTOR_VERSION}`);
  const now = new Date();
  const report = proposalReport(cluster, proposal);
  const [record] = await database
    .insert(extractorImprovementProposals)
    .values({
      proposalKey,
      clusterKey: cluster.clusterKey,
      extractorVersion: EXTRACTOR_VERSION,
      title: proposal.title,
      platform: cluster.platform,
      failureReason: cluster.failureReason,
      affectedFailureCount: cluster.affectedFailureCount,
      confidence: proposal.confidence,
      proposal,
      report,
      status: "pending_review",
    })
    .onConflictDoUpdate({
      target: extractorImprovementProposals.proposalKey,
      set: {
        title: proposal.title,
        affectedFailureCount: cluster.affectedFailureCount,
        confidence: proposal.confidence,
        proposal,
        report,
        status: "pending_review",
        updatedAt: now,
      },
    })
    .returning();
  return record;
}

async function analyzeCluster(cluster: FailureCluster) {
  const prompt = proposalPrompt(cluster);
  improvementMetrics.llmRequests++;
  const result = await invokeLLMWithFallback({
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    outputSchema: PROPOSAL_OUTPUT_SCHEMA,
    maxTokens: 3_000,
    resultValidator: validateProposalResult,
  });
  const proposal = validateImprovementProposal(
    jsonFromText(resultContent(result))
  );
  const normalizedProposal = {
    ...proposal,
    affectedFailureCount: cluster.affectedFailureCount,
    platform: cluster.platform,
  };
  const record = await persistProposal(cluster, normalizedProposal);
  await extractionFailureIntelligenceService.markAnalyzed(
    cluster.failures.map(failure => failure.id)
  );
  improvementMetrics.proposalsCreated++;
  logger.info(
    {
      proposalId: record.id,
      clusterKey: cluster.clusterKey,
      affectedFailureCount: cluster.affectedFailureCount,
      status: record.status,
    },
    "Scraper improvement proposal created for human review"
  );
  return record;
}

export function getScraperImprovementMetrics() {
  return { ...improvementMetrics };
}

export const scraperImprovementService = {
  async analyzePendingFailures() {
    improvementMetrics.analysisRuns++;
    const failures = await extractionFailureIntelligenceService.listPending();
    const clusters = clusterExtractionFailures(
      failures,
      ENV.scraperImprovementMinFailures
    );
    improvementMetrics.clustersEligible += clusters.length;
    const selected = clusters.slice(0, ENV.scraperImprovementMaxClusters);
    const records = [];
    for (const cluster of selected) {
      try {
        records.push(await analyzeCluster(cluster));
      } catch (error) {
        improvementMetrics.analysisFailures++;
        logger.error(
          { clusterKey: cluster.clusterKey, err: error },
          "Scraper improvement cluster analysis failed"
        );
      }
    }
    return {
      pendingFailures: failures.length,
      eligibleClusters: clusters.length,
      proposals: records,
    };
  },

  async recordEvaluation(
    proposalId: string,
    evaluation: ExtractorComparisonReport
  ) {
    const database = await requireDb();
    const status =
      evaluation.recommendation === "APPROVE" ? "ready_for_review" : "rejected";
    const [record] = await database
      .update(extractorImprovementProposals)
      .set({
        evaluation,
        report: evaluation.humanReport,
        status,
        updatedAt: new Date(),
      })
      .where(eq(extractorImprovementProposals.id, proposalId))
      .returning();
    return record ?? null;
  },

  async evaluateRegisteredCandidate(
    proposalId: string,
    candidateExtractor: RegisteredExtractor,
    fixtureLimit = 1_000
  ) {
    const fixtures =
      await extractionFailureIntelligenceService.listReplayFixtures(
        fixtureLimit
      );
    if (fixtures.length === 0) {
      throw new Error("No labeled extraction replay fixtures are available");
    }
    const evaluation = compareExtractors(
      fixtures,
      extractDeterministicProduct,
      candidateExtractor
    );
    const record = await scraperImprovementService.recordEvaluation(
      proposalId,
      evaluation
    );
    return { evaluation, proposal: record };
  },
};
