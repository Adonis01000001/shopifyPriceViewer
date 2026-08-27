import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useProductAnalytics } from "@/lib/analytics";

interface UpgradePromptProps {
  feature: string;
  plan: string;
  title: string;
  description: string;
  metric?: string;
}

export function UpgradePrompt({
  feature,
  plan,
  title,
  description,
  metric,
}: UpgradePromptProps) {
  const [, setLocation] = useLocation();
  const track = useProductAnalytics();
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    track("feature_upgrade_prompt_viewed", { feature, plan });
  }, [feature, plan, track]);

  return (
    <section className="glass-panel rounded-lg border border-primary/20 bg-primary/[0.06] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="label-caps text-[12px] text-primary">UNLOCK {plan}</p>
            <h3 className="mt-1 text-sm font-semibold">{title}</h3>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              {description}
            </p>
            {metric && (
              <p className="mt-2 text-[13px] font-medium text-primary">{metric}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
          onClick={() => {
            track("plan_selected", { plan, source: "contextual_upgrade_prompt", feature });
            setLocation("/settings#billing");
          }}
        >
          See how it pays off
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
