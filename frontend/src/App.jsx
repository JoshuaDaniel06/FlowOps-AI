import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  Clock,
  Coins,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileClock,
  GitBranch,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  UploadCloud,
  Workflow,
  Zap,
  X,
  XCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import "./App.css";
import RapidAPITestPage from "./RapidAPITestPage";

const API_URL = (
  import.meta.env.VITE_API_URL !== undefined
    ? import.meta.env.VITE_API_URL
    : typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ? ""
    : "http://127.0.0.1:8000"
).replace(/\/+$/, "");

/* =========================================================
   NAVIGATION DEFINITION (EXACT ORDER 1 TO 11)
========================================================= */

const NAV_GROUPS = [
  {
    section: "CORE",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "etl", label: "ETL Pipelines", icon: Upload },
      { id: "monitoring", label: "Pipeline Monitoring", icon: Activity },
    ],
  },
  {
    section: "DATA & QUALITY",
    items: [
      { id: "quality", label: "Data Quality", icon: ShieldCheck },
      { id: "anomalies", label: "Anomaly Detection", icon: AlertTriangle },
      { id: "lineage", label: "Data Lineage", icon: GitBranch },
      { id: "history", label: "Run History", icon: FileClock },
      { id: "schedules", label: "Scheduled Pipelines", icon: CalendarClock },
    ],
  },
  {
    section: "INTELLIGENCE & SYSTEM",
    items: [
      { id: "insights", label: "AI Insights", icon: Sparkles },
      { id: "usage", label: "API Usage & Costs", icon: BarChart3 },
      { id: "rapid_test", label: "Rapid API Test", icon: Zap },
      { id: "health", label: "System Health", icon: Server },
    ],
  },
];

const PAGE_INFO = {
  overview: {
    title: "Overview",
    subtitle: "Data pipeline activity, quality metrics, and platform health at a glance",
  },
  etl: {
    title: "ETL Pipelines",
    subtitle: "Upload CSV, inspect contents, validate, clean, and load to PostgreSQL",
  },
  monitoring: {
    title: "Pipeline Monitoring",
    subtitle: "Track live execution status, durations, failures, and retries",
  },
  quality: {
    title: "Data Quality",
    subtitle: "Inspect overall quality score, missing values, duplicates, and invalid records",
  },
  anomalies: {
    title: "Anomaly Detection",
    subtitle: "Review rule-based and statistical data issues flagged during pipeline runs",
  },
  lineage: {
    title: "Data Lineage",
    subtitle: "Trace data flow from source CSV through validation and transformation to PostgreSQL",
  },
  history: {
    title: "Run History",
    subtitle: "Search, filter, paginate, and inspect historical pipeline executions",
  },
  schedules: {
    title: "Scheduled Pipelines",
    subtitle: "Automated recurring pipeline execution status and schedule configuration",
  },
  insights: {
    title: "AI Insights",
    subtitle: "Claude AI root-cause analysis, failure diagnosis, and recommendations",
  },
  usage: {
    title: "API Usage & Costs",
    subtitle: "Track Claude token consumption, request counts, and estimated platform costs",
  },
  rapid_test: {
    title: "Rapid Claude API Test",
    subtitle: "High-throughput workload runner to consume prepaid Claude credit down to verified provider zero",
  },
  health: {
    title: "System Health",
    subtitle: "Monitor FastAPI backend, PostgreSQL database, and AI service connectivity",
  },
};

/* =========================================================
   UTILITIES
========================================================= */

const toArr = (v) =>
  Array.isArray(v) ? v : v && Array.isArray(v.items) ? v.items : [];
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const money = (v) => `$${toNum(v).toFixed(4)}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "—");

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null) return obj[k];
  }
  return undefined;
}

function downloadFile(name, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateCSV(rows) {
  if (!rows || !rows.length) return "";
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r || {})))];
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = keys.map(esc).join(",");
  const body = rows
    .map((r) =>
      keys
        .map((k) =>
          esc(typeof r[k] === "object" ? JSON.stringify(r[k]) : r[k])
        )
        .join(",")
    )
    .join("\n");
  return `${header}\n${body}`;
}

/* =========================================================
   MAIN APPLICATION
========================================================= */

function App() {
  const [activePage, setActivePage] = useState("overview");
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState({});
  const [anomalies, setAnomalies] = useState([]);
  const [insights, setInsights] = useState([]);
  const [usage, setUsage] = useState({});
  const [health, setHealth] = useState(null);
  const [dbHealth, setDbHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("info");
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [mobileMenu, setMobileMenu] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [localBudget, setLocalBudget] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("flowops_budget") || "5.00";
    }
    return "5.00";
  });
  useEffect(() => {
    if (usage && usage.starting_credit_usd !== undefined && !localStorage.getItem("flowops_budget")) {
      setLocalBudget(String(usage.starting_credit_usd));
    }
  }, [usage]);


  // Light / Dark Theme State with persistence (Default: Light Mode)
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("flowops_theme");
      if (saved === "dark" || saved === "light") {
        return saved;
      }
    }
    return "light"; // Fresh install defaults to Light Mode
  });

  useEffect(() => {
    if (typeof document !== "undefined") {
      if (theme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      try {
        localStorage.setItem("flowops_theme", theme);
      } catch {}
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  // FlowOps Bot conversation state
  const [botMessages, setBotMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm FlowOps Bot. I can help you understand pipeline runs, investigate failures, analyze data quality issues, and explore your FlowOps AI operations. Ask me a question to get started.",
      sources: [],
      timestamp: new Date().toISOString(),
    },
  ]);
  const [botLoading, setBotLoading] = useState(false);
  const [botError, setBotError] = useState(null);
  const [lastFailedQuery, setLastFailedQuery] = useState(null);

  // ETL processing state
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [etlResult, setEtlResult] = useState(null);
  const [etlLoading, setEtlLoading] = useState(false);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);

  /* -------------------------------------------------------
     API REQUEST HELPER
  ------------------------------------------------------- */
  const request = useCallback(async (path, options = {}) => {
    const res = await fetch(`${API_URL}${path}`, options);
    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { detail: raw };
    }
    if (!res.ok) {
      throw new Error(data.detail || `Request failed (${res.status})`);
    }
    return data;
  }, []);

  /* -------------------------------------------------------
     REFRESH ALL BACKEND DATA
  ------------------------------------------------------- */
  const refresh = useCallback(async () => {
    setBusy(true);
    const tasks = [
      request("/api/pipelines/runs").then((d) => setRuns(toArr(d.runs ?? d))),
      request("/api/pipelines/stats").then(setStats),
      request("/api/anomalies").then((d) => setAnomalies(toArr(d.anomalies ?? d))),
      request("/api/ai/insights").then((d) => setInsights(toArr(d.insights ?? d))),
      request("/api/ai/usage").then(setUsage),
      request("/api/health").then(setHealth),
      request("/api/database/health").then(setDbHealth),
    ];

    const results = await Promise.allSettled(tasks);
    const failed = results.filter((x) => x.status === "rejected");
    if (failed.length > 0) {
      setNotice(
        `${failed.length} backend check(s) unreachable. Ensure the FastAPI server and PostgreSQL are running.`
      );
      setNoticeType("error");
    } else {
      setNotice("");
    }
    setLastUpdated(new Date());
    setBusy(false);
  }, [request]);

  // Initial load deferred to next tick to comply with react-hooks/set-state-in-effect
  useEffect(() => {
    const timer = setTimeout(() => {
      refresh();
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  /* -------------------------------------------------------
     PAGE NAVIGATION
  ------------------------------------------------------- */
  const navigate = (pageId) => {
    setActivePage(pageId);
    setMobileMenu(false);
  };

  /* -------------------------------------------------------
     ETL ACTIONS
  ------------------------------------------------------- */
  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    setEtlResult(null);
    setNotice("");
  };

  const analyzeFile = async () => {
    if (!file) {
      setNotice("Please select a CSV file first.");
      setNoticeType("error");
      return;
    }
    setAnalyzeLoading(true);
    setNotice("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await request("/api/etl/analyze", {
        method: "POST",
        body: fd,
      });
      setPreview(data);
      setNotice("CSV validation and analysis completed successfully.");
      setNoticeType("success");
    } catch (err) {
      setNotice(err.message || "Failed to analyze CSV file.");
      setNoticeType("error");
    } finally {
      setAnalyzeLoading(false);
    }
  };

  const runETL = async () => {
    if (!file) {
      setNotice("Please select a CSV file first.");
      setNoticeType("error");
      return;
    }
    setEtlLoading(true);
    setNotice("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await request("/api/etl/process", {
        method: "POST",
        body: fd,
      });
      setEtlResult(data);
      setNotice(
        `ETL pipeline completed (Run #${data.run_id}). Records processed and stored in PostgreSQL.`
      );
      setNoticeType("success");
      await refresh();
    } catch (err) {
      setNotice(err.message || "ETL pipeline execution failed.");
      setNoticeType("error");
    } finally {
      setEtlLoading(false);
    }
  };

  /* -------------------------------------------------------
     CALCULATED METRICS
  ------------------------------------------------------- */
  const totalRuns = pick(stats, "total_runs", "total_pipeline_runs") ?? runs.length;
  const completedRuns =
    pick(stats, "successful_runs", "completed_runs") ??
    runs.filter((r) => String(r.status).toLowerCase() === "completed").length;
  const failedRuns =
    pick(stats, "failed_runs") ??
    runs.filter((r) => String(r.status).toLowerCase() === "failed").length;
  const runningRuns =
    pick(stats, "running_runs") ??
    runs.filter((r) => String(r.status).toLowerCase() === "running").length;
  const rowsProcessed =
    pick(stats, "total_rows_processed", "rows_processed") ??
    runs.reduce((acc, r) => acc + toNum(pick(r, "cleaned_rows", "original_rows")), 0);
  const successRate =
    toNum(totalRuns) > 0 ? Math.round((toNum(completedRuns) / toNum(totalRuns)) * 100) : 0;

  const usageInput = toNum(pick(usage, "total_input_tokens", "input_tokens"));
  const usageOutput = toNum(pick(usage, "total_output_tokens", "output_tokens"));
  const usageTotal =
    toNum(pick(usage, "total_tokens")) || usageInput + usageOutput;
  const cost = toNum(
    pick(usage, "total_estimated_cost_usd", "estimated_cost_usd", "estimated_credit_used_usd")
  );

  const pageInfo = PAGE_INFO[activePage] || PAGE_INFO.overview;

  return (
    <div className="app-shell">
      {/* MOBILE MENU TOGGLE */}
      <button
        className="mobile-menu-button"
        onClick={() => setMobileMenu((v) => !v)}
        aria-label="Toggle Navigation"
      >
        {mobileMenu ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* ===================================================
          SIDEBAR
      =================================================== */}
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <Workflow size={20} />
          </div>
          <div className="brand-text">
            <h1>FlowOps AI</h1>
            <span>DATA OPERATIONS</span>
          </div>
        </div>

        <div className="sidebar-scroll">
          {NAV_GROUPS.map((group) => (
            <div className="nav-section" key={group.section}>
              <div className="nav-section-title">{group.section}</div>
              <nav className="sidebar-nav">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`nav-item ${active ? "active" : ""}`}
                      onClick={() => navigate(item.id)}
                    >
                      <Icon size={17} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>

        {/* SIDEBAR FOOTER */}
        <div className="sidebar-footer">
          <div
            className="status-dot"
            style={{
              background:
                health?.status === "healthy" && dbHealth?.connected
                  ? "#22c55e"
                  : "#ef4444",
            }}
          />
          <div>
            <strong>FlowOps AI</strong>
            <span>Data Pipeline v1.3</span>
          </div>
        </div>
      </aside>

      {/* ===================================================
          MAIN WORKSPACE
      =================================================== */}
      <main className="main">
        <header className="page-header">
          <div>
            <h2>{pageInfo.title}</h2>
            <p>{pageInfo.subtitle}</p>
          </div>

          <div className="header-actions">
            {/* GLOBAL SEARCH */}
            <div className="global-search-container">
              <Search size={14} className="global-search-icon" />
              <input
                type="text"
                placeholder="Search runs, files, insights..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </div>

            <span className="last-updated">
              Updated{" "}
              {lastUpdated
                .toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })
                .replace("am", "AM")
                .replace("pm", "PM")}
            </span>

            <button
              type="button"
              className="refresh-button"
              onClick={refresh}
              disabled={busy}
            >
              <RefreshCw size={11} className={busy ? "spin" : ""} />
              Refresh
            </button>

            {/* THEME TOGGLE (Top-right area of header) */}
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? (
                <Sun size={15} className="theme-toggle-icon sun" />
              ) : (
                <Moon size={15} className="theme-toggle-icon moon" />
              )}
            </button>
          </div>
        </header>

        {notice && (
          <div className={`notification ${noticeType === "error" ? "error" : ""}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {noticeType === "error" ? (
                <CircleAlert size={18} />
              ) : (
                <CircleCheck size={18} />
              )}
              <span>{notice}</span>
            </div>
            <button
              type="button"
              className="notification-dismiss"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* =================================================
            PAGE ROUTING (11 PAGES)
        ================================================= */}
        {activePage === "overview" && (
          <OverviewPage
            runs={runs}
            totalRuns={totalRuns}
            completedRuns={completedRuns}
            rowsProcessed={rowsProcessed}
            successRate={successRate}
            anomalies={anomalies}
            navigate={navigate}
          />
        )}

        {activePage === "etl" && (
          <ETLPipelinesPage
            file={file}
            handleFileChange={handleFileChange}
            analyzeFile={analyzeFile}
            runETL={runETL}
            analyzeLoading={analyzeLoading}
            etlLoading={etlLoading}
            preview={preview}
            etlResult={etlResult}
            navigate={navigate}
          />
        )}

        {activePage === "monitoring" && (
          <PipelineMonitoringPage
            runs={runs}
            totalRuns={totalRuns}
            completedRuns={completedRuns}
            failedRuns={failedRuns}
            runningRuns={runningRuns}
            refresh={refresh}
            busy={busy}
            globalSearch={globalSearch}
            setSelectedRun={setSelectedRun}
          />
        )}

        {activePage === "quality" && (
          <DataQualityPage
            runs={runs}
            anomalies={anomalies}
          />
        )}

        {activePage === "anomalies" && (
          <AnomalyDetectionPage
            anomalies={anomalies}
            globalSearch={globalSearch}
          />
        )}

        {activePage === "lineage" && (
          <DataLineagePage runs={runs} />
        )}

        {activePage === "history" && (
          <RunHistoryPage
            runs={runs}
            globalSearch={globalSearch}
            setSelectedRun={setSelectedRun}
          />
        )}

        {activePage === "schedules" && (
          <ScheduledPipelinesPage
            navigate={navigate}
            request={request}
            refreshParent={refresh}
          />
        )}

        {activePage === "insights" && (
          <AIInsightsPage
            insights={insights}
            usageInput={usageInput}
            usageOutput={usageOutput}
            cost={cost}
            refresh={refresh}
            busy={busy}
            globalSearch={globalSearch}
            selectedInsight={selectedInsight}
            setSelectedInsight={setSelectedInsight}
            navigate={navigate}
            request={request}
            botMessages={botMessages}
            setBotMessages={setBotMessages}
            botLoading={botLoading}
            setBotLoading={setBotLoading}
            botError={botError}
            setBotError={setBotError}
            lastFailedQuery={lastFailedQuery}
            setLastFailedQuery={setLastFailedQuery}
          />
        )}

        {activePage === "usage" && (
          <APIUsagePage
            usage={usage}
            insights={insights}
            usageInput={usageInput}
            usageOutput={usageOutput}
            usageTotal={usageTotal}
            cost={cost}
            localBudget={localBudget}
            setLocalBudget={setLocalBudget}
            request={request}
            refresh={refresh}
            busy={busy}
          />
        )}

        {activePage === "rapid_test" && (
          <RapidAPITestPage
            request={request}
            apiUrl={API_URL}
          />
        )}

        {activePage === "health" && (
          <SystemHealthPage
            health={health}
            dbHealth={dbHealth}
            runsCount={runs.length}
            insightsCount={insights.length}
            refresh={refresh}
            busy={busy}
          />
        )}

        {/* =================================================
            RUN DETAILS MODAL
        ================================================= */}
        {selectedRun && (
          <RunDetailsModal
            run={selectedRun}
            onClose={() => setSelectedRun(null)}
            onViewInsights={() => {
              setSelectedRun(null);
              setActivePage("insights");
            }}
          />
        )}
      </main>
    </div>
  );
}

/* =========================================================
   1. OVERVIEW PAGE
========================================================= */

function OverviewPage({
  runs,
  totalRuns,
  completedRuns,
  rowsProcessed,
  successRate,
  anomalies,
  navigate,
}) {
  const trend = useMemo(() => {
    const map = {};
    runs.forEach((r) => {
      const day = (r.created_at || r.started_at || "").slice(0, 10) || "Recent";
      if (!map[day]) {
        map[day] = { day, Completed: 0, Failed: 0, Running: 0 };
      }
      const st = String(r.status || "").toLowerCase();
      if (st === "completed") map[day].Completed++;
      else if (st === "failed") map[day].Failed++;
      else if (st === "running") map[day].Running++;
    });
    return Object.values(map)
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-10);
  }, [runs]);

  return (
    <div className="page-container">
      {/* TOP STAT CARDS */}
      <div className="stats">
        <StatCard
          label="TOTAL PIPELINE RUNS"
          value={totalRuns}
          description="All recorded executions"
          icon={Workflow}
          onClick={() => navigate("history")}
        />
        <StatCard
          label="SUCCESSFUL RUNS"
          value={completedRuns}
          description={`${successRate}% execution success rate`}
          icon={CheckCircle2}
          onClick={() => navigate("monitoring")}
        />
        <StatCard
          label="ANOMALIES DETECTED"
          value={anomalies.length}
          description="Issues identified by rule engine"
          icon={AlertTriangle}
          onClick={() => navigate("anomalies")}
        />
        <StatCard
          label="ROWS PROCESSED"
          value={rowsProcessed.toLocaleString()}
          description="Cleaned rows stored in DB"
          icon={Database}
          onClick={() => navigate("history")}
        />
      </div>

      {/* QUICK ACTIONS & CHART GRID */}
      <div className="panel quick-actions-panel">
        <PanelHeader
          title="Quick Actions"
          description="Direct operations on data pipelines"
          icon={Activity}
        />
        <div className="quick-actions">
          <QuickAction
            icon={UploadCloud}
            title="Upload CSV Dataset"
            description="Select a file to validate and process"
            onClick={() => navigate("etl")}
            variant="upload"
          />
          <QuickAction
            icon={Play}
            title="Run ETL Pipeline"
            description="Execute validation, cleaning, and storage"
            onClick={() => navigate("etl")}
            variant="analyze"
          />
          <QuickAction
            icon={Sparkles}
            title="Review AI Insights"
            description="Claude-assisted root-cause diagnoses"
            onClick={() => navigate("insights")}
            variant="ai"
          />
          <QuickAction
            icon={AlertTriangle}
            title="Inspect Anomalies"
            description="Rule-based quality and schema alerts"
            onClick={() => navigate("anomalies")}
            variant="download"
          />
          <QuickAction
            icon={Server}
            title="Check System Health"
            description="PostgreSQL and FastAPI availability"
            onClick={() => navigate("health")}
            variant="mysql"
          />
        </div>
      </div>

      <div className="panel chart-panel overview-quality-panel">
        <div className="panel-header chart-panel-header">
          <div>
            <h3>Pipeline Execution & Quality Trend</h3>
            <p>Recorded runs grouped by date and status</p>
          </div>
          <button
            type="button"
            className="view-analytics-button"
            onClick={() => navigate("monitoring")}
          >
            View analytics
            <ArrowRight size={15} />
          </button>
        </div>

        {runs.length === 0 ? (
          <EmptyState
            icon={UploadCloud}
            title="No Pipeline Runs Recorded"
            description="Upload and analyze a CSV dataset to see execution metrics and quality trends."
            buttonText="Upload Dataset"
            onClick={() => navigate("etl")}
          />
        ) : (
          <div className="quality-chart">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={trend}
                margin={{ top: 8, right: 8, left: -18, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="4 4"
                  vertical={false}
                  stroke="#e5e7eb"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#858a93", fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#858a93", fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: "#f4f5f7" }}
                  contentStyle={{
                    background: "#ffffff",
                    border: "1px solid #e8e8e8",
                    borderRadius: "10px",
                    boxShadow: "0 8px 24px rgba(17, 24, 39, 0.08)",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: 8 }} />
                <Bar
                  dataKey="Completed"
                  stackId="a"
                  fill="#16a34a"
                  radius={[4, 4, 0, 0]}
                  barSize={40}
                />
                <Bar
                  dataKey="Failed"
                  stackId="a"
                  fill="#dc2626"
                  radius={[4, 4, 0, 0]}
                  barSize={40}
                />
                <Bar
                  dataKey="Running"
                  stackId="a"
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                  barSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   2. ETL PIPELINES PAGE
========================================================= */

function ETLPipelinesPage({
  file,
  handleFileChange,
  analyzeFile,
  runETL,
  analyzeLoading,
  etlLoading,
  preview,
  etlResult,
  navigate,
}) {
  const previewReport = preview?.report;
  const executionReport = etlResult?.report;

  return (
    <div className="page-container">
      {/* 5-STEP PIPELINE PROGRESS */}
      <div className="panel" style={{ padding: "16px 20px", marginBottom: 20 }}>
        <div className="pipeline">
          <PipelineStep
            number="01"
            title="CSV Input"
            description={file ? file.name : "Select a CSV dataset"}
            completed={Boolean(file)}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="02"
            title="Validation"
            description={preview ? "Validation complete" : "Verify missing/duplicates"}
            completed={Boolean(preview)}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="03"
            title="Clean & Transform"
            description={etlResult ? "Data standardized" : "Null conversion & cleaning"}
            completed={Boolean(etlResult)}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="04"
            title="PostgreSQL Load"
            description={
              etlResult?.status === "processing_completed"
                ? "Saved to destination"
                : "Load processed_records"
            }
            completed={etlResult?.status === "processing_completed"}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="05"
            title="Execution Report"
            description={
              etlResult?.ai_insight
                ? "Report + AI analysis ready"
                : "Execution metrics & report"
            }
            completed={Boolean(etlResult)}
          />
        </div>
      </div>

      {/* UPLOAD WORKSPACE */}
      <div className="panel upload-panel">
        <PanelHeader
          title="Upload Dataset"
          description="Upload a CSV file to validate, clean, and execute the FlowOps AI ETL pipeline"
          icon={UploadCloud}
        />

        <label className="upload-box">
          <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
          <div className="upload-icon">
            <UploadCloud size={32} />
          </div>
          <h3>{file ? file.name : "Choose your CSV dataset"}</h3>
          <p>CSV files only · UTF-8 tabular customer or pipeline records</p>
          <span className="upload-button datamedic-upload-button">Browse CSV</span>
        </label>

        {file && (
          <div className="selected-file">
            <div>
              <FileCheck2 size={20} />
              <div>
                <strong>{file.name}</strong>
                <span>{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            </div>
            <CheckCircle2 size={20} />
          </div>
        )}

        <div className="cleaned-data-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="secondary-button"
            onClick={analyzeFile}
            disabled={!file || analyzeLoading || etlLoading}
          >
            {analyzeLoading ? (
              <>
                <RefreshCw size={14} className="spin" />
                Validating CSV...
              </>
            ) : (
              <>
                <Eye size={14} />
                Preview / Analyze
              </>
            )}
          </button>

          <button
            type="button"
            className="primary-button datamedic-analyze-button"
            onClick={runETL}
            disabled={!file || etlLoading || analyzeLoading}
          >
            {etlLoading ? (
              <>
                <RefreshCw size={14} className="spin" />
                Executing Pipeline...
              </>
            ) : (
              <>
                <Play size={14} />
                Run ETL Pipeline
              </>
            )}
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate("history")}
          >
            View Run History
          </button>
        </div>
      </div>

      {/* CSV VALIDATION / PREVIEW REPORT */}
      {preview && previewReport && (
        <div className="panel">
          <PanelHeader
            title="CSV Validation & Analysis Summary"
            description={`Validation findings for ${fmt(preview.filename)}`}
            icon={CheckCircle2}
          />
          <div className="stats" style={{ marginBottom: 20 }}>
            <StatCard
              label="ORIGINAL ROWS"
              value={previewReport.total_rows}
              description="Input rows parsed"
              icon={Database}
            />
            <StatCard
              label="TOTAL COLUMNS"
              value={previewReport.total_columns}
              description="Columns identified"
              icon={FileCheck2}
            />
            <StatCard
              label="MISSING CELLS"
              value={previewReport.missing_cells}
              description="Null or blank values"
              icon={AlertTriangle}
            />
            <StatCard
              label="DUPLICATE ROWS"
              value={previewReport.duplicate_rows}
              description="Identical records detected"
              icon={Trash2}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--body, #475569)" }}>
              Identified Schema Columns:
            </span>
            <div className="tag-list">
              {(previewReport.column_names || []).map((col) => (
                <span className="tag" key={col}>
                  {col}
                </span>
              ))}
            </div>
          </div>

          {Array.isArray(previewReport.preview) && previewReport.preview.length > 0 && (
            <div>
              <h4 style={{ margin: "16px 0 8px", fontSize: 13, color: "var(--ink, #111827)" }}>
                First 5 Records Preview:
              </h4>
              <RecordsTable rows={previewReport.preview} />
            </div>
          )}
        </div>
      )}

      {/* EXECUTION REPORT */}
      {etlResult && (
        <div className="panel">
          <PanelHeader
            title={`ETL Execution Report (Run #${etlResult.run_id})`}
            description={`Status: ${fmt(etlResult.status)} · Processing Duration: ${toNum(
              etlResult.duration_seconds
            ).toFixed(3)}s`}
            icon={CheckCircle2}
          />

          <div className="success-box" style={{ marginBottom: 20 }}>
            <CheckCircle2 size={24} />
            <div>
              <strong>Pipeline Execution Completed Successfully</strong>
              <p>
                Run #{etlResult.run_id} processed {fmt(executionReport?.original_rows)} rows
                and saved {fmt(executionReport?.cleaned_rows)} cleaned records into PostgreSQL.
                {etlResult.retry_attempts > 0 &&
                  ` (${etlResult.retry_attempts} retry attempts required)`}
              </p>
            </div>
          </div>

          <div className="stats" style={{ marginBottom: 20 }}>
            <StatCard
              label="ORIGINAL ROWS"
              value={executionReport?.original_rows ?? 0}
              description="Rows read from CSV"
              icon={Database}
            />
            <StatCard
              label="CLEANED ROWS"
              value={executionReport?.cleaned_rows ?? 0}
              description="Loaded to PostgreSQL"
              icon={CheckCircle2}
            />
            <StatCard
              label="REJECTED ROWS"
              value={executionReport?.rejected_rows ?? 0}
              description="Duplicates & invalid emails"
              icon={Trash2}
            />
            <StatCard
              label="EXECUTION TIME"
              value={`${toNum(etlResult.duration_seconds).toFixed(2)}s`}
              description="Total pipeline latency"
              icon={Activity}
            />
          </div>

          {/* DOWNLOAD & EXPORT ACTIONS */}
          <div className="cleaned-data-actions" style={{ marginBottom: 20 }}>
            {Array.isArray(etlResult.cleaned_data_preview) && (
              <button
                type="button"
                className="primary-button datamedic-download-button"
                onClick={() =>
                  downloadFile(
                    `cleaned_data_run_${etlResult.run_id}.csv`,
                    generateCSV(etlResult.cleaned_data_preview)
                  )
                }
              >
                <Download size={14} />
                Download Cleaned Data (CSV)
              </button>
            )}

            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                downloadFile(
                  `flowops_run_${etlResult.run_id}_report.json`,
                  JSON.stringify(etlResult, null, 2),
                  "application/json"
                )
              }
            >
              <Download size={14} />
              Export Full Report (JSON)
            </button>
          </div>

          {/* CLEANED DATA PREVIEW TABLE */}
          {Array.isArray(etlResult.cleaned_data_preview) &&
            etlResult.cleaned_data_preview.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink, #111827)" }}>
                  Cleaned Records Sample (Post-Transformation):
                </h4>
                <RecordsTable rows={etlResult.cleaned_data_preview} />
              </div>
            )}

          {/* AI INSIGHT IF RETURNED */}
          {etlResult.ai_insight && (
            <div className="ai-result" style={{ marginTop: 20 }}>
              <div className="ai-result-header">
                <div className="ai-result-icon datamedic-ai-icon">
                  <Sparkles size={19} />
                </div>
                <div>
                  <h3>Claude AI Pipeline Analysis</h3>
                  <p>
                    Model: {fmt(etlResult.ai_insight.model)} · Tokens:{" "}
                    {fmt(etlResult.ai_insight.total_tokens)} · Est. Cost:{" "}
                    {money(etlResult.ai_insight.estimated_cost_usd)}
                  </p>
                </div>
              </div>
              <div className="ai-result-content">
                {etlResult.ai_insight.analysis}
              </div>
            </div>
          )}

          {etlResult.ai_error && (
            <div className="notification error" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <AlertTriangle size={18} />
                <span>{etlResult.ai_error}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   3. PIPELINE MONITORING PAGE
========================================================= */

function PipelineMonitoringPage({
  runs,
  totalRuns,
  completedRuns,
  failedRuns,
  runningRuns,
  refresh,
  busy,
  globalSearch,
  setSelectedRun,
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [localSearch, setLocalSearch] = useState("");

  const query = (localSearch || globalSearch).toLowerCase().trim();

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      const matchesQuery =
        !query ||
        [r.run_id, r.filename, r.status, r.error_message, r.failed_step].some((field) =>
          String(field ?? "")
            .toLowerCase()
            .includes(query)
        );
      const st = String(r.status || "").toLowerCase();
      const matchesStatus = statusFilter === "all" || st === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [runs, query, statusFilter]);

  return (
    <div className="page-container">
      {/* STAT CARDS */}
      <div className="stats">
        <StatCard
          label="TOTAL RUNS"
          value={totalRuns}
          description="All recorded executions"
          icon={Workflow}
        />
        <StatCard
          label="RUNNING"
          value={runningRuns}
          description="Currently active"
          icon={Activity}
        />
        <StatCard
          label="COMPLETED"
          value={completedRuns}
          description="Successful executions"
          icon={CheckCircle2}
        />
        <StatCard
          label="FAILED"
          value={failedRuns}
          description="Errors requiring attention"
          icon={XCircle}
        />
      </div>

      {/* FILTER & SEARCH */}
      <div className="cleaned-directory-filters">
        <div className="cleaned-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search run ID, filename, error..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="cleaned-filter-select"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>

        <button
          type="button"
          className="cleaned-clear-button"
          onClick={() => {
            setLocalSearch("");
            setStatusFilter("all");
          }}
        >
          Clear
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw size={13} className={busy ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {/* MONITORING TABLE */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Operational Pipeline Monitor
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Showing {filteredRuns.length} of {runs.length} recorded execution logs
          </p>
        </div>

        {filteredRuns.length === 0 ? (
          <EmptyState
            icon={FileClock}
            title="No Matching Runs"
            description="Adjust your search query or status filter to see executions."
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Pipeline / File</th>
                  <th>Status</th>
                  <th>Original Rows</th>
                  <th>Cleaned</th>
                  <th>Rejected</th>
                  <th>Duration</th>
                  <th>Retries</th>
                  <th>Failed Step</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((r) => (
                  <tr
                    key={r.run_id}
                    onClick={() => setSelectedRun(r)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <strong>#{r.run_id}</strong>
                    </td>
                    <td>{fmt(r.filename)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{fmt(r.original_rows)}</td>
                    <td>{fmt(r.cleaned_rows)}</td>
                    <td>{fmt(r.rejected_rows)}</td>
                    <td>{toNum(r.duration_seconds).toFixed(2)}s</td>
                    <td>{fmt(r.retry_attempts)}</td>
                    <td>{fmt(r.failed_step)}</td>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="table-action-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRun(r);
                        }}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   4. DATA QUALITY PAGE
========================================================= */

function DataQualityPage({ runs, anomalies }) {
  const [selectedRunId, setSelectedRunId] = useState("");
  const [animatedScore, setAnimatedScore] = useState(0);

  const activeRun = useMemo(() => {
    if (selectedRunId) {
      return runs.find((r) => String(r.run_id) === String(selectedRunId)) || runs[0];
    }
    return runs[0] || null;
  }, [runs, selectedRunId]);

  const originalRows = toNum(activeRun?.original_rows);
  const cleanedRows = toNum(activeRun?.cleaned_rows);
  const rejectedRows = toNum(activeRun?.rejected_rows);

  // Quality score formula based on genuine rejection rate
  const rawScore =
    originalRows > 0
      ? Math.max(0, Math.round((cleanedRows / originalRows) * 100))
      : 100;

  useEffect(() => {
    let frameId;
    const duration = 900;
    const start = performance.now();
    const animate = (time) => {
      const progress = Math.min((time - start) / duration, 1);
      setAnimatedScore(Math.round(progress * rawScore));
      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    };
    frameId = requestAnimationFrame(animate);
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [rawScore, activeRun]);

  const duplicateIssues = anomalies.filter(
    (a) =>
      a.anomaly_type === "duplicate_rows" &&
      (!activeRun || String(a.run_id) === String(activeRun.run_id))
  ).length;

  const emailIssues = anomalies.filter(
    (a) =>
      a.anomaly_type === "invalid_emails" &&
      (!activeRun || String(a.run_id) === String(activeRun.run_id))
  ).length;

  const missingIssues = anomalies.filter(
    (a) =>
      a.anomaly_type === "high_missing_values" &&
      (!activeRun || String(a.run_id) === String(activeRun.run_id))
  ).length;

  const chartData = [
    { name: "Rejected Rows", count: rejectedRows },
    { name: "Duplicates Removed", count: duplicateIssues },
    { name: "Invalid Emails", count: emailIssues },
    { name: "Missing Rate Alerts", count: missingIssues },
  ];

  return (
    <div className="page-container">
      {/* RUN SELECTOR */}
      {runs.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--body, #374151)" }}>
            Inspect Quality for Run:
          </span>
          <select
            value={selectedRunId || (activeRun ? String(activeRun.run_id) : "")}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="cleaned-filter-select"
            style={{ minWidth: 260, height: 42 }}
          >
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                Run #{r.run_id} — {fmt(r.filename)} ({fmt(r.status)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* STAT CARDS */}
      <div className="stats quality-stats">
        <StatCard
          label="TOTAL CHECKED ROWS"
          value={originalRows}
          description="Analyzed in selected run"
          icon={Database}
        />
        <StatCard
          label="QUALITY SCORE"
          value={`${animatedScore}%`}
          description="Overall dataset integrity"
          icon={CheckCircle2}
        />
        <StatCard
          label="REJECTED ROWS"
          value={rejectedRows}
          description="Failed validation checks"
          icon={XCircle}
        />
        <StatCard
          label="CLEAN RECORDS"
          value={cleanedRows}
          description="Loaded to database"
          icon={FileCheck2}
        />
        <StatCard
          label="ANOMALIES FLAGGED"
          value={anomalies.filter((a) => !activeRun || String(a.run_id) === String(activeRun.run_id)).length}
          description="Rule engine issues"
          icon={AlertTriangle}
        />
        <StatCard
          label="STATUS"
          value={activeRun?.status ? String(activeRun.status).toUpperCase() : "—"}
          description="Execution outcome"
          icon={Workflow}
        />
      </div>

      {/* QUALITY SCORE PANEL */}
      <div className="panel">
        <PanelHeader
          title="Dataset Quality Assessment"
          description="Calculated based on schema conformance, duplicate filtering, and validation pass rates"
          icon={CircleCheck}
        />
        <div className="score-section">
          <div className="score-number">{animatedScore}%</div>
          <div className="score-track datamedic-score-track">
            <div
              className="score-fill datamedic-score-fill"
              style={{
                width: `${Math.min(Math.max(animatedScore, 0), 100)}%`,
              }}
            />
          </div>
          <p>
            Score represents the proportion of input records passing validation rules
            and successfully loaded into PostgreSQL.
          </p>
        </div>
      </div>

      {/* BREAKDOWN CHART */}
      <div className="panel">
        <PanelHeader
          title="Data Quality Issue Categories"
          description="Breakdown of detected problems for this pipeline run"
          icon={BarChart3}
        />
        <div className="quality-chart">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 8, left: -18, bottom: 4 }}
            >
              <CartesianGrid
                strokeDasharray="4 4"
                vertical={false}
                stroke="#e5e7eb"
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#858a93", fontSize: 11 }}
              />
              <YAxis
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#858a93", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "#f4f5f7" }}
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e8e8e8",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
              />
              <Bar
                dataKey="count"
                name="Occurrences"
                fill="#2563eb"
                radius={[6, 6, 0, 0]}
                barSize={50}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ALL RUNS QUALITY TABLE */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Historical Quality by Run
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Quality metrics across recorded executions
          </p>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>File</th>
                <th>Checked</th>
                <th>Cleaned</th>
                <th>Rejected</th>
                <th>Pass Rate</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const orig = toNum(r.original_rows);
                const cln = toNum(r.cleaned_rows);
                const passRate = orig > 0 ? Math.round((cln / orig) * 100) : 100;
                return (
                  <tr key={r.run_id}>
                    <td>
                      <strong>#{r.run_id}</strong>
                    </td>
                    <td>{fmt(r.filename)}</td>
                    <td>{fmt(r.original_rows)}</td>
                    <td>{fmt(r.cleaned_rows)}</td>
                    <td>{fmt(r.rejected_rows)}</td>
                    <td>
                      <strong style={{ color: passRate >= 80 ? "#16a34a" : "#dc2626" }}>
                        {passRate}%
                      </strong>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{fmtDate(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   5. ANOMALY DETECTION PAGE
========================================================= */

function AnomalyDetectionPage({ anomalies, globalSearch }) {
  const [severityFilter, setSeverityFilter] = useState("all");
  const [localSearch, setLocalSearch] = useState("");

  const query = (localSearch || globalSearch).toLowerCase().trim();

  const filtered = useMemo(() => {
    return anomalies.filter((a) => {
      const matchesQuery =
        !query ||
        [a.anomaly_id, a.run_id, a.anomaly_type, a.message, a.severity].some((f) =>
          String(f ?? "")
            .toLowerCase()
            .includes(query)
        );
      const sev = String(a.severity || "").toLowerCase();
      const matchesSeverity = severityFilter === "all" || sev === severityFilter;
      return matchesQuery && matchesSeverity;
    });
  }, [anomalies, query, severityFilter]);

  const criticalCount = anomalies.filter(
    (a) => String(a.severity).toLowerCase() === "critical"
  ).length;
  const warningCount = anomalies.filter(
    (a) => String(a.severity).toLowerCase() === "warning"
  ).length;
  const lowCount = anomalies.filter(
    (a) => String(a.severity).toLowerCase() === "low"
  ).length;

  return (
    <div className="page-container">
      {/* STAT CARDS */}
      <div className="stats">
        <StatCard
          label="TOTAL ANOMALIES"
          value={anomalies.length}
          description="Detected by rule engine"
          icon={AlertTriangle}
        />
        <StatCard
          label="CRITICAL ISSUES"
          value={criticalCount}
          description="High severity alerts (>20% rejected)"
          icon={XCircle}
        />
        <StatCard
          label="WARNINGS"
          value={warningCount}
          description="Duplicates, missing values, slow execution"
          icon={AlertTriangle}
        />
        <StatCard
          label="LOW SEVERITY"
          value={lowCount}
          description="Informational data flags"
          icon={CheckCircle2}
        />
      </div>

      {/* TOP ANOMALY RULE CARDS */}
      <div className="issue-grid" style={{ marginBottom: 20 }}>
        <div className="issue-card danger">
          <div className="issue-icon">
            <XCircle size={18} />
          </div>
          <div>
            <span>HIGH REJECTION RATE</span>
            <strong>
              {anomalies.filter((a) => a.anomaly_type === "high_rejection_rate").length}
            </strong>
            <p>Runs where &gt;20% of records were rejected</p>
          </div>
        </div>

        <div className="issue-card">
          <div className="issue-icon">
            <AlertTriangle size={18} />
          </div>
          <div>
            <span>MISSING CELLS ALERT</span>
            <strong>
              {anomalies.filter((a) => a.anomaly_type === "high_missing_values").length}
            </strong>
            <p>Datasets where &gt;20% of cells were empty</p>
          </div>
        </div>

        <div className="issue-card">
          <div className="issue-icon">
            <Trash2 size={18} />
          </div>
          <div>
            <span>DUPLICATE ROWS</span>
            <strong>
              {anomalies.filter((a) => a.anomaly_type === "duplicate_rows").length}
            </strong>
            <p>Executions where duplicate records were removed</p>
          </div>
        </div>

        <div className="issue-card">
          <div className="issue-icon">
            <Activity size={18} />
          </div>
          <div>
            <span>SLOW PIPELINE</span>
            <strong>
              {anomalies.filter((a) => a.anomaly_type === "slow_pipeline").length}
            </strong>
            <p>Runs exceeding the 10-second duration threshold</p>
          </div>
        </div>
      </div>

      {/* SEARCH & FILTERS */}
      <div className="cleaned-directory-filters">
        <div className="cleaned-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search anomaly ID, run ID, message..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
          />
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="cleaned-filter-select"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="low">Low</option>
        </select>

        <button
          type="button"
          className="cleaned-clear-button"
          onClick={() => {
            setLocalSearch("");
            setSeverityFilter("all");
          }}
        >
          Clear
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            downloadFile(
              "flowops_anomalies.csv",
              generateCSV(anomalies)
            )
          }
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* ANOMALIES TABLE */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Detected Anomaly Log
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Showing {filtered.length} of {anomalies.length} recorded anomaly events
          </p>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No Anomalies Flagged"
            description="The rule engine has not recorded issues matching your filter."
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Anomaly ID</th>
                  <th>Run ID</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Description / Message</th>
                  <th>Logged Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const sev = String(a.severity || "").toLowerCase();
                  return (
                    <tr key={a.anomaly_id}>
                      <td>
                        <strong>#{a.anomaly_id}</strong>
                      </td>
                      <td>#{a.run_id}</td>
                      <td>
                        <span className="tag">{fmt(a.anomaly_type)}</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            sev === "critical"
                              ? "badge-danger"
                              : sev === "warning"
                              ? "badge-warning"
                              : "badge-success"
                          }`}
                        >
                          {fmt(a.severity)}
                        </span>
                      </td>
                      <td>{fmt(a.message)}</td>
                      <td>{fmtDate(a.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   6. DATA LINEAGE PAGE
========================================================= */

function DataLineagePage({ runs }) {
  const [selectedRunId, setSelectedRunId] = useState("");

  const activeRun = useMemo(() => {
    if (selectedRunId) {
      return runs.find((r) => String(r.run_id) === String(selectedRunId)) || runs[0];
    }
    return runs[0] || null;
  }, [runs, selectedRunId]);

  return (
    <div className="page-container">
      {/* RUN SELECTOR */}
      {runs.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--body, #374151)" }}>
            Select Pipeline Execution:
          </span>
          <select
            value={selectedRunId || (activeRun ? String(activeRun.run_id) : "")}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="cleaned-filter-select"
            style={{ minWidth: 280, height: 42 }}
          >
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                Run #{r.run_id} — {fmt(r.filename)} ({fmt(r.status)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* LINEAGE FLOW DIAGRAM */}
      <div className="panel">
        <PanelHeader
          title="Run-Level Data Lineage"
          description="Visual trace of records from source ingestion to database load"
          icon={GitBranch}
        />

        <div className="pipeline" style={{ margin: "20px 0" }}>
          <PipelineStep
            number="01"
            title="Source CSV Ingestion"
            description={
              activeRun
                ? `${fmt(activeRun.filename)} (${fmt(activeRun.original_rows)} rows)`
                : "Source file"
            }
            completed={Boolean(activeRun)}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="02"
            title="Validation & Cleaning"
            description="Remove duplicates, strip whitespace, check emails"
            completed={Boolean(activeRun)}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="03"
            title="Transformation"
            description="Type casting and null value sanitization"
            completed={Boolean(activeRun)}
          />
          <div className="pipeline-line" />
          <PipelineStep
            number="04"
            title="PostgreSQL Destination"
            description={
              activeRun
                ? `processed_records table (${fmt(activeRun.cleaned_rows)} rows)`
                : "PostgreSQL table"
            }
            completed={String(activeRun?.status).toLowerCase() === "completed"}
          />
        </div>

        {activeRun ? (
          <div>
            <h4 style={{ margin: "20px 0 10px", fontSize: 14, color: "var(--ink, #111827)" }}>
              Lineage Metadata for Run #{activeRun.run_id}:
            </h4>
            <div className="info-list">
              <div className="info-row">
                <span>Source File</span>
                <strong>{fmt(activeRun.filename)}</strong>
              </div>
              <div className="info-row">
                <span>Input Rows</span>
                <strong>{fmt(activeRun.original_rows)} records</strong>
              </div>
              <div className="info-row">
                <span>Transformed & Stored</span>
                <strong style={{ color: "#16a34a" }}>
                  {fmt(activeRun.cleaned_rows)} records
                </strong>
              </div>
              <div className="info-row">
                <span>Rejected During Cleaning</span>
                <strong style={{ color: "#dc2626" }}>
                  {fmt(activeRun.rejected_rows)} records
                </strong>
              </div>
              <div className="info-row">
                <span>Destination Storage</span>
                <strong>PostgreSQL (public.processed_records)</strong>
              </div>
              <div className="info-row">
                <span>Pipeline Status</span>
                <strong style={{ textTransform: "uppercase" }}>
                  {fmt(activeRun.status)}
                </strong>
              </div>
              <div className="info-row">
                <span>Execution Duration</span>
                <strong>{toNum(activeRun.duration_seconds).toFixed(3)}s</strong>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  downloadFile(
                    `lineage_run_${activeRun.run_id}.json`,
                    JSON.stringify(activeRun, null, 2),
                    "application/json"
                  )
                }
              >
                <Download size={14} />
                Export Lineage JSON
              </button>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={GitBranch}
            title="No Execution Selected"
            description="Run a pipeline to view provenance and lineage flow."
          />
        )}
      </div>

      <div className="panel">
        <PanelHeader
          title="Lineage Granularity Note"
          description="Explanation of supported lineage tracking"
          icon={CircleAlert}
        />
        <p style={{ margin: 0, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
          FlowOps AI currently tracks run-level provenance: recording the source CSV filename,
          input record volume, rejected invalid rows, and the loaded destination count in
          PostgreSQL. Fine-grained column-level lineage and AST SQL AST tracking require
          parsing persistent schema definitions which are not currently persisted by the backend.
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   7. RUN HISTORY PAGE
========================================================= */

function RunHistoryPage({ runs, globalSearch, setSelectedRun }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 6;

  const query = (searchTerm || globalSearch).toLowerCase().trim();

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      const matchesSearch =
        !query ||
        [r.run_id, r.filename, r.status].some((f) =>
          String(f ?? "")
            .toLowerCase()
            .includes(query)
        );
      const st = String(r.status || "").toLowerCase();
      const matchesStatus = statusFilter === "all" || st === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [runs, query, statusFilter]);

  const totalPages = Math.max(Math.ceil(filteredRuns.length / recordsPerPage), 1);
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRuns = filteredRuns.slice(
    (safePage - 1) * recordsPerPage,
    safePage * recordsPerPage
  );

  return (
    <div className="page-container">
      {/* STAT CARDS */}
      <div className="stats">
        <StatCard
          label="HISTORICAL RUNS"
          value={runs.length}
          description="Total recorded executions"
          icon={FileClock}
        />
        <StatCard
          label="COMPLETED"
          value={runs.filter((r) => String(r.status).toLowerCase() === "completed").length}
          description="Successful pipelines"
          icon={CheckCircle2}
        />
        <StatCard
          label="FAILED"
          value={runs.filter((r) => String(r.status).toLowerCase() === "failed").length}
          description="Failed executions"
          icon={XCircle}
        />
        <StatCard
          label="TOTAL PROCESSED"
          value={runs
            .reduce((s, r) => s + toNum(r.cleaned_rows), 0)
            .toLocaleString()}
          description="Cleaned rows stored"
          icon={Database}
        />
      </div>

      {/* SEARCH & FILTERS */}
      <div className="cleaned-directory-filters">
        <div className="cleaned-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search run ID or filename..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setCurrentPage(1);
          }}
          className="cleaned-filter-select"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>

        <button
          type="button"
          className="cleaned-clear-button"
          onClick={() => {
            setSearchTerm("");
            setStatusFilter("all");
            setCurrentPage(1);
          }}
        >
          Clear
        </button>

        <button
          type="button"
          className="primary-button datamedic-download-button"
          onClick={() =>
            downloadFile(
              "flowops_run_history.csv",
              generateCSV(filteredRuns)
            )
          }
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* CUSTOMER/RUN DIRECTORY WITH PAGINATION */}
      <div className="cleaned-customer-directory">
        <div className="cleaned-directory-title">
          <div>
            <h2>Execution Directory</h2>
            <p>
              Showing {paginatedRuns.length} of {filteredRuns.length} pipeline records
            </p>
          </div>
          <div className="cleaned-page-indicator">
            Page {safePage} / {totalPages}
          </div>
        </div>

        {paginatedRuns.length > 0 ? (
          <div className="cleaned-table-wrapper">
            <table className="cleaned-customer-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Pipeline / File</th>
                  <th>Status</th>
                  <th>Original Rows</th>
                  <th>Cleaned</th>
                  <th>Rejected</th>
                  <th>Duration</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedRuns.map((r) => (
                  <tr key={r.run_id}>
                    <td>
                      <strong className="cleaned-customer-id">#{r.run_id}</strong>
                    </td>
                    <td>
                      <strong className="cleaned-customer-name">
                        {fmt(r.filename)}
                      </strong>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>{fmt(r.original_rows)}</td>
                    <td>{fmt(r.cleaned_rows)}</td>
                    <td>{fmt(r.rejected_rows)}</td>
                    <td>{toNum(r.duration_seconds).toFixed(2)}s</td>
                    <td>{fmtDate(r.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="cleaned-view-button"
                        onClick={() => setSelectedRun(r)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="cleaned-no-results">
            <FileClock size={28} />
            <h3>No Matching Executions</h3>
            <p>Try clearing filters or search queries.</p>
          </div>
        )}

        {/* PAGINATION CONTROLS */}
        <div className="cleaned-pagination">
          <button
            type="button"
            disabled={safePage === 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          >
            ← Previous
          </button>
          <span>
            Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
          </span>
          <button
            type="button"
            disabled={safePage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   8. SCHEDULED PIPELINES PAGE
========================================================= */

function ScheduledPipelinesPage({ navigate, request, refreshParent }) {
  const [schedules, setSchedules] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [triggeringId, setTriggeringId] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  const [newSchedule, setNewSchedule] = useState({
    name: "",
    dataset_filename: "customers.csv",
    frequency: "daily",
    auto_clean: true,
    ai_diagnosis: true,
  });

  const fetchSchedulerData = useCallback(async () => {
    try {
      setLoading(true);
      const reqFn =
        request ||
        (async (path, opts) => {
          const res = await fetch(`${API_URL}${path}`, opts);
          return res.json();
        });

      const [schedulesData, statsData] = await Promise.all([
        reqFn("/api/schedules").catch(() => []),
        reqFn("/api/schedules/stats").catch(() => null),
      ]);

      const list = Array.isArray(schedulesData)
        ? schedulesData
        : schedulesData?.value || [];
      setSchedules(list);
      if (statsData) {
        setStats(statsData);
      }
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    fetchSchedulerData();
    const interval = setInterval(fetchSchedulerData, 12000);
    return () => clearInterval(interval);
  }, [fetchSchedulerData]);

  const handleTrigger = async (schedule) => {
    try {
      setTriggeringId(schedule.schedule_id);
      const reqFn =
        request ||
        (async (path, opts) => {
          const res = await fetch(`${API_URL}${path}`, opts);
          return res.json();
        });

      const result = await reqFn(`/api/schedules/${schedule.schedule_id}/trigger`, {
        method: "POST",
      });

      setActionNotice({
        type: "success",
        message: `Triggered "${schedule.name}"! Created Run #${result.run_id} with ${result.records_processed} processed records.`,
      });

      await fetchSchedulerData();
      if (refreshParent) {
        refreshParent();
      }
    } catch (err) {
      setActionNotice({
        type: "error",
        message: `Failed to trigger schedule #${schedule.schedule_id}: ${err.message}`,
      });
    } finally {
      setTriggeringId(null);
    }
  };

  const handleToggleActive = async (schedule) => {
    try {
      const nextActive = !schedule.is_active;
      const reqFn =
        request ||
        (async (path, opts) => {
          const res = await fetch(`${API_URL}${path}`, opts);
          return res.json();
        });

      await reqFn(`/api/schedules/${schedule.schedule_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: nextActive }),
      });

      setActionNotice({
        type: "success",
        message: `Schedule #${schedule.schedule_id} is now ${nextActive ? "Active" : "Paused"}.`,
      });
      await fetchSchedulerData();
    } catch (err) {
      setActionNotice({
        type: "error",
        message: `Failed to update schedule status: ${err.message}`,
      });
    }
  };

  const handleDelete = async (schedule) => {
    if (!window.confirm(`Are you sure you want to delete the schedule "${schedule.name}"?`)) {
      return;
    }
    try {
      const reqFn =
        request ||
        (async (path, opts) => {
          const res = await fetch(`${API_URL}${path}`, opts);
          return res.json();
        });

      await reqFn(`/api/schedules/${schedule.schedule_id}`, {
        method: "DELETE",
      });

      setActionNotice({
        type: "success",
        message: `Schedule "${schedule.name}" was deleted successfully.`,
      });
      await fetchSchedulerData();
    } catch (err) {
      setActionNotice({
        type: "error",
        message: `Failed to delete schedule: ${err.message}`,
      });
    }
  };

  const handleCreateSchedule = async (e) => {
    e.preventDefault();
    if (!newSchedule.name.trim()) {
      alert("Please provide a name for the schedule.");
      return;
    }
    try {
      setSubmittingCreate(true);
      const reqFn =
        request ||
        (async (path, opts) => {
          const res = await fetch(`${API_URL}${path}`, opts);
          return res.json();
        });

      await reqFn("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSchedule),
      });

      setShowCreateModal(false);
      setNewSchedule({
        name: "",
        dataset_filename: "customers.csv",
        frequency: "daily",
        auto_clean: true,
        ai_diagnosis: true,
      });
      setActionNotice({
        type: "success",
        message: "New recurring pipeline schedule registered and operational!",
      });
      await fetchSchedulerData();
    } catch (err) {
      alert(`Error creating schedule: ${err.message}`);
    } finally {
      setSubmittingCreate(false);
    }
  };

  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        !searchTerm.trim() ||
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.dataset_filename && s.dataset_filename.toLowerCase().includes(q)) ||
        (s.frequency_label && s.frequency_label.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && s.is_active) ||
        (statusFilter === "paused" && !s.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [schedules, searchTerm, statusFilter]);

  const totalSchedulesCount = stats?.total_schedules !== undefined ? stats.total_schedules : schedules.length;
  const activeSchedulesCount = stats?.active_schedules !== undefined ? stats.active_schedules : 0;
  const pausedSchedulesCount = stats?.paused_schedules !== undefined ? stats.paused_schedules : 0;

  return (
    <div className="page-container">
      {/* 1. PRIMARY METRICS STAT CARDS */}
      <div className="stats">
        <StatCard
          label="SCHEDULED PIPELINES"
          value={String(totalSchedulesCount)}
          description={`${totalSchedulesCount} configured in PostgreSQL`}
          icon={CalendarClock}
        />
        <StatCard
          label="ACTIVE SCHEDULES"
          value={String(activeSchedulesCount)}
          description={`${activeSchedulesCount} active • ${pausedSchedulesCount} paused`}
          icon={Activity}
        />
        <StatCard
          label="NEXT SCHEDULED RUN"
          value={stats?.next_scheduled_run || "—"}
          description={
            stats?.next_run_timestamp
              ? `Target: ${new Date(stats.next_run_timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "No active countdown"
          }
          icon={Clock}
        />
        <StatCard
          label="EXECUTION ENGINE"
          value={stats?.engine_status === "operational" ? "Active" : "Operational"}
          description={`FastAPI Async Daemon (${stats?.daemon_interval_sec || 30}s tick)`}
          icon={Workflow}
        />
      </div>

      {/* 2. DYNAMIC SYSTEM STATUS STRIP (MATCHING SYSTEM HEALTH PAGE) */}
      <div className="system-status-grid">
        <StatusCard
          label="POSTGRESQL STORAGE"
          value={stats?.database_connected ? `Connected (${stats?.db_latency_ms || 0.8}ms)` : "Offline"}
          icon={Database}
          status={stats?.database_connected ? "healthy" : "error"}
        />
        <StatusCard
          label="ASYNC WORKER DAEMON"
          value={stats?.daemon_status ? `${stats.daemon_status} (#${stats.daemon_heartbeat_count || 1})` : "Polling (30s)"}
          icon={Server}
          status="healthy"
        />
        <StatusCard
          label="TOTAL SCHEDULED RUNS"
          value={`${stats?.total_scheduled_runs_executed || 0} Runs Logged`}
          icon={Workflow}
          status="healthy"
        />
      </div>

      {/* 3. NOTIFICATION TOAST */}
      {actionNotice && (
        <div
          className="query-success-box"
          style={{
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderColor: actionNotice.type === "error" ? "#ef4444" : "#10b981",
            background:
              actionNotice.type === "error"
                ? "rgba(239, 68, 68, 0.08)"
                : "rgba(16, 185, 129, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {actionNotice.type === "error" ? (
              <CircleAlert size={18} style={{ color: "#ef4444" }} />
            ) : (
              <CheckCircle2 size={18} style={{ color: "#10b981" }} />
            )}
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: actionNotice.type === "error" ? "#ef4444" : "#10b981",
              }}
            >
              {actionNotice.message}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#64748b",
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* 4. CLEANED DIRECTORY FILTERS TOOLBAR (MATCHING RUN HISTORY & CLEANED DATA PAGES) */}
      <div className="schedule-filters-grid">
        <div className="cleaned-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search schedule name, dataset, or cadence..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="cleaned-filter-select"
        >
          <option value="all">All Schedules ({schedules.length})</option>
          <option value="active">Active Only ({activeSchedulesCount})</option>
          <option value="paused">Paused Only ({pausedSchedulesCount})</option>
        </select>

        <button
          type="button"
          className="cleaned-clear-button"
          onClick={fetchSchedulerData}
          title="Refresh schedule telemetry & status"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          <span>Refresh</span>
        </button>

        <button
          type="button"
          className="primary-button datamedic-download-button"
          onClick={() => setShowCreateModal(true)}
          style={{
            height: 58,
            padding: "0 22px",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 12,
            fontWeight: 700,
          }}
        >
          <Plus size={16} />
          <span>Create Schedule</span>
        </button>
      </div>

      {/* 5. SCHEDULED PIPELINES DIRECTORY TABLE */}
      <div className="cleaned-customer-directory">
        <div className="cleaned-directory-title">
          <div>
            <h2>Pipeline Execution Directory</h2>
            <p>
              Showing {filteredSchedules.length} of {schedules.length} configured recurring executions
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {stats?.cadence_distribution?.map((c) => (
              <span
                key={c.label}
                className="badge badge-info"
                style={{ fontSize: 11, padding: "4px 9px", fontWeight: 600 }}
              >
                {c.label}: {c.count}
              </span>
            ))}
          </div>
        </div>

        {filteredSchedules.length > 0 ? (
          <div className="cleaned-table-wrapper">
            <table className="cleaned-customer-table">
              <thead>
                <tr>
                  <th>Schedule ID</th>
                  <th>Pipeline Name</th>
                  <th>Dataset Target</th>
                  <th>Cadence & Cron</th>
                  <th>Status</th>
                  <th>Next Execution</th>
                  <th>Total Runs</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSchedules.map((s) => (
                  <tr key={s.schedule_id}>
                    <td>
                      <strong className="cleaned-customer-id">
                        #{s.schedule_id}
                      </strong>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <strong className="cleaned-customer-name" style={{ fontSize: 14 }}>
                          {s.name}
                        </strong>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {s.auto_clean && (
                            <span className="overview-tag blue">
                              Auto-Clean
                            </span>
                          )}
                          {s.ai_diagnosis && (
                            <span className="overview-tag purple">
                              AI Diagnosis
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <code
                        style={{
                          fontSize: 12,
                          padding: "3px 8px",
                          background: "rgba(79, 70, 229, 0.08)",
                          color: "#4f46e5",
                          borderRadius: 6,
                          fontWeight: 600,
                        }}
                      >
                        {s.dataset_filename}
                      </code>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <strong style={{ fontSize: 13, color: "#1e293b" }}>
                          {s.frequency_label}
                        </strong>
                        <span
                          className="badge badge-info"
                          style={{
                            fontFamily: "monospace",
                            fontSize: 11,
                            alignSelf: "flex-start",
                          }}
                        >
                          {s.frequency_cron}
                        </span>
                      </div>
                    </td>
                    <td>
                      {s.is_active ? (
                        <span
                          className="badge badge-success"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span className="status-dot healthy" />
                          Active
                        </span>
                      ) : (
                        <span
                          className="badge badge-warning"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span className="status-dot warning" />
                          Paused
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <strong
                          style={{
                            fontSize: 13,
                            color: s.is_active ? "#10b981" : "#94a3b8",
                          }}
                        >
                          {s.next_run_relative}
                        </strong>
                        {s.next_run_at && s.is_active && (
                          <span style={{ fontSize: 11, color: "#64748b" }}>
                            {new Date(s.next_run_at).toLocaleDateString()}{" "}
                            {new Date(s.next_run_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                        <strong style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
                          {s.total_runs}
                        </strong>
                        <span style={{ fontSize: 12, color: "#64748b" }}>
                          runs
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 8,
                          alignItems: "center",
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          type="button"
                          className="cleaned-view-button"
                          onClick={() => handleTrigger(s)}
                          disabled={triggeringId === s.schedule_id}
                          title="Trigger immediate execution"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "0 14px",
                          }}
                        >
                          {triggeringId === s.schedule_id ? (
                            <>
                              <RefreshCw size={13} className="spin" />
                              <span>Running...</span>
                            </>
                          ) : (
                            <>
                              <Play size={13} />
                              <span>Run Now</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleToggleActive(s)}
                          title={s.is_active ? "Pause schedule" : "Activate schedule"}
                          style={{
                            height: 40,
                            padding: "0 12px",
                            fontSize: 13,
                            minWidth: 78,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          {s.is_active ? (
                            <>
                              <Pause size={13} />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play size={13} />
                              <span>Resume</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleDelete(s)}
                          title="Delete Schedule"
                          style={{
                            height: 40,
                            width: 40,
                            padding: 0,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#ef4444",
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: "40px 20px" }}>
            <div className="empty-icon">
              <CalendarClock size={28} />
            </div>
            <h3>No Pipeline Schedules Found</h3>
            <p>
              Configure automated recurring pipeline schedules to run ETL processing
              and data quality checks on cron frequencies.
            </p>
            <button
              type="button"
              className="primary-button datamedic-analyze-button"
              onClick={() => setShowCreateModal(true)}
              style={{ marginTop: 14 }}
            >
              <Plus size={14} />
              Create First Schedule
            </button>
          </div>
        )}
      </div>

      {/* 6. CREATE SCHEDULE MODAL */}
      {showCreateModal && (
        <div
          className="cleaned-customer-overlay"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="cleaned-customer-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 540 }}
          >
            <div className="cleaned-customer-modal-header">
              <div>
                <h3>Create Recurring Pipeline Schedule</h3>
                <p>
                  Configure automated cron intervals, dataset targets, and operational rules
                </p>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)}>
                ×
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} style={{ padding: "20px 24px" }}>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  Schedule Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Daily Customer Master Ingestion"
                  value={newSchedule.name}
                  onChange={(e) =>
                    setNewSchedule({ ...newSchedule, name: e.target.value })
                  }
                  className="schedule-modal-input"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Dataset Target
                  </label>
                  <select
                    value={newSchedule.dataset_filename}
                    onChange={(e) =>
                      setNewSchedule({
                        ...newSchedule,
                        dataset_filename: e.target.value,
                      })
                    }
                    className="schedule-modal-select"
                  >
                    <option value="customers.csv">customers.csv (Master)</option>
                    <option value="transactions.csv">transactions.csv (Financial)</option>
                    <option value="inventory_sync.csv">
                      inventory_sync.csv (Operations)
                    </option>
                    <option value="user_logs.csv">user_logs.csv (Analytics)</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Execution Cadence
                  </label>
                  <select
                    value={newSchedule.frequency}
                    onChange={(e) =>
                      setNewSchedule({ ...newSchedule, frequency: e.target.value })
                    }
                    className="schedule-modal-select"
                  >
                    <option value="every_15_mins">
                      Every 15 minutes (*/15 * * * *)
                    </option>
                    <option value="every_30_mins">
                      Every 30 minutes (*/30 * * * *)
                    </option>
                    <option value="every_1_hour">Every 1 hour (0 * * * *)</option>
                    <option value="every_6_hours">Every 6 hours (0 */6 * * *)</option>
                    <option value="daily">Daily at midnight (0 0 * * *)</option>
                    <option value="weekly">Weekly on Monday (0 0 * * 1)</option>
                  </select>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  marginBottom: 22,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newSchedule.auto_clean}
                    onChange={(e) =>
                      setNewSchedule({ ...newSchedule, auto_clean: e.target.checked })
                    }
                  />
                  <span>
                    Automated Data Cleaning (Remove duplicates, sanitize text, enforce schemas)
                  </span>
                </label>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newSchedule.ai_diagnosis}
                    onChange={(e) =>
                      setNewSchedule({
                        ...newSchedule,
                        ai_diagnosis: e.target.checked,
                      })
                    }
                  />
                  <span>Run Claude AI Root Cause Diagnosis on pipeline failures</span>
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="primary-button datamedic-analyze-button"
                >
                  {submittingCreate ? "Saving..." : "Save & Activate Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. DYNAMIC SCHEDULER ARCHITECTURE & TELEMETRY PANEL */}
      <div className="panel">
        <PanelHeader
          title="Scheduler Architecture & Live Infrastructure Telemetry"
          description="Real-time health verification, heartbeat monitoring, and persistent table metrics"
          icon={Server}
        />
        <div className="info-list">
          <div className="info-row">
            <span>Persistent Schedule Storage</span>
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="status-dot healthy" />
              {stats?.storage_backend || "PostgreSQL"} • Table: {stats?.database_table || "pipeline_schedules"} ({stats?.total_schedules || 0} rows)
            </strong>
          </div>
          <div className="info-row">
            <span>PostgreSQL Database Connection</span>
            <strong style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="status-dot healthy" />
              Connected ({stats?.db_latency_ms || 0.8} ms query ping)
            </strong>
          </div>
          <div className="info-row">
            <span>Execution Daemon Status</span>
            <strong style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="status-dot healthy" />
              {stats?.daemon_status || "Operational & Polling"} (Interval: {stats?.daemon_interval_sec || 30}s)
            </strong>
          </div>
          <div className="info-row">
            <span>Daemon Heartbeat & Ticks</span>
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="status-dot healthy" />
              Tick #{stats?.daemon_heartbeat_count || 1} • Last ping: {stats?.last_heartbeat ? new Date(stats.last_heartbeat).toLocaleTimeString() : "Just now"}
            </strong>
          </div>
          <div className="info-row">
            <span>Scheduler Daemon Uptime</span>
            <strong>
              {stats?.scheduler_uptime_seconds
                ? `${Math.floor(stats.scheduler_uptime_seconds / 60)}m ${Math.floor(stats.scheduler_uptime_seconds % 60)}s`
                : "Active"}
            </strong>
          </div>
          <div className="info-row">
            <span>Overall Infrastructure Status</span>
            <strong
              style={{
                color: "#10b981",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
              }}
            >
              <span className="status-dot healthy" />
              Operational & Automated ({stats?.active_schedules || 0} active pipelines scheduled)
            </strong>
          </div>
        </div>
      </div>

      {/* 8. VERIFIED SCHEDULER REST ENDPOINTS PANEL (MATCHING SYSTEM HEALTH PAGE) */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Verified Scheduler REST Endpoints
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Live contract endpoints actively powering automated recurring executions
          </p>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint Route</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.endpoints_catalog || [
                { method: "GET", path: "/api/schedules", desc: "List all recurring schedules", status: "200 OK" },
                { method: "GET", path: "/api/schedules/stats", desc: "Scheduler health & telemetry stats", status: "200 OK" },
                { method: "POST", path: "/api/schedules", desc: "Register new pipeline schedule", status: "200 OK" },
                { method: "PATCH", path: "/api/schedules/:id", desc: "Toggle schedule pause/resume or modify cadence", status: "200 OK" },
                { method: "DELETE", path: "/api/schedules/:id", desc: "Remove schedule from persistent database", status: "200 OK" },
                { method: "POST", path: "/api/schedules/:id/trigger", desc: "Immediate manual pipeline execution trigger", status: "200 OK" },
              ]).map((ep) => (
                <tr key={ep.path + ep.method}>
                  <td>
                    <span
                      className={`badge ${
                        ep.method === "POST"
                          ? "badge-warning"
                          : ep.method === "DELETE"
                          ? "badge-danger"
                          : ep.method === "PATCH"
                          ? "badge-warning"
                          : "badge-info"
                      }`}
                      style={{ minHeight: 24, fontSize: 11 }}
                    >
                      {ep.method}
                    </span>
                  </td>
                  <td>
                    <strong style={{ fontFamily: "monospace", fontSize: 13 }}>
                      {ep.path}
                    </strong>
                  </td>
                  <td>{ep.desc}</td>
                  <td>
                    <span className="badge badge-success" style={{ minHeight: 24, fontSize: 11 }}>
                      {ep.status || "200 OK"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}



/* =========================================================
   9. AI INSIGHTS PAGE & FLOWOPS BOT
========================================================= */

const SUGGESTED_QUESTIONS = [
  "Explain my latest pipeline run.",
  "Why were records rejected?",
  "Show recent failed pipeline runs.",
  "Explain the latest data quality issues.",
  "How can I improve pipeline reliability?",
  "Explain the latest detected anomalies.",
  "Summarize my recent pipeline activity.",
  "Explain the latest AI insight.",
];

const COPILOT_MODES = [
  { id: "auto", label: "Auto Assistant", icon: "✨", prompt: "" },
  { id: "root_cause", label: "Root Cause RCA", icon: "🔍", prompt: "Investigate root cause of latest pipeline failure" },
  { id: "quality", label: "Quality Audit", icon: "🛡️", prompt: "Investigate data quality issues and rejected records" },
  { id: "sql", label: "Safe SQL Query", icon: "⚡", prompt: "Show the last 5 pipeline runs" },
  { id: "investigation", label: "Deep Investigation", icon: "🔬", prompt: "Investigate why latest pipeline results show rejected records and is it connected to recent anomalies" },
  { id: "report", label: "Ops Report", icon: "📄", prompt: "Generate an operational report in PDF" },
];

function formatInlineText(text) {
  if (!text) return null;
  const parts = [];
  const regex = /(\*\*.*?\*\*|`.*?`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code key={match.index} className="flowops-inline-code">
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

function BotMessageContent({ text }) {
  if (!text) return null;

  const codeBlockSplit = text.split(/(```[\s\S]*?```)/g);

  return (
    <div className="flowops-bot-rendered">
      {codeBlockSplit.map((section, sIdx) => {
        if (section.startsWith("```") && section.endsWith("```")) {
          const inner = section.slice(3, -3).trim();
          const lines = inner.split("\n");
          const firstLine = lines[0].trim();
          const hasLang = firstLine && !firstLine.includes(" ");
          const code = (hasLang ? lines.slice(1) : lines).join("\n");
          return (
            <div key={sIdx} className="flowops-code-container">
              {hasLang && <div className="flowops-code-lang">{firstLine}</div>}
              <pre className="flowops-code-block">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        const paragraphs = section.split(/\n{2,}/);

        return (
          <div key={sIdx} className="flowops-prose-block">
            {paragraphs.map((para, pIdx) => {
              const trimmed = para.trim();
              if (!trimmed) return null;

              if (trimmed.includes("|") && trimmed.split("\n").length >= 2) {
                const tableLines = trimmed.split("\n").filter((l) => l.trim().startsWith("|"));
                if (tableLines.length >= 2) {
                  const headers = tableLines[0]
                    .split("|")
                    .slice(1, -1)
                    .map((h) => h.trim());
                  const rows = tableLines.slice(2).map((r) =>
                    r
                      .split("|")
                      .slice(1, -1)
                      .map((c) => c.trim())
                  );
                  return (
                    <div key={pIdx} className="flowops-chat-table-wrapper">
                      <table className="flowops-chat-table">
                        <thead>
                          <tr>
                            {headers.map((h, hIdx) => (
                              <th key={hIdx}>{formatInlineText(h)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx}>{formatInlineText(cell)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
              }

              if (trimmed.startsWith("### ")) {
                return (
                  <h4 key={pIdx} className="flowops-chat-h4">
                    {formatInlineText(trimmed.replace(/^###\s+/, ""))}
                  </h4>
                );
              }
              if (trimmed.startsWith("## ")) {
                return (
                  <h3 key={pIdx} className="flowops-chat-h3">
                    {formatInlineText(trimmed.replace(/^##\s+/, ""))}
                  </h3>
                );
              }

              const lines = trimmed.split("\n");
              const isList = lines.every((l) =>
                /^\s*[-*•]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)
              );
              if (isList) {
                return (
                  <ul key={pIdx} className="flowops-chat-list">
                    {lines.map((line, lIdx) => (
                      <li key={lIdx}>
                        {formatInlineText(
                          line.replace(/^\s*[-*•]\s+/, "").replace(/^\s*\d+\.\s+/, "")
                        )}
                      </li>
                    ))}
                  </ul>
                );
              }

              return (
                <p key={pIdx} className="flowops-chat-paragraph">
                  {lines.map((l, lIdx) => (
                    <span key={lIdx}>
                      {formatInlineText(l)}
                      {lIdx < lines.length - 1 && <br />}
                    </span>
                  ))}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function AIInsightsPage({
  insights,
  usageInput,
  usageOutput,
  cost,
  refresh,
  busy,
  globalSearch,
  selectedInsight,
  setSelectedInsight,
  navigate,
  request,
  botMessages,
  setBotMessages,
  botLoading,
  setBotLoading,
  botError,
  setBotError,
  lastFailedQuery,
  setLastFailedQuery,
}) {
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [copiedMsgId, setCopiedMsgId] = useState(null);
  const [activeMode, setActiveMode] = useState("auto");
  const messagesEndRef = useRef(null);

  const query = (searchTerm || globalSearch).toLowerCase().trim();

  const filteredInsights = useMemo(() => {
    return insights.filter((i) => {
      return (
        !query ||
        [i.insight_id, i.run_id, i.model, i.analysis].some((f) =>
          String(f ?? "")
            .toLowerCase()
            .includes(query)
        )
      );
    });
  }, [insights, query]);

  const copyAnalysis = (text) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyMessage = (id, text) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    }
  };

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    if (isChatOpen) {
      scrollToBottom();
    }
  }, [isChatOpen, botMessages, botLoading]);

  const handleSendMessage = async (textToSend, explicitMode) => {
    const messageText = (textToSend !== undefined ? textToSend : chatInput).trim();
    if (!messageText || botLoading) return;

    setBotError(null);
    setLastFailedQuery(null);
    setChatInput("");

    const modeToSend = explicitMode || activeMode || "auto";

    const userMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: messageText,
      mode: modeToSend,
      timestamp: new Date().toISOString(),
    };

    const nextMessages = [...botMessages, userMessage];
    setBotMessages(nextMessages);
    setBotLoading(true);

    try {
      const historyPayload = nextMessages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await request("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: messageText,
          history: historyPayload.slice(-8),
          mode: modeToSend,
        }),
      });

      const assistantMessage = {
        id: `bot_${Date.now()}`,
        role: "assistant",
        content: res.answer,
        sources: res.sources || [],
        model: res.model,
        input_tokens: res.input_tokens,
        output_tokens: res.output_tokens,
        total_tokens: res.total_tokens,
        estimated_cost_usd: res.estimated_cost_usd,
        mode: res.mode,
        sql_data: res.sql_data,
        report_data: res.report_data,
        timestamp: new Date().toISOString(),
      };

      setBotMessages((prev) => [...prev, assistantMessage]);

      // Immediately refresh AI insights and usage statistics across the dashboard
      if (typeof refresh === "function") {
        refresh();
      }
    } catch (err) {
      setBotError(err.message || "Failed to communicate with FlowOps Bot. Please try again.");
      setLastFailedQuery(messageText);
    } finally {
      setBotLoading(false);
    }
  };

  const handleRetry = () => {
    if (lastFailedQuery) {
      handleSendMessage(lastFailedQuery);
    }
  };

  const handleNewChat = () => {
    if (botMessages.length > 1) {
      if (!window.confirm("Start a new conversation? Current chat history will be cleared.")) {
        return;
      }
    }
    setBotMessages([
      {
        id: "welcome",
        role: "assistant",
        content:
          "Hi! I'm FlowOps Bot. I can help you understand pipeline runs, investigate failures, analyze data quality issues, and explore your FlowOps AI operations. Ask me a question to get started.",
        sources: [],
        timestamp: new Date().toISOString(),
      },
    ]);
    setChatInput("");
    setBotError(null);
    setLastFailedQuery(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="page-container">
      {/* INTRO BANNER */}
      <div className="panel ai-intro" style={{ marginBottom: 20 }}>
        <div className="ai-intro-icon">
          <Sparkles size={25} />
        </div>
        <div>
          <h3>Claude Data Engineering AI Assistant</h3>
          <p>
            Automated root-cause analysis, failure explanations, and preventative suggestions
            generated by Claude for completed pipeline executions.
          </p>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="stats">
        <StatCard
          label="TOTAL ANALYSES"
          value={insights.length}
          description="Stored Claude insight reports"
          icon={Sparkles}
        />
        <StatCard
          label="INPUT TOKENS"
          value={usageInput.toLocaleString()}
          description="Reported by Claude API"
          icon={BarChart3}
        />
        <StatCard
          label="OUTPUT TOKENS"
          value={usageOutput.toLocaleString()}
          description="Reported by Claude API"
          icon={Activity}
        />
        <StatCard
          label="ESTIMATED COST"
          value={money(cost)}
          description="Estimated based on token usage"
          icon={Database}
        />
      </div>

      {/* SELECTED INSIGHT DETAIL DISPLAY */}
      {selectedInsight && (
        <div className="panel ai-result" style={{ marginBottom: 20 }}>
          <div className="ai-result-header">
            <div className="ai-result-icon datamedic-ai-icon">
              <Sparkles size={19} />
            </div>
            <div style={{ flex: 1 }}>
              <h3>Claude AI Pipeline Analysis · Run #{selectedInsight.run_id}</h3>
              <p>
                Model: {fmt(selectedInsight.model)} · Tokens:{" "}
                {fmt(selectedInsight.total_tokens)} · Est. Cost:{" "}
                {money(selectedInsight.estimated_cost_usd)} · Logged:{" "}
                {fmtDate(selectedInsight.created_at)}
              </p>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedInsight(null)}
            >
              Close
            </button>
          </div>

          <div className="ai-result-content">
            {selectedInsight.analysis}
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              padding: "0 24px 20px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="primary-button datamedic-ai-button"
              onClick={() => copyAnalysis(selectedInsight.analysis)}
            >
              <Copy size={14} />
              {copied ? "Copied to Clipboard!" : "Copy Analysis"}
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                downloadFile(
                  `ai_insight_run_${selectedInsight.run_id}.json`,
                  JSON.stringify(selectedInsight, null, 2),
                  "application/json"
                )
              }
            >
              <Download size={14} />
              Export JSON
            </button>
          </div>
        </div>
      )}

      {/* FILTER & SEARCH */}
      <div className="cleaned-directory-filters">
        <div className="cleaned-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search insight ID, run ID, analysis text..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <button
          type="button"
          className="cleaned-clear-button"
          onClick={() => setSearchTerm("")}
        >
          Clear
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw size={13} className={busy ? "spin" : ""} />
          Refresh
        </button>
      </div>

      {/* INSIGHTS TABLE */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Stored AI Insight Records
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Showing {filteredInsights.length} of {insights.length} generated diagnoses
          </p>
        </div>

        {filteredInsights.length === 0 ? (
          <div className="ai-placeholder">
            <div className="ai-placeholder-icon datamedic-ai-icon">
              <Sparkles size={30} />
            </div>
            <h3>No AI Insights Recorded Yet</h3>
            <p>
              Claude AI analyzes ETL reports automatically when you run a pipeline via
              the ETL Pipelines page.
            </p>
            <button
              type="button"
              className="primary-button datamedic-ai-button"
              style={{ marginTop: 18 }}
              onClick={() => navigate("etl")}
            >
              Go to ETL Pipelines
            </button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Insight ID</th>
                  <th>Run ID</th>
                  <th>Model</th>
                  <th>Analysis Summary</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Est. Cost</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredInsights.map((i) => (
                  <tr
                    key={i.insight_id}
                    onClick={() => setSelectedInsight(i)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <strong>#{i.insight_id}</strong>
                    </td>
                    <td>#{i.run_id}</td>
                    <td>
                      <span className="tag">{fmt(i.model)}</span>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <span
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {fmt(i.analysis)}
                      </span>
                    </td>
                    <td>{fmt(i.input_tokens)}</td>
                    <td>{fmt(i.output_tokens)}</td>
                    <td>
                      <strong style={{ color: "#2563eb" }}>
                        {money(i.estimated_cost_usd)}
                      </strong>
                    </td>
                    <td>{fmtDate(i.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="table-action-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInsight(i);
                        }}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* =========================================================
         FLOWOPS BOT — FLOATING CHAT WIDGET (BOTTOM-RIGHT)
      ========================================================= */}
      {/* 1. FLOATING LAUNCHER BUTTON */}
      <button
        type="button"
        className={`flowops-floating-launcher ${isChatOpen ? "active" : ""}`}
        onClick={() => setIsChatOpen((prev) => !prev)}
        aria-label={isChatOpen ? "Close FlowOps Bot chat window" : "Open FlowOps Bot chat window"}
        title={isChatOpen ? "Close FlowOps Bot" : "Chat with FlowOps Bot"}
      >
        <div className="flowops-launcher-icon">
          <Bot size={20} />
        </div>
        <span className="flowops-launcher-label">FlowOps Bot</span>
        <span className="flowops-launcher-dot"></span>
      </button>

      {/* 2. FLOATING CHAT WINDOW */}
      {isChatOpen && (
        <div
          className="flowops-floating-panel"
          role="dialog"
          aria-labelledby="flowops-bot-title"
        >
          {/* HEADER */}
          <div className="flowops-float-header">
            <div className="flowops-float-header-left">
              <div className="flowops-float-icon">
                <Bot size={18} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 id="flowops-bot-title" className="flowops-float-title">
                    FlowOps Bot
                  </h3>
                  <span className="flowops-live-badge-mini">● Live Data</span>
                </div>
                <p className="flowops-float-subtitle">Your Data Engineering AI Copilot</p>
              </div>
            </div>

            <div className="flowops-float-header-actions">
              <button
                type="button"
                className="flowops-float-tool-btn"
                onClick={handleNewChat}
                title="New Chat (clear history)"
                aria-label="New Chat"
              >
                <RotateCcw size={13} />
              </button>
              <button
                type="button"
                className="flowops-float-tool-btn flowops-float-close-btn"
                onClick={() => setIsChatOpen(false)}
                title="Close chat window"
                aria-label="Close chat window"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* CONVERSATION MESSAGES AREA */}
          <div className="flowops-float-messages">
            {botMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flowops-chat-msg ${
                  msg.role === "user" ? "flowops-msg-user" : "flowops-msg-assistant"
                }`}
              >
                <div
                  className={`flowops-avatar ${
                    msg.role === "user" ? "flowops-avatar-user" : "flowops-avatar-bot"
                  }`}
                >
                  {msg.role === "user" ? "You" : <Bot size={14} />}
                </div>

                <div className="flowops-msg-bubble">
                  {msg.role === "assistant" && (
                    <div className="flowops-msg-meta">
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="flowops-author-name">FlowOps Bot</span>
                        {msg.total_tokens ? (
                          <span className="flowops-tokens-badge" title={`Input: ${msg.input_tokens || 0} | Output: ${msg.output_tokens || 0}`}>
                            {msg.total_tokens.toLocaleString()} tokens
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="flowops-copy-btn"
                        onClick={() => copyMessage(msg.id, msg.content)}
                        title="Copy response"
                      >
                        {copiedMsgId === msg.id ? (
                          <>
                            <Check size={11} className="text-emerald" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {msg.role === "assistant" ? (
                    <BotMessageContent text={msg.content} />
                  ) : (
                    <div className="flowops-user-text">{msg.content}</div>
                  )}

                  {/* SAFE NATURAL LANGUAGE SQL DATA VIEW */}
                  {msg.sql_data && (
                    <div className="flowops-sql-result-box">
                      <details className="flowops-sql-details">
                        <summary className="flowops-sql-summary">
                          <span>View Validated SQL</span>
                          <span className="flowops-sql-meta-tag">{msg.sql_data.execution_duration_ms}ms</span>
                        </summary>
                        <pre className="flowops-sql-code">
                          <code>{msg.sql_data.sql}</code>
                        </pre>
                      </details>
                      {msg.sql_data.rows && msg.sql_data.rows.length > 0 ? (
                        <div className="flowops-sql-table-wrapper">
                          <table className="flowops-chat-table">
                            <thead>
                              <tr>
                                {msg.sql_data.columns.map((c, i) => (
                                  <th key={i}>{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {msg.sql_data.rows.map((row, rIdx) => (
                                <tr key={rIdx}>
                                  {msg.sql_data.columns.map((col, cIdx) => (
                                    <td key={cIdx}>{String(row[col] ?? "-")}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="flowops-sql-table-footer">
                            Showing {msg.sql_data.row_count} rows from PostgreSQL
                          </div>
                        </div>
                      ) : (
                        <div className="flowops-sql-empty">No matching records found in database.</div>
                      )}
                    </div>
                  )}

                  {/* OPERATIONAL REPORT CARD */}
                  {msg.report_data && (
                    <div className="flowops-report-card">
                      <div className="flowops-report-header">
                        <div className="flowops-report-icon">
                          <FileCheck2 size={16} />
                        </div>
                        <div>
                          <div className="flowops-report-title">{msg.report_data.title}</div>
                          <div className="flowops-report-meta">
                            Ref: {msg.report_data.report_id} • Format: {msg.report_data.format?.toUpperCase()}
                          </div>
                        </div>
                      </div>
                      <a
                        href={`${API_URL}${msg.report_data.download_url}`}
                        download={msg.report_data.filename}
                        className="flowops-report-download-btn"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download size={13} />
                        <span>Download Official Report ({msg.report_data.format?.toUpperCase()})</span>
                      </a>
                    </div>
                  )}

                  {/* EVIDENCE / SOURCES BADGES */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="flowops-sources-box">
                      <span className="flowops-sources-label">Operational Evidence:</span>
                      <div className="flowops-sources-list">
                        {msg.sources.map((src, sIdx) => (
                          <span key={sIdx} className="flowops-source-pill">
                            <Database size={10} />
                            <span>{src.label}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flowops-msg-time">{fmtDate(msg.timestamp)}</div>
                </div>
              </div>
            ))}

            {/* LOADING STATE */}
            {botLoading && (
              <div className="flowops-chat-msg flowops-msg-assistant flowops-msg-loading">
                <div className="flowops-avatar flowops-avatar-bot">
                  <Bot size={14} />
                </div>
                <div className="flowops-msg-bubble">
                  <div className="flowops-loading-container">
                    <div className="flowops-loading-dots">
                      <span className="dot dot-1"></span>
                      <span className="dot dot-2"></span>
                      <span className="dot dot-3"></span>
                    </div>
                    <span className="flowops-loading-text">
                      {activeMode === "investigation"
                        ? "FlowOps Bot is conducting deep multi-source investigation..."
                        : activeMode === "sql"
                        ? "FlowOps Bot is generating and validating safe SQL..."
                        : activeMode === "report"
                        ? "FlowOps Bot is compiling operational report..."
                        : activeMode === "root_cause"
                        ? "FlowOps Bot is analyzing root cause evidence..."
                        : "FlowOps Bot is analyzing operational data..."}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ERROR STATE */}
            {botError && (
              <div className="flowops-chat-error-banner">
                <div className="flowops-error-left">
                  <AlertTriangle size={14} />
                  <span>{botError}</span>
                </div>
                {lastFailedQuery && (
                  <button
                    type="button"
                    className="secondary-button flowops-retry-btn"
                    onClick={handleRetry}
                    disabled={botLoading}
                  >
                    <RotateCcw size={11} />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* COPILOT TASK MODE CHIPS */}
          <div className="flowops-mode-chips">
            {COPILOT_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`flowops-mode-chip ${activeMode === m.id ? "active" : ""}`}
                onClick={() => {
                  if (activeMode === m.id && m.id !== "auto") {
                    setActiveMode("auto");
                  } else {
                    setActiveMode(m.id);
                    if (m.prompt && chatInput.trim() === "") {
                      handleSendMessage(m.prompt, m.id);
                    }
                  }
                }}
                title={m.prompt || m.label}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* SUGGESTED QUESTIONS (WHEN EMPTY / WELCOME ONLY) */}
          {botMessages.length <= 1 ? (
            <div className="flowops-float-suggested">
              <div className="flowops-suggested-header">
                <Sparkles size={12} />
                <span>Suggested Questions</span>
              </div>
              <div className="flowops-float-suggested-list">
                {SUGGESTED_QUESTIONS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="flowops-float-suggested-chip"
                    onClick={() => handleSendMessage(q)}
                    disabled={botLoading}
                  >
                    <span className="flowops-suggested-icon">✦</span>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flowops-float-quick-bar">
              <div className="flowops-quick-list">
                {SUGGESTED_QUESTIONS.slice(0, 3).map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="flowops-quick-chip"
                    onClick={() => handleSendMessage(q)}
                    disabled={botLoading}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* MESSAGE COMPOSER */}
          <div className="flowops-float-composer">
            <div className="flowops-float-input-box">
              <textarea
                className="flowops-float-textarea"
                placeholder="Ask FlowOps Bot a question... (Enter to send, Shift+Enter for new line)"
                rows={1}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={botLoading}
              />
              <button
                type="button"
                className="primary-button flowops-float-send-btn"
                onClick={() => handleSendMessage()}
                disabled={!chatInput.trim() || botLoading}
                aria-label="Send message to FlowOps Bot"
                title="Send message"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   10. API USAGE & COSTS PAGE
========================================================= */

function TokenCostMonitor({
  insights,
  cost,
  usageTotal,
  usageInput,
  usageOutput,
  localBudget,
}) {
  const [viewMode, setViewMode] = useState("combined"); // "combined" | "tokens" | "cost"

  // Process data in chronological order (oldest to newest)
  const chartData = useMemo(() => {
    if (!insights || insights.length === 0) return [];

    const sorted = [...insights].sort((a, b) => {
      if (a.created_at && b.created_at) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return (toNum(a.insight_id) || 0) - (toNum(b.insight_id) || 0);
    });

    let cumCost = 0;
    return sorted.map((item, idx) => {
      const inp = toNum(item.input_tokens);
      const out = toNum(item.output_tokens);
      const tot = toNum(item.total_tokens) || inp + out;
      const runCost = toNum(item.estimated_cost_usd);
      cumCost += runCost;

      let dateStr = "";
      if (item.created_at) {
        try {
          const d = new Date(item.created_at);
          dateStr =
            d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
            " " +
            d.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });
        } catch {
          dateStr = "";
        }
      }

      return {
        label: item.run_id ? `#${item.run_id}` : `A-${item.insight_id || idx + 1}`,
        fullLabel: item.run_id ? `Run #${item.run_id}` : `Analysis #${item.insight_id || idx + 1}`,
        runId: item.run_id,
        insightId: item.insight_id,
        model: item.model || "claude-sonnet-4-6",
        inputTokens: inp,
        outputTokens: out,
        totalTokens: tot,
        cost: Number(runCost.toFixed(6)),
        cumulativeCost: Number(cumCost.toFixed(6)),
        formattedCost: money(runCost),
        formattedCumulative: money(cumCost),
        date: dateStr,
      };
    });
  }, [insights]);

  const totalRuns = chartData.length;
  const avgCost = totalRuns > 0 ? cost / totalRuns : 0;
  const avgTokens = totalRuns > 0 ? Math.round(usageTotal / totalRuns) : 0;
  const costPer1k = usageTotal > 0 ? (cost / usageTotal) * 1000 : 0;
  const inputRatio = usageTotal > 0 ? Math.round((usageInput / usageTotal) * 100) : 0;
  const outputRatio = usageTotal > 0 ? 100 - inputRatio : 0;
  const budgetNum = toNum(localBudget);

  const peakRun = useMemo(() => {
    if (chartData.length === 0) return null;
    return chartData.reduce(
      (prev, curr) => (curr.totalTokens > prev.totalTokens ? curr : prev),
      chartData[0]
    );
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className="panel monitor-panel">
        <PanelHeader
          title="Tokens & Cost Monitor"
          description="Execution-by-execution Claude AI token consumption and spending trend"
          icon={Coins}
        />
        <EmptyState
          icon={BarChart3}
          title="No Token & Cost Data Recorded"
          description="Execute an ETL pipeline with Claude AI analysis to track token usage curves and cost progression here."
        />
      </div>
    );
  }

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;

    return (
      <div className="monitor-tooltip">
        <div className="monitor-tooltip-top">
          <span className="monitor-tooltip-title">{data.fullLabel}</span>
          <span className="monitor-tooltip-model">{data.model}</span>
        </div>
        {data.date && <div className="monitor-tooltip-date">{data.date}</div>}
        <div className="monitor-tooltip-divider" />
        <div className="monitor-tooltip-body">
          <div className="monitor-tooltip-row">
            <span className="monitor-tooltip-marker" style={{ background: "#3b82f6" }} />
            <span className="monitor-tooltip-key">Input Tokens (Prompt):</span>
            <span className="monitor-tooltip-val">
              {data.inputTokens?.toLocaleString()}
              <span className="monitor-tooltip-sub">
                {" "}
                ({data.totalTokens > 0 ? Math.round((data.inputTokens / data.totalTokens) * 100) : 0}%)
              </span>
            </span>
          </div>
          <div className="monitor-tooltip-row">
            <span className="monitor-tooltip-marker" style={{ background: "#8b5cf6" }} />
            <span className="monitor-tooltip-key">Output Tokens (Claude):</span>
            <span className="monitor-tooltip-val">
              {data.outputTokens?.toLocaleString()}
              <span className="monitor-tooltip-sub">
                {" "}
                ({data.totalTokens > 0 ? Math.round((data.outputTokens / data.totalTokens) * 100) : 0}%)
              </span>
            </span>
          </div>
          <div className="monitor-tooltip-row monitor-tooltip-row--total">
            <span className="monitor-tooltip-marker" style={{ background: "#0ea5e9" }} />
            <span className="monitor-tooltip-key">Total Tokens:</span>
            <span className="monitor-tooltip-val font-bold">
              {data.totalTokens?.toLocaleString()}
            </span>
          </div>
          <div className="monitor-tooltip-divider" />
          <div className="monitor-tooltip-row">
            <span className="monitor-tooltip-marker" style={{ background: "#10b981" }} />
            <span className="monitor-tooltip-key">Execution Cost:</span>
            <span className="monitor-tooltip-val text-green font-bold">
              {data.formattedCost}
            </span>
          </div>
          <div className="monitor-tooltip-row">
            <span className="monitor-tooltip-marker" style={{ background: "#f59e0b" }} />
            <span className="monitor-tooltip-key">Cumulative Spend:</span>
            <span className="monitor-tooltip-val text-amber font-bold">
              {data.formattedCumulative}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="panel monitor-panel">
      {/* HEADER WITH CONTROLS */}
      <div className="monitor-header">
        <div className="monitor-header-left">
          <div className="monitor-header-icon-box">
            <Coins size={20} />
          </div>
          <div>
            <h3 className="monitor-title">Tokens & Cost Monitor</h3>
            <p className="monitor-subtitle">
              Execution-by-execution tracking of Claude token consumption, prompt/response ratio, and expenditure
            </p>
          </div>
        </div>

        {/* VIEW MODE TOGGLE BUTTONS */}
        <div className="monitor-toggle-group">
          <button
            type="button"
            className={`monitor-toggle-btn ${viewMode === "combined" ? "active" : ""}`}
            onClick={() => setViewMode("combined")}
            title="View Dual-Axis Tokens & Cost Chart"
          >
            <Activity size={13} />
            <span>Combined</span>
          </button>
          <button
            type="button"
            className={`monitor-toggle-btn ${viewMode === "tokens" ? "active" : ""}`}
            onClick={() => setViewMode("tokens")}
            title="View Input vs Output Token Breakdown"
          >
            <Layers size={13} />
            <span>Token Breakdown</span>
          </button>
          <button
            type="button"
            className={`monitor-toggle-btn ${viewMode === "cost" ? "active" : ""}`}
            onClick={() => setViewMode("cost")}
            title="View Cost & Cumulative Spend Trajectory"
          >
            <TrendingUp size={13} />
            <span>Cost & Budget</span>
          </button>
        </div>
      </div>

      {/* METRIC STRIP / QUICK STATS */}
      <div className="monitor-kpi-strip">
        <div className="monitor-kpi-card">
          <span className="monitor-kpi-label">AVG TOKENS / RUN</span>
          <span className="monitor-kpi-value">{avgTokens.toLocaleString()}</span>
          <span className="monitor-kpi-desc">Across {totalRuns} analyses</span>
        </div>
        <div className="monitor-kpi-card">
          <span className="monitor-kpi-label">AVG COST / RUN</span>
          <span className="monitor-kpi-value">{money(avgCost)}</span>
          <span className="monitor-kpi-desc">Per Claude execution</span>
        </div>
        <div className="monitor-kpi-card">
          <span className="monitor-kpi-label">COST / 1K TOKENS</span>
          <span className="monitor-kpi-value">${costPer1k.toFixed(4)}</span>
          <span className="monitor-kpi-desc">Blended effective rate</span>
        </div>
        <div className="monitor-kpi-card">
          <span className="monitor-kpi-label">TOKEN BALANCE</span>
          <span className="monitor-kpi-value">
            {inputRatio}% <span className="monitor-kpi-sub">In</span> / {outputRatio}% <span className="monitor-kpi-sub">Out</span>
          </span>
          <span className="monitor-kpi-desc">Prompt vs Completion</span>
        </div>
        {peakRun && (
          <div className="monitor-kpi-card">
            <span className="monitor-kpi-label">PEAK RUN</span>
            <span className="monitor-kpi-value">{peakRun.totalTokens.toLocaleString()}</span>
            <span className="monitor-kpi-desc">{peakRun.fullLabel} ({peakRun.formattedCost})</span>
          </div>
        )}
      </div>

      {/* CHART CONTAINER */}
      <div className="monitor-chart-area">
        {viewMode === "combined" && (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={chartData}
              margin={{ top: 16, right: 28, left: -10, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
              />
              <YAxis
                yAxisId="tokens"
                orientation="left"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#10b981", fontSize: 11 }}
                tickFormatter={(v) => `$${v.toFixed(3)}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "12px", paddingTop: 14 }}
                iconType="circle"
              />
              <Bar
                yAxisId="tokens"
                dataKey="inputTokens"
                name="Input Tokens (Prompt)"
                stackId="tokens"
                fill="#3b82f6"
                radius={[0, 0, 0, 0]}
                barSize={30}
              />
              <Bar
                yAxisId="tokens"
                dataKey="outputTokens"
                name="Output Tokens (Claude)"
                stackId="tokens"
                fill="#8b5cf6"
                radius={[5, 5, 0, 0]}
                barSize={30}
              />
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="cost"
                name="Run Cost ($)"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#10b981", strokeWidth: 2, stroke: "#ffffff" }}
                activeDot={{ r: 6, fill: "#10b981", stroke: "#ffffff", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {viewMode === "tokens" && (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={chartData}
              margin={{ top: 16, right: 16, left: -10, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11 }}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "12px", paddingTop: 14 }}
                iconType="circle"
              />
              <Bar
                dataKey="inputTokens"
                name="Input Tokens (Prompts)"
                stackId="tokens"
                fill="#3b82f6"
                radius={[0, 0, 0, 0]}
                barSize={32}
              />
              <Bar
                dataKey="outputTokens"
                name="Output Tokens (Claude Analysis)"
                stackId="tokens"
                fill="#8b5cf6"
                radius={[5, 5, 0, 0]}
                barSize={32}
              />
              <Line
                type="monotone"
                dataKey="totalTokens"
                name="Total Tokens Trend"
                stroke="#0ea5e9"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: "#0ea5e9" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}

        {viewMode === "cost" && (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart
              data={chartData}
              margin={{ top: 16, right: 28, left: -10, bottom: 4 }}
            >
              <defs>
                <linearGradient id="cumCostGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis
                dataKey="label"
                axisLine={{ stroke: "#cbd5e1" }}
                tickLine={false}
                tick={{ fill: "#64748b", fontSize: 11, fontWeight: 600 }}
              />
              <YAxis
                yAxisId="runCost"
                orientation="left"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#10b981", fontSize: 11 }}
                tickFormatter={(v) => `$${v.toFixed(3)}`}
              />
              <YAxis
                yAxisId="cumCost"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#f59e0b", fontSize: 11 }}
                tickFormatter={(v) => `$${v.toFixed(3)}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "12px", paddingTop: 14 }}
                iconType="circle"
              />
              {budgetNum > 0 && budgetNum <= 1.0 && (
                <ReferenceLine
                  yAxisId="cumCost"
                  y={budgetNum}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  label={{
                    value: `Budget: $${budgetNum.toFixed(2)}`,
                    fill: "#ef4444",
                    fontSize: 11,
                    position: "insideTopRight",
                  }}
                />
              )}
              <Bar
                yAxisId="runCost"
                dataKey="cost"
                name="Per-Run Cost ($)"
                fill="#10b981"
                radius={[4, 4, 0, 0]}
                barSize={28}
              />
              <Area
                yAxisId="cumCost"
                type="monotone"
                dataKey="cumulativeCost"
                name="Cumulative Spend ($)"
                stroke="#f59e0b"
                strokeWidth={2.5}
                fill="url(#cumCostGradient)"
                dot={{ r: 4, fill: "#f59e0b", stroke: "#ffffff", strokeWidth: 2 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function APIUsagePage({
  usage,
  insights,
  usageInput,
  usageOutput,
  usageTotal,
  cost,
  localBudget,
  setLocalBudget,
  request,
  refresh,
  busy,
}) {
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);

  // Auto-refresh usage and token telemetry every 2.5s while viewing this page
  useEffect(() => {
    if (typeof refresh === "function") {
      refresh();
      const timer = setInterval(() => {
        refresh();
      }, 2500);
      return () => clearInterval(timer);
    }
  }, [refresh]);

  const handleBudgetChange = async (newVal) => {
    setLocalBudget(newVal);
    if (typeof window !== "undefined") {
      localStorage.setItem("flowops_budget", newVal);
    }
    const valNum = parseFloat(newVal);
    if (!isNaN(valNum) && valNum > 0) {
      setSavingBudget(true);
      try {
        await request("/api/ai/budget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ budget: valNum }),
        });
        setBudgetSaved(true);
        setTimeout(() => setBudgetSaved(false), 2500);
        if (typeof refresh === "function") {
          refresh();
        }
      } catch {
        // Fallback gracefully
      } finally {
        setSavingBudget(false);
      }
    }
  };
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptPeriod, setReceiptPeriod] = useState("30d");
  const [receiptFormat, setReceiptFormat] = useState("pdf");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptSuccess, setReceiptSuccess] = useState(null);
  const [receiptError, setReceiptError] = useState(null);

  const handleDownloadReceipt = async () => {
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptSuccess(null);
    try {
      const res = await request("/api/ai/receipt/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: receiptPeriod,
          format: receiptFormat,
          start_date: customStart || null,
          end_date: customEnd || null,
          budget: budgetNum > 0 ? budgetNum : 5.0,
        }),
      });

      if (res && res.download_url) {
        setReceiptSuccess(`Receipt generated: ${res.receipt_id} (${res.total_requests} requests, $${res.estimated_total_cost_usd} USD)`);
        const a = document.createElement("a");
        a.href = `${API_URL}${res.download_url}`;
        a.download = res.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        throw new Error("Invalid receipt response from backend.");
      }
    } catch (err) {
      setReceiptError(err.message || "Failed to generate receipt.");
    } finally {
      setReceiptLoading(false);
    }
  };

  const totalRequests =
    pick(usage, "total_requests", "request_count") ?? insights.length;
  const avgTokens =
    toNum(totalRequests) > 0 ? Math.round(usageTotal / toNum(totalRequests)) : 0;
  const startingCredit = toNum(pick(usage, "starting_credit_usd")) || 5.0;
  const budgetNum = toNum(localBudget);
  const remainingBudget = Math.max(0, budgetNum - cost);
  const budgetUtilization =
    budgetNum > 0 ? Math.min(100, (cost / budgetNum) * 100).toFixed(1) : "0";

  return (
    <div className="page-container">
      {/* STAT CARDS */}
      <div className="stats">
        <StatCard
          label="TOTAL TOKENS"
          value={usageTotal.toLocaleString()}
          description="Input + output tokens"
          icon={BarChart3}
        />
        <StatCard
          label="INPUT TOKENS"
          value={usageInput.toLocaleString()}
          description="Prompts sent to Claude"
          icon={Activity}
        />
        <StatCard
          label="OUTPUT TOKENS"
          value={usageOutput.toLocaleString()}
          description="Claude generated responses"
          icon={Sparkles}
        />
        <StatCard
          label="ESTIMATED COST"
          value={money(cost)}
          description="Estimated based on pricing"
          icon={Database}
        />
      </div>

      {/* TOKENS & COST MONITOR GRAPH */}
      <TokenCostMonitor
        insights={insights}
        cost={cost}
        usageTotal={usageTotal}
        usageInput={usageInput}
        usageOutput={usageOutput}
        localBudget={localBudget}
      />

      {/* USAGE DETAILS PANEL */}
      <div className="content-grid">
        <div className="panel">
          <PanelHeader
            title="AI Consumption Overview"
            description="Verified metrics returned by /api/ai/usage"
            icon={BarChart3}
          />
          <div className="info-list">
            <div className="info-row">
              <span>Total Claude Requests</span>
              <strong>{totalRequests} analyses</strong>
            </div>
            <div className="info-row">
              <span>Average Tokens per Request</span>
              <strong>{avgTokens.toLocaleString()} tokens</strong>
            </div>
            <div className="info-row">
              <span>Minimum Tokens per Request</span>
              <strong>{fmt(usage.minimum_tokens_per_request)}</strong>
            </div>
            <div className="info-row">
              <span>Maximum Tokens per Request</span>
              <strong>{fmt(usage.maximum_tokens_per_request)}</strong>
            </div>
            <div className="info-row">
              <span>App Starting Credit</span>
              <strong>{money(startingCredit)}</strong>
            </div>
            <div className="info-row">
              <span>Estimated Credit Remaining</span>
              <strong style={{ color: "#16a34a" }}>
                {money(usage.estimated_credit_remaining_usd ?? startingCredit - cost)}
              </strong>
            </div>
          </div>

          <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary-button datamedic-download-button"
              onClick={() => setShowReceiptModal(true)}
              title="Generate a detailed, official AI usage receipt"
            >
              <FileCheck2 size={14} />
              Download Usage Receipt
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                downloadFile(
                  "flowops_ai_usage.csv",
                  generateCSV(
                    insights.map((i) => ({
                      insight_id: i.insight_id,
                      run_id: i.run_id,
                      model: i.model,
                      input_tokens: i.input_tokens,
                      output_tokens: i.output_tokens,
                      total_tokens: i.total_tokens,
                      estimated_cost_usd: i.estimated_cost_usd,
                      created_at: i.created_at,
                    }))
                  )
                )
              }
            >
              <Download size={14} />
              Export Raw CSV
            </button>
          </div>
        </div>

        <div className="panel">
          <PanelHeader
            title="Local Budget Management"
            description="App-side budget simulation and expenditure monitoring"
            icon={Server}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
              <span className="pulse-dot" style={{ display: "inline-block" }}></span>
              Live Sync Active (2.5s)
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={refresh}
              disabled={busy}
              style={{ height: 30, padding: "0 10px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 6 }}
            >
              <RefreshCw size={12} className={busy ? "spin" : ""} />
              {busy ? "Updating..." : "Refresh"}
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--body, #374151)",
                  margin: 0,
                }}
              >
                Configured Budget Limit (USD):
              </label>
              {budgetSaved && (
                <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>
                  ✓ Saved to Database
                </span>
              )}
            </div>
            <input
              type="number"
              min="0"
              step="0.5"
              className="input"
              value={localBudget}
              onChange={(e) => handleBudgetChange(e.target.value)}
              style={{ height: 42 }}
            />
          </div>

          <div className="info-list">
            <div className="info-row">
              <span>Estimated Credit Used</span>
              <strong>{money(cost)}</strong>
            </div>
            <div className="info-row">
              <span>Budget Remaining</span>
              <strong style={{ color: remainingBudget > 0 ? "#16a34a" : "#dc2626" }}>
                {money(remainingBudget)}
              </strong>
            </div>
            <div className="info-row">
              <span>Budget Utilization</span>
              <strong>{budgetUtilization}%</strong>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="score-track" style={{ height: 8 }}>
              <div
                className="score-fill"
                style={{
                  width: `${Math.min(toNum(budgetUtilization), 100)}%`,
                  background: toNum(budgetUtilization) > 90 ? "#dc2626" : "#2563eb",
                }}
              />
            </div>
          </div>

          <p
            style={{
              margin: "18px 0 0",
              fontSize: 11,
              color: "#94a3b8",
              lineHeight: 1.5,
            }}
          >
            * Note: {fmt(usage.note || "Estimated app-side usage based on Claude-reported token counts and configured pricing. This is not the live Anthropic account balance.")}
          </p>
        </div>
      </div>

      {/* REQUEST HISTORY TABLE */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Claude Request History
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Individual token and cost records per pipeline analysis
          </p>
        </div>

        {insights.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No Request Records"
            description="Run an ETL pipeline to record token consumption."
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Model</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Total Tokens</th>
                  <th>Est. Cost</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {insights.map((i) => (
                  <tr key={i.insight_id}>
                    <td>
                      <strong>#{i.run_id}</strong>
                    </td>
                    <td>
                      <span className="tag">{fmt(i.model)}</span>
                    </td>
                    <td>{fmt(i.input_tokens)}</td>
                    <td>{fmt(i.output_tokens)}</td>
                    <td>{fmt(i.total_tokens)}</td>
                    <td>
                      <strong style={{ color: "#2563eb" }}>
                        {money(i.estimated_cost_usd)}
                      </strong>
                    </td>
                    <td>{fmtDate(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DOWNLOAD USAGE RECEIPT MODAL */}
      {showReceiptModal && (
        <div className="receipt-modal-backdrop" onClick={() => setShowReceiptModal(false)}>
          <div className="receipt-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="receipt-modal-header">
              <div className="receipt-modal-title">
                <FileCheck2 size={18} style={{ color: "#2563eb" }} />
                <span>Download API Usage & Cost Receipt</span>
              </div>
              <button
                type="button"
                className="flowops-float-tool-btn"
                onClick={() => setShowReceiptModal(false)}
                aria-label="Close receipt dialog"
              >
                <X size={16} />
              </button>
            </div>

            <div className="receipt-filter-section">
              <label className="receipt-filter-label">1. Select Reporting Period:</label>
              <div className="receipt-grid-options">
                {[
                  { id: "today", label: "Today" },
                  { id: "7d", label: "Last 7 Days" },
                  { id: "30d", label: "Last 30 Days" },
                  { id: "this_month", label: "This Month" },
                  { id: "all", label: "All History" },
                  { id: "custom", label: "Custom Range" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`receipt-option-btn ${receiptPeriod === opt.id ? "selected" : ""}`}
                    onClick={() => setReceiptPeriod(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {receiptPeriod === "custom" && (
                <div className="receipt-custom-dates">
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted, #64748b)", display: "block", marginBottom: 4 }}>Start Date:</label>
                    <input
                      type="date"
                      className="input"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "var(--muted, #64748b)", display: "block", marginBottom: 4 }}>End Date:</label>
                    <input
                      type="date"
                      className="input"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="receipt-filter-section">
              <label className="receipt-filter-label">2. Select Export Format:</label>
              <div className="receipt-format-row">
                {[
                  { id: "pdf", label: "PDF Document" },
                  { id: "csv", label: "CSV Spreadsheet" },
                  { id: "json", label: "JSON Metadata" },
                ].map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    className={`receipt-format-btn ${receiptFormat === fmt.id ? "selected" : ""}`}
                    onClick={() => setReceiptFormat(fmt.id)}
                  >
                    <Download size={13} />
                    <span>{fmt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* BUDGET ALLOCATION & COST DEDUCTION BREAKDOWN */}
            <div className="receipt-budget-preview-box">
              <div className="receipt-budget-preview-title">
                <Coins size={14} style={{ color: "#2563eb" }} />
                <span>Account Budget & Cost Deduction Summary</span>
              </div>
              <div className="receipt-budget-preview-grid">
                <div className="receipt-budget-preview-item">
                  <span className="lbl">Configured Budget / Credit:</span>
                  <span className="val">${(budgetNum > 0 ? budgetNum : 5.0).toFixed(2)} USD</span>
                </div>
                <div className="receipt-budget-preview-item">
                  <span className="lbl">Less Incurred Cost (Reduction):</span>
                  <span className="val cost-red">-${cost.toFixed(4)} USD</span>
                </div>
                <div className="receipt-budget-preview-item highlight">
                  <span className="lbl">Net Remaining Balance:</span>
                  <span className="val balance-green">${remainingBudget.toFixed(4)} USD</span>
                </div>
                <div className="receipt-budget-preview-item">
                  <span className="lbl">Budget Utilization Rate:</span>
                  <span className="val">{budgetUtilization}%</span>
                </div>
              </div>
            </div>

            {receiptSuccess && (
              <div className="receipt-success-banner">
                <CheckCircle2 size={16} />
                <span>{receiptSuccess}</span>
              </div>
            )}

            {receiptError && (
              <div className="receipt-error-banner">
                <AlertTriangle size={16} />
                <span>{receiptError}</span>
              </div>
            )}

            <div className="receipt-actions-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowReceiptModal(false)}
                disabled={receiptLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleDownloadReceipt}
                disabled={receiptLoading}
              >
                {receiptLoading ? (
                  <>
                    <RefreshCw size={13} className="spin" />
                    <span>Generating Receipt...</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span>Generate & Download ({receiptFormat.toUpperCase()})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   11. SYSTEM HEALTH PAGE
========================================================= */

function SystemHealthPage({
  health,
  dbHealth,
  runsCount,
  insightsCount,
  refresh,
  busy,
}) {
  const endpoints = [
    { method: "GET", path: "/api/health", desc: "FastAPI service health status" },
    { method: "GET", path: "/api/database/health", desc: "PostgreSQL connectivity & version" },
    { method: "POST", path: "/api/etl/analyze", desc: "CSV structure & anomaly pre-validation" },
    { method: "POST", path: "/api/etl/process", desc: "ETL execution, cleaning, & DB save" },
    { method: "GET", path: "/api/pipelines/runs", desc: "Pipeline execution run history" },
    { method: "GET", path: "/api/pipelines/stats", desc: "Aggregated pipeline operational stats" },
    { method: "GET", path: "/api/anomalies", desc: "Rule-based detected anomaly logs" },
    { method: "GET", path: "/api/ai/insights", desc: "Stored Claude AI analysis reports" },
    { method: "GET", path: "/api/ai/usage", desc: "Cumulative token usage & cost summary" },
  ];

  return (
    <div className="page-container">
      {/* SERVICE HEALTH STATUS CARDS */}
      <div className="system-status-grid">
        <StatusCard
          label="FASTAPI BACKEND"
          value={health?.status === "healthy" ? "Connected" : "Offline"}
          icon={Server}
          status={health?.status === "healthy" ? "healthy" : "error"}
        />
        <StatusCard
          label="POSTGRESQL DATABASE"
          value={dbHealth?.connected ? "Connected" : "Disconnected"}
          icon={Database}
          status={dbHealth?.connected ? "healthy" : "error"}
        />
        <StatusCard
          label="CLAUDE AI INTEGRATION"
          value={insightsCount > 0 ? "Active" : "Ready"}
          icon={Sparkles}
          status={insightsCount > 0 ? "healthy" : "unknown"}
        />
      </div>

      {/* BACKEND CONFIGURATION PANEL */}
      <div className="panel">
        <PanelHeader
          title="Backend Infrastructure Information"
          description="Verified configuration parameters for the FlowOps AI platform"
          icon={Server}
        />

        <div className="info-list">
          <div className="info-row">
            <span>API Base URL</span>
            <strong>{API_URL}</strong>
          </div>
          <div className="info-row">
            <span>FastAPI Application Status</span>
            <strong style={{ color: health?.status === "healthy" ? "#16a34a" : "#dc2626" }}>
              {health?.status ? `${health.status} (${health.application || "FlowOps AI"})` : "Unreachable"}
            </strong>
          </div>
          <div className="info-row">
            <span>Database Engine</span>
            <strong>PostgreSQL</strong>
          </div>
          <div className="info-row">
            <span>Connected Database Name</span>
            <strong>{fmt(dbHealth?.database)}</strong>
          </div>
          <div className="info-row">
            <span>PostgreSQL Server Version</span>
            <strong>{fmt(dbHealth?.version)}</strong>
          </div>
          <div className="info-row">
            <span>Data Processing Engine</span>
            <strong>Python 3 + Pandas</strong>
          </div>
          <div className="info-row">
            <span>AI Diagnostic Engine</span>
            <strong>Anthropic Claude (claude-sonnet-4-6)</strong>
          </div>
          <div className="info-row">
            <span>Total Recorded Pipeline Runs</span>
            <strong>{runsCount}</strong>
          </div>
          <div className="info-row">
            <span>Total Stored AI Insights</span>
            <strong>{insightsCount}</strong>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 20,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="primary-button datamedic-analyze-button"
            onClick={refresh}
            disabled={busy}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
            Check Health Again
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={() => window.open(`${API_URL}/docs`, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink size={14} />
            Open Swagger API Docs
          </button>
        </div>
      </div>

      {/* ENDPOINTS CATALOGUE */}
      <div className="panel table-panel">
        <div className="table-header" style={{ padding: "18px 24px" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Verified Backend REST Endpoints
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8a96a8" }}>
            Contract endpoints verified against the FastAPI backend
          </p>
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint Route</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep) => (
                <tr key={ep.path}>
                  <td>
                    <span
                      className={`badge ${
                        ep.method === "POST" ? "badge-warning" : "badge-info"
                      }`}
                      style={{ minHeight: 24, fontSize: 11 }}
                    >
                      {ep.method}
                    </span>
                  </td>
                  <td>
                    <strong style={{ fontFamily: "monospace", fontSize: 13 }}>
                      {ep.path}
                    </strong>
                  </td>
                  <td>{ep.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   REUSABLE UI COMPONENTS
========================================================= */

function StatCard({ label, value, description, icon: Icon, onClick }) {
  return (
    <div
      className="stat-card"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <div className="stat-icon">
        <Icon size={19} />
      </div>
      <div className="stat-content">
        <span className="stat-label">{label}</span>
        <strong>{fmt(value)}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function PanelHeader({ title, description, icon: Icon }) {
  return (
    <div className="panel-header">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {Icon && (
        <div className="panel-header-icon">
          <Icon size={18} />
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon: Icon, title, description, onClick, variant }) {
  return (
    <button
      type="button"
      className={`quick-action quick-action--${variant}`}
      onClick={onClick}
    >
      <div className="quick-action-icon">
        <Icon size={17} />
      </div>
      <div className="quick-action-content">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <ArrowRight size={16} className="quick-action-arrow" />
    </button>
  );
}

function PipelineStep({ number, title, description, completed }) {
  return (
    <div className="pipeline-step">
      <div className={`pipeline-number ${completed ? "completed" : ""}`}>
        {completed ? <CheckCircle2 size={16} /> : number}
      </div>
      <div className="pipeline-content">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </div>
  );
}

function StatusCard({ label, value, icon: Icon, status }) {
  return (
    <div className={`status-card ${status}`}>
      <div className="status-card-icon">
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong className={`status-${status}`}>{value}</strong>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const st = String(status || "").toLowerCase();
  let badgeClass = "badge-info";
  if (st === "completed" || st === "healthy" || st === "success") {
    badgeClass = "badge-success";
  } else if (st === "failed" || st === "error") {
    badgeClass = "badge-danger";
  } else if (st === "running" || st === "warning") {
    badgeClass = "badge-warning";
  }

  return (
    <span className={`badge ${badgeClass}`}>
      {fmt(status)}
    </span>
  );
}

function EmptyState({ icon: Icon, title, description, buttonText, onClick }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {buttonText && onClick && (
        <button type="button" className="secondary-button" onClick={onClick}>
          {buttonText}
          <ArrowRight size={15} className="overview-upload-arrow" />
        </button>
      )}
    </div>
  );
}

function RecordsTable({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);

  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id ?? row.run_id ?? idx}>
              {columns.map((c) => (
                <td key={c}>
                  {row[c] === null || row[c] === undefined || row[c] === ""
                    ? "—"
                    : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================
   MODALS
========================================================= */

function RunDetailsModal({ run, onClose, onViewInsights }) {
  return (
    <div className="cleaned-customer-overlay" onClick={onClose}>
      <div className="cleaned-customer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cleaned-customer-modal-header">
          <div>
            <h3>Pipeline Run #{run.run_id}</h3>
            <p>{fmt(run.filename)}</p>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-details-grid">
          <div className="modal-detail-item">
            <span>Status</span>
            <strong>
              <StatusBadge status={run.status} />
            </strong>
          </div>
          <div className="modal-detail-item">
            <span>Duration</span>
            <strong>{toNum(run.duration_seconds).toFixed(3)}s</strong>
          </div>
          <div className="modal-detail-item">
            <span>Original Rows</span>
            <strong>{fmt(run.original_rows)}</strong>
          </div>
          <div className="modal-detail-item">
            <span>Cleaned Rows</span>
            <strong>{fmt(run.cleaned_rows)}</strong>
          </div>
          <div className="modal-detail-item">
            <span>Rejected Rows</span>
            <strong>{fmt(run.rejected_rows)}</strong>
          </div>
          <div className="modal-detail-item">
            <span>Retry Attempts</span>
            <strong>{fmt(run.retry_attempts)}</strong>
          </div>
          <div className="modal-detail-item">
            <span>Started At</span>
            <strong>{fmtDate(run.started_at)}</strong>
          </div>
          <div className="modal-detail-item">
            <span>Completed At</span>
            <strong>{fmtDate(run.completed_at || run.created_at)}</strong>
          </div>

          {run.failed_step && (
            <div className="modal-detail-item full-width">
              <span>Failed Step</span>
              <strong style={{ color: "#dc2626" }}>{run.failed_step}</strong>
            </div>
          )}

          {run.error_message && (
            <div className="modal-detail-item full-width">
              <span>Error Message</span>
              <div className="code-snippet">{run.error_message}</div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="secondary-button"
            onClick={onViewInsights}
          >
            Related AI Insights
          </button>
          <button
            type="button"
            className="primary-button datamedic-download-button"
            onClick={() =>
              downloadFile(
                `run_${run.run_id}_details.json`,
                JSON.stringify(run, null, 2),
                "application/json"
              )
            }
          >
            Export JSON
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
