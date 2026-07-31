# HappyShelf — Smart Household Inventory Management System

A full-stack household/team inventory manager with role-based access, ML-assisted demand and expiry predictions, reorder & consumption tracking, sustainability metrics, and one-click PDF reporting. Built with React, Express, MongoDB, and a Python (FastAPI + scikit-learn) prediction service.

Every chart in the app is drawn from records the household actually created — there are no illustrative or placeholder series. Where there is no data yet, a chart says so rather than showing a shape.

## Features

- **Authentication & RBAC** — JWT-based login/register, four roles (`Admin`, `Manager`, `Staff`, `Viewer`) with per-route enforcement and a last-remaining-Admin safeguard. Roles and account status are re-read from the database on every request, so a demotion, deactivation, or removal takes effect immediately rather than whenever the token happens to expire.
- **Inventory CRUD** — full item lifecycle (name, category, quantity, unit, daily usage, cost, min stock level, storage location, purchase/expiry dates), plus bulk CSV/JSON import (one request for the whole file) and CSV export.
- **Search, filter, sort & pagination** — real-time search by name/category/storage location, filters for category/stock status/expiry status, five sort fields (name, quantity, price, total value, expiry date) in either direction, server-side pagination.
- **Reorder & Consumption tracking** — dedicated "Reorder" and "Consume" actions (never below zero, never more than available), each maintaining a full history log (item, quantity, date, resulting stock) for analytics and demand forecasting.
- **Dashboard & Alerts** — live stats (total items, low stock, out of stock, protected inventory value, carbon reduced), Low Stock / Expiring Soon / Out of Stock alert cards, recent activity feed.
- **Statistics & Analytics** — all derived from the reorder and consumption logs: monthly usage trends, weekly restocking spend, stock levels, category breakdown, and expiry distribution. Charts with no underlying records render an empty state instead of a generated curve.
- **ML Predictions** — 7-day demand forecast, expiry risk, low-stock probability, and purchase recommendations per item, from scikit-learn models. The demand forecast is fitted on **your household's own consumption log** where there's enough of it, falling back to the shipped training data and then to a flat projection — each item reports which tier produced it (see [Forecast sources](#forecast-sources)). A JS heuristic covers the ML service being unreachable entirely, with a visible "Live ML Model" / "Heuristic Fallback" badge.
- **Sustainability tracking** — food waste tracker, CO₂e avoided per week (from stock actually consumed rather than binned), used-before-expiry efficiency, sustainability score, smart recommendations.
- **Action Plans** — auto-generated restock/use-soon checklists derived from current inventory state, using the same stock and expiry rules as every other surface (including already-expired items, which an earlier version silently skipped).
- **Team management** — Admins and Managers add household members directly, choosing the member's initial password, and manage their roles. There is no email invitation flow; accounts are created ready to use.
- **PDF Inventory Report** — single-click, branded, multi-page report covering inventory summary, category breakdown, complete inventory, low-stock report, expiry report, ML prediction summary, spending & cost analysis, sustainability report, and consumption history.
- **Resilient by design** — outside production the backend falls back to an in-memory store when MongoDB is unreachable, and it always falls back to a JS heuristic when the ML service is unreachable, so local development is never blocked. In production a missing database is a startup failure rather than a silent data-loss trap.
- **Tested** — 273 tests (129 backend, 111 frontend, 33 ML service) run on every push (see `.github/workflows/ci.yml`).

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS, Chart.js, jsPDF + jspdf-autotable, Lucide icons |
| Backend | Node.js + Express, MongoDB + Mongoose, JWT (jsonwebtoken) + bcrypt, helmet, express-rate-limit |
| ML Service | Python, FastAPI, scikit-learn (Decision Tree classifiers/regressors), pandas/numpy, joblib |
| Testing | `node --test` + supertest (backend), Vitest + Testing Library (frontend), pytest (ML) |

## Project Structure

```
HappyShelf/
├── backend/
│   ├── src/
│   │   ├── config/database.js          # MongoDB connection (in-memory fallback outside production)
│   │   ├── models/                     # Mongoose schemas
│   │   │   ├── User.js
│   │   │   ├── Item.js
│   │   │   ├── ReorderHistory.js
│   │   │   ├── ConsumptionHistory.js
│   │   │   └── ActionPlan.js
│   │   ├── controllers/                # authController, inventoryController, teamController, actionPlanController
│   │   ├── middleware/                 # auth.js (JWT + live role/status check), rateLimiter.js
│   │   ├── routes/                     # authRoutes, inventoryRoutes, teamRoutes, actionPlanRoutes
│   │   ├── store/devStore.js           # in-memory user store used when the DB is down
│   │   ├── utils/
│   │   │   ├── inventoryMetrics.js     # SINGLE SOURCE OF TRUTH for stock/expiry/stats rules
│   │   │   │                           #   (used by controllers, filters, alerts AND action plans)
│   │   │   ├── inventoryQuery.js       # search/filter/sort/pagination
│   │   │   ├── itemValidation.js       # shared by POST /items and bulk import
│   │   │   ├── mailer.js               # low/out-of-stock alert emails (BCC)
│   │   │   └── historyJson.js          # shared camelCase envelope for reorder/consumption history
│   │   └── server.js
│   ├── __tests__/                      # node --test + supertest
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/                 # Dashboard, InventoryExplorer, InventoryTable, ItemModal,
│   │   │                                #   ReorderModal, ConsumeModal, Sidebar, Login/Register, ...
│   │   │   ├── predictions/            # DemandForecast, ExpiryForecast, LowStockForecast, ...
│   │   │   ├── stats/                  # UsageTrends, StockLevelsChart, CategoryInsights, ...
│   │   │   ├── sustainability/         # FoodWasteTracker, CO2Impact, SustainabilityScore, ...
│   │   │   └── charts/                 # shared chart primitives
│   │   ├── contexts/                   # AuthContext.tsx, ToastContext.tsx
│   │   ├── hooks/                      # useHashRoute, useUserSettings, useModalDismiss
│   │   ├── services/
│   │   │   ├── httpClient.ts           # single fetch entry point; handles 401/session expiry
│   │   │   └── api.ts                  # typed client for the whole backend API
│   │   └── utils/
│   │       ├── stock.ts                # client mirror of inventoryMetrics.js
│   │       ├── expiry.ts               # days-to-expiry rules
│   │       ├── history.ts              # bucketing for every analytics chart
│   │       ├── sustainability.ts       # shared "wasted" definition + CO2 factors
│   │       ├── csvImport.ts, reorder.ts, metricsCalculator.ts, reportGenerator.ts
│   └── .env.example
├── ml_service/
│   ├── main.py                         # FastAPI app, /predict + /health
│   ├── test_main.py
│   └── requirements.txt
├── fixtures/
│   └── inventory-metrics.json          # shared contract fixtures (backend + frontend tests)
└── .github/workflows/ci.yml
```

## Roles & Permissions

| Action | Admin | Manager | Staff | Viewer |
|---|:-:|:-:|:-:|:-:|
| View inventory, stats, predictions, reports | ✅ | ✅ | ✅ | ✅ |
| Create / edit / delete items, reorder, consume | ✅ | ✅ | ✅ | ❌ |
| Manage action plans | ✅ | ✅ | ✅ | ❌ |
| Manage team members | ✅ | ✅ | ❌ | ❌ |

The account created via `/auth/register` is always the household's first `Admin`; further members are added from the Team page.

A Manager may only assign or act on `Staff`/`Viewer` accounts — never an `Admin` or a peer `Manager` — and nobody may change their own role or active status unless they are an Admin. A household can never be left with zero active Admins.

Changing a member's role, deactivating them, resetting their password, or removing them **immediately invalidates their existing sessions**; their next request returns 401/403 and the UI returns them to the login screen with an explanation.

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- MongoDB (local install or MongoDB Atlas) — optional for local dev; the backend runs in an in-memory fallback mode without it

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env   # then edit as needed
npm run dev
```

`.env` (see `backend/.env.example` for the annotated full list):
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/happyshelf

# Required in production — the server refuses to start without it there.
JWT_SECRET=your_jwt_secret_here_change_in_production

# Browser origins allowed to call this API. Defaults to the local dev
# origins; set it to your deployed frontend URL in production.
CORS_ORIGIN=http://localhost:5173

# Optional — the backend falls back to a JS heuristic if unreachable.
ML_SERVICE_URL=http://127.0.0.1:8000
ML_SERVICE_TOKEN=
```

Backend runs at `http://localhost:5000`.

### 2. ML Service

```bash
cd ml_service
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

> `python -m uvicorn` rather than a bare `uvicorn`: on Windows, and anywhere
> pip installs with `--user`, the console scripts land in a Scripts directory
> that isn't on PATH, so `uvicorn` alone fails with "command not found". The
> `python -m` form always resolves. Same applies to `python -m pytest`.

Runs at `http://localhost:8000`.

**Startup models.** Expiry risk and low-stock probability are trained at boot from CSVs in `backend/` if present (`expiry_risk_data.csv`, `low_stock_data.csv`, `demand_forecasting_data.csv`), falling back to small built-in samples otherwise. These are cached to `ml_service/model_cache/`, keyed by a fingerprint of their training data, so additional workers and subsequent restarts load them from disk instead of refitting. Editing a training CSV changes the fingerprint and transparently forces a retrain — there is no cache to bust by hand.

**Per-request models.** Demand forecasting additionally fits a model per item on the household's own consumption history, sent with each request. See [Forecast sources](#forecast-sources) for the tiers and thresholds. This needs no configuration; it engages automatically once an item has enough logged consumption.

`/predict` can be protected with a shared secret: set the same `ML_SERVICE_TOKEN` here and in the backend's `.env`. Left unset the endpoint is open, which is safe only while the process is bound to loopback — the service prints a startup warning to that effect. `GET /health` is always unauthenticated, for uptime probes.

The backend proxies to this service and automatically falls back to a JS heuristic if it's slow or unreachable — so it's optional for local dev too.

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env   # then edit if your API isn't on localhost:5000
npm run dev
```

`.env`:
```env
VITE_API_URL=http://localhost:5000/api
```

Runs at `http://localhost:5173`.

## Available Scripts

**Backend** (`backend/`): `npm run dev` (watch mode), `npm start`, `npm test` (129 tests), `npm run test:watch`
**Frontend** (`frontend/`): `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` (111 tests), `npm run test:watch`, `npm run test:coverage`, `npm run preview`
**ML service** (`ml_service/`): `python -m uvicorn main:app --reload --port 8000`, `python -m pytest` (33 tests)

All three run in CI on every push and pull request (`.github/workflows/ci.yml`).

## API Reference

All routes below except `/auth/*` require `Authorization: Bearer <token>`.

### Auth — `/api/auth`
| Method | Path | Notes |
|---|---|---|
| POST | `/register` | Creates a household + its first Admin user |
| POST | `/login` | Rate-limited |

### Inventory — `/api/inventory`
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/items` | any | Accepts `search`, `category`, `stockStatus`, `expiryStatus`, `sortBy`, `sortOrder`, `page`, `limit` — omit all to get the full unfiltered list |
| POST | `/items` | Admin/Manager/Staff | |
| POST | `/items/bulk` | Admin/Manager/Staff | Up to 1000 items per call. Valid rows are created and invalid ones reported per-row, rather than failing the whole batch |
| PUT | `/items/:id` | Admin/Manager/Staff | |
| DELETE | `/items/:id` | Admin/Manager/Staff | |
| PATCH | `/items/:id/reorder` | Admin/Manager/Staff | Optional `quantity`; auto-suggests one otherwise |
| PATCH | `/items/:id/consume` | Admin/Manager/Staff | Atomic, never below zero, never more than in stock |
| GET | `/reorder-history` | any | Newest first. `limit` (default 50, max 2000) and `days` narrow the window |
| GET | `/consumption-history` | any | Same `limit`/`days` params — the analytics charts request a year |
| GET | `/stats` | any | Aggregate dashboard metrics |
| GET | `/predictions` | any | Proxies to the ML service with the household's consumption history; JS fallback if unreachable |

### Health — `/api/health`
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/health` | none | Unauthenticated liveness probe, mounted before the rate limiter so uptime checks don't consume anyone's budget |

### Team — `/api/team` (Admin/Manager only)
`GET /`, `POST /`, `PUT /:id`, `DELETE /:id`

### Action Plans — `/api/action-plans`
`GET /` (any), `POST /`, `PATCH /:planId/tasks/:taskId`, `DELETE /:planId` (Admin/Manager/Staff)

### ML Service — `/predict` (called by the backend, not the frontend directly)

`POST http://localhost:8000/predict` with:

```jsonc
{
  "items": [ /* the household's inventory */ ],
  "consumption_history": [           // optional; the backend sends up to a
    {                                // year, capped at 2000 records
      "item_id": "…",
      "item_name": "Basmati Rice",
      "quantity_consumed": 1.5,
      "consumed_at": "2026-07-14T09:00:00.000Z"
    }
  ]
}
```

Returns per-item `demand_forecast`, `expiry_risk`, `low_stock_probability`,
`refill_date` and `forecast_source`, plus `model_metadata` carrying a
`forecast_sources` tally. `GET /health` is an unauthenticated readiness probe.

## Forecast sources

The demand forecast is not a single model. Each item is forecast from the most
specific source available, and the response says which one was used — both
per item (`forecast_source`) and as a tally in
`model_metadata.forecast_sources`.

| Tier | `forecast_source` | When it applies |
|---|---|---|
| 1 | `household_history` | The item has **8 or more distinct days** of logged consumption. A `DecisionTreeRegressor` is fitted on that history alone. |
| 2 | `pretrained_model` | No usable history, but the item's name matches one in the shipped training data. |
| 3 | `daily_usage_estimate` | Neither — a flat projection of the `daily_usage` figure on the item. |

Why this ordering matters: the pre-trained demand models are keyed by item
*name* and the training data covers 15 of them (Milk, Rice, Eggs, Bread,
Cheese, Butter, Bananas, Tomatoes, Yogurt, Cereal, Ice Cream, Frozen Peas,
Orange Juice, Cooking Oil, Chicken Breast). Anything a user actually calls
their items — "Basmati Rice", "Shampoo" — never matched, so in practice most
forecasts were tier 3. Tier 1 removes that ceiling: any item becomes
forecastable once it has been consumed enough times, regardless of its name.

Details worth knowing:

- Consumes are **aggregated per calendar day** before fitting, so twenty
  entries logged on one afternoon count as one day of demand, not twenty
  independent samples.
- Fitted models are cached in-process, keyed by a digest of the history they
  were built from, so the dashboard re-polling predictions doesn't refit
  identical data. The cache is bounded (256 entries, least-recently-used
  evicted).
- Household history is fitted at `max_depth=3` — shallower than the
  pre-trained models, because a single household's log is far smaller and a
  deeper tree would fit noise.
- `model_confidence` in the metadata is a **data-completeness score**, not
  model accuracy: it rises as items gain expiry dates and usage rates. The UI
  labels it "Data completeness" for that reason.

## Where the analytics come from

Every chart is derived from stored records. The bucketing lives in
`frontend/src/utils/history.ts` so each chart aggregates the same way.

| Chart | Source | Window |
|---|---|---|
| Usage Trends | `ConsumptionHistory` — units consumed | 6 calendar months |
| Seasonal Trends | `ConsumptionHistory` — units consumed | 12 calendar months |
| Restocking Spend | `ReorderHistory` × item's current `cost_per_unit` | 8 trailing weeks |
| CO₂ Impact | `ConsumptionHistory` × per-category CO₂e factor | 8 trailing weeks |
| Used (30 days) | `ConsumptionHistory` | 30 days |
| Stock Levels, Category Breakdown, Expiry Analysis, Food Waste | current items | live |

Two caveats stated in the UI as well as here:

- **Spend is valued at today's price.** History rows don't store the price
  paid, so a reorder is multiplied by the item's *current* `cost_per_unit`.
  Items with no cost recorded contribute ₹0 rather than a guessed price.
- **CO₂ shows emissions avoided, not emissions incurred.** Waste events aren't
  logged, but consumption is, and consumed stock is precisely the stock that
  wasn't thrown away. Current at-risk waste is shown as a figure alongside the
  chart rather than as a trend.

A chart with no underlying records renders an empty state explaining which
action produces the data. None of them fall back to a generated series.

## Key Business Logic

- **Low stock**: fewer than 3 days of supply remaining (`quantity / daily_usage`), **or** at/below a configured `min_stock_level`. The `min_stock_level` half applies even when `daily_usage` is 0 — that setting is the user stating what "low" means for that item.
- **Expiring soon**: expires within 7 days, *or already expired* (a deliberate design choice — an expired item must never be missing from "expiring soon" surfaces).
- **Out of stock**: `quantity <= 0`.
- **`lowStockItems`** in the stats counts everything needing restock attention, i.e. both `low` and `out`.
- **Suggested reorder quantity**: bring stock up to `max(min_stock_level, ceil(daily_usage × 14), 1)`, floored at adding at least 1 unit.
- **Sustainability "wasted"**: out of stock, or already past expiry.

These rules live in exactly two places — `backend/src/utils/inventoryMetrics.js` and its client mirror `frontend/src/utils/stock.ts` + `expiry.ts`. Two implementations exist so the dashboard can recompute instantly without a round trip; `fixtures/inventory-metrics.json` is a shared fixture set that **both** test suites run through **both** implementations, so the two cannot drift apart. If you change a rule on one side, change it on the other in the same commit.

Everything server-side imports from `inventoryMetrics.js` — the stats
endpoint, the search filters, the low-stock alert emails, **and the action
plan generator**. That last one is worth calling out: it used to keep private
copies of both rules, and they had drifted. Its `isLowStock` ignored
`min_stock_level`, and its `isExpiringSoon` guarded on `days >= 0`, so an item
that had *already expired* produced no "use soon" task at all — the one case
an action plan most needs to raise. Regression tests for both now live in
`backend/__tests__/actionPlans.test.js`.

Similarly, the "wasted" definition and the per-category CO₂ factors are shared
from `frontend/src/utils/sustainability.ts` rather than copy-pasted into the
waste tracker, the CO₂ chart, the sustainability score and the PDF report.

## A note on the frontend lockfile

`frontend/package.json` declares two devDependencies the app never imports:

```json
"@emnapi/core": "2.0.0-alpha.3",
"@emnapi/runtime": "2.0.0-alpha.3"
```

They are transitive dependencies of `@rolldown/binding-wasm32-wasi`, an
optional dependency of `rolldown` that arrives via vite/vitest. npm on Windows
records that binding in `package-lock.json` but does not resolve its
dependencies, because the binding is not installable there — leaving a lockfile
that names packages it has no entries for. Linux npm *does* walk that subtree,
so `npm ci` fails in CI with:

```
npm error code EUSAGE
npm error Missing: @emnapi/core@2.0.0-alpha.3 from lock file
```

Declaring them explicitly forces npm to resolve them on every platform, so a
lockfile regenerated on Windows can no longer omit them. No npm flag fixes this
otherwise — `--package-lock-only`, a from-scratch regeneration, `--os=linux`
and `--os=wasi` all reproduce the gap.

Delete both entries once `rolldown` no longer ships a wasm32-wasi binding. If
CI ever fails with that `EUSAGE` message again, check whether the same trick is
needed for a newly added optional binding.

**Regenerate the lockfile with `npm install`, never `npm install
--package-lock-only`.** The latter strips `resolved` and `integrity` from
several hundred entries, silently discarding the supply-chain pinning that
makes `npm ci` reproducible.

## Upgrading: the Item household field

Inventory items used to store their household under a field named `user_id`,
even though the value was always a household id, not a user id. It is now
`household_id`. The misnomer was worth removing rather than living with: the
next person to touch scoping reads `user_id` and reasonably assumes per-user
ownership, and getting that wrong leaks one household's inventory into
another's.

**Existing databases must be migrated**, otherwise every stored item stops
matching the new queries and disappears from the app while still sitting in
the collection:

```bash
cd backend
node scripts/migrate-item-household-id.js --dry-run   # report only
node scripts/migrate-item-household-id.js             # apply
```

The script is idempotent, so running it twice is a no-op. It renames
documents that carry only `user_id`, drops a redundant `user_id` where both
fields agree, and **skips** any document whose two fields disagree — that
conflict cannot be resolved safely without knowing which value is correct, so
it is reported for manual attention instead of guessed at. Once nothing
carries `user_id`, the stale index is dropped too.

The backend also detects the situation on startup and prints a warning naming
the script, so an unmigrated deployment announces itself rather than quietly
showing empty inventories. Detection only — migrating automatically would
race across workers and hide a decision worth making deliberately.

Over the wire the field is now `householdId`, matching `User`, `ActionPlan`
and the history models, which already used that name.

## Building for Production

```bash
cd frontend && npm run build   # outputs frontend/dist
cd backend && npm start
```

Serve `ml_service` behind a process manager (e.g. gunicorn + uvicorn workers) in production; it's stateless aside from its cached models, which every worker loads from `model_cache/` rather than refitting.

Set `NODE_ENV=production` on the backend. That makes a missing `JWT_SECRET` and an unreachable database hard startup failures instead of silent degradation.

## Notes

- Passwords are hashed with bcrypt; JWTs expire after 7 days, and are additionally revocable — every token carries a `token_version` that the server bumps on any role change, deactivation, or password reset.
- Data is isolated per household via `householdId`/`user_id`; every query is scoped to the authenticated user's household.
- If MongoDB is unreachable **outside production**, the backend serves from an in-memory store so local development isn't blocked — this data does not persist across restarts. Under `NODE_ENV=production` the process exits instead, rather than accepting writes it would silently lose.
- Every route under `/api` is rate limited; auth and the expensive endpoints (ML predictions, bulk import) have tighter budgets. Limits are keyed by user id when authenticated, so household members behind one connection don't share a bucket.
- `is_ml: true/false` on the predictions response (and the "Live ML Model" / "Heuristic Fallback" badge in the UI) tells you whether predictions came from the ML service or the JS fallback. `forecast_source` on each item is finer-grained — see [Forecast sources](#forecast-sources).
- The JS fallback uses the same consumption history the ML service would have learned from, so an item with real usage data still gets a forecast grounded in it when the ML service is down.
- History endpoints default to the newest 50 entries. The analytics views request `limit=2000&days=365`; the server caps `limit` at 2000 regardless of what's asked for.
