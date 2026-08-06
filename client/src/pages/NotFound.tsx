import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-4 py-10 sm:px-6">
      <Card
        className="glass-card w-full max-w-lg rounded-2xl border-0"
        aria-labelledby="not-found-title"
      >
        <CardContent className="p-8 text-center sm:p-12">
          <div className="flex justify-center mb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
              <AlertCircle className="h-8 w-8 text-primary" />
            </div>
          </div>

          <p className="page-kicker">Navigation error</p>
          <h1 id="not-found-title" className="page-title">
            Page not found
          </h1>

          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            Sorry, the page you are looking for doesn't exist. It may have been
            moved or deleted.
          </p>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              type="button"
              className="px-6 shadow-lg shadow-primary/15"
            >
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
