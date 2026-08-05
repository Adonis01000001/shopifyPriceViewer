import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Auth from "./pages/Auth";
import { trpc } from "@/lib/trpc";

const Overview = lazy(() => import("./pages/dashboard/Overview"));
const Products = lazy(() => import("./pages/dashboard/Products"));
const ProductDetail = lazy(() => import("./pages/dashboard/ProductDetail"));
const Alerts = lazy(() => import("./pages/dashboard/Alerts"));
const Competitors = lazy(() => import("./pages/dashboard/Competitors"));
const Analytics = lazy(() => import("./pages/dashboard/Analytics"));
const PriceScout = lazy(() => import("./pages/dashboard/PriceScout"));
const PathOfWisdom = lazy(() => import("./pages/dashboard/PathOfWisdom"));
const PriceRadar = lazy(() => import("./pages/dashboard/PriceRadar"));
const Settings = lazy(() => import("./pages/dashboard/Settings"));

function DashboardPageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary"
        role="status"
        aria-label="Loading page"
      />
    </div>
  );
}

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
                  <Suspense fallback={<DashboardPageFallback />}>
                    <Switch>
                      <Route path="/" component={Overview} />
                      <Route path="/products" component={Products} />
                      <Route path="/products/:id" component={ProductDetail} />
                      <Route path="/scout" component={PriceScout} />
                      <Route path="/wisdom" component={PathOfWisdom} />
                      <Route path="/price-radar" component={PriceRadar} />
                      <Route path="/alerts" component={Alerts} />
                      <Route path="/competitors" component={Competitors} />
                      <Route path="/analytics" component={Analytics} />
                      <Route path="/settings" component={Settings} />
                      <Route component={NotFound} />
                    </Switch>
                  </Suspense>
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
