import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Check, Search, X } from "lucide-react";

/**
 * The working behind a suggestion. The run narrates itself as it goes, and
 * this reads that narration back, so "we compared you against three shops"
 * can be checked rather than taken on trust.
 */

type Kind = "match" | "reject" | "look";

/** Read a step line for what it says happened, so it can carry a mark. */
function classify(detail: string): Kind {
  if (detail.includes("sells it for $")) return "match";
  if (
    detail.includes("sells something different") ||
    detail.includes("showed no price") ||
    detail.includes("could not be read") ||
    detail.includes("could not be read properly") ||
    detail.startsWith("Ignored an implausible") ||
    detail.startsWith("Discarded a price") ||
    detail.startsWith("No shops found")
  ) {
    return "reject";
  }
  return "look";
}

const MARK: Record<Kind, { icon: typeof Check; className: string }> = {
  match: { icon: Check, className: "text-[var(--success)]" },
  reject: { icon: X, className: "text-muted-foreground" },
  look: { icon: Search, className: "text-muted-foreground/60" },
};

export function ProductEvidence({ productId, storeId }: { productId: string; storeId?: string }) {
  const { data, isLoading } = trpc.pipeline.productEvidence.useQuery(
    { productId, storeId },
    { enabled: !!productId, staleTime: 1000 * 30 }
  );

  const steps = data?.steps ?? [];

  return (
    <div className="glass-panel overflow-hidden rounded-lg">
      <div className="flex items-center gap-2 bg-surface-container/50 px-5 py-3">
        <Search className="h-4 w-4 text-primary" />
        <h3 className="text-[15px] font-semibold">
          Everything we checked for this product
        </h3>
        {data?.checkedAt && (
          <span className="ml-auto text-[12px] text-muted-foreground">
            {new Date(data.checkedAt).toLocaleString()}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="px-5 py-8 text-center text-[14px] text-muted-foreground">
          Loading…
        </div>
      ) : steps.length === 0 ? (
        <div className="space-y-3 px-5 py-8 text-center text-[14px] text-muted-foreground">
          {data?.manualPriceAdded && (
            <p className="text-left text-[13px] text-amber-300">
              A price was added manually by the merchant. It has not been
              independently verified.
            </p>
          )}
          <p>
            This product has not been checked yet. It is checked once a day,
            and the shops we looked at will be listed here afterwards.
          </p>
        </div>
      ) : (
        <>
          {data?.manualPriceAdded && (
            <div className="border-b border-outline-variant/20 px-5 py-3 text-[13px] text-amber-300">
              Price added manually by the merchant — not independently
              verified.
            </div>
          )}
          <ol className="divide-y divide-outline-variant/20">
            {steps.map((s, i) => {
              const kind = classify(s.detail);
              const { icon: Icon, className } = MARK[kind];
              return (
                <li
                  key={`${s.at}-${i}`}
                  className="flex items-start gap-3 px-5 py-2.5"
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} />
                  <span
                    className={cn(
                      "text-[14px]",
                      kind === "match"
                        ? "font-medium"
                        : kind === "look"
                          ? "text-muted-foreground"
                          : ""
                    )}
                  >
                    {s.detail}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
