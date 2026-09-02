import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnMount: true,
      refetchOnWindowFocus: true,
    },
  },
});

let csrfToken: string | null = null;
let csrfTokenRequest: Promise<string> | null = null;
let sessionRefreshRequest: Promise<boolean> | null = null;
let sessionRefreshUnavailableUntil = 0;

const SESSION_REFRESH_COOLDOWN_MS = 5_000;

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (!csrfTokenRequest) {
    csrfTokenRequest = globalThis
      .fetch("/api/csrf-token", {
        credentials: "include",
        headers: { Accept: "application/json" },
      })
      .then(async response => {
        if (!response.ok) {
          throw new Error(
            "Unable to initialize CSRF protection (" + response.status + ")"
          );
        }
        const payload: unknown = await response.json();
        if (
          !payload ||
          typeof payload !== "object" ||
          typeof (payload as { csrfToken?: unknown }).csrfToken !== "string"
        ) {
          throw new Error("CSRF endpoint returned an invalid token");
        }
        csrfToken = (payload as { csrfToken: string }).csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfTokenRequest = null;
      });
  }
  return csrfTokenRequest;
}

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized =
    error.message === UNAUTHED_ERR_MSG || error.data?.code === "UNAUTHORIZED";

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

function isSessionRefreshRequest(input: RequestInfo | URL): boolean {
  const url = input instanceof Request ? input.url : String(input);
  return new URL(url, window.location.origin).pathname.endsWith(
    "/auth.refreshSession"
  );
}

async function refreshSession(): Promise<boolean> {
  const now = Date.now();
  if (now < sessionRefreshUnavailableUntil) return false;
  if (sessionRefreshRequest) return sessionRefreshRequest;

  sessionRefreshRequest = (async () => {
    try {
      const response = await globalThis.fetch("/api/trpc/auth.refreshSession", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({ json: null }),
      });

      if (response.ok) return true;

      // Avoid sending the same expired refresh token on every failed query.
      sessionRefreshUnavailableUntil = Date.now() + SESSION_REFRESH_COOLDOWN_MS;
      return false;
    } catch {
      sessionRefreshUnavailableUntil = Date.now() + SESSION_REFRESH_COOLDOWN_MS;
      return false;
    } finally {
      sessionRefreshRequest = null;
    }
  })();

  return sessionRefreshRequest;
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        const method = (init?.method ?? "GET").toUpperCase();
        const headers = new Headers(init?.headers);
        if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
          headers.set("x-csrf-token", await getCsrfToken());
        }

        const request = () =>
          globalThis.fetch(input instanceof Request ? input.clone() : input, {
            ...(init ?? {}),
            credentials: "include",
            headers,
          });

        const response = await request();
        if (
          response.status !== 401 ||
          isSessionRefreshRequest(input) ||
          typeof window === "undefined"
        ) {
          return response;
        }

        // A valid refresh token can outlive the short-lived access cookie.
        // Refresh once and replay the original request; protected procedures
        // remain protected throughout this recovery path.
        if (await refreshSession()) return request();
        return response;
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
