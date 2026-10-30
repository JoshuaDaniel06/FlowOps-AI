# FlowOps AI — Enterprise Data Pipeline Intelligence & Monitoring

FlowOps AI is an intelligent data engineering platform combining automated ETL pipeline execution, data quality validation, anomaly detection, PostgreSQL persistence, and Claude AI copilot insights with real-time telemetry and budget controls.

---

## Architecture Overview

- **Backend:** FastAPI (Python 3.11), SQLAlchemy, PostgreSQL (`psycopg`), Anthropic Claude API SDK
- **Frontend:** React 19, Vite, Recharts, Lucide Icons, Modern Responsive Dashboard
- **Database:** PostgreSQL (with JSONB document storage, relational lineage, audit tables)
- **AI Copilot & Monitoring:** Claude-powered root cause analysis, conversational data engineering copilot, and high-throughput Rapid API test runner

---

## Quick Start

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+** & `npm`
- **PostgreSQL 14+** running locally (or remote connection)

---

### 2. Backend Setup

1. Open a terminal and navigate to the backend:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```powershell
   # Windows PowerShell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
   *(Or on Linux/macOS: `source .venv/bin/activate`)*

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure your environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Update `DATABASE_URL` with your PostgreSQL credentials.
   - Set your `ANTHROPIC_API_KEY` and optional `CLAUDE_MODEL` (default: `claude-sonnet-4-6`).

5. Run the FastAPI development server:
   ```powershell
   uvicorn main:app --reload --port 8000
   ```
   - API Server: `http://127.0.0.1:8000`
   - Interactive Swagger Docs: `http://127.0.0.1:8000/docs`

---

### 3. Frontend Setup

1. Open a separate terminal and navigate to the frontend:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   - Web Application: `http://localhost:5173`
   *(Vite automatically proxies `/api` calls to `http://127.0.0.1:8000`)*

---

## Core Features

- **ETL Pipelines:** Upload CSV datasets with automatic cleaning, schema validation, type casting, and rejection analysis.
- **Pipeline Monitoring:** Real-time metrics for execution duration, row counts (original, cleaned, rejected), retry handling, and error states.
- **Data Quality & Anomaly Detection:** Rule-based and statistical anomaly detection (RFC email syntax, E.164 phone formats, balance drift, null clustering).
- **Scheduled Pipelines:** Recurring pipeline schedule management with customizable frequencies and automated background runners.
- **AI Insights & Conversational Copilot:** Grounded Claude AI diagnoses linking rejected records directly to anomalies and SQL remediation scripts.
- **API Usage & Costs:** Live telemetry tracking input/output tokens, cost calculations, local budget caps, and downloadable PDF/CSV receipts.
- **Rapid API Test Mode:** High-throughput concurrent runner designed to safely test API boundaries and track provider balances with spending ceilings.

---

## Repository Structure

```
FlowOps-AI/
├── .gitignore                   # Root gitignore protecting secrets and environments
├── README.md                    # Project documentation
├── backend/
│   ├── .env.example             # Environment template (PostgreSQL, Claude API)
│   ├── requirements.txt         # Python dependencies
│   ├── main.py                  # FastAPI server & route handlers
│   ├── database.py              # PostgreSQL engine & connection pool
│   ├── etl.py                   # CSV parsing, transformation, & validation
│   ├── anomaly_detection.py     # Rule-based & statistical outlier detection
│   ├── ai_analyzer.py           # Anthropic Claude API integrations & prompt chains
│   ├── investigations.py        # Multi-step deep-dive root cause analysis
│   ├── sql_assistant.py         # Natural Language to PostgreSQL query engine
│   ├── reports_generator.py     # Operational reports & PDF receipt generation
│   ├── rapid_tester.py          # Concurrency workload engine & test runner
│   └── scheduler.py             # Pipeline scheduler & execution loop
├── frontend/
│   ├── package.json             # React dependencies & scripts
│   ├── vite.config.js           # Vite dev server configuration & API proxy
│   ├── src/
│   │   ├── App.jsx              # Main dashboard application shell
│   │   ├── App.css              # Dashboard styling & theme variables
│   │   ├── RapidAPITestPage.jsx # Rapid API Test control panel
│   │   └── main.jsx             # React DOM root entry point
│   └── public/                  # Static assets & SVG icons
├── docs/                        # Project documentation assets
└── sample_data/                 # Sample pipeline CSV datasets
```

---

## License

This project is licensed under the MIT License.

