import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Store,
  Package,
  Users,
  ArrowRight,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useProductAnalytics } from "@/lib/analytics";

const steps = [
  {
    id: "shopify",
    title: "Connect your Shopify store",
    description: "Sync your products and start monitoring prices in minutes.",
    icon: Store,
    action: "Connect Shopify",
    color: "text-primary bg-primary/10 border-primary/20",
  },
  {
    id: "products",
    title: "Import your products",
    description: "Choose which products to track and set target prices.",
    icon: Package,
    action: "Sync Products",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  },
  {
    id: "competitor",
    title: "Add your first competitor",
    description: "Monitor competitor pricing to stay ahead of the market.",
    icon: Users,
    action: "Add Competitor",
    color:
      "text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/20",
  },
];

interface OnboardingWizardProps {
  open: boolean;
  stores: Array<{ id: string; isActive: boolean }>;
  productCount: number;
  competitorCount: number;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export default function OnboardingWizard({
  open,
  stores,
  productCount,
  competitorCount,
  onOpenChange,
  onComplete,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [manuallyCompleted, setManuallyCompleted] = useState<Set<string>>(
    new Set()
  );
  const completionEventsSent = useRef<Set<string>>(new Set());
  const utils = trpc.useUtils();
  const track = useProductAnalytics();

  const completed = useMemo(() => {
    const ids = new Set(manuallyCompleted);
    if (stores.some(store => store.isActive)) ids.add("shopify");
    if (productCount > 0) ids.add("products");
    if (competitorCount > 0) ids.add("competitor");
    return ids;
  }, [competitorCount, manuallyCompleted, productCount, stores]);

  const firstIncompleteStep = steps.findIndex(item => !completed.has(item.id));
  const allStepsComplete = firstIncompleteStep === -1;

  useEffect(() => {
    if (!open || allStepsComplete) return;
    setStep(currentStep =>
      currentStep === firstIncompleteStep ? currentStep : firstIncompleteStep
    );
  }, [allStepsComplete, firstIncompleteStep, open]);

  useEffect(() => {
    if (!open) return;
    for (const item of steps) {
      if (
        !completed.has(item.id) ||
        completionEventsSent.current.has(item.id)
      ) {
        continue;
      }
      completionEventsSent.current.add(item.id);
      track("onboarding_step_completed", { step: item.id });
    }
  }, [completed, open, track]);

  const syncMutation = trpc.shopify.syncProducts.useMutation({
    onSuccess: data => {
      toast.success(data.message || `Synced ${data.synced} products`);
      setManuallyCompleted(prev => new Set(prev).add("products"));
      utils.products.list.invalidate();
    },
    onError: err => toast.error(err.message || "Sync failed"),
  });

  const handleConnectShopify = () => {
    track("onboarding_step_started", { step: "shopify" });
    window.location.href = "/api/shopify/login";
  };

  const handleSyncProducts = () => {
    const activeStore = stores.find(store => store.isActive);
    if (!activeStore) {
      toast.error("No active store found. Connect a Shopify store first.");
      return;
    }
    track("onboarding_step_started", { step: "products" });
    syncMutation.mutate({ storeId: activeStore.id });
  };

  const handleAddCompetitor = () => {
    track("onboarding_step_started", { step: "competitor" });
    window.location.href = "/competitors?onboarding=1";
  };

  const current = steps[step];
  const StepIcon = current.icon;
  const isCompleted = completed.has(current.id);

  const handleNext = () => {
    if (!isCompleted) return;
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      track("first_value_reached", {
        activation_path: "shopify_products_competitor",
      });
      onComplete();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]" showCloseButton={false}>
        <DialogHeader>
          <p className="label-caps text-[10px] text-primary">
            Get your first pricing signal in under 5 minutes
          </p>
          <div className="flex items-center gap-2 mb-1">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                    i === step
                      ? "bg-primary text-primary-foreground"
                      : i < step
                        ? "bg-[var(--success)] text-white"
                        : "bg-surface-container-highest text-muted-foreground"
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={cn(
                      "w-12 h-0.5",
                      i < step
                        ? "bg-[var(--success)]"
                        : "bg-surface-container-highest"
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogTitle className="text-lg mt-3">{current.title}</DialogTitle>
          <DialogDescription className="text-sm">
            {current.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center py-6">
          <div
            className={cn(
              "w-20 h-20 rounded-2xl flex items-center justify-center border-2 mb-4",
              current.color
            )}
          >
            <StepIcon className="h-8 w-8" />
          </div>

          <div className="text-center max-w-sm">
            {step === 0 && (
              <p className="text-xs text-muted-foreground">
                Authorize PriceVision to access your Shopify store. We only read
                product and pricing data — we never modify your store without
                your approval.
              </p>
            )}
            {step === 1 && (
              <p className="text-xs text-muted-foreground">
                We&apos;ll import your product catalog from Shopify. You can
                then select which products to actively monitor and track.
              </p>
            )}
            {step === 2 && (
              <p className="text-xs text-muted-foreground">
                Enter the website domain of a competitor. Our AI will discover
                their products and match them to yours automatically.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/70 mt-4">
              {completed.size} of {steps.length} setup steps complete. You can
              leave and resume this checklist any time.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-outline-variant/20">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground text-xs"
          >
            Skip for now
          </Button>
          <div className="flex items-center gap-2">
            {!isCompleted ? (
              <Button
                size="sm"
                className="bg-primary text-primary-foreground text-xs"
                onClick={() => {
                  if (step === 0) handleConnectShopify();
                  else if (step === 1) handleSyncProducts();
                  else if (step === 2) handleAddCompetitor();
                }}
                disabled={step === 1 ? syncMutation.isPending : false}
              >
                {step === 1 && syncMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Syncing...
                  </>
                ) : (
                  <>{current.action}</>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="border-outline-variant text-xs"
                onClick={handleNext}
              >
                {step < steps.length - 1 ? "Continue" : "See your dashboard"}
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
