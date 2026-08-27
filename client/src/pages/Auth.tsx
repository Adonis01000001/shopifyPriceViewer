import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  Check,
  CircleDollarSign,
  Eye,
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

type AuthView = "account" | "forgot" | "reset";

export default function Auth() {
  const [, navigate] = useLocation();
  const initialResetToken =
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(
          window.location.hash.replace(/^#/, "")
        ).get("resetToken") ??
        new URLSearchParams(window.location.search).get("resetToken") ??
        "";
  const [authView, setAuthView] = useState<AuthView>(
    initialResetToken ? "reset" : "account"
  );
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetToken, setResetToken] = useState(initialResetToken);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] =
    useState("");
  const [resetRequested, setResetRequested] = useState(false);
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

  const requestPasswordResetMutation =
    trpc.auth.requestPasswordReset.useMutation({
      onSuccess: () => {
        setResetRequested(true);
      },
      onError: () => {
        toast.error("We could not process that request. Please try again.");
      },
    });

  const resetPasswordMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setAuthView("account");
      setResetToken("");
      setResetPasswordValue("");
      setResetPasswordConfirmation("");
      setPassword("");
      window.history.replaceState({}, document.title, "/auth");
      toast.success("Your password has been updated. You can sign in now.");
    },
    onError: error => {
      toast.error(error.message || "This reset link is invalid or expired.");
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

  const handleForgotSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    requestPasswordResetMutation.mutate({ email: forgotEmail });
  };

  const handleResetSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetPasswordValue !== resetPasswordConfirmation) {
      toast.error("The passwords do not match.");
      return;
    }
    if (!resetToken) {
      toast.error("This reset link is invalid or expired.");
      return;
    }
    resetPasswordMutation.mutate({
      token: resetToken,
      password: resetPasswordValue,
    });
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
              <span className="auth-brand-caption">Competitor pricing</span>
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
                {authView === "forgot"
                  ? "Recover your account"
                  : authView === "reset"
                    ? "Set a new password"
                    : mode === "login"
                      ? "Welcome back"
                      : "Start seeing the market"}
              </h2>
              <p>
                {authView === "forgot"
                  ? "Enter your email and we will send a secure recovery link."
                  : authView === "reset"
                    ? "Choose a new password for your PriceIntel account."
                    : mode === "login"
                      ? "Sign in to continue where you left off."
                      : "Create an account and see your first useful signal in minutes."}
              </p>
            </div>

            {authView === "account" && (
              <>
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
                  onClick={() =>
                    window.location.assign("/api/oauth/google/start")
                  }
                >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  fill="#4285F4"
                  d="M21.35 12.27c0-.79-.07-1.55-.23-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42Z"
                />
                <path
                  fill="#34A853"
                  d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.5Z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.54 13.58a5.85 5.85 0 0 1 0-3.16V7.89H3.29a9.74 9.74 0 0 0 0 8.22l3.25-2.53Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6.39c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.47 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.71 5.39l3.25 2.53C7.31 8.11 9.46 6.39 12 6.39Z"
                />
              </svg>
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
                    <div className="auth-field-heading">
                      <label htmlFor="auth-password">Password</label>
                      {mode === "login" ? (
                        <button
                          type="button"
                          className="auth-inline-action"
                          onClick={() => {
                            setForgotEmail(email);
                            setResetRequested(false);
                            setAuthView("forgot");
                          }}
                        >
                          Forgot password?
                        </button>
                      ) : (
                        <span>8+ characters</span>
                      )}
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
                        {mode === "login"
                          ? "Open workspace"
                          : "Create workspace"}
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
                    onClick={() =>
                      setMode(mode === "login" ? "register" : "login")
                    }
                  >
                    {mode === "login" ? "Create an account" : "Sign in"}
                  </button>
                </p>
              </>
            )}

            {authView === "forgot" && (
              <div className="auth-recovery-flow">
                {resetRequested ? (
                  <div className="auth-success-panel" role="status">
                    <strong>Check your inbox</strong>
                    <p>
                      If an account exists for that email, you will receive a
                      secure reset link shortly.
                    </p>
                  </div>
                ) : (
                  <form
                    className="auth-form"
                    onSubmit={handleForgotSubmit}
                    aria-busy={requestPasswordResetMutation.isPending}
                  >
                    <div className="auth-field">
                      <label htmlFor="forgot-email">Email address</label>
                      <input
                        id="forgot-email"
                        type="email"
                        value={forgotEmail}
                        onChange={event => setForgotEmail(event.target.value)}
                        placeholder="you@yourstore.com"
                        autoComplete="email"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className="auth-submit"
                      disabled={requestPasswordResetMutation.isPending}
                    >
                      {requestPasswordResetMutation.isPending ? (
                        <span
                          className="auth-spinner"
                          role="status"
                          aria-label="Sending reset link"
                        />
                      ) : (
                        <>
                          Email me a reset link
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  </form>
                )}
                <button
                  type="button"
                  className="auth-back-button"
                  onClick={() => setAuthView("account")}
                >
                  Back to sign in
                </button>
              </div>
            )}

            {authView === "reset" && (
              <div className="auth-recovery-flow">
                <form
                  className="auth-form"
                  onSubmit={handleResetSubmit}
                  aria-busy={resetPasswordMutation.isPending}
                >
                  <div className="auth-field">
                    <label htmlFor="reset-password">New password</label>
                    <input
                      id="reset-password"
                      type="password"
                      value={resetPasswordValue}
                      onChange={event =>
                        setResetPasswordValue(event.target.value)
                      }
                      placeholder="At least 8 characters"
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label htmlFor="reset-password-confirmation">
                      Confirm new password
                    </label>
                    <input
                      id="reset-password-confirmation"
                      type="password"
                      value={resetPasswordConfirmation}
                      onChange={event =>
                        setResetPasswordConfirmation(event.target.value)
                      }
                      placeholder="Repeat your new password"
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={resetPasswordMutation.isPending}
                  >
                    {resetPasswordMutation.isPending ? (
                      <span
                        className="auth-spinner"
                        role="status"
                        aria-label="Updating password"
                      />
                    ) : (
                      <>
                        Update password
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
                <button
                  type="button"
                  className="auth-back-button"
                  onClick={() => {
                    setAuthView("account");
                    setResetToken("");
                    window.history.replaceState({}, document.title, "/auth");
                  }}
                >
                  Back to sign in
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
