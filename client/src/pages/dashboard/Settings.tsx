import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import { Store, User, Bell, Palette, LogOut, Globe, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const { data: user } = trpc.auth.me.useQuery();
  const { data: stores, refetch: refetchStores } = trpc.shopify.listStores.useQuery();
  const { theme, toggleTheme, switchable } = useTheme();

  const disconnectMutation = trpc.shopify.disconnect.useMutation({
    onSuccess: () => {
      refetchStores();
      toast.success("Shopify store disconnected");
    },
    onError: (err) => toast.error(err.message || "Failed to disconnect"),
  });

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");

  const allStores = stores ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">Settings</h2>
        <p className="text-muted-foreground text-sm">
          Manage your account, connected stores, and preferences.
        </p>
      </div>

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
              <Label htmlFor="name" className="text-xs text-muted-foreground">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-surface-container border-outline-variant h-9"
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs text-muted-foreground">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                const confirmed = window.confirm("Are you sure you want to sign out?");
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
                    <div className={cn(
                      "w-8 h-8 rounded flex items-center justify-center text-xs font-bold shrink-0",
                      store.isActive
                        ? "bg-primary/15 text-primary"
                        : "bg-surface-container-highest text-muted-foreground"
                    )}>
                      {store.shopDomain?.charAt(0).toUpperCase() || "S"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium truncate">
                        {store.shopDomain || "Unknown store"}
                      </p>
                      <p className={cn(
                        "text-[10px] label-caps",
                        store.isActive ? "text-primary" : "text-muted-foreground"
                      )}>
                        {store.isActive ? "ACTIVE" : "INACTIVE"}
                        {store.lastSyncedAt && ` · Last sync: ${new Date(store.lastSyncedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => {
                      const confirmed = window.confirm(`Disconnect ${store.shopDomain}?`);
                      if (confirmed) disconnectMutation.mutate({ shopDomain: store.shopDomain });
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
            onClick={() => window.location.href = "/api/shopify/login"}
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
            <Switch defaultChecked disabled />
          </div>
          <Separator className="bg-outline-variant/20" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">In-App Alerts</p>
              <p className="text-xs text-muted-foreground">
                Show notifications in the dashboard
              </p>
            </div>
            <Switch defaultChecked disabled />
          </div>
          <Separator className="bg-outline-variant/20" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Price Drop Alerts</p>
              <p className="text-xs text-muted-foreground">
                Alert when competitor prices drop significantly
              </p>
            </div>
            <Switch defaultChecked disabled />
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Notification preferences management coming soon.
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
