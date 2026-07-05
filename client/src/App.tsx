import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Overview from "./pages/dashboard/Overview";
import Products from "./pages/dashboard/Products";
import Alerts from "./pages/dashboard/Alerts";
import Competitors from "./pages/dashboard/Competitors";
import Analytics from "./pages/dashboard/Analytics";
import PriceScout from "./pages/dashboard/PriceScout";
import Settings from "./pages/dashboard/Settings";

import Auth from "./pages/Auth";
import { trpc } from "@/lib/trpc";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
  });

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background:
            "linear-gradient(135deg, #0f0b2e 0%, #1a1145 40%, #0d1b3e 100%)",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            border: "3px solid rgba(255,255,255,0.15)",
            borderTopColor: "#818cf8",
            borderRadius: "50%",
            animation: "auth-spin 0.7s linear infinite",
          }}
        />
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster position="top-right" richColors />
          <Switch>
            <Route path="/auth" component={Auth} />
            <Route>
              <AuthGuard>
                <DashboardLayout>
                  <Switch>
                    <Route path="/" component={Overview} />
                    <Route path="/products" component={Products} />
                    <Route path="/scout" component={PriceScout} />
                    <Route path="/alerts" component={Alerts} />
                    <Route path="/competitors" component={Competitors} />
                    <Route path="/analytics" component={Analytics} />
                    <Route path="/settings" component={Settings} />
                    <Route component={NotFound} />
                  </Switch>
                </DashboardLayout>
              </AuthGuard>
            </Route>
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
