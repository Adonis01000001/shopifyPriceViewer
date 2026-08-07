import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Check,
  CircleDollarSign,
  Eye,
  Globe2,
  LockKeyhole,
  Radar,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useProductAnalytics } from "@/lib/analytics";
import "./auth.css";

const benefits = [
  {
    icon: Radar,
    title: "A clear view of the market",
    description: "Track competitor movement without living in spreadsheets.",
  },
  {
    icon: BellRing,
    title: "Signals worth acting on",
    description: "Get alerts when a price move can affect your margin.",
  },
  {
    icon: CircleDollarSign,
    title: "Decisions with evidence",
    description: "See the context behind every pricing recommendation.",
  },
];

export default function Auth() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const track = useProductAnalytics();
  const utils = trpc.useUtils();

  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get(
      "oauth_error"
    );
    if (!oauthError) return;

    const messages: Record<string, string> = {
      google_not_configured: "Google sign-in is not configured yet.",
      google_cancelled: "Google sign-in was cancelled.",
      google_state_invalid: "Google sign-in expired. Please try again.",
      google_exchange_failed: "Google sign-in could not be completed.",
      google_identity_missing: "Google did not return an identity.",
      google_identity_invalid: "Google account verification failed.",
      google_database_unavailable: "Sign-in is temporarily unavailable.",
      google_account_failed: "We could not create your account.",
      google_login_failed: "Google sign-in failed. Please try again.",
    };
    toast.error(messages[oauthError] ?? "Google sign-in failed.");
    window.history.replaceState({}, document.title, "/auth");
  }, []);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("Welcome back");
      utils.auth.me.invalidate();
      navigate("/");
    },
    onError: error => {
      toast.error(error.message || "Login failed");
      setIsLoading(false);
    },
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("Your workspace is ready");
      track("signup_completed", { method: "email" });
      track("trial_started", { source: "registration" });
      utils.auth.me.invalidate();
      navigate("/");
    },
    onError: error => {
      toast.error(error.message || "Registration failed");
      setIsLoading(false);
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    if (mode === "login") {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ email, password, name });
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-story" aria-labelledby="auth-story-title">
          <div className="auth-brand-row">
            <span className="auth-brand-mark" aria-hidden="true">
              <BarChart3 className="h-5 w-5" />
            </span>
            <span>
              <span className="auth-brand-name">PriceIntel</span>
              <span className="auth-brand-caption">Decision studio</span>
            </span>
          </div>

          <div className="auth-story-content">
            <span className="auth-eyebrow">
              Pricing intelligence for Shopify
            </span>
            <h1 id="auth-story-title" className="auth-story-title">
              Make every price move intentional.
            </h1>
            <p className="auth-story-description">
              A focused workspace for seeing competitor movement, protecting
              margin, and acting before the market moves past you.
            </p>

            <div className="auth-stat-row" aria-label="Product capabilities">
              <div>
                <strong>24/7</strong>
                <span>market watch</span>
              </div>
              <div>
                <strong>1 view</strong>
                <span>to find your signal</span>
              </div>
              <div>
                <strong>5 min</strong>
                <span>to first insight</span>
              </div>
            </div>

            <ul className="auth-benefits">
              {benefits.map(benefit => {
                const Icon = benefit.icon;
                return (
                  <li key={benefit.title}>
                    <span className="auth-benefit-icon" aria-hidden="true">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <strong>{benefit.title}</strong>
                      <span>{benefit.description}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="auth-story-footer">
            <span>
              <Check className="h-3.5 w-3.5" /> No credit card required
            </span>
            <span>
              <LockKeyhole className="h-3.5 w-3.5" /> Secure workspace
            </span>
          </div>
        </section>

        <section className="auth-panel" aria-labelledby="auth-form-title">
          <div className="auth-panel-inner">
            <div className="auth-panel-header">
              <div className="auth-panel-icon" aria-hidden="true">
                <Eye className="h-4 w-4" />
              </div>
              <span className="auth-eyebrow">Your workspace awaits</span>
              <h2 id="auth-form-title">
                {mode === "login" ? "Welcome back" : "Start seeing the market"}
              </h2>
              <p>
                {mode === "login"
                  ? "Sign in to continue where you left off."
                  : "Create an account and see your first useful signal in minutes."}
              </p>
            </div>

            <div
              className="auth-tabs"
              role="group"
              aria-label="Account access mode"
            >
              <button
                type="button"
                aria-pressed={mode === "login"}
                className={mode === "login" ? "is-active" : ""}
                onClick={() => setMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                aria-pressed={mode === "register"}
                className={mode === "register" ? "is-active" : ""}
                onClick={() => setMode("register")}
              >
                Create account
              </button>
            </div>

            <button
              type="button"
              className="auth-google-button"
              onClick={() => window.location.assign("/api/oauth/google/start")}
            >
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              Continue with Google
            </button>

            <div className="auth-divider" aria-hidden="true">
              <span>or use email</span>
            </div>

            <form
              className="auth-form"
              onSubmit={handleSubmit}
              aria-busy={isLoading}
            >
              {mode === "register" && (
                <div className="auth-field">
                  <label htmlFor="auth-name">Full name</label>
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder="Jordan Lee"
                    autoComplete="name"
                    required
                  />
                </div>
              )}
              <div className="auth-field">
                <label htmlFor="auth-email">Email address</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="you@yourstore.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="auth-field">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="auth-password">Password</label>
                  {mode === "register" && <span>8+ characters</span>}
                </div>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  minLength={8}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                />
              </div>
              <button
                type="submit"
                className="auth-submit"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span
                    className="auth-spinner"
                    role="status"
                    aria-label="Working"
                  />
                ) : (
                  <>
                    {mode === "login" ? "Open workspace" : "Create workspace"}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="auth-switch">
              {mode === "login"
                ? "New to PriceIntel?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
              >
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
