import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Zap,
  Play,
  Square,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Activity,
  Coins,
  Cpu,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Copy,
  Check,
  Sparkles,
  Sliders,
  Server,
  Info,
  ExternalLink,
  Layers,
  Database,
  ArrowRight,
} from "lucide-react";

export default function RapidAPITestPage({ request, apiUrl = "http://127.0.0.1:8000" }) {
  // Config state
  const [concurrency, setConcurrency] = useState(3);
  const [maxOutputTokens, setMaxOutputTokens] = useState(3000);
  const [spendingCeiling, setSpendingCeiling] = useState(3.20);
  const [safetyMargin, setSafetyMargin] = useState(0.05);
  const [dryRun, setDryRun] = useState(true); // Default dry-run for safety until user initiates live burn
  const [taskMix, setTaskMix] = useState("all");

  // Runner live telemetry state
  const [status, setStatus] = useState("IDLE");
  const [telemetry, setTelemetry] = useState(null);
  const [promptsList, setPromptsList] = useState([]);
  const [loadingAction, setLoadingAction] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [copiedResponse, setCopiedResponse] = useState(false);

  const pollingRef = useRef(null);

  // Fetch telemetry status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/rapid-test/status`);
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
        setStatus(data.status || "IDLE");

        // Sync initial spending ceiling if default
        if (data.balances?.estimated_remaining_balance_usd && spendingCeiling === 3.20) {
          const rem = data.balances.estimated_remaining_balance_usd;
          if (rem > 0 && Math.abs(rem - spendingCeiling) > 0.01) {
            setSpendingCeiling(rem);
          }
        }
      }
    } catch (err) {
      // Backend may be starting or offline
    }
  }, [apiUrl, spendingCeiling]);

  // Fetch prompt templates
  useEffect(() => {
    async function loadPrompts() {
      try {
        const res = await fetch(`${apiUrl}/api/rapid-test/prompts`);
        if (res.ok) {
          const list = await res.json();
          setPromptsList(list);
        }
      } catch (e) {
        // Fallback
      }
    }
    loadPrompts();
    fetchStatus();
  }, [apiUrl, fetchStatus]);

  // Dynamic Polling: Fast (800ms) when running, relaxed (3000ms) when idle
  useEffect(() => {
    const intervalMs = status === "RUNNING" || status === "STOPPING" ? 800 : 3000;
    pollingRef.current = setInterval(fetchStatus, intervalMs);
    return () => clearInterval(pollingRef.current);
  }, [status, fetchStatus]);

  // Handler: Start Rapid Test
  const handleStart = async () => {
    setLoadingAction(true);
    setActionError(null);
    try {
      const res = await fetch(`${apiUrl}/api/rapid-test/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concurrency: parseInt(concurrency, 10),
          max_output_tokens: parseInt(maxOutputTokens, 10),
          spending_ceiling: parseFloat(spendingCeiling),
          safety_margin: parseFloat(safetyMargin),
          dry_run: Boolean(dryRun),
          task_mix: taskMix,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status === "error") {
        throw new Error(data.message || data.detail || "Failed to start rapid test.");
      }
      setStatus("RUNNING");
      if (data.telemetry) {
        setTelemetry(data.telemetry);
      }
    } catch (err) {
      setActionError(err.message);
    } finally {
      setLoadingAction(false);
      fetchStatus();
    }
  };

  // Handler: Stop Rapid Test
  const handleStop = async () => {
    setLoadingAction(true);
    setActionError(null);
    try {
      const res = await fetch(`${apiUrl}/api/rapid-test/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.detail || "Failed to stop rapid test.");
      }
      setStatus("STOPPING");
    } catch (err) {
      setActionError(err.message);
    } finally {
      setLoadingAction(false);
      fetchStatus();
    }
  };

  // Handler: Reset Telemetry
  const handleReset = async () => {
    setLoadingAction(true);
    setActionError(null);
    try {
      const res = await fetch(`${apiUrl}/api/rapid-test/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.detail || "Failed to reset rapid test.");
      }
      setStatus("IDLE");
      fetchStatus();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setLoadingAction(false);
    }
  };

  // Copy last response
  const handleCopyResponse = () => {
    if (telemetry?.last_successful_response?.response_preview) {
      navigator.clipboard.writeText(telemetry.last_successful_response.response_preview);
      setCopiedResponse(true);
      setTimeout(() => setCopiedResponse(false), 2000);
    }
  };

  // Computed metrics
  const metrics = telemetry?.metrics || {};
  const balances = telemetry?.balances || {};
  const pricing = telemetry?.pricing || {
    display_name: "Claude 3.5 / 3.7 Sonnet",
    input_per_m: 3.00,
    output_per_m: 15.00,
  };
  const isRunning = status === "RUNNING";
  const isStopping = status === "STOPPING";
  const ceilingPct = Math.min(100, metrics.progress_percent || 0);

  // Status badge styling
  const renderStatusBadge = () => {
    switch (status) {
      case "RUNNING":
        return (
          <span className="rapid-badge rapid-badge-running">
            <span className="pulse-dot"></span> ACTIVE — RUNNING WORKLOAD
          </span>
        );
      case "STOPPING":
        return (
          <span className="rapid-badge rapid-badge-stopping">
            <span className="pulse-dot-amber"></span> STOPPING — DRAINING TASKS
          </span>
        );
      case "STOPPED_CEILING_REACHED":
        return (
          <span className="rapid-badge rapid-badge-ceiling">
            <ShieldCheck size={14} /> SPENDING CEILING REACHED
          </span>
        );
      case "STOPPED_CREDIT_EXHAUSTED":
        return (
          <span className="rapid-badge rapid-badge-exhausted">
            <Sparkles size={14} /> VERIFIED $0.00 — CREDIT EXHAUSTED
          </span>
        );
      case "STOPPED_BY_USER":
        return (
          <span className="rapid-badge rapid-badge-user">
            <CheckCircle2 size={14} /> STOPPED BY USER
          </span>
        );
      case "STOPPED_ERROR":
        return (
          <span className="rapid-badge rapid-badge-error">
            <AlertTriangle size={14} /> STOPPED ON ERROR
          </span>
        );
      default:
        return (
          <span className="rapid-badge rapid-badge-idle">
            <Clock size={14} /> RUNNER IDLE — READY TO START
          </span>
        );
    }
  };

  return (
    <div className="page-container rapid-test-page">
      {/* =========================================================
          HERO BANNER & CONTROLS
      ========================================================= */}
      <div className="rapid-hero-card">
        <div className="rapid-hero-header">
          <div className="rapid-hero-title-group">
            <div className="rapid-icon-orb">
              <Zap size={24} className="rapid-icon-pulse" />
            </div>
            <div>
              <div className="rapid-title-row">
                <h2 className="rapid-hero-title">Rapid Claude Credit Consumption Mode</h2>
                {renderStatusBadge()}
                {dryRun && (
                  <span className="rapid-badge rapid-badge-simulation">
                    <ShieldCheck size={13} /> DRY-RUN SIMULATION (Zero Cost)
                  </span>
                )}
                {!dryRun && (
                  <span className="rapid-badge rapid-badge-live">
                    <Flame size={13} /> LIVE CLAUDE BURNING
                  </span>
                )}
              </div>
              <p className="rapid-hero-subtitle">
                High-throughput concurrent pipeline workloads designed to rapidly consume prepaid Claude API credit down to a genuine provider-reported balance of $0.00.
              </p>
            </div>
          </div>

          {/* Action Button Group */}
          <div className="rapid-hero-actions">
            {!isRunning && !isStopping ? (
              <button
                type="button"
                className="btn btn-rapid-start"
                onClick={handleStart}
                disabled={loadingAction}
              >
                <Play size={16} fill="currentColor" />
                {loadingAction ? "Starting..." : dryRun ? "Start Simulation" : "Start Live Burn"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-rapid-stop"
                onClick={handleStop}
                disabled={loadingAction || isStopping}
              >
                <Square size={16} fill="currentColor" />
                {isStopping ? "Stopping..." : "Stop Test"}
              </button>
            )}

            <button
              type="button"
              className="btn btn-rapid-reset"
              onClick={handleReset}
              disabled={isRunning || isStopping || loadingAction}
              title="Reset telemetry and elapsed time back to zero"
            >
              <RotateCcw size={15} />
              Reset
            </button>
          </div>
        </div>

        {/* Action Error Banner */}
        {actionError && (
          <div className="rapid-alert-error">
            <AlertTriangle size={16} />
            <span>{actionError}</span>
          </div>
        )}

        {/* Last Error / Stop Reason Banner */}
        {telemetry?.last_error && (
          <div className="rapid-alert-notice">
            <Info size={16} />
            <div>
              <strong>Runner Notice:</strong> {telemetry.last_error}
            </div>
          </div>
        )}
      </div>

      {/* =========================================================
          TWO BALANCES CARDS (REQUIREMENT 11)
      ========================================================= */}
      <div className="rapid-balances-grid">
        {/* Balance Card 1: Estimated Application Balance */}
        <div className="card rapid-balance-card app-balance-card">
          <div className="rapid-balance-badge-row">
            <span className="rapid-balance-type">APPLICATION DEMO LEDGER</span>
            <span className="badge badge-info">Calculated from Telemetry</span>
          </div>
          <div className="rapid-balance-value">
            ${(balances.estimated_remaining_balance_usd ?? 3.2047).toFixed(4)}
            <span className="rapid-balance-currency">USD</span>
          </div>
          <div className="rapid-balance-meta">
            <div>
              Starting Session Balance: <strong>${(balances.initial_app_balance_usd ?? 3.2047).toFixed(4)}</strong>
            </div>
            <div>
              Consumed this session: <strong>${(metrics.estimated_expenditure_usd ?? 0).toFixed(4)}</strong>
            </div>
          </div>
          <div className="rapid-balance-footnote">
            Tracked in PostgreSQL <code>ai_insights</code> & <code>ai_usage_summary</code> based on actual tokens × configured model rates.
          </div>
        </div>

        {/* Balance Card 2: Verified Provider Balance (Anthropic) */}
        <div className={`card rapid-balance-card provider-balance-card ${balances.provider_confirmed_zero ? "provider-zero-confirmed" : ""}`}>
          <div className="rapid-balance-badge-row">
            <span className="rapid-balance-type">OFFICIAL ANTHROPIC PROVIDER BALANCE</span>
            {balances.provider_confirmed_zero ? (
              <span className="badge badge-success">Provider Confirmed $0.00</span>
            ) : (
              <span className="badge badge-warning">Unverified by API (In Progress)</span>
            )}
          </div>

          <div className="rapid-balance-value">
            {balances.provider_confirmed_zero ? (
              <span className="text-gold-highlight">$0.00</span>
            ) : (
              <span className="text-muted-provider">Pending Signal</span>
            )}
            <span className="rapid-balance-currency">USD</span>
          </div>

          <div className="rapid-balance-meta">
            <div>
              Provider Status: <strong>{balances.provider_balance_label || "Active / Consuming"}</strong>
            </div>
            {balances.provider_confirmation_detail && (
              <div className="provider-confirmation-text">
                {balances.provider_confirmation_detail}
              </div>
            )}
          </div>

          <div className="rapid-balance-footnote">
            Anthropic Messages API does not expose account balance checks. Provider $0.00 is strictly certified when the API returns <code>credit_balance_too_low</code> (HTTP 400/402) or in your Anthropic Console.
          </div>
        </div>
      </div>

      {/* =========================================================
          CONFIGURATION CONTROLS PANEL
      ========================================================= */}
      <div className="card rapid-config-panel">
        <div className="card-header rapid-card-header">
          <div className="rapid-card-title-group">
            <Sliders size={18} />
            <h3 className="card-title">Test Runner Controls & Parameters</h3>
          </div>
          <div className="rapid-config-mode-toggle">
            <span className={`toggle-label ${!dryRun ? "active" : ""}`}>Live Burn</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={isRunning || isStopping}
              />
              <span className="slider round"></span>
            </label>
            <span className={`toggle-label ${dryRun ? "active" : ""}`}>Dry-Run (0 Cost)</span>
          </div>
        </div>

        <div className="card-body">
          <div className="rapid-controls-grid">
            {/* Control 1: Concurrency */}
            <div className="rapid-control-item">
              <div className="rapid-control-label-row">
                <label>Request Concurrency</label>
                <span className="rapid-control-val">{concurrency} workers</span>
              </div>
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                disabled={isRunning || isStopping}
                className="rapid-slider"
              />
              <div className="rapid-control-hint">
                Concurrent async workers (1 = gentle, 3-4 = optimal throughput, 6-8 = max load).
              </div>
            </div>

            {/* Control 2: Output Token Limit */}
            <div className="rapid-control-item">
              <div className="rapid-control-label-row">
                <label>Output Token Limit (max_tokens)</label>
                <span className="rapid-control-val">{maxOutputTokens.toLocaleString()} tokens</span>
              </div>
              <input
                type="range"
                min="500"
                max="4096"
                step="100"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(e.target.value)}
                disabled={isRunning || isStopping}
                className="rapid-slider"
              />
              <div className="rapid-control-hint">
                Upper bound sent to Claude API. Actual returned tokens determine exact billing.
              </div>
            </div>

            {/* Control 3: Spending Cap */}
            <div className="rapid-control-item">
              <div className="rapid-control-label-row">
                <label>Spending Ceiling ($ USD)</label>
                <span className="rapid-control-val">${parseFloat(spendingCeiling || 0).toFixed(2)}</span>
              </div>
              <input
                type="number"
                min="0.05"
                max="50.00"
                step="0.05"
                value={spendingCeiling}
                onChange={(e) => setSpendingCeiling(e.target.value)}
                disabled={isRunning || isStopping}
                className="rapid-input"
              />
              <div className="rapid-control-hint">
                Strict stopping threshold. Runner will cease dispatching once expenditure hits this cap.
              </div>
            </div>

            {/* Control 4: Safety Margin */}
            <div className="rapid-control-item">
              <div className="rapid-control-label-row">
                <label>Safety Margin ($ USD)</label>
                <span className="rapid-control-val">${parseFloat(safetyMargin || 0).toFixed(2)}</span>
              </div>
              <input
                type="number"
                min="0.01"
                max="1.00"
                step="0.01"
                value={safetyMargin}
                onChange={(e) => setSafetyMargin(e.target.value)}
                disabled={isRunning || isStopping}
                className="rapid-input"
              />
              <div className="rapid-control-hint">
                Buffer subtracted from ceiling to prevent overshooting budget on in-flight requests.
              </div>
            </div>

            {/* Control 5: Workload Task Mix */}
            <div className="rapid-control-item rapid-control-fullwidth">
              <label>Workload Domain & Engineering Prompts</label>
              <select
                value={taskMix}
                onChange={(e) => setTaskMix(e.target.value)}
                disabled={isRunning || isStopping}
                className="rapid-select"
              >
                <option value="all">Balanced Rotation — All 5 Deep Engineering Domains</option>
                {promptsList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.category}: {p.title}
                  </option>
                ))}
              </select>
              <div className="rapid-control-hint">
                Requests send genuine, heavy technical scenarios (ETL architecture, DQ forensics, rollback PL/pgSQL, JSONB partitioning, executive audits) with substantial token weights.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================
          LIVE TELEMETRY METRICS ROW
      ========================================================= */}
      <div className="rapid-telemetry-grid">
        <div className="rapid-stat-box">
          <div className="rapid-stat-icon-wrap icon-purple">
            <Clock size={20} />
          </div>
          <div>
            <div className="rapid-stat-label">ELAPSED TIME</div>
            <div className="rapid-stat-value">
              {Math.floor((telemetry?.elapsed_seconds || 0) / 60)}m{" "}
              {Math.floor((telemetry?.elapsed_seconds || 0) % 60)}s
            </div>
            <div className="rapid-stat-sub">
              {isRunning ? "Live ticking" : "Session duration"}
            </div>
          </div>
        </div>

        <div className="rapid-stat-box">
          <div className="rapid-stat-icon-wrap icon-green">
            <Activity size={20} />
          </div>
          <div>
            <div className="rapid-stat-label">COMPLETED REQUESTS</div>
            <div className="rapid-stat-value">
              {metrics.completed_requests || 0}
            </div>
            <div className="rapid-stat-sub">
              Rate: {metrics.requests_per_minute || 0} req/min
            </div>
          </div>
        </div>

        <div className="rapid-stat-box">
          <div className="rapid-stat-icon-wrap icon-amber">
            <Cpu size={20} />
          </div>
          <div>
            <div className="rapid-stat-label">TOTAL TOKENS</div>
            <div className="rapid-stat-value">
              {(metrics.total_tokens || 0).toLocaleString()}
            </div>
            <div className="rapid-stat-sub">
              Throughput: {metrics.tokens_per_second || 0} tok/sec
            </div>
          </div>
        </div>

        <div className="rapid-stat-box">
          <div className="rapid-stat-icon-wrap icon-blue">
            <Coins size={20} />
          </div>
          <div>
            <div className="rapid-stat-label">ESTIMATED EXPENDITURE</div>
            <div className="rapid-stat-value text-expenditure">
              ${(metrics.estimated_expenditure_usd || 0).toFixed(4)}
            </div>
            <div className="rapid-stat-sub">
              {ceilingPct.toFixed(1)}% of ${parseFloat(spendingCeiling || 0).toFixed(2)} cap
            </div>
          </div>
        </div>

        <div className="rapid-stat-box">
          <div className="rapid-stat-icon-wrap icon-red">
            <ShieldAlert size={20} />
          </div>
          <div>
            <div className="rapid-stat-label">FAILED / RATE LIMITS</div>
            <div className="rapid-stat-value">
              {metrics.failed_requests || 0}{" "}
              <span className="text-muted-small">({metrics.rate_limit_hits || 0} hits)</span>
            </div>
            <div className="rapid-stat-sub">
              Auto exponential backoff & safety halt
            </div>
          </div>
        </div>
      </div>

      {/* Spending Ceiling Progress Bar */}
      <div className="card rapid-progress-card">
        <div className="rapid-progress-header">
          <div className="rapid-progress-title">
            <Flame size={16} />
            <span>Spending Ceiling Progress: ${(metrics.estimated_expenditure_usd || 0).toFixed(4)} of ${parseFloat(spendingCeiling || 0).toFixed(2)}</span>
          </div>
          <span className="rapid-progress-pct">{ceilingPct.toFixed(1)}%</span>
        </div>
        <div className="rapid-progress-track">
          <div
            className={`rapid-progress-fill ${ceilingPct >= 90 ? "fill-critical" : ceilingPct >= 65 ? "fill-warning" : "fill-normal"}`}
            style={{ width: `${ceilingPct}%` }}
          ></div>
        </div>
        <div className="rapid-progress-meta">
          <span>Safety stop threshold: ${(parseFloat(spendingCeiling || 0) - parseFloat(safetyMargin || 0)).toFixed(2)} USD</span>
          <span>Configured Safety Margin: ${parseFloat(safetyMargin || 0).toFixed(2)} USD</span>
        </div>
      </div>

      {/* =========================================================
          TWO-COLUMN WORKLOAD STREAM & RESPONSE VIEWER
      ========================================================= */}
      <div className="rapid-workload-grid">
        {/* Left: Live Request Stream */}
        <div className="card rapid-stream-card">
          <div className="card-header rapid-card-header">
            <div className="rapid-card-title-group">
              <Layers size={18} />
              <h3 className="card-title">Live Request Stream</h3>
            </div>
            <span className="badge badge-info">{telemetry?.recent_logs?.length || 0} in buffer</span>
          </div>

          <div className="card-body rapid-stream-body">
            {(!telemetry?.recent_logs || telemetry.recent_logs.length === 0) ? (
              <div className="rapid-empty-state">
                <Clock size={32} />
                <p>No requests recorded in this session yet.</p>
                <span>Click &quot;Start Live Burn&quot; or &quot;Start Simulation&quot; to begin processing workload batches.</span>
              </div>
            ) : (
              <div className="rapid-stream-list">
                {telemetry.recent_logs.map((log) => (
                  <div key={log.id} className={`rapid-stream-item status-${log.status}`}>
                    <div className="rapid-stream-meta">
                      <span className="stream-time">{log.time}</span>
                      <span className={`stream-badge ${log.status === "success" ? "badge-success" : "badge-danger"}`}>
                        {log.status === "success" ? "200 OK" : "ERROR"}
                      </span>
                      <span className="stream-category">{log.category}</span>
                    </div>

                    <div className="stream-title">{log.title}</div>

                    <div className="stream-stats">
                      {log.status === "success" ? (
                        <>
                          <span>In: <strong>{log.input_tokens?.toLocaleString()}</strong></span>
                          <span>Out: <strong>{log.output_tokens?.toLocaleString()}</strong></span>
                          <span>Total: <strong>{log.total_tokens?.toLocaleString()}</strong></span>
                          <span>Cost: <strong className="text-cost">${log.cost_usd?.toFixed(5)}</strong></span>
                          <span>Latency: <strong>{log.duration_seconds}s</strong></span>
                        </>
                      ) : (
                        <span className="text-danger">{log.error}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Last Successful API Response */}
        <div className="card rapid-response-card">
          <div className="card-header rapid-card-header">
            <div className="rapid-card-title-group">
              <Sparkles size={18} />
              <h3 className="card-title">Last Successful API Response</h3>
            </div>

            {telemetry?.last_successful_response && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCopyResponse}
              >
                {copiedResponse ? <Check size={14} /> : <Copy size={14} />}
                {copiedResponse ? "Copied" : "Copy"}
              </button>
            )}
          </div>

          <div className="card-body rapid-response-body">
            {!telemetry?.last_successful_response ? (
              <div className="rapid-empty-state">
                <Sparkles size={32} />
                <p>No successful response received yet.</p>
                <span>When an API request completes, the full response, token breakdown, and architectural analysis will display here.</span>
              </div>
            ) : (
              <div className="rapid-response-content">
                <div className="rapid-response-meta-banner">
                  <div>
                    <strong>{telemetry.last_successful_response.title}</strong>
                    <div className="text-muted-small">
                      Category: {telemetry.last_successful_response.category} | Model: {telemetry.last_successful_response.model}
                    </div>
                  </div>
                  <div className="rapid-response-cost-badge">
                    ${(telemetry.last_successful_response.cost_usd || 0).toFixed(5)} USD
                  </div>
                </div>

                <div className="rapid-response-tokens-row">
                  <div>Input: <strong>{telemetry.last_successful_response.input_tokens?.toLocaleString()}</strong></div>
                  <div>Output: <strong>{telemetry.last_successful_response.output_tokens?.toLocaleString()}</strong></div>
                  <div>Total: <strong>{telemetry.last_successful_response.total_tokens?.toLocaleString()}</strong></div>
                  <div>Latency: <strong>{telemetry.last_successful_response.duration_seconds}s</strong></div>
                </div>

                <div className="rapid-response-text-viewer">
                  <pre>{telemetry.last_successful_response.response_preview}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* =========================================================
          PRICING ENGINE & SAFETY TRANSPARENCY CARD
      ========================================================= */}
      <div className="card rapid-pricing-card">
        <div className="card-header rapid-card-header">
          <div className="rapid-card-title-group">
            <Database size={18} />
            <h3 className="card-title">Configured Model & Pricing Verification</h3>
          </div>
          <span className="badge badge-info">{pricing.display_name}</span>
        </div>

        <div className="card-body">
          <div className="rapid-pricing-grid">
            <div className="rapid-price-item">
              <span className="price-label">Configured Model</span>
              <span className="price-val font-mono">{telemetry?.model || "claude-sonnet-4-6"}</span>
              <span className="price-sub">Loaded from <code>backend/.env</code></span>
            </div>

            <div className="rapid-price-item">
              <span className="price-label">Standard Input Rate</span>
              <span className="price-val">${pricing.input_per_m?.toFixed(2)} / 1M</span>
              <span className="price-sub">${(pricing.input_per_m / 1_000_000).toFixed(8)} per token</span>
            </div>

            <div className="rapid-price-item">
              <span className="price-label">Standard Output Rate</span>
              <span className="price-val">${pricing.output_per_m?.toFixed(2)} / 1M</span>
              <span className="price-sub">${(pricing.output_per_m / 1_000_000).toFixed(8)} per token</span>
            </div>

            <div className="rapid-price-item">
              <span className="price-label">Cache Write / Read</span>
              <span className="price-val">${pricing.cache_write_per_m?.toFixed(2)} / ${pricing.cache_read_per_m?.toFixed(2)}</span>
              <span className="price-sub">Prompt cache write / read per 1M</span>
            </div>
          </div>

          <div className="rapid-formula-bar">
            <strong>Formula:</strong>{" "}
            <code>
              Cost = (Input × ${pricing.input_per_m} + Output × ${pricing.output_per_m} + CacheWrite × ${pricing.cache_write_per_m} + CacheRead × ${pricing.cache_read_per_m}) / 1,000,000
            </code>
          </div>

          <div className="rapid-safety-notes">
            <ShieldCheck size={16} />
            <div>
              <strong>Safety Guardrails Active:</strong>
              <ul>
                <li>The API key remains securely inside the backend environment (never exposed to client).</li>
                <li>Production datasets, recurring schedules, and pipeline lineage remain completely intact.</li>
                <li>Automatic halt triggers when spending cap is reached, provider reports credit exhaustion, or 5 consecutive errors occur. Infinite retries are disallowed.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

