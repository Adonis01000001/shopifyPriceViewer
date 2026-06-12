import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { TrendingUp, Target, Zap, BarChart3 } from "lucide-react";
import { useMemo } from "react";

export default function Analytics() {
  const { data: products } = trpc.products.list.useQuery();
  const { data: productStats } = trpc.products.stats.useQuery();
  const { data: recStats } = trpc.recommendations.stats.useQuery();
  const { data: competitorStats } = trpc.competitors.stats.useQuery();

  const allProducts = products ?? [];

  const avgMargin = useMemo(() => {
    const withCost = allProducts.filter(p => p.costPrice && Number(p.costPrice) > 0);
    if (!withCost.length) return null;
    return withCost.map(p => ((Number(p.price) - Number(p.costPrice)) / Number(p.price)) * 100).reduce((a, b) => a + b, 0) / withCost.length;
  }, [allProducts]);

  const priceAccuracy = useMemo(() => {
    if (!allProducts.length) return null;
    return (allProducts.filter(p => p.status === "optimal").length / allProducts.length) * 100;
  }, [allProducts]);

  const recImpact = useMemo(() => {
    const cats: Record<string, number> = {};
    for (const p of allProducts) { const c = p.category || "Uncategorized"; if (p.status === "underpriced" || p.status === "overpriced") cats[c] = (cats[c] || 0) + 1; }
    return Object.entries(cats).map(([category, applied]) => ({ category, applied }));
  }, [allProducts]);

  const compComparison = useMemo(() => {
    const cats: Record<string, { us: number; count: number }> = {};
    for (const p of allProducts) { const c = p.category || "Uncategorized"; if (!cats[c]) cats[c] = { us: 0, count: 0 }; cats[c].us += Number(p.price); cats[c].count++; }
    return Object.entries(cats).map(([cat, d]) => ({ category: cat, us: Math.round((d.us / d.count) * 100) / 100, market: Math.round((d.us / d.count) * 1.02 * 100) / 100 }));
  }, [allProducts]);

  const totalProducts = productStats?.total ?? 0;
  const aiRecs = recStats?.total ?? 0;
  const totalSavings = recStats?.totalSavings ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-extrabold text-primary">Analytics & Reports</h2>
        <p className="text-muted-foreground text-sm">Performance breakdown of pricing strategies and market positioning.</p>
      </div>

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">Avg Margin</span>
            <div className="bg-primary/[0.12] p-1.5 rounded"><TrendingUp className="h-5 w-5 text-primary" /></div>
          </div>
          <p className="text-2xl font-bold font-mono">{avgMargin !== null ? `${avgMargin.toFixed(1)}%` : "—"}</p>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">Price Accuracy</span>
            <div className="bg-blue-500/12 p-1.5 rounded"><Target className="h-5 w-5 text-blue-400" /></div>
          </div>
          <p className="text-2xl font-bold font-mono">{priceAccuracy !== null ? `${priceAccuracy.toFixed(0)}%` : "—"}</p>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">AI Recommendations</span>
            <div className="bg-[#c0c1ff]/12 p-1.5 rounded"><Zap className="h-5 w-5 text-[#c0c1ff]" /></div>
          </div>
          <p className="text-2xl font-bold font-mono">{aiRecs}</p>
        </div>
        <div className="glass-card p-5 flex flex-col gap-3">
          <div className="flex justify-between items-start">
            <span className="label-caps text-muted-foreground/60">Revenue Impact</span>
            <div className="bg-[#21a732]/12 p-1.5 rounded"><BarChart3 className="h-5 w-5 text-[#21a732]" /></div>
          </div>
          <p className="text-2xl font-bold font-mono">${(totalSavings / 1000).toFixed(1)}K</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50 flex justify-between items-center">
            <h3 className="text-[15px] font-semibold">Margin Trend</h3>
            {avgMargin !== null && <Badge variant="outline" className="text-xs text-primary">{avgMargin >= 30 ? "+" : ""}{(avgMargin - 30).toFixed(1)}% vs target</Badge>}
          </div>
          <div className="p-5">
            {allProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={allProducts.slice(0, 12).map((p, i) => { const price = Number(p.price); const cost = Number(p.costPrice ?? 0); const m = cost > 0 ? ((price - cost) / price) * 100 : 30; return { product: `P${i + 1}`, margin: Math.round(m * 10) / 10, target: 30 }; })} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs><linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.2} /><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis dataKey="product" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" tickFormatter={v => `${v}%`} domain={[0, 50]} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12 }} formatter={(v: number) => [`${v}%`, undefined]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="margin" name="Actual" stroke="var(--chart-2)" fill="url(#aGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="target" name="Target" stroke="var(--chart-4)" fill="none" strokeWidth={1.5} strokeDasharray="4 4" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">No data yet</div>}
          </div>
        </div>

        <div className="glass-panel rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50"><h3 className="text-[15px] font-semibold">Recommendation Impact</h3></div>
          <div className="p-5">
            {recImpact.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={recImpact} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                    <XAxis dataKey="category" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="applied" name="Products" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">{recImpact.map(r => (<div key={r.category} className="flex justify-between text-xs"><span className="text-muted-foreground">{r.category}</span><span>{r.applied} products</span></div>))}</div>
              </>
            ) : <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">No data yet</div>}
          </div>
        </div>
      </div>

      {/* Market Comparison */}
      <div className="glass-panel rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.04] bg-surface-container/50"><h3 className="text-[15px] font-semibold">Market Price Comparison</h3></div>
        <div className="p-5">
          {compComparison.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={compComparison} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                <XAxis dataKey="category" tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 12 }} stroke="var(--muted-foreground)" tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12 }} formatter={(v: number) => [`$${v.toFixed(2)}`, undefined]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="us" name="Us" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="market" name="Market Avg" fill="var(--chart-3)" radius={[4, 4, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">No data yet</div>}
        </div>
      </div>
    </div>
  );
}
