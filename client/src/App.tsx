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
const Settings = lazy(() => import("./pages/dashboard/Settings"));

function DashboardPageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6">
      <div
        className="w-full max-w-xl space-y-4"
        role="status"
        aria-label="Loading page"
      >
        <div className="h-3 w-28 animate-pulse rounded-full bg-primary/20" />
        <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-full bg-muted/70" />
        <div className="grid gap-4 pt-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-xl border border-border/70 bg-card/60"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div
          className="flex items-center gap-3"
          role="status"
          aria-label="Checking session"
        >
          <div className="h-9 w-9 animate-pulse rounded-xl bg-primary/15 ring-1 ring-primary/25" />
          <div className="space-y-2">
            <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-2 w-32 animate-pulse rounded-full bg-muted/70" />
          </div>
        </div>
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
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-right" richColors />
          <Switch>
            <Route path="/auth" component={Auth} />
            <Route>
              <AuthGuard>
                <DashboardLayout>
                  <Suspense fallback={<DashboardPageFallback />}>
                    <Switch>
                      <Route path="/dashboard/:connectionId/products/:id" component={ProductDetail} />
                      <Route path="/dashboard/:connectionId/products" component={Products} />
                      <Route path="/dashboard/:connectionId/alerts" component={Alerts} />
                      <Route path="/dashboard/:connectionId/competitors" component={Competitors} />
                      <Route path="/dashboard/:connectionId" component={Overview} />
                      <Route path="/" component={Overview} />
                      <Route path="/products" component={Products} />
                      <Route path="/products/:id" component={ProductDetail} />
                      <Route path="/alerts" component={Alerts} />
                      <Route path="/competitors" component={Competitors} />
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
