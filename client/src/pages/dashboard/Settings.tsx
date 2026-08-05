import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Store,
  User,
  Bell,
  Palette,
  LogOut,
  Globe,
  Trash2,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { useProductAnalytics } from "@/lib/analytics";

export default function Settings() {
  const { data: user } = trpc.auth.me.useQuery();
  const { data: stores, refetch: refetchStores } =
    trpc.shopify.listStores.useQuery();
  const { data: notificationPreferences } =
    trpc.notifications.preferences.useQuery();
  const { data: accountUsage } = trpc.account.usage.useQuery();
  const { data: billingStatus, refetch: refetchBilling } =
    trpc.billing.status.useQuery();
  const { data: planCatalog } = trpc.account.plans.useQuery();
  const { theme, toggleTheme, switchable } = useTheme();
  const utils = trpc.useUtils();
  const track = useProductAnalytics();

  const updateNotificationPreferences =
    trpc.notifications.updatePreferences.useMutation({
      onSuccess: () => {
        utils.notifications.preferences.invalidate();
      },
      onError: error =>
        toast.error(error.message || "Failed to update preferences"),
    });

  const disconnectMutation = trpc.shopify.disconnect.useMutation({
    onSuccess: () => {
      refetchStores();
      toast.success("Shopify store disconnected");
    },
    onError: err => toast.error(err.message || "Failed to disconnect"),
  });

  const checkoutMutation = trpc.billing.checkout.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
    onError: error => toast.error(error.message || "Unable to start checkout"),
  });
  const portalMutation = trpc.billing.portal.useMutation({
    onSuccess: ({ url }) => window.location.assign(url),
    onError: error => toast.error(error.message || "Unable to open billing portal"),
  });
  const cancelMutation = trpc.billing.cancel.useMutation({
    onSuccess: async result => {
      await refetchBilling();
      track("subscription_cancelled", {
        cancel_at_period_end: result.cancelAtPeriodEnd,
      });
      toast.success(
        result.cancelAtPeriodEnd
          ? "Subscription scheduled to cancel at period end"
          : "Subscription cancellation reversed"
      );
    },
    onError: error => toast.error(error.message || "Unable to update subscription"),
  });

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");

  const allStores = stores ?? [];
  const usageItems = accountUsage
    ? [
        {
          label: "Products",
          used: accountUsage.usage.products,
          limit: accountUsage.limits.products,
          utilization: accountUsage.utilization.products,
        },
        {
          label: "Competitors",
          used: accountUsage.usage.competitors,
          limit: accountUsage.limits.competitors,
          utilization: accountUsage.utilization.competitors,
        },
        {
          label: "Price Radar sources",
          used: accountUsage.usage.radarSources,
          limit: accountUsage.limits.radarSources,
          utilization: accountUsage.utilization.radarSources,
        },
      ]
    : [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage your account, connected stores, and preferences.
        </p>
      </div>

      {/* Account Section */}
      <Card id="billing" className="border-outline-variant/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Account</CardTitle>
          </div>
          <CardDescription>
            Your profile information and sign-out options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs text-muted-foreground">
                Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="bg-surface-container border-outline-variant h-9"
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="bg-surface-container border-outline-variant h-9"
                placeholder="your@email.com"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-primary text-primary-foreground text-xs"
              disabled
            >
              Save Changes
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-outline-variant text-xs text-destructive hover:text-destructive"
              onClick={() => {
                const confirmed = window.confirm(
                  "Are you sure you want to sign out?"
                );
                if (confirmed) window.location.href = "/auth";
              }}
            >
              <LogOut className="h-3 w-3 mr-1" />
              Sign Out
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Profile updates and password changes coming soon.
          </p>
        </CardContent>
      </Card>

      {/* Plan and usage */}
      <Card className="border-outline-variant/30">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Billing & usage
                </span>
              </div>
              <CardTitle className="text-base">
                {accountUsage?.plan.name ?? "Account plan"}
              </CardTitle>
              <CardDescription>
                {accountUsage?.plan.description ??
                  "See the usage and capabilities that shape your next pricing decision."}
              </CardDescription>
            </div>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {accountUsage?.subscription.status ?? "trialing"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {usageItems.map(item => {
            const percent = Math.min(item.utilization * 100, 100);
            return (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-mono">
                    {item.used} / {item.limit ?? "∞"}
                  </span>
                </div>
                <Progress
                  value={percent}
                  className={percent >= 90 ? "bg-[#93000a]/20" : undefined}
                />
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            {billingStatus?.hasProviderSubscription ? (
              <Button
                size="sm"
                variant="outline"
                className="border-outline-variant text-xs"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
              >
                Manage billing
              </Button>
            ) : null}
            {billingStatus?.hasProviderSubscription ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-destructive hover:text-destructive"
                onClick={() =>
                  cancelMutation.mutate({
                    cancelAtPeriodEnd: !billingStatus.cancelAtPeriodEnd,
                  })
                }
                disabled={cancelMutation.isPending}
              >
                {billingStatus.cancelAtPeriodEnd
                  ? "Keep subscription"
                  : "Cancel at period end"}
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(planCatalog ?? [])
              .filter(plan => plan.id !== "free")
              .map(plan => {
                const isCurrent = billingStatus?.plan === plan.id;
                return (
                  <Button
                    key={plan.id}
                    size="sm"
                    variant={isCurrent ? "secondary" : "outline"}
                    className="h-auto min-h-14 justify-start border-outline-variant px-3 py-2 text-left"
                    disabled={
                      isCurrent ||
                      checkoutMutation.isPending ||
                      portalMutation.isPending
                    }
                    onClick={() => {
                      track("plan_selected", {
                        plan: plan.id,
                        source: "billing_settings",
                      });
                      if (billingStatus?.hasProviderSubscription) {
                        portalMutation.mutate();
                      } else {
                        track("checkout_started", {
                          plan: plan.id,
                          source: "billing_settings",
                        });
                        checkoutMutation.mutate({
                          plan: plan.id as "starter" | "pro" | "scale",
                        });
                      }
                    }}
                  >
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="text-xs font-semibold">
                        {isCurrent ? `${plan.name} plan` : `Choose ${plan.name}`}
                      </span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {isCurrent
                          ? "Current plan"
                          : billingStatus?.hasProviderSubscription
                            ? "Manage in Stripe"
                            : plan.description}
                      </span>
                    </span>
                  </Button>
                );
              })}
          </div>
          <p className="text-[10px] text-muted-foreground/60">
            Usage limits are enforced from the server-side plan catalog. Billing
            state is synchronized from verified payment-provider events.
          </p>
        </CardContent>
      </Card>

      {/* Shopify Connections */}
      <Card className="border-outline-variant/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Shopify Stores</CardTitle>
          </div>
          <CardDescription>
            Connect and manage your Shopify stores for product syncing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {allStores.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Store className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No stores connected</p>
              <p className="text-xs mt-1">
                Connect a Shopify store to start syncing products.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allStores.map((store: any) => (
                <div
                  key={store.id}
                  className="flex items-center justify-between p-3 bg-surface-container-low rounded-lg border border-outline-variant/20"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-8 h-8 rounded flex items-center justify-center text-xs font-bold shrink-0",
                        store.isActive
                          ? "bg-primary/15 text-primary"
                          : "bg-surface-container-highest text-muted-foreground"
                      )}
                    >
                      {store.shopDomain?.charAt(0).toUpperCase() || "S"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">
                        {store.shopDomain || "Unknown store"}
                      </p>
                      <p
                        className={cn(
                          "text-[10px] label-caps",
                          store.isActive
                            ? "text-primary"
                            : "text-muted-foreground"
                        )}
                      >
                        {store.isActive ? "ACTIVE" : "INACTIVE"}
                        {store.lastSyncedAt &&
                          ` · Last sync: ${new Date(store.lastSyncedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Disconnect ${store.shopDomain}?`
                      );
                      if (confirmed)
                        disconnectMutation.mutate({
                          shopDomain: store.shopDomain,
                        });
                    }}
                    disabled={disconnectMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="border-outline-variant text-xs"
            onClick={() => (window.location.href = "/api/shopify/login")}
          >
            <Globe className="h-3.5 w-3.5 mr-1.5" />
            Connect Shopify Store
          </Button>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card className="border-outline-variant/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Notifications</CardTitle>
          </div>
          <CardDescription>
            Configure how and when you receive price alerts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email Notifications</p>
              <p className="text-xs text-muted-foreground">
                Receive price alerts via email
              </p>
            </div>
            <Switch
              checked={notificationPreferences?.emailNotifications ?? true}
              onCheckedChange={emailNotifications =>
                updateNotificationPreferences.mutate({ emailNotifications })
              }
              disabled={updateNotificationPreferences.isPending}
            />
          </div>
          <Separator className="bg-outline-variant/20" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">In-App Alerts</p>
              <p className="text-xs text-muted-foreground">
                Show notifications in the dashboard
              </p>
            </div>
            <Switch
              checked={notificationPreferences?.inAppNotifications ?? true}
              onCheckedChange={inAppNotifications =>
                updateNotificationPreferences.mutate({ inAppNotifications })
              }
              disabled={updateNotificationPreferences.isPending}
            />
          </div>
          <Separator className="bg-outline-variant/20" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Alert Frequency</p>
              <p className="text-xs text-muted-foreground">
                Choose how often email alerts are grouped
              </p>
            </div>
            <Select
              value={notificationPreferences?.frequency ?? "daily"}
              onValueChange={frequency =>
                updateNotificationPreferences.mutate({
                  frequency: frequency as
                    | "realtime"
                    | "hourly"
                    | "daily"
                    | "weekly",
                })
              }
              disabled={updateNotificationPreferences.isPending}
            >
              <SelectTrigger className="h-8 w-[110px] bg-surface-container border-outline-variant text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="realtime">Realtime</SelectItem>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            In-app alerts are active now. SMTP-backed email delivery is staged
            for the notification worker rollout.
          </p>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card className="border-outline-variant/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Appearance</CardTitle>
          </div>
          <CardDescription>
            Customize the dashboard look and feel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {switchable && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-xs text-muted-foreground">
                  Toggle between light and dark theme
                </p>
              </div>
              <Switch
                checked={theme === "dark"}
                onCheckedChange={toggleTheme}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
