import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  Brain,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Lightbulb,
  Target,
  BarChart3,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type WisdomData = {
  analysis: {
    summary: string;
    overallMarketContext: string;
    topOpportunities: string[];
    keyRisks: string[];
    productRecommendations: Array<{
      productId: string;
      productTitle: string;
      currentPrice: number;
      recommendedPrice: number;
      confidence: "low" | "medium" | "high";
      reasoning: string;
      marketContext: string;
      riskFactors: string[];
      priceChange: number;
      priceChangePercent: number;
    }>;
  } | null;
  error: string | null;
  productCount: number;
};

export default function PathOfWisdom() {
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const { data, isLoading, refetch, isFetching } = trpc.wisdom.analyze.useQuery(undefined, {
    enabled: false,
  });

  const wisdomData = data as WisdomData | undefined;

  const handleAnalyze = async () => {
    setHasAnalyzed(true);
    refetch();
  };

  const handleRerun = () => {
    setHasAnalyzed(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center">
              <Brain className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-2xl font-extrabold text-primary">Path of Wisdom</h2>
            <Sparkles className="h-4 w-4 text-yellow-400" />
          </div>
          <p className="text-muted-foreground text-sm">
            AI-powered portfolio pricing analysis and strategic recommendations
          </p>
        </div>
      </div>

      {!hasAnalyzed ? (
        <div className="glass-panel rounded-lg p-16 text-center">
          <div className="max-w-md mx-auto space-y-6">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Brain className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-primary mb-2">
                Ready for Strategic Insights
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Analyze your entire product portfolio through AI. The Path of Wisdom
                examines your products, competitor data, and market position to deliver
                strategic pricing recommendations with detailed reasoning.
              </p>
            </div>
            <Button
              size="lg"
              className="h-11 px-8 gap-2"
              onClick={handleAnalyze}
            >
              <Sparkles className="h-4 w-4" />
              Begin Analysis
            </Button>
          </div>
        </div>
      ) : isLoading || isFetching ? (
        <div className="glass-panel rounded-lg p-16 text-center">
          <div className="max-w-md mx-auto space-y-6">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto animate-pulse">
              <Brain className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                <span className="text-sm font-medium text-primary">
                  Consulting the Path of Wisdom...
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Analyzing products, processing market data, and generating strategic recommendations
              </p>
            </div>
          </div>
        </div>
      ) : wisdomData?.error ? (
        <div className="glass-panel rounded-lg p-12 text-center">
          <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">{wisdomData.error}</p>
          <Button variant="outline" size="sm" onClick={handleRerun}>
            Try Again
          </Button>
        </div>
      ) : wisdomData?.analysis ? (
        <div className="space-y-6">
          {/* Summary Card */}
          <div className="glass-panel rounded-lg overflow-hidden border border-primary/10">
            <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">Executive Summary</h3>
              <Badge variant="outline" className="ml-auto text-[10px] font-mono">
                {wisdomData.productCount} products
              </Badge>
            </div>
            <div className="p-5">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {wisdomData.analysis.summary}
              </p>
            </div>
          </div>

          {/* Market Context */}
          <div className="glass-panel rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">Market Landscape</h3>
            </div>
            <div className="p-5">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {wisdomData.analysis.overallMarketContext}
              </p>
            </div>
          </div>

          {/* Opportunities & Risks */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="glass-panel rounded-lg overflow-hidden border border-[#21a732]/20">
              <div className="px-5 py-3 border-b border-white/[0.04] bg-[#21a732]/5 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-[#21a732]" />
                <h3 className="text-[14px] font-semibold text-[#21a732]">
                  Top Opportunities
                </h3>
              </div>
              <div className="divide-y divide-outline-variant/20">
                {wisdomData.analysis.topOpportunities.map((item, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-3">
                    <span className="h-5 w-5 rounded-full bg-[#21a732]/10 text-[#21a732] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {item}
                    </p>
                  </div>
                ))}
                {wisdomData.analysis.topOpportunities.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No specific opportunities identified
                  </div>
                )}
              </div>
            </div>

            <div className="glass-panel rounded-lg overflow-hidden border border-[#93000a]/20">
              <div className="px-5 py-3 border-b border-white/[0.04] bg-[#93000a]/5 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#ffb4ab]" />
                <h3 className="text-[14px] font-semibold text-[#ffb4ab]">
                  Key Risks
                </h3>
              </div>
              <div className="divide-y divide-outline-variant/20">
                {wisdomData.analysis.keyRisks.map((item, i) => (
                  <div key={i} className="px-5 py-3 flex items-start gap-3">
                    <span className="h-5 w-5 rounded-full bg-[#93000a]/15 text-[#ffb4ab] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {item}
                    </p>
                  </div>
                ))}
                {wisdomData.analysis.keyRisks.length === 0 && (
                  <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                    No risks identified
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Product Recommendations */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">
                Product Recommendations
              </h3>
              <Badge variant="outline" className="text-[10px] font-mono">
                {wisdomData.analysis.productRecommendations.length} products
              </Badge>
            </div>
            {wisdomData.analysis.productRecommendations.map((rec) => {
              const priceChange = rec.priceChange;
              const confidenceColor =
                rec.confidence === "high"
                  ? "text-[#21a732]"
                  : rec.confidence === "medium"
                    ? "text-yellow-400"
                    : "text-muted-foreground";
              return (
                <div
                  key={rec.productId}
                  className="glass-panel rounded-lg overflow-hidden"
                >
                  <div className="px-5 py-3 border-b border-white/[0.04] bg-surface-container/50 flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Target className="h-4 w-4 text-primary shrink-0" />
                      <h4 className="text-[13px] font-semibold truncate">
                        {rec.productTitle}
                      </h4>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold label-caps shrink-0 ml-2",
                        confidenceColor,
                        rec.confidence === "high"
                          ? "bg-[#21a732]/10"
                          : rec.confidence === "medium"
                            ? "bg-yellow-500/10"
                            : "bg-gray-500/10",
                        "border",
                        rec.confidence === "high"
                          ? "border-[#21a732]/30"
                          : rec.confidence === "medium"
                            ? "border-yellow-500/30"
                            : "border-gray-500/30"
                      )}
                    >
                      {rec.confidence.toUpperCase()}
                    </span>
                  </div>
                  <div className="p-5 space-y-4">
                    <div className="flex items-center gap-6 flex-wrap">
                      <div>
                        <p className="label-caps text-muted-foreground/60 text-[10px]">
                          Current Price
                        </p>
                        <p className="text-lg font-bold font-mono">
                          ${rec.currentPrice.toFixed(2)}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="label-caps text-muted-foreground/60 text-[10px]">
                          AI Recommended
                        </p>
                        <p className="text-lg font-bold font-mono text-primary">
                          ${rec.recommendedPrice.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {priceChange > 0 ? (
                          <TrendingUp className="h-4 w-4 text-[#ffb4ab]" />
                        ) : priceChange < 0 ? (
                          <TrendingDown className="h-4 w-4 text-[#21a732]" />
                        ) : (
                          <Minus className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span
                          className={cn(
                            "font-mono text-sm font-bold",
                            priceChange > 0
                              ? "text-[#ffb4ab]"
                              : priceChange < 0
                                ? "text-[#21a732]"
                                : "text-muted-foreground"
                          )}
                        >
                          {priceChange > 0 ? "+" : ""}
                          ${Math.abs(priceChange).toFixed(2)} (
                          {rec.priceChangePercent > 0 ? "+" : ""}
                          {rec.priceChangePercent.toFixed(1)}%)
                        </span>
                      </div>
                    </div>

                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {rec.reasoning}
                    </p>

                    {rec.marketContext && (
                      <div className="bg-surface-container-highest/50 rounded p-3">
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {rec.marketContext}
                        </p>
                      </div>
                    )}

                    {rec.riskFactors.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold label-caps text-muted-foreground/60">
                          Risks
                        </p>
                        {rec.riskFactors.map((risk, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <AlertTriangle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-muted-foreground">
                              {risk}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rerun */}
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={handleRerun}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Run Fresh Analysis
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}