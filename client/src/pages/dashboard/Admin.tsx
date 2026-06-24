import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Admin() {
  const [result, setResult] = useState<{ usersProcessed: number; recommendationsGenerated: number; errors: number } | null>(null);
  const generateAll = trpc.recommendations.generateAll.useMutation({
    onSuccess: (data) => {
      setResult(data);
      toast.success(`Generated ${data.recommendationsGenerated} recommendations across ${data.usersProcessed} users`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to generate recommendations");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">Admin Panel</h2>
        <p className="text-muted-foreground text-sm max-w-2xl">
          System-wide operations and maintenance tools.
        </p>
      </div>

      <div className="glass-panel rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold">Bulk Recommendation Generation</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Generate pricing recommendations for all products across all user accounts using existing competitor price data.
            </p>
          </div>
          <button
            className="px-4 py-2 bg-primary text-primary-foreground text-xs font-bold label-caps rounded hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => generateAll.mutate()}
            disabled={generateAll.isPending}
          >
            {generateAll.isPending ? "GENERATING..." : "GENERATE ALL RECOMMENDATIONS"}
          </button>
        </div>

        {result && (
          <div className="mt-4 p-4 rounded-lg bg-surface-container/50 border border-outline-variant">
            <h4 className="text-sm font-semibold mb-2">Results</h4>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold font-mono text-primary">{result.usersProcessed}</p>
                <p className="text-[10px] label-caps text-muted-foreground">Users Processed</p>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-[#21a732]">{result.recommendationsGenerated}</p>
                <p className="text-[10px] label-caps text-muted-foreground">Recommendations Generated</p>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono text-[#ffb4ab]">{result.errors}</p>
                <p className="text-[10px] label-caps text-muted-foreground">Errors</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
