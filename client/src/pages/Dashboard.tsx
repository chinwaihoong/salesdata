import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronUp, ChevronDown, Package, DollarSign, Calendar } from "lucide-react";

type Filters = {
  startDate: string;
  endDate: string;
  platform: string;
  brand: string;
  shop: string;
};

type SortKey = "name" | "brand" | "qty" | "sales" | null;
type SortDir = "asc" | "desc";

type QuickFilter = {
  label: string;
  startDate: string;
  endDate: string;
};

const QUICK_FILTERS: QuickFilter[] = [
  { label: "2023", startDate: "2023-01-01", endDate: "2023-12-31" },
  { label: "2024", startDate: "2024-01-01", endDate: "2024-12-31" },
  { label: "2025", startDate: "2025-01-01", endDate: "2025-12-31" },
  { label: "2026", startDate: "2026-01-01", endDate: "2026-12-31" },
];

function getLastMonthsFilter(months: number): QuickFilter {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  start.setDate(1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    label: `Last ${months} month${months > 1 ? "s" : ""}`,
    startDate: start.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

const PERIOD_FILTERS = [
  getLastMonthsFilter(1),
  getLastMonthsFilter(3),
  getLastMonthsFilter(6),
];

export default function DashboardPage() {
  const [filters, setFilters] = useState<Filters>({
    startDate: "",
    endDate: "",
    platform: "all",
    brand: "all",
    shop: "all",
  });

  // Sort state for top 50 tables
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Active quick filter label (for highlighting)
  const [activeQuickFilter, setActiveQuickFilter] = useState<string>("");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "brand" ? "asc" : "desc");
    }
  };

  const applyQuickFilter = (qf: QuickFilter) => {
    setFilters(f => ({
      ...f,
      startDate: qf.startDate,
      endDate: qf.endDate,
    }));
    setActiveQuickFilter(qf.label);
  };

  const clearQuickFilter = () => {
    setFilters(f => ({
      ...f,
      startDate: "",
      endDate: "",
    }));
    setActiveQuickFilter("");
  };

  const filterInput = useMemo(() => ({
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    platform: filters.platform === "all" ? undefined : filters.platform,
    brand: filters.brand === "all" ? undefined : filters.brand,
    shop: filters.shop === "all" ? undefined : filters.shop,
  }), [filters]);

  const overview = trpc.dashboard.overview.useQuery(filterInput);
  const shopPlatformComp = trpc.dashboard.shopPlatformComparison.useQuery(filterInput);
  const shopPlatformCompYearly = trpc.dashboard.shopPlatformComparisonYearly.useQuery(filterInput);
  const [viewMode, setViewMode] = useState<"month" | "year">("month");
  const brandComp = trpc.dashboard.brandComparison.useQuery(filterInput);
  const topByQty = trpc.dashboard.topItemsByQuantity.useQuery(filterInput);
  const topByVal = trpc.dashboard.topItemsByValue.useQuery(filterInput);

  // Transform shop+platform comparison data into grouped stacked bar format
  // Each period has 4 bars: JS_Shopee, JS_Lazada, EC_Shopee, EC_Lazada
  // JS bars use stackId="js", EC bars use stackId="ec" for side-by-side grouping
  const activeShopPlatformData = viewMode === "year" ? shopPlatformCompYearly.data : shopPlatformComp.data;
  const groupedBarData = useMemo(() => {
    const data = activeShopPlatformData;
    if (!data || data.length === 0) return [];

    const map: Record<string, { period: string; JS_Shopee: number; JS_Lazada: number; EC_Shopee: number; EC_Lazada: number }> = {};
    for (const row of data) {
      const key = row.period;
      if (!map[key]) map[key] = { period: key, JS_Shopee: 0, JS_Lazada: 0, EC_Shopee: 0, EC_Lazada: 0 };
      const sales = parseFloat(row.sales || 0);
      if (row.shop === "Japan Stationery") {
        if (row.platform === "Shopee") map[key].JS_Shopee += sales;
        if (row.platform === "Lazada") map[key].JS_Lazada += sales;
      } else if (row.shop === "Elite Camp") {
        if (row.platform === "Shopee") map[key].EC_Shopee += sales;
        if (row.platform === "Lazada") map[key].EC_Lazada += sales;
      }
    }
    return Object.values(map).sort((a, b) => a.period.localeCompare(b.period));
  }, [activeShopPlatformData]);

  const chartTitle = viewMode === "year" ? "Sales by Shop & Platform (Yearly)" : "Sales by Shop & Platform (Monthly)";
  const isLoading = viewMode === "year" ? shopPlatformCompYearly.isLoading : shopPlatformComp.isLoading;

  // Brand chart data: show all brands — ensure sales is parsed as number
  const brandData = useMemo(() => {
    return (brandComp.data || []).map((row: any) => ({
      ...row,
      sales: Number(row.sales) || 0,
    }));
  }, [brandComp.data]);

  // Compute max sales from filtered data for the X-axis domain
  const brandChartMax = useMemo(() => {
    if (brandData.length === 0) return 100000;
    const max = Math.max(...brandData.map(d => d.sales));
    return Math.ceil(max * 1.15 / 1000) * 1000;
  }, [brandData]);

  const myrFormatter = (val: number) => {
    return `RM ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Sort helper for top 50 items
  const sortItems = (items: any[] | undefined) => {
    if (!items) return [];
    if (!sortKey) return items;
    return [...items].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortKey) {
        case "name": aVal = a.displayName || a.productName; bVal = b.displayName || b.productName; break;
        case "brand": aVal = a.brand; bVal = b.brand; break;
        case "qty": aVal = a.totalQty; bVal = b.totalQty; break;
        case "sales": aVal = a.totalSales; bVal = b.totalSales; break;
        default: return 0;
      }
      const dir = sortDir === "asc" ? 1 : -1;
      if (typeof aVal === "string") return aVal.localeCompare(bVal) * dir;
      return ((aVal as number) - (bVal as number)) * dir;
    });
  };

  const SortHeader = ({ label, sortCol }: { label: string; sortCol: SortKey }) => (
    <TableHead
      className="font-semibold text-xs text-slate-600 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
      onClick={() => handleSort(sortCol)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === sortCol && (
          sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        )}
      </div>
    </TableHead>
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Sales Dashboard</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Comprehensive analytics for Shopee & Lazada sales data
        </p>
      </div>

      {/* Filters — responsive: stack on mobile, inline on desktop */}
      <Card className="border-border/60">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            {/* Date + Platform/Brand row */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">From:</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={e => { setFilters(f => ({ ...f, startDate: e.target.value })); setActiveQuickFilter(""); }}
                  className="h-8 text-sm rounded-md border border-input px-2 py-1 bg-background w-full sm:w-auto"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">To:</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={e => { setFilters(f => ({ ...f, endDate: e.target.value })); setActiveQuickFilter(""); }}
                  className="h-8 text-sm rounded-md border border-input px-2 py-1 bg-background w-full sm:w-auto"
                />
              </div>
              <Select value={filters.platform} onValueChange={v => setFilters(f => ({ ...f, platform: v }))}>
                <SelectTrigger className="h-8 w-full sm:w-36 text-sm">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="Shopee">Shopee</SelectItem>
                  <SelectItem value="Lazada">Lazada</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filters.brand} onValueChange={v => setFilters(f => ({ ...f, brand: v }))}>
                <SelectTrigger className="h-8 w-full sm:w-40 text-sm">
                  <SelectValue placeholder="Brand" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Brands</SelectItem>
                  {(overview.data?.availableBrands || []).map((b: string) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filters.shop} onValueChange={v => setFilters(f => ({ ...f, shop: v }))}>
                <SelectTrigger className="h-8 w-full sm:w-40 text-sm">
                  <SelectValue placeholder="Shop" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shops</SelectItem>
                  <SelectItem value="Japan Stationery">Japan Stationery</SelectItem>
                  <SelectItem value="Elite Camp">Elite Camp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Quick filter buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Quick filters:</span>
              {QUICK_FILTERS.map(qf => (
                <button
                  key={qf.label}
                  onClick={() => applyQuickFilter(qf)}
                  className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                    activeQuickFilter === qf.label
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {qf.label}
                </button>
              ))}
              <span className="text-slate-300 mx-1">|</span>
              {PERIOD_FILTERS.map(qf => (
                <button
                  key={qf.label}
                  onClick={() => applyQuickFilter(qf)}
                  className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                    activeQuickFilter === qf.label
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {qf.label}
                </button>
              ))}
              {/* All Time button */}
              <button
                onClick={clearQuickFilter}
                className={`h-7 px-3 text-xs font-medium rounded-md transition-all ${
                  !filters.startDate && !filters.endDate
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                All Time
              </button>
              {(filters.startDate || filters.endDate) && (
                <button
                  onClick={clearQuickFilter}
                  className="h-7 px-3 text-xs font-medium rounded-md bg-slate-200 text-slate-600 hover:bg-slate-300 transition-all"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stacked Bar: Sales by Platform Over Time with Month/Year toggle */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle className="text-sm sm:text-base font-semibold text-slate-800">{chartTitle}</CardTitle>
            <Tabs value={viewMode} onValueChange={v => setViewMode(v as "month" | "year")} className="w-full sm:w-auto">
              <TabsList className="h-8 w-full sm:w-auto">
                <TabsTrigger value="month" className="text-xs px-3">Monthly</TabsTrigger>
                <TabsTrigger value="year" className="text-xs px-3">Yearly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-64 sm:h-72 animate-pulse bg-slate-100 rounded-lg" />
          ) : groupedBarData.length > 0 ? (
            <ChartContainer config={{
              JS_Shopee: { label: "JS Shopee", color: "#f97316" },
              JS_Lazada: { label: "JS Lazada", color: "#0086f6" },
              EC_Shopee: { label: "EC Shopee", color: "#fbbf24" },
              EC_Lazada: { label: "EC Lazada", color: "#38bdf8" },
            }}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={groupedBarData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                    interval="preserveStartEnd"
                    angle={-45}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickFormatter={val => `RM${(val / 1000).toFixed(0)}K`}
                    width={60}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    iconType="square"
                  />
                  <Bar dataKey="JS_Shopee" stackId="js" fill="#f97316" radius={[0, 0, 0, 0]} name="JS Shopee" />
                  <Bar dataKey="JS_Lazada" stackId="js" fill="#0086f6" radius={[0, 0, 0, 0]} name="JS Lazada" />
                  <Bar dataKey="EC_Shopee" stackId="ec" fill="#fbbf24" radius={[0, 0, 0, 0]} name="EC Shopee" />
                  <Bar dataKey="EC_Lazada" stackId="ec" fill="#38bdf8" radius={[4, 4, 0, 0]} name="EC Lazada" />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              No data available for the selected filters
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sales by Brand — proportional height */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm sm:text-base font-semibold text-slate-800">Sales by Brand</CardTitle>
        </CardHeader>
        <CardContent>
          {brandComp.isLoading ? (
            <div className="h-80 animate-pulse bg-slate-100 rounded-lg" />
          ) : brandData.length > 0 ? (
            <ResponsiveContainer width="100%" height={brandData.length * 32 + 20}>
              <BarChart data={brandData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" domain={[0, brandChartMax]} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} tickFormatter={val => `RM${(val / 1000).toFixed(0)}K`} />
                <YAxis dataKey="brand" type="category" width={110} tick={{ fontSize: 12, fontWeight: 500, fill: "#334155" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} interval={0} />
                <ChartTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.[0]) return null;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg">
                        <p className="text-sm font-semibold text-slate-800">{label}</p>
                        <p className="text-sm text-slate-600">
                          Sales: RM{Number(payload[0].value).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="sales" radius={[0, 4, 4, 0]} name="Sales (RM)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
          )}
        </CardContent>
      </Card>

      {/* Top 50 Tables — stack vertically on mobile */}
      <div className="grid grid-cols-1 gap-4">
        {/* Top 50 by Quantity */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm sm:text-base font-semibold text-slate-800 flex items-center gap-2">
              <Package className="h-4 w-4 text-indigo-600" />
              Top 50 Items by Quantity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4">
            {topByQty.isLoading ? (
              <div className="h-64 animate-pulse bg-slate-100 rounded-lg" />
            ) : topByQty.data?.length ? (
              <div className="max-h-[400px] overflow-y-auto overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50">
                      <TableHead className="font-semibold text-xs text-slate-600 w-8">#</TableHead>
                      <SortHeader label="Product" sortCol="name" />
                      <SortHeader label="Brand" sortCol="brand" />
                      <SortHeader label="Qty" sortCol="qty" />
                      <SortHeader label="Sales" sortCol="sales" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortItems(topByQty.data).map((item: any, idx: number) => (
                      <TableRow key={idx} className="hover:bg-slate-50/50">
                        <TableCell className="text-xs font-medium text-slate-500">{idx + 1}</TableCell>
                        <TableCell className="text-xs min-w-[200px]">
                          <div className="font-medium text-slate-800" title={item.productName}>
                            {item.displayName || item.productName}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{item.brand}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-medium">{item.totalQty?.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{myrFormatter(item.totalSales)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>

        {/* Top 50 by Value */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm sm:text-base font-semibold text-slate-800 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-indigo-600" />
              Top 50 Items by Value (MYR)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2 sm:p-4">
            {topByVal.isLoading ? (
              <div className="h-64 animate-pulse bg-slate-100 rounded-lg" />
            ) : topByVal.data?.length ? (
              <div className="max-h-[400px] overflow-y-auto overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/50">
                      <TableHead className="font-semibold text-xs text-slate-600 w-8">#</TableHead>
                      <SortHeader label="Product" sortCol="name" />
                      <SortHeader label="Brand" sortCol="brand" />
                      <SortHeader label="Qty" sortCol="qty" />
                      <SortHeader label="Sales" sortCol="sales" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortItems(topByVal.data).map((item: any, idx: number) => (
                      <TableRow key={idx} className="hover:bg-slate-50/50">
                        <TableCell className="text-xs font-medium text-slate-500">{idx + 1}</TableCell>
                        <TableCell className="text-xs min-w-[200px]">
                          <div className="font-medium text-slate-800" title={item.productName}>
                            {item.displayName || item.productName}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{item.brand}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-medium">{item.totalQty?.toLocaleString()}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{myrFormatter(item.totalSales)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const BRAND_COLORS = [
  "#6366f1", "#f97316", "#0086f6", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
  "#d946ef", "#64748b", "#e11d48", "#16a34a", "#7c3aed",
  "#ea580c", "#059669", "#ca8a04", "#be185d", "#0ea5e9",
];
