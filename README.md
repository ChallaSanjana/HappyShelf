# HappyShelf — Smart Household Inventory Management System

A full-stack household/team inventory manager with role-based access, ML-powered demand and expiry predictions, reorder & consumption tracking, sustainability metrics, and one-click PDF reporting. Built with React, Express, MongoDB, and a Python (FastAPI + scikit-learn) prediction service.

## Features

- **Authentication & RBAC** — JWT-based login/register, four roles (`Admin`, `Manager`, `Staff`, `Viewer`) with per-route enforcement and a last-remaining-Admin safeguard.
- **Inventory CRUD** — full item lifecycle (name, category, quantity, unit, daily usage, cost, min stock level, storage location, purchase/expiry dates), plus CSV/JSON import and CSV export.
- **Search, filter, sort & pagination** — real-time search by name/category/storage location, filters for category/stock status/expiry status, five sort fields (name, quantity, price, total value, expiry date) in either direction, server-side pagination.
- **Reorder & Consumption tracking** — dedicated "Reorder" and "Consume" actions (never below zero, never more than available), each maintaining a full history log (item, quantity, date, resulting stock) for analytics and demand forecasting.
- **Dashboard & Alerts** — live stats (total items, low stock, out of stock, protected inventory value, carbon reduced), Low Stock / Expiring Soon / Out of Stock alert cards, recent activity feed.
- **Statistics & Analytics** — usage trends, stock-level charts, category insights, expiry analysis, cost analytics.
- **ML Predictions** — 7-day demand forecast, expiry risk, low-stock probability, and purchase recommendations per item, served by a scikit-learn model with an automatic JS heuristic fallback (and a visible "Live ML Model" / "Heuristic Fallback" badge) if the ML service is unreachable.
- **Sustainability tracking** — food waste tracker, CO₂ impact estimate, used-before-expiry efficiency, sustainability score, smart recommendations.
- **Action Plans** — auto-generated restock/use-soon checklists derived from current inventory state.
- **Team management** — invite/manage household members and their roles (Admin/Manager only).
- **PDF Inventory Report** — single-click, branded, multi-page report covering inventory summary, category breakdown, complete inventory, low-stock report, expiry report, ML prediction summary, spending & cost analysis, sustainability report, and consumption history.
- **Resilient by design** — the backend falls back to an in-memory store when MongoDB is unreachable, and to a JS heuristic when the ML service is unreachable, so the app stays usable in either case.

## Tech Stack

| Layer | Stack |
|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS, Chart.js, jsPDF + jspdf-autotable, Lucide icons |
| Backend | Node.js + Express, MongoDB + Mongoose, JWT (jsonwebtoken) + bcrypt, express-rate-limit |
| ML Service | Python, FastAPI, scikit-learn (Decision Tree classifiers/regressors), pandas/numpy |

## Project Structure

```
HappyShelf/
├── backend/
│   ├── src/
│   │   ├── config/database.js          # MongoDB connection (falls back to in-memory if unreachable)
│   │   ├── models/                     # Mongoose schemas
│   │   │   ├── User.js
│   │   │   ├── Item.js
│   │   │   ├── ReorderHistory.js
│   │   │   ├── ConsumptionHistory.js
│   │   │   └── ActionPlan.js
│   │   ├── controllers/                # authController, inventoryController, teamController, actionPlanController
│   │   ├── middleware/                 # auth.js (JWT + RBAC), rateLimiter.js
│   │   ├── routes/                     # authRoutes, inventoryRoutes, teamRoutes, actionPlanRoutes
│   │   ├── utils/
│   │   │   ├── inventoryQuery.js       # search/filter/sort/pagination
│   │   │   └── historyJson.js          # shared camelCase envelope for reorder/consumption history
│   │   └── server.js
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/                 # Dashboard, InventoryExplorer, InventoryTable, ItemModal,
│   │   │                                #   ReorderModal, ConsumeModal, Sidebar, Login/Register, ...
│   │   │   ├── predictions/            # DemandForecast, ExpiryForecast, LowStockForecast, ...
│   │   │   ├── stats/                  # UsageTrends, StockLevelsChart, CategoryInsights, ...
│   │   │   ├── sustainability/         # FoodWasteTracker, CO2Impact, SustainabilityScore, ...
│   │   │   └── charts/                 # shared chart primitives
│   │   ├── contexts/AuthContext.tsx
│   │   ├── services/api.ts             # typed fetch client for the whole backend API
│   │   └── utils/                      # expiry.ts, reorder.ts, metricsCalculator.ts, reportGenerator.ts
│   └── .env.example
└── ml_service/
    ├── main.py                         # FastAPI app, /predict endpoint
    └── requirements.txt
```

## Roles & Permissions

| Action | Admin | Manager | Staff | Viewer |
|---|:-:|:-:|:-:|:-:|
| View inventory, stats, predictions, reports | ✅ | ✅ | ✅ | ✅ |
| Create / edit / delete items, reorder, consume | ✅ | ✅ | ✅ | ❌ |
| Manage action plans | ✅ | ✅ | ✅ | ❌ |
| Manage team members | ✅ | ✅ | ❌ | ❌ |

The account created via `/auth/register` is always the household's first `Admin`; further members are added from the Team page.

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

`.env`:
```env
PORT=5000
JWT_SECRET=your_jwt_secret_here_change_in_production
MONGODB_URI=mongodb://localhost:27017/happyshelf
```

Backend runs at `http://localhost:5000`.

### 2. ML Service

```bash
cd ml_service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Runs at `http://localhost:8000`. Trains its models from CSVs in `backend/` if present (`expiry_risk_data.csv`, `low_stock_data.csv`, `demand_forecasting_data.csv`), otherwise falls back to small synthetic training data. The backend proxies to this service and automatically falls back to a JS heuristic if it's slow or unreachable — so it's optional for local dev too.

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

**Backend** (`backend/`): `npm run dev` (watch mode), `npm start`
**Frontend** (`frontend/`): `npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm run preview`

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
| PUT | `/items/:id` | Admin/Manager/Staff | |
| DELETE | `/items/:id` | Admin/Manager/Staff | |
| PATCH | `/items/:id/reorder` | Admin/Manager/Staff | Optional `quantity`; auto-suggests one otherwise |
| PATCH | `/items/:id/consume` | Admin/Manager/Staff | Atomic, never below zero, never more than in stock |
| GET | `/reorder-history` | any | Last 50 entries |
| GET | `/consumption-history` | any | Last 50 entries |
| GET | `/stats` | any | Aggregate dashboard metrics |
| GET | `/predictions` | any | Proxies to the ML service; JS fallback if unreachable |

### Team — `/api/team` (Admin/Manager only)
`GET /`, `POST /`, `PUT /:id`, `DELETE /:id`

### Action Plans — `/api/action-plans`
`GET /` (any), `POST /`, `PATCH /:planId/tasks/:taskId`, `DELETE /:planId` (Admin/Manager/Staff)

### ML Service — `/predict` (called by the backend, not the frontend directly)
`POST http://localhost:8000/predict` — body `{ items: [...] }`, returns per-item demand forecast, expiry risk, low-stock probability, refill date, plus model metadata.

## Key Business Logic

- **Low stock**: `quantity / daily_usage < 3` days remaining.
- **Expiring soon**: expires within 7 days, *or already expired* (a deliberate design choice — an expired item must never be missing from "expiring soon" surfaces).
- **Out of stock**: `quantity <= 0`.
- **Suggested reorder quantity**: bring stock up to `max(min_stock_level, ceil(daily_usage × 14), 1)`, floored at adding at least 1 unit.
- **Sustainability "wasted"**: out of stock, or already past expiry.

These thresholds are intentionally centralized (`frontend/src/utils/expiry.ts`, `backend/src/utils/inventoryQuery.js`) so every surface — dashboard, alerts, reports, filters — agrees on the same definitions.

## Building for Production

```bash
cd frontend && npm run build   # outputs frontend/dist
cd backend && npm start
```

Serve `ml_service` behind a process manager (e.g. gunicorn + uvicorn workers) in production; it's stateless aside from its trained models.

## Notes

- Passwords are hashed with bcrypt; JWTs expire after 7 days.
- Data is isolated per household via `householdId`/`user_id`; every query is scoped to the authenticated user's household.
- If MongoDB is unreachable, the backend transparently serves from an in-memory store so local development isn't blocked — this data does not persist across server restarts.
- `is_ml: true/false` on the predictions response (and the "Live ML Model" / "Heuristic Fallback" badge in the UI) tells you whether a given prediction came from the trained model or the JS fallback.
