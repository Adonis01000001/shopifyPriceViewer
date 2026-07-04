import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TypewriterEffectSmooth } from "@/components/ui/typewriter-effect";
import "./auth.css";

export default function Auth() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("Welcome back!");
      utils.auth.me.invalidate();
      navigate("/");
    },
    onError: err => {
      toast.error(err.message || "Login failed");
      setIsLoading(false);
    },
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("Account created successfully!");
      utils.auth.me.invalidate();
      navigate("/");
    },
    onError: err => {
      toast.error(err.message || "Registration failed");
      setIsLoading(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (mode === "login") {
      loginMutation.mutate({ email, password });
    } else {
      registerMutation.mutate({ email, password, name });
    }
  };

  return (
    <div className="auth-page">
      {/* Gradient mesh background */}
      <div className="auth-bg">
        <div className="auth-bg-orb auth-bg-orb--1" />
        <div className="auth-bg-orb auth-bg-orb--2" />
        <div className="auth-bg-orb auth-bg-orb--3" />
      </div>

      {/* Grid pattern overlay */}
      <div className="auth-grid" />

      {/* Floating glass decorations */}
      <div className="auth-glass-decoration auth-glass-decoration--1" />
      <div className="auth-glass-decoration auth-glass-decoration--2" />

      <div className="auth-container">
        {/* Left branding panel — glass */}
        <div className="auth-branding">
          <div className="auth-branding__content">
            <div className="auth-logo">
              <svg
                viewBox="0 0 36 36"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="auth-logo__icon"
              >
                <rect
                  width="36"
                  height="36"
                  rx="9"
                  fill="var(--color-primary)"
                />
                <path
                  d="M10 25V14l8-5 8 5v11l-7 4-9-3z"
                  fill="var(--color-primary-foreground)"
                  fillOpacity="0.9"
                />
                <path
                  d="M18 9v20M10 14l8 7 8-7"
                  stroke="var(--color-primary-foreground)"
                  strokeOpacity="0.3"
                  strokeWidth="1.2"
                />
              </svg>
              <span className="auth-logo__text">PriceVision</span>
            </div>

            <TypewriterEffectSmooth
              words={[
                { text: "Track" },
                { text: "competitor" },
                { text: "prices" },
                {
                  text: "effortlessly",
                  style: { color: "var(--color-tertiary)" },
                },
              ]}
              className="auth-branding__typewriter"
            />

            <p className="auth-branding__desc">
              AI-powered pricing intelligence for your Shopify store. Monitor,
              analyze, and optimize — all in real-time.
            </p>

            <div className="auth-branding__features">
              <div className="auth-feature">
                <div className="auth-feature__icon" aria-hidden="true">
                  <svg
                    className="auth-feature__svg"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 10h4l3-6 4 8 3-2h4"
                      stroke="var(--color-primary)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div>
                  <div className="auth-feature__title">Real-time Tracking</div>
                  <div className="auth-feature__desc">
                    Monitor competitor prices as they change
                  </div>
                </div>
              </div>
              <div className="auth-feature">
                <div className="auth-feature__icon" aria-hidden="true">
                  <svg
                    className="auth-feature__svg"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      stroke="var(--color-tertiary)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M10 6v4l2.5 2.5"
                      stroke="var(--color-tertiary)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <div className="auth-feature__title">AI Recommendations</div>
                  <div className="auth-feature__desc">
                    Get smart pricing suggestions instantly
                  </div>
                </div>
              </div>
              <div className="auth-feature">
                <div className="auth-feature__icon" aria-hidden="true">
                  <svg
                    className="auth-feature__svg"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M4 6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V6z"
                      stroke="var(--color-primary)"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M8 9h4M8 12h4"
                      stroke="var(--color-primary)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
                <div>
                  <div className="auth-feature__title">Price Alerts</div>
                  <div className="auth-feature__desc">
                    Notified the moment competitors adjust
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right form panel — glass */}
        <div className="auth-form-panel">
          <div className="auth-form-wrapper">
            <div className="auth-form-header">
              <h2 className="auth-form-header__title">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="auth-form-header__subtitle">
                {mode === "login"
                  ? "Sign in to your PriceVision dashboard"
                  : "Start your pricing intelligence journey"}
              </p>
            </div>

            {/* Tab selector */}
            <div className="auth-tabs" role="tablist">
              <button
                className={`auth-tab ${mode === "login" ? "auth-tab--active" : ""}`}
                onClick={() => setMode("login")}
                type="button"
                role="tab"
                aria-selected={mode === "login"}
              >
                Sign In
              </button>
              <button
                className={`auth-tab ${mode === "register" ? "auth-tab--active" : ""}`}
                onClick={() => setMode("register")}
                type="button"
                role="tab"
                aria-selected={mode === "register"}
              >
                Sign Up
              </button>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              {mode === "register" && (
                <div className="auth-field">
                  <label className="auth-label" htmlFor="auth-name">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    className="auth-input"
                    type="text"
                    placeholder="John Doe"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>
              )}

              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-email">
                  Email Address
                </label>
                <input
                  id="auth-email"
                  className="auth-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-password">
                  Password
                </label>
                <input
                  id="auth-password"
                  className="auth-input"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
                {mode === "register" && (
                  <span className="auth-hint">Minimum 8 characters</span>
                )}
              </div>

              <button
                className="auth-submit"
                type="submit"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="auth-submit__loader" />
                ) : mode === "login" ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </button>
            </form>

            <p className="auth-footer">
              {mode === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    className="auth-link"
                    onClick={() => setMode("register")}
                    type="button"
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    className="auth-link"
                    onClick={() => setMode("login")}
                    type="button"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
