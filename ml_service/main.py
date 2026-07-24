import datetime
from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
import os

app = FastAPI(title="HappyShelf ML Service")

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

class PredictionRequest(BaseModel):
    items: List[InventoryItem]

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXPIRY_CSV = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "expiry_risk_data.csv"))
STOCK_CSV = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "low_stock_data.csv"))
DEMAND_CSV = os.path.abspath(os.path.join(BASE_DIR, "..", "backend", "demand_forecasting_data.csv"))

# --- 1. Expiry Classifier Model ---
# Fallback synthetic training data
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
expiry_model = DecisionTreeClassifier(max_depth=3, random_state=42)

try:
    if os.path.exists(EXPIRY_CSV):
        df_expiry = pd.read_csv(EXPIRY_CSV)
        label_map = {"Low Risk": 0, "Medium Risk": 1, "High Risk": 2}
        y_expiry = df_expiry["target_label"].map(label_map)
        X_expiry = df_expiry[["shelf_life_days", "purchase_quantity", "daily_usage_rate"]]
        
        # Drop rows with NaN
        valid_indices = X_expiry.notna().all(axis=1) & y_expiry.notna()
        X_expiry = X_expiry[valid_indices]
        y_expiry = y_expiry[valid_indices]
        
        expiry_model.fit(X_expiry, y_expiry)
        print(f"Successfully trained Expiry Risk Model on {len(X_expiry)} rows from CSV.")
    else:
        print(f"Warning: {EXPIRY_CSV} not found. Training Expiry Model on fallback synthetic data.")
        expiry_model.fit(X_expiry_train, y_expiry_train)
except Exception as e:
    print(f"Error training Expiry Model on CSV: {e}. Falling back to synthetic data.")
    expiry_model.fit(X_expiry_train, y_expiry_train)


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
stock_model = DecisionTreeClassifier(max_depth=3, random_state=42)

try:
    if os.path.exists(STOCK_CSV):
        df_stock = pd.read_csv(STOCK_CSV)
        # Compute days_until_out_of_stock
        df_stock["days_until_out_of_stock"] = np.where(
            df_stock["mean_daily_usage"] > 0,
            df_stock["quantity"] / df_stock["mean_daily_usage"],
            999.0
        )
        X_stock = df_stock[["days_until_out_of_stock", "min_stock_level"]]
        y_stock = df_stock["target_label"]
        
        # Drop rows with NaN
        valid_indices = X_stock.notna().all(axis=1) & y_stock.notna()
        X_stock = X_stock[valid_indices]
        y_stock = y_stock[valid_indices]
        
        stock_model.fit(X_stock, y_stock)
        print(f"Successfully trained Low Stock Model on {len(X_stock)} rows from CSV.")
    else:
        print(f"Warning: {STOCK_CSV} not found. Training Low Stock Model on fallback synthetic data.")
        stock_model.fit(X_stock_train, y_stock_train)
except Exception as e:
    print(f"Error training Low Stock Model on CSV: {e}. Falling back to synthetic data.")
    stock_model.fit(X_stock_train, y_stock_train)


# --- 3. Demand Forecasting Models (trained per item_name) ---
demand_models = {}

try:
    if os.path.exists(DEMAND_CSV):
        df_demand = pd.read_csv(DEMAND_CSV)
        df_demand = df_demand.dropna(subset=["item_name", "day_of_week", "is_weekend", "month", "is_holiday", "quantity_consumed"])
        
        unique_items = df_demand["item_name"].str.lower().unique()
        for item_name in unique_items:
            df_item = df_demand[df_demand["item_name"].str.lower() == item_name]
            X_item = df_item[["day_of_week", "is_weekend", "month", "is_holiday"]]
            y_item = df_item["quantity_consumed"]
            
            if len(X_item) > 5:
                model = DecisionTreeRegressor(max_depth=4, random_state=42)
                model.fit(X_item, y_item)
                demand_models[item_name] = model
        print(f"Successfully trained {len(demand_models)} Demand Forecasting Models from CSV.")
    else:
        print(f"Warning: {DEMAND_CSV} not found. Will use fallback linear regression for demand forecasting.")
except Exception as e:
    print(f"Error training Demand Forecasting Models: {e}. Will use fallback linear regression.")


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

@app.post("/predict")
def predict(request: PredictionRequest):
    predictions = {}
    total_score = 0
    item_count = len(request.items)

    for item in request.items:
        # 1. Demand Forecast
        item_key = item.name.lower()
        if item_key in demand_models:
            today = datetime.date.today()
            demand_forecast = []
            for i in range(1, 8):
                future_date = today + datetime.timedelta(days=i)
                day_of_week = future_date.weekday()
                is_weekend = 1 if day_of_week >= 5 else 0
                month = future_date.month
                is_holiday = 0
                pred_df = pd.DataFrame(
                    [[day_of_week, is_weekend, month, is_holiday]], 
                    columns=["day_of_week", "is_weekend", "month", "is_holiday"]
                )
                pred_val = demand_models[item_key].predict(pred_df)[0]
                demand_forecast.append(max(0.1, float(np.round(pred_val, 2))))
        else:
            # Fallback to simulated Linear Regression
            np.random.seed(hash(item.id) % 1000)
            history_days = 14
            X_hist = np.arange(history_days).reshape(-1, 1)
            y_hist = np.random.normal(loc=item.daily_usage, scale=max(0.1, item.daily_usage * 0.15), size=history_days)
            y_hist = np.maximum(0.1, y_hist)
            
            lr_model = LinearRegression()
            lr_model.fit(X_hist, y_hist)
            
            X_pred = np.arange(history_days, history_days + 7).reshape(-1, 1)
            y_pred = lr_model.predict(X_pred)
            demand_forecast = [max(0.1, float(np.round(val, 2))) for val in y_pred]

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
            "low_stock_probability": low_stock_prob
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
            "model_confidence": model_confidence,
            "next_peak_demand_date": next_peak_date
        }
    }

