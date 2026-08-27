import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/workspace/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const { data: user } = trpc.auth.me.useQuery();
  const { data: stores, refetch: refetchStores } =
    trpc.shopify.listStores.useQuery();
  const { data: notificationPreferences } =
    trpc.notifications.preferences.useQuery();
  const { theme, toggleTheme, switchable } = useTheme();
  const utils = trpc.useUtils();

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

  const { data: pricingRules } = trpc.account.pricingRules.useQuery();
  const [undercut, setUndercut] = useState("");
  const [minMargin, setMinMargin] = useState("");
  // The saved values arrive after first paint; fill the boxes once they do,
  // and never again, so typing is not overwritten by a refetch.
  useEffect(() => {
    if (!pricingRules) return;
    setUndercut(prev => (prev === "" ? String(pricingRules.undercutPercent) : prev));
    setMinMargin(prev =>
      prev === "" ? String(pricingRules.minMarginPercent) : prev
    );
  }, [pricingRules]);

  const updatePricingRules = trpc.account.updatePricingRules.useMutation({
    onSuccess: () => {
      utils.account.pricingRules.invalidate();
      utils.recommendations.list.invalidate();
      utils.pricingEngine.analyze.invalidate();
      toast.success("Saved. New suggestions will use these rules.");
    },
    onError: err => toast.error(err.message || "Could not save"),
  });

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");

  const allStores = stores ?? [];
  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Settings"
        description="Manage your account, connected stores, and preferences."
      />

      {/* Account Section */}
      <Card className="border-outline-variant/30">
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
          <p className="text-[12px] text-muted-foreground/60">
            Profile updates and password changes coming soon.
          </p>
        </CardContent>
      </Card>

      {/* How prices are worked out */}
      <Card className="border-outline-variant/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">
              How we work out a suggested price
            </CardTitle>
          </div>
          <CardDescription>
            Every suggestion follows these two rules, in this order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="undercut" className="text-sm">
                Aim this far below what other shops charge
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="undercut"
                  type="number"
                  step="0.5"
                  className="h-11 w-28 text-right font-mono"
                  value={undercut}
                  onChange={e => setUndercut(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  % under their average
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="min-margin" className="text-sm">
                Never leave less margin than this
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="min-margin"
                  type="number"
                  step="0.5"
                  className="h-11 w-28 text-right font-mono"
                  value={minMargin}
                  onChange={e => setMinMargin(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  % of the selling price
                </span>
              </div>
            </div>
          </div>

          <p className="rounded-lg bg-surface-container px-4 py-3 text-[14px] leading-relaxed text-muted-foreground">
            On a product costing $10 that rivals sell for $20 on average, we
            would suggest{" "}
            <span className="font-mono font-medium text-foreground">
              ${(20 * (1 - (Number(undercut) || 0) / 100)).toFixed(2)}
            </span>
            . We would never go below{" "}
            <span className="font-mono font-medium text-foreground">
              ${(10 / (1 - Math.min(Number(minMargin) || 0, 90) / 100)).toFixed(2)}
            </span>
            , which is what $10 of cost has to sell for to leave{" "}
            {Number(minMargin) || 0}% margin.
          </p>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              className="h-11"
              disabled={updatePricingRules.isPending}
              onClick={() =>
                updatePricingRules.mutate({
                  undercutPercent: Number(undercut),
                  minMarginPercent: Number(minMargin),
                })
              }
            >
              {updatePricingRules.isPending ? "Saving..." : "Save these rules"}
            </Button>
            <button
              type="button"
              className="text-[13px] text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setUndercut("5");
                setMinMargin("10");
              }}
            >
              Back to 5% and 10%
            </button>
          </div>
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
                      <p className="text-[14px] font-medium truncate">
                        {store.shopDomain || "Unknown store"}
                      </p>
                      <p
                        className={cn(
                          "text-[12px] label-caps",
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
          <p className="text-[12px] text-muted-foreground/60 mt-1">
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
