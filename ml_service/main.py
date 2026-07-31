import datetime
import hashlib
import hmac
import os
from collections import OrderedDict
from typing import List, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

app = FastAPI(title="HappyShelf ML Service")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPIRY_CSV = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "expiry_risk_data.csv"))
STOCK_CSV = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "low_stock_data.csv"))
DEMAND_CSV = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "demand_forecasting_data.csv"))

MODEL_CACHE_DIR = os.environ.get(
    "ML_MODEL_CACHE_DIR", os.path.join(BASE_DIR, "model_cache")
)

# A single request should never be able to make this service chew through an
# unbounded list. The backend only ever sends one household's inventory, so
# this ceiling is far above any legitimate call.
MAX_ITEMS_PER_REQUEST = 5000

# Upper bound on the consumption history a request may carry. The backend
# caps its own query well below this.
MAX_HISTORY_RECORDS = 5000

# Distinct logged consumes an item needs before its own history is worth
# fitting a model to. Below this a decision tree just memorises noise, so we
# fall back to the pre-trained model or the item's stated daily usage.
MIN_HISTORY_POINTS = 8

# Fitted per-household models are cached in-process, keyed by a digest of the
# history they were built from — the dashboard re-requests predictions on
# every refresh, and refitting identical data each time is pure waste. Bounded
# so a busy multi-household deployment can't grow it without limit.
MAX_FITTED_CACHE_ENTRIES = 256

# Shared secret the backend must present. Set ML_SERVICE_TOKEN on both sides.
# Left unset, the service stays open — acceptable only when it is bound to
# loopback, which is why the startup banner warns loudly about it.
ML_SERVICE_TOKEN = os.environ.get("ML_SERVICE_TOKEN", "").strip()


def require_service_token(x_ml_token: Optional[str] = Header(default=None)):
    """
    Gate /predict behind a shared secret.

    Without this the endpoint was completely open: anyone who could reach the
    port could submit arbitrary inventory payloads and burn CPU on model
    inference. compare_digest keeps the check constant-time so the token
    can't be recovered a byte at a time.
    """
    if not ML_SERVICE_TOKEN:
        return
    if not x_ml_token or not hmac.compare_digest(x_ml_token, ML_SERVICE_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing ML service token",
        )


class InventoryItem(BaseModel):
    id: str
    name: str
    category: str
    quantity: float
    daily_usage: float
    expiry_date: Optional[str] = None
    unit: str
    purchase_date: Optional[str] = None
    min_stock_level: Optional[float] = None
    storage_location: Optional[str] = None


class ConsumptionRecord(BaseModel):
    """One logged "I used N of this" event from the household's own history."""

    item_id: str
    item_name: str
    quantity_consumed: float
    consumed_at: str


class PredictionRequest(BaseModel):
    items: List[InventoryItem] = Field(..., max_length=MAX_ITEMS_PER_REQUEST)
    # Optional so an older backend (or a direct caller) still works; without
    # it the service simply falls back to the pre-trained models.
    consumption_history: List[ConsumptionRecord] = Field(
        default_factory=list, max_length=MAX_HISTORY_RECORDS
    )


# --- Model cache -----------------------------------------------------------
# Training used to run at import time, in module scope. Under the gunicorn +
# uvicorn-workers deployment the README recommends, that meant every worker
# retrained every model on every boot — startup cost and memory both scaling
# linearly with worker count, for models that are identical across workers.
#
# Now each model is fitted once, keyed by a fingerprint of its training data,
# and persisted to disk. Subsequent workers (and subsequent restarts) load
# the artifact instead of refitting. Changing a CSV changes the fingerprint,
# which transparently forces a retrain — no manual cache busting.

def _fingerprint(*paths) -> str:
    """Short digest of the training inputs, so stale caches are never reused."""
    digest = hashlib.sha256()
    for path in paths:
        if os.path.exists(path):
            stat = os.stat(path)
            digest.update(f"{path}:{stat.st_size}:{stat.st_mtime_ns}".encode())
        else:
            digest.update(f"{path}:missing".encode())
    return digest.hexdigest()[:16]


def _cached(name: str, paths, build):
    """
    Return a fitted model, loading it from disk when the training inputs are
    unchanged. Any cache failure falls back to building in-process — a broken
    or unwritable cache must never take the service down.
    """
    key = _fingerprint(*paths)
    cache_path = os.path.join(MODEL_CACHE_DIR, f"{name}-{key}.joblib")

    try:
        if os.path.exists(cache_path):
            model = joblib.load(cache_path)
            print(f"Loaded {name} model from cache ({os.path.basename(cache_path)}).")
            return model
    except Exception as exc:
        print(f"Could not load cached {name} model ({exc}); retraining.")

    model = build()

    try:
        os.makedirs(MODEL_CACHE_DIR, exist_ok=True)
        # Write to a temp path then rename, so two workers starting at once
        # can't leave a half-written artifact for the other to load.
        tmp_path = f"{cache_path}.{os.getpid()}.tmp"
        joblib.dump(model, tmp_path)
        os.replace(tmp_path, cache_path)
    except Exception as exc:
        print(f"Could not cache {name} model ({exc}); continuing without cache.")

    return model


# --- 1. Expiry Classifier Model ---
X_expiry_train = np.array([
    [2, 10, 5],
    [30, 5, 0.5],
    [5, 20, 0.5],
    [10, 10, 1.2],
    [3, 15, 0.1],
    [100, 50, 2],
    [15, 10, 0.5],
    [12, 15, 1],
    [-2, 5, 0.5],
    [8, 2, 0.5],
])
y_expiry_train = np.array([2, 0, 2, 1, 2, 0, 1, 1, 2, 0])


def build_expiry_model():
    model = DecisionTreeClassifier(max_depth=3, random_state=42)
    try:
        if os.path.exists(EXPIRY_CSV):
            df_expiry = pd.read_csv(EXPIRY_CSV)
            label_map = {"Low Risk": 0, "Medium Risk": 1, "High Risk": 2}
            y_expiry = df_expiry["target_label"].map(label_map)
            X_expiry = df_expiry[["shelf_life_days", "purchase_quantity", "daily_usage_rate"]]

            valid_indices = X_expiry.notna().all(axis=1) & y_expiry.notna()
            X_expiry = X_expiry[valid_indices]
            y_expiry = y_expiry[valid_indices]

            model.fit(X_expiry, y_expiry)
            print(f"Successfully trained Expiry Risk Model on {len(X_expiry)} rows from CSV.")
            return model

        print(f"Warning: {EXPIRY_CSV} not found. Training Expiry Model on fallback synthetic data.")
    except Exception as e:
        print(f"Error training Expiry Model on CSV: {e}. Falling back to synthetic data.")

    model.fit(X_expiry_train, y_expiry_train)
    return model


# --- 2. Low Stock Classifier Model ---
X_stock_train = np.array([
    [2, 5],
    [15, 2],
    [5, 1],
    [8, 5],
    [25, 10],
    [4, 0],
    [12, 1],
])
y_stock_train = np.array([1, 0, 1, 1, 0, 1, 0])


def build_stock_model():
    model = DecisionTreeClassifier(max_depth=3, random_state=42)
    try:
        if os.path.exists(STOCK_CSV):
            df_stock = pd.read_csv(STOCK_CSV)
            df_stock["days_until_out_of_stock"] = np.where(
                df_stock["mean_daily_usage"] > 0,
                df_stock["quantity"] / df_stock["mean_daily_usage"],
                999.0
            )
            X_stock = df_stock[["days_until_out_of_stock", "min_stock_level"]]
            y_stock = df_stock["target_label"]

            valid_indices = X_stock.notna().all(axis=1) & y_stock.notna()
            X_stock = X_stock[valid_indices]
            y_stock = y_stock[valid_indices]

            model.fit(X_stock, y_stock)
            print(f"Successfully trained Low Stock Model on {len(X_stock)} rows from CSV.")
            return model

        print(f"Warning: {STOCK_CSV} not found. Training Low Stock Model on fallback synthetic data.")
    except Exception as e:
        print(f"Error training Low Stock Model on CSV: {e}. Falling back to synthetic data.")

    model.fit(X_stock_train, y_stock_train)
    return model


# --- 3. Demand Forecasting Models (trained per item_name) ---
def build_demand_models():
    models = {}
    try:
        if os.path.exists(DEMAND_CSV):
            df_demand = pd.read_csv(DEMAND_CSV)
            df_demand = df_demand.dropna(
                subset=["item_name", "day_of_week", "is_weekend", "month", "is_holiday", "quantity_consumed"]
            )

            unique_items = df_demand["item_name"].str.lower().unique()
            for item_name in unique_items:
                df_item = df_demand[df_demand["item_name"].str.lower() == item_name]
                X_item = df_item[["day_of_week", "is_weekend", "month", "is_holiday"]]
                y_item = df_item["quantity_consumed"]

                if len(X_item) > 5:
                    model = DecisionTreeRegressor(max_depth=4, random_state=42)
                    model.fit(X_item, y_item)
                    models[item_name] = model
            print(f"Successfully trained {len(models)} Demand Forecasting Models from CSV.")
        else:
            print(f"Warning: {DEMAND_CSV} not found. Will use current daily_usage for demand forecasting.")
    except Exception as e:
        print(f"Error training Demand Forecasting Models: {e}. Will use current daily_usage instead.")
    return models


expiry_model = _cached("expiry", [EXPIRY_CSV], build_expiry_model)
stock_model = _cached("stock", [STOCK_CSV], build_stock_model)
demand_models = _cached("demand", [DEMAND_CSV], build_demand_models)

if not ML_SERVICE_TOKEN:
    # Plain ASCII on purpose: Windows consoles default to cp1252, and a
    # non-encodable character here would raise UnicodeEncodeError at import
    # time and take the whole service down before it ever serves a request.
    print(
        "WARNING: ML_SERVICE_TOKEN is not set - /predict is UNAUTHENTICATED.\n"
        "   Safe only if this process is bound to loopback (127.0.0.1).\n"
        "   Set ML_SERVICE_TOKEN here and in the backend before exposing it."
    )


# --- Learning from the household's own consumption -------------------------
# The pre-trained demand models above are fitted on generic CSVs covering 15
# fixed item names, so anything a user actually calls their items ("Basmati
# Rice", "Shampoo") never matched one and fell straight through to a flat
# projection. The backend now ships the household's real consumption log with
# each request, and an item with enough of its own history gets a model fitted
# on *that* instead. Three tiers, most-specific first:
#
#   1. household_history    — fitted on this household's logged consumes
#   2. pretrained_model     — the generic CSV model, if the name matches
#   3. daily_usage_estimate — flat projection of the user's stated rate
#
# Which tier produced a forecast is reported per item as `forecast_source`, so
# the UI never has to guess how much to trust it.

_fitted_cache: "OrderedDict[str, DecisionTreeRegressor]" = OrderedDict()


def _date_features(day: datetime.date) -> List[int]:
    """The same four features the pre-trained demand models were fitted on."""
    day_of_week = day.weekday()
    return [day_of_week, 1 if day_of_week >= 5 else 0, day.month, 0]


DEMAND_FEATURE_COLUMNS = ["day_of_week", "is_weekend", "month", "is_holiday"]


def group_history_by_item(
    history: List[ConsumptionRecord],
) -> "dict[str, List[ConsumptionRecord]]":
    grouped: "dict[str, List[ConsumptionRecord]]" = {}
    for record in history:
        grouped.setdefault(str(record.item_id), []).append(record)
    return grouped


def _history_digest(records: List[ConsumptionRecord]) -> str:
    digest = hashlib.sha256()
    for record in records:
        digest.update(f"{record.consumed_at}:{record.quantity_consumed};".encode())
    return digest.hexdigest()[:16]


def fit_household_demand_model(
    records: List[ConsumptionRecord],
) -> Optional[DecisionTreeRegressor]:
    """
    Fits a demand regressor on one item's own consumption log.

    Consumes are aggregated per calendar day first: two separate "used 1"
    entries on the same day are one day of demand 2, not two independent
    samples. Returns None when there isn't enough distinct history to learn
    anything, so the caller can fall back rather than trust a model fitted on
    three points.
    """
    daily_totals: "dict[datetime.date, float]" = {}

    for record in records:
        try:
            date_part = record.consumed_at.split("T")[0]
            day = datetime.datetime.strptime(date_part, "%Y-%m-%d").date()
        except (ValueError, AttributeError):
            continue
        daily_totals[day] = daily_totals.get(day, 0.0) + float(record.quantity_consumed)

    if len(daily_totals) < MIN_HISTORY_POINTS:
        return None

    rows = [_date_features(day) for day in daily_totals]
    targets = list(daily_totals.values())

    try:
        # Shallower than the pre-trained models: a single household's log is
        # far smaller, so a deeper tree would fit noise.
        model = DecisionTreeRegressor(max_depth=3, random_state=42)
        model.fit(pd.DataFrame(rows, columns=DEMAND_FEATURE_COLUMNS), targets)
        return model
    except Exception as exc:
        print(f"Could not fit household demand model: {exc}")
        return None


def get_household_demand_model(
    item_id: str, records: List[ConsumptionRecord]
) -> Optional[DecisionTreeRegressor]:
    """Cached wrapper around fit_household_demand_model."""
    cache_key = f"{item_id}:{_history_digest(records)}"

    if cache_key in _fitted_cache:
        _fitted_cache.move_to_end(cache_key)
        return _fitted_cache[cache_key]

    model = fit_household_demand_model(records)
    if model is not None:
        _fitted_cache[cache_key] = model
        while len(_fitted_cache) > MAX_FITTED_CACHE_ENTRIES:
            _fitted_cache.popitem(last=False)

    return model


def forecast_with_model(model) -> List[float]:
    """Runs a fitted demand model over the next seven days."""
    today = datetime.date.today()
    forecast = []
    for offset in range(1, 8):
        future = today + datetime.timedelta(days=offset)
        frame = pd.DataFrame([_date_features(future)], columns=DEMAND_FEATURE_COLUMNS)
        forecast.append(max(0.1, float(np.round(model.predict(frame)[0], 2))))
    return forecast


def get_days_to_expiry(expiry_date_str: Optional[str]) -> Optional[float]:
    if not expiry_date_str:
        return None
    try:
        # Parse date part (supports both YYYY-MM-DD and ISO formats)
        date_part = expiry_date_str.split('T')[0]
        exp_date = datetime.datetime.strptime(date_part, "%Y-%m-%d").date()
        today = datetime.date.today()
        return (exp_date - today).days
    except Exception:
        return None


@app.get("/health")
def health():
    """Unauthenticated liveness probe — reports readiness, never any data."""
    return {
        "status": "OK",
        "demand_models": len(demand_models),
        "authenticated": bool(ML_SERVICE_TOKEN),
    }


@app.post("/predict", dependencies=[Depends(require_service_token)])
def predict(request: PredictionRequest):
    predictions = {}
    total_score = 0
    item_count = len(request.items)

    history_by_item = group_history_by_item(request.consumption_history)
    source_counts = {
        "household_history": 0,
        "pretrained_model": 0,
        "daily_usage_estimate": 0,
    }

    for item in request.items:
        # 1. Demand Forecast — most-specific source available (see the tier
        #    comment above group_history_by_item).
        demand_forecast = None
        forecast_source = "daily_usage_estimate"

        item_history = history_by_item.get(str(item.id), [])
        if item_history:
            household_model = get_household_demand_model(str(item.id), item_history)
            if household_model is not None:
                demand_forecast = forecast_with_model(household_model)
                forecast_source = "household_history"

        if demand_forecast is None and item.name.lower() in demand_models:
            demand_forecast = forecast_with_model(demand_models[item.name.lower()])
            forecast_source = "pretrained_model"

        if demand_forecast is None:
            # Neither this household nor the training CSVs know anything about
            # this item. Rather than fabricating a trend from random noise
            # (which produced a spurious pattern with no predictive basis and
            # mutated numpy's global RNG state, corrupting concurrent
            # requests), project the item's stated daily_usage flat across the
            # week -- an honest "best estimate available" forecast.
            demand_forecast = [max(0.1, round(item.daily_usage, 2))] * 7
            forecast_source = "daily_usage_estimate"

        source_counts[forecast_source] += 1

        # 2. Expiry Risk Classification
        days_to_expiry = get_days_to_expiry(item.expiry_date)
        if days_to_expiry is None:
            expiry_risk = "Low"
        else:
            try:
                expiry_df = pd.DataFrame(
                    [[days_to_expiry, item.quantity, item.daily_usage]],
                    columns=["shelf_life_days", "purchase_quantity", "daily_usage_rate"]
                )
                pred_class = expiry_model.predict(expiry_df)[0]
                expiry_risk = {0: "Low", 1: "Medium", 2: "High"}[pred_class]
            except Exception:
                expiry_risk = "Low"

        # 3. Low-Stock Probability
        days_until_out_of_stock = (item.quantity / item.daily_usage) if item.daily_usage > 0 else 999.0
        min_stock = item.min_stock_level if item.min_stock_level is not None else 0.0

        if days_until_out_of_stock <= 0:
            low_stock_prob = 1.0
        else:
            try:
                stock_df = pd.DataFrame(
                    [[days_until_out_of_stock, min_stock]],
                    columns=["days_until_out_of_stock", "min_stock_level"]
                )
                prob = stock_model.predict_proba(stock_df)[0]
                low_stock_prob = float(prob[1]) if len(prob) > 1 else float(prob[0])
            except Exception:
                if days_until_out_of_stock < 3:
                    low_stock_prob = 0.95
                elif days_until_out_of_stock < 7:
                    low_stock_prob = 0.80
                elif days_until_out_of_stock < 10:
                    low_stock_prob = 0.50
                else:
                    low_stock_prob = 0.05

        # 4. Predicted Refill Date
        if item.daily_usage > 0:
            days_to_empty = item.quantity / item.daily_usage
            refill_date = (datetime.date.today() + datetime.timedelta(days=int(days_to_empty))).isoformat()
        else:
            refill_date = "N/A"

        predictions[item.id] = {
            "demand_forecast": demand_forecast,
            "refill_date": refill_date,
            "expiry_risk": expiry_risk,
            "low_stock_probability": low_stock_prob,
            "forecast_source": forecast_source,
        }

        item_score = 1.0
        if not item.expiry_date:
            item_score -= 0.3
        if item.daily_usage <= 0:
            item_score -= 0.5
        total_score += item_score

    model_confidence = 65
    if item_count > 0:
        model_confidence = int(65 + (total_score / item_count) * 31)

    next_peak_date = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()

    return {
        "predictions": predictions,
        "model_metadata": {
            # NOTE: this is a data-completeness score, not model accuracy — it
            # rises as items gain expiry dates and usage rates. Named
            # "confidence" for backwards compatibility with existing clients.
            "model_confidence": model_confidence,
            "next_peak_demand_date": next_peak_date,
            # How many items were forecast from each tier, so the UI can say
            # honestly how much of the forecast is grounded in real usage.
            "forecast_sources": source_counts,
        }
    }
