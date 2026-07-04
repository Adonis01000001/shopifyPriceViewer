// Mock data for the Shopify Price Intelligence dashboard

export const kpiData = {
  totalProducts: 1247,
  productsChange: 12.5,
  avgPrice: 47.99,
  avgPriceChange: -3.2,
  priceAlerts: 23,
  priceAlertsChange: 8,
  competitors: 156,
  competitorsChange: 4,
};

export const priceHistoryData = [
  { date: "Jan", ourPrice: 49.99, competitor: 52.99, market: 51.5 },
  { date: "Feb", ourPrice: 48.99, competitor: 51.99, market: 50.75 },
  { date: "Mar", ourPrice: 47.99, competitor: 50.99, market: 49.5 },
  { date: "Apr", ourPrice: 46.99, competitor: 49.99, market: 48.75 },
  { date: "May", ourPrice: 47.99, competitor: 48.99, market: 48.25 },
  { date: "Jun", ourPrice: 45.99, competitor: 47.99, market: 47.5 },
  { date: "Jul", ourPrice: 44.99, competitor: 46.99, market: 46.75 },
  { date: "Aug", ourPrice: 45.99, competitor: 47.49, market: 47.0 },
  { date: "Sep", ourPrice: 46.99, competitor: 48.99, market: 48.25 },
  { date: "Oct", ourPrice: 47.99, competitor: 49.99, market: 49.5 },
  { date: "Nov", ourPrice: 46.99, competitor: 48.49, market: 48.0 },
  { date: "Dec", ourPrice: 47.99, competitor: 49.99, market: 49.25 },
];

export const categoryDistribution = [
  { name: "Electronics", value: 35, color: "var(--chart-1)" },
  { name: "Clothing", value: 25, color: "var(--chart-2)" },
  { name: "Home & Garden", value: 20, color: "var(--chart-3)" },
  { name: "Sports", value: 12, color: "var(--chart-4)" },
  { name: "Other", value: 8, color: "var(--chart-5)" },
];

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  ourPrice: number;
  competitorPrice: number;
  marketAvg: number;
  status: "optimal" | "underpriced" | "overpriced" | "alert";
  lastUpdated: string;
  change: number;
}

export const products: Product[] = [
  {
    id: "1",
    name: "Wireless Bluetooth Headphones",
    sku: "WBH-001",
    category: "Electronics",
    ourPrice: 45.99,
    competitorPrice: 49.99,
    marketAvg: 47.5,
    status: "optimal",
    lastUpdated: "2026-05-15",
    change: -2.1,
  },
  {
    id: "2",
    name: "Premium Yoga Mat",
    sku: "PYM-042",
    category: "Sports",
    ourPrice: 29.99,
    competitorPrice: 24.99,
    marketAvg: 27.5,
    status: "overpriced",
    lastUpdated: "2026-05-15",
    change: 5.0,
  },
  {
    id: "3",
    name: "Smart LED Desk Lamp",
    sku: "SDL-103",
    category: "Electronics",
    ourPrice: 34.99,
    competitorPrice: 39.99,
    marketAvg: 37.0,
    status: "optimal",
    lastUpdated: "2026-05-14",
    change: -1.5,
  },
  {
    id: "4",
    name: "Organic Cotton T-Shirt",
    sku: "OCT-018",
    category: "Clothing",
    ourPrice: 19.99,
    competitorPrice: 18.99,
    marketAvg: 19.5,
    status: "optimal",
    lastUpdated: "2026-05-14",
    change: 0.5,
  },
  {
    id: "5",
    name: "Stainless Steel Water Bottle",
    sku: "SWB-067",
    category: "Sports",
    ourPrice: 22.99,
    competitorPrice: 19.99,
    marketAvg: 21.0,
    status: "overpriced",
    lastUpdated: "2026-05-13",
    change: 8.2,
  },
  {
    id: "6",
    name: "Ceramic Plant Pot Set",
    sku: "CPP-091",
    category: "Home & Garden",
    ourPrice: 38.99,
    competitorPrice: 42.99,
    marketAvg: 40.5,
    status: "optimal",
    lastUpdated: "2026-05-13",
    change: -3.0,
  },
  {
    id: "7",
    name: "USB-C Hub 7-in-1",
    sku: "UCH-055",
    category: "Electronics",
    ourPrice: 27.99,
    competitorPrice: 32.99,
    marketAvg: 30.0,
    status: "underpriced",
    lastUpdated: "2026-05-12",
    change: -12.5,
  },
  {
    id: "8",
    name: "Running Shoes Pro",
    sku: "RSP-029",
    category: "Sports",
    ourPrice: 89.99,
    competitorPrice: 79.99,
    marketAvg: 85.0,
    status: "alert",
    lastUpdated: "2026-05-15",
    change: 15.3,
  },
  {
    id: "9",
    name: "Linen Throw Blanket",
    sku: "LTB-073",
    category: "Home & Garden",
    ourPrice: 44.99,
    competitorPrice: 49.99,
    marketAvg: 47.0,
    status: "optimal",
    lastUpdated: "2026-05-11",
    change: -1.0,
  },
  {
    id: "10",
    name: "Denim Jacket Classic",
    sku: "DJC-014",
    category: "Clothing",
    ourPrice: 59.99,
    competitorPrice: 54.99,
    marketAvg: 57.5,
    status: "optimal",
    lastUpdated: "2026-05-10",
    change: 2.5,
  },
  {
    id: "11",
    name: "Portable Power Bank 20K",
    sku: "PPB-088",
    category: "Electronics",
    ourPrice: 32.99,
    competitorPrice: 35.99,
    marketAvg: 34.5,
    status: "optimal",
    lastUpdated: "2026-05-15",
    change: -4.2,
  },
  {
    id: "12",
    name: "Bamboo Cutting Board",
    sku: "BCB-036",
    category: "Home & Garden",
    ourPrice: 18.99,
    competitorPrice: 16.99,
    marketAvg: 17.5,
    status: "overpriced",
    lastUpdated: "2026-05-09",
    change: 6.8,
  },
];

export interface PriceAlert {
  id: string;
  product: string;
  type: "price_drop" | "price_increase" | "competitor_change" | "threshold";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  timestamp: string;
  resolved: boolean;
}

export const priceAlerts: PriceAlert[] = [
  {
    id: "a1",
    product: "Running Shoes Pro",
    type: "price_increase",
    severity: "critical",
    message:
      "Competitor raised price by 15.3% — opportunity to increase margin",
    timestamp: "2026-05-15T10:30:00",
    resolved: false,
  },
  {
    id: "a2",
    product: "USB-C Hub 7-in-1",
    type: "threshold",
    severity: "high",
    message: "Our price is 12.5% below market average — consider raising",
    timestamp: "2026-05-15T09:15:00",
    resolved: false,
  },
  {
    id: "a3",
    product: "Stainless Steel Water Bottle",
    type: "competitor_change",
    severity: "medium",
    message: "Competitor dropped price to $19.99 — we are now overpriced",
    timestamp: "2026-05-14T16:45:00",
    resolved: false,
  },
  {
    id: "a4",
    product: "Wireless Bluetooth Headphones",
    type: "price_drop",
    severity: "low",
    message: "Minor price adjustment detected across 3 competitors",
    timestamp: "2026-05-14T14:20:00",
    resolved: true,
  },
  {
    id: "a5",
    product: "Bamboo Cutting Board",
    type: "competitor_change",
    severity: "medium",
    message: "2 competitors now pricing below our cost floor",
    timestamp: "2026-05-13T11:00:00",
    resolved: false,
  },
  {
    id: "a6",
    product: "Premium Yoga Mat",
    type: "price_increase",
    severity: "high",
    message: "We are 20% above nearest competitor — risk of lost sales",
    timestamp: "2026-05-13T08:30:00",
    resolved: false,
  },
  {
    id: "a7",
    product: "Smart LED Desk Lamp",
    type: "price_drop",
    severity: "low",
    message: "Market average decreased by $1.50",
    timestamp: "2026-05-12T15:10:00",
    resolved: true,
  },
  {
    id: "a8",
    product: "Denim Jacket Classic",
    type: "competitor_change",
    severity: "low",
    message: "New competitor entered at $52.99",
    timestamp: "2026-05-11T13:45:00",
    resolved: true,
  },
];

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  productsTracked: number;
  avgPriceDiff: number;
  lastScraped: string;
  status: "active" | "inactive" | "error";
  priceIndex: number;
}

export const competitors: Competitor[] = [
  {
    id: "c1",
    name: "TechMart",
    domain: "techmart.com",
    productsTracked: 342,
    avgPriceDiff: -5.2,
    lastScraped: "2026-05-15T10:00:00",
    status: "active",
    priceIndex: 94.8,
  },
  {
    id: "c2",
    name: "StyleHub",
    domain: "stylehub.com",
    productsTracked: 218,
    avgPriceDiff: 3.8,
    lastScraped: "2026-05-15T09:30:00",
    status: "active",
    priceIndex: 103.8,
  },
  {
    id: "c3",
    name: "HomeEssentials",
    domain: "homeessentials.com",
    productsTracked: 156,
    avgPriceDiff: -1.5,
    lastScraped: "2026-05-15T08:00:00",
    status: "active",
    priceIndex: 98.5,
  },
  {
    id: "c4",
    name: "SportZone",
    domain: "sportzone.com",
    productsTracked: 189,
    avgPriceDiff: 7.1,
    lastScraped: "2026-05-14T22:00:00",
    status: "active",
    priceIndex: 107.1,
  },
  {
    id: "c5",
    name: "GadgetWorld",
    domain: "gadgetworld.com",
    productsTracked: 275,
    avgPriceDiff: -8.3,
    lastScraped: "2026-05-14T20:00:00",
    status: "active",
    priceIndex: 91.7,
  },
  {
    id: "c6",
    name: "UrbanWear",
    domain: "urbanwear.com",
    productsTracked: 98,
    avgPriceDiff: 2.4,
    lastScraped: "2026-05-13T18:00:00",
    status: "error",
    priceIndex: 102.4,
  },
  {
    id: "c7",
    name: "GreenLiving",
    domain: "greenliving.com",
    productsTracked: 67,
    avgPriceDiff: -0.8,
    lastScraped: "2026-05-15T07:00:00",
    status: "active",
    priceIndex: 99.2,
  },
  {
    id: "c8",
    name: "MegaStore",
    domain: "megastore.com",
    productsTracked: 412,
    avgPriceDiff: -12.5,
    lastScraped: "2026-05-12T16:00:00",
    status: "inactive",
    priceIndex: 87.5,
  },
];

export const competitorPriceComparison = [
  {
    category: "Electronics",
    us: 35.66,
    techmart: 33.2,
    gadgetworld: 31.5,
    market: 34.25,
  },
  {
    category: "Clothing",
    us: 39.99,
    stylehub: 42.5,
    urbanwear: 41.0,
    market: 40.75,
  },
  {
    category: "Home & Garden",
    us: 34.32,
    homeessentials: 33.8,
    greenliving: 35.1,
    market: 34.5,
  },
  { category: "Sports", us: 47.66, sportzone: 51.2, market: 48.5 },
];

export const recentActivity = [
  {
    id: 1,
    action: "Price alert triggered",
    detail: "Running Shoes Pro — competitor price +15.3%",
    time: "10 min ago",
    type: "alert" as const,
  },
  {
    id: 2,
    action: "Competitor scraped",
    detail: "TechMart — 342 products updated",
    time: "30 min ago",
    type: "scrape" as const,
  },
  {
    id: 3,
    action: "Price recommendation",
    detail: "USB-C Hub 7-in-1 — suggest raising to $30.99",
    time: "1 hr ago",
    type: "recommendation" as const,
  },
  {
    id: 4,
    action: "New competitor detected",
    detail: "BudgetTech — 45 overlapping products",
    time: "2 hrs ago",
    type: "discovery" as const,
  },
  {
    id: 5,
    action: "Bulk price update",
    detail: "12 products adjusted based on rules",
    time: "3 hrs ago",
    type: "update" as const,
  },
  {
    id: 6,
    action: "Alert resolved",
    detail: "Wireless Bluetooth Headphones — price normalized",
    time: "4 hrs ago",
    type: "resolve" as const,
  },
  {
    id: 7,
    action: "Competitor scraped",
    detail: "StyleHub — 218 products updated",
    time: "5 hrs ago",
    type: "scrape" as const,
  },
  {
    id: 8,
    action: "Price alert triggered",
    detail: "Stainless Steel Water Bottle — overpriced",
    time: "6 hrs ago",
    type: "alert" as const,
  },
];
