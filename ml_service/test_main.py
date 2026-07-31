"""
Tests for the prediction service.

Each test re-imports main with a fresh environment so the module-level
auth/token configuration can be varied — the token is read once at import
time, which is what makes the check cheap per request.
"""

import datetime
import importlib
import os
import sys

import pytest
from fastapi.testclient import TestClient


def load_main(monkeypatch, token=None, cache_dir=None):
    """(Re)imports main with the given environment."""
    if token is None:
        monkeypatch.delenv("ML_SERVICE_TOKEN", raising=False)
    else:
        monkeypatch.setenv("ML_SERVICE_TOKEN", token)

    if cache_dir is not None:
        monkeypatch.setenv("ML_MODEL_CACHE_DIR", str(cache_dir))

    sys.modules.pop("main", None)
    return importlib.import_module("main")


def item(**overrides):
    base = {
        "id": "item-1",
        "name": "Rice",
        "category": "Grains",
        "quantity": 100.0,
        "daily_usage": 2.0,
        "unit": "kg",
    }
    base.update(overrides)
    return base


@pytest.fixture
def client(monkeypatch, tmp_path):
    main = load_main(monkeypatch, token=None, cache_dir=tmp_path)
    return TestClient(main.app)


class TestHealth:
    def test_health_needs_no_token(self, client):
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "OK"

    def test_health_reports_whether_auth_is_on(self, client):
        assert client.get("/health").json()["authenticated"] is False


class TestAuth:
    def test_open_when_no_token_configured(self, client):
        res = client.post("/predict", json={"items": [item()]})
        assert res.status_code == 200

    def test_rejects_missing_token_when_configured(self, monkeypatch, tmp_path):
        main = load_main(monkeypatch, token="s3cret", cache_dir=tmp_path)
        res = TestClient(main.app).post("/predict", json={"items": [item()]})
        assert res.status_code == 401

    def test_rejects_wrong_token(self, monkeypatch, tmp_path):
        main = load_main(monkeypatch, token="s3cret", cache_dir=tmp_path)
        res = TestClient(main.app).post(
            "/predict", json={"items": [item()]}, headers={"X-ML-Token": "wrong"}
        )
        assert res.status_code == 401

    def test_accepts_correct_token(self, monkeypatch, tmp_path):
        main = load_main(monkeypatch, token="s3cret", cache_dir=tmp_path)
        res = TestClient(main.app).post(
            "/predict", json={"items": [item()]}, headers={"X-ML-Token": "s3cret"}
        )
        assert res.status_code == 200


class TestPayloadLimits:
    def test_rejects_more_items_than_the_cap(self, client, monkeypatch, tmp_path):
        main = load_main(monkeypatch, token=None, cache_dir=tmp_path)
        too_many = [item(id=f"item-{i}") for i in range(main.MAX_ITEMS_PER_REQUEST + 1)]
        res = TestClient(main.app).post("/predict", json={"items": too_many})
        assert res.status_code == 422

    def test_accepts_an_empty_list(self, client):
        res = client.post("/predict", json={"items": []})
        assert res.status_code == 200
        assert res.json()["predictions"] == {}


class TestPredictions:
    def test_returns_a_seven_day_forecast_per_item(self, client):
        res = client.post("/predict", json={"items": [item()]})
        prediction = res.json()["predictions"]["item-1"]
        assert len(prediction["demand_forecast"]) == 7
        assert all(value >= 0.1 for value in prediction["demand_forecast"])

    def test_refill_date_is_na_when_nothing_is_consumed(self, client):
        res = client.post("/predict", json={"items": [item(daily_usage=0.0)]})
        assert res.json()["predictions"]["item-1"]["refill_date"] == "N/A"

    def test_refill_date_truncates_like_the_js_fallback(self, client):
        # 10 / 3 = 3.33 days -> floor to 3, matching the backend's Math.floor
        # so the answer is identical whether or not this service is reachable.
        res = client.post("/predict", json={"items": [item(quantity=10.0, daily_usage=3.0)]})
        expected = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
        assert res.json()["predictions"]["item-1"]["refill_date"] == expected

    def test_out_of_stock_is_certain_to_be_low(self, client):
        res = client.post("/predict", json={"items": [item(quantity=0.0, daily_usage=1.0)]})
        assert res.json()["predictions"]["item-1"]["low_stock_probability"] == 1.0

    def test_missing_expiry_date_is_low_risk(self, client):
        res = client.post("/predict", json={"items": [item(expiry_date=None)]})
        assert res.json()["predictions"]["item-1"]["expiry_risk"] == "Low"

    def test_malformed_expiry_date_does_not_error(self, client):
        res = client.post("/predict", json={"items": [item(expiry_date="not-a-date")]})
        assert res.status_code == 200
        assert res.json()["predictions"]["item-1"]["expiry_risk"] == "Low"

    def test_unknown_item_falls_back_to_flat_daily_usage(self, client):
        # No trained model exists for this name, so the forecast should be an
        # honest flat projection rather than fabricated noise.
        res = client.post(
            "/predict", json={"items": [item(name="Zzz Unheard Of", daily_usage=4.0)]}
        )
        forecast = res.json()["predictions"]["item-1"]["demand_forecast"]
        assert forecast == [4.0] * 7

    def test_repeated_calls_are_deterministic(self, client):
        # An earlier version seeded forecasts from numpy's global RNG, which
        # both fabricated a trend and made concurrent requests interfere.
        payload = {"items": [item(name="Zzz Unheard Of")]}
        first = client.post("/predict", json=payload).json()
        second = client.post("/predict", json=payload).json()
        assert first["predictions"] == second["predictions"]

    def test_model_metadata_is_present(self, client):
        body = client.post("/predict", json={"items": [item()]}).json()
        assert 0 <= body["model_metadata"]["model_confidence"] <= 100
        assert body["model_metadata"]["next_peak_demand_date"]


def consumption(days_ago, qty, item_id="item-1", name="Rice"):
    """One logged consume, `days_ago` days before today."""
    day = (datetime.date.today() - datetime.timedelta(days=days_ago)).isoformat()
    return {
        "item_id": item_id,
        "item_name": name,
        "quantity_consumed": qty,
        "consumed_at": day,
    }


def history_for(days, qty=2.0, item_id="item-1"):
    return [consumption(d, qty + (d % 3), item_id=item_id) for d in range(1, days + 1)]


class TestLearningFromHistory:
    """
    The demand model used to key off item *name* against 15 names baked into
    the training CSVs, so a user's own items almost never matched and fell
    through to a flat projection. The household's real consumption log is now
    the first-choice source.
    """

    def test_enough_history_fits_a_household_model(self, client):
        # An item name that appears nowhere in the training CSVs.
        item_ = item(name="Basmati Rice")
        res = client.post(
            "/predict",
            json={"items": [item_], "consumption_history": history_for(20)},
        )
        assert res.status_code == 200
        assert res.json()["predictions"]["item-1"]["forecast_source"] == "household_history"

    def test_sparse_history_falls_back(self, client):
        res = client.post(
            "/predict",
            json={"items": [item(name="Basmati Rice")], "consumption_history": history_for(3)},
        )
        assert res.json()["predictions"]["item-1"]["forecast_source"] == "daily_usage_estimate"

    def test_household_history_beats_the_pretrained_model(self, client):
        # "Rice" IS in the training CSVs, but this household's own log is the
        # more specific signal and must win.
        res = client.post(
            "/predict",
            json={"items": [item(name="Rice")], "consumption_history": history_for(20)},
        )
        assert res.json()["predictions"]["item-1"]["forecast_source"] == "household_history"

    def test_pretrained_model_used_when_no_history(self, client):
        res = client.post("/predict", json={"items": [item(name="Rice")]})
        assert res.json()["predictions"]["item-1"]["forecast_source"] == "pretrained_model"

    def test_flat_estimate_when_nothing_is_known(self, client):
        res = client.post("/predict", json={"items": [item(name="Zzz Unheard Of", daily_usage=4.0)]})
        prediction = res.json()["predictions"]["item-1"]
        assert prediction["forecast_source"] == "daily_usage_estimate"
        assert prediction["demand_forecast"] == [4.0] * 7

    def test_history_for_another_item_is_not_borrowed(self, client):
        res = client.post(
            "/predict",
            json={
                "items": [item(id="item-1", name="Basmati Rice")],
                "consumption_history": history_for(20, item_id="a-different-item"),
            },
        )
        assert res.json()["predictions"]["item-1"]["forecast_source"] == "daily_usage_estimate"

    def test_same_day_consumes_aggregate_into_one_sample(self, client):
        # Twenty consumes all on one day is one day of demand, not twenty
        # independent samples — otherwise MIN_HISTORY_POINTS is trivially met.
        same_day = [consumption(1, 1.0) for _ in range(20)]
        res = client.post(
            "/predict",
            json={"items": [item(name="Basmati Rice")], "consumption_history": same_day},
        )
        assert res.json()["predictions"]["item-1"]["forecast_source"] == "daily_usage_estimate"

    def test_forecast_is_seven_days_and_non_negative(self, client):
        res = client.post(
            "/predict",
            json={"items": [item(name="Basmati Rice")], "consumption_history": history_for(20)},
        )
        forecast = res.json()["predictions"]["item-1"]["demand_forecast"]
        assert len(forecast) == 7
        assert all(value >= 0.1 for value in forecast)

    def test_malformed_timestamps_are_skipped_not_fatal(self, client):
        broken = history_for(20)
        broken[0]["consumed_at"] = "not-a-date"
        broken[1]["consumed_at"] = ""
        res = client.post(
            "/predict",
            json={"items": [item(name="Basmati Rice")], "consumption_history": broken},
        )
        assert res.status_code == 200

    def test_metadata_reports_source_counts(self, client):
        res = client.post(
            "/predict",
            json={
                "items": [
                    item(id="learned", name="Basmati Rice"),
                    item(id="pretrained", name="Milk"),
                    item(id="flat", name="Zzz Unheard Of"),
                ],
                "consumption_history": history_for(20, item_id="learned"),
            },
        )
        counts = res.json()["model_metadata"]["forecast_sources"]
        assert counts == {
            "household_history": 1,
            "pretrained_model": 1,
            "daily_usage_estimate": 1,
        }

    def test_history_is_optional(self, client):
        # An older backend that doesn't send the field must still work.
        res = client.post("/predict", json={"items": [item()]})
        assert res.status_code == 200

    def test_oversized_history_is_rejected(self, client, monkeypatch, tmp_path):
        main = load_main(monkeypatch, token=None, cache_dir=tmp_path)
        too_many = [consumption(1, 1.0) for _ in range(main.MAX_HISTORY_RECORDS + 1)]
        res = TestClient(main.app).post(
            "/predict", json={"items": [item()], "consumption_history": too_many}
        )
        assert res.status_code == 422

    def test_repeated_identical_requests_are_stable(self, client):
        payload = {
            "items": [item(name="Basmati Rice")],
            "consumption_history": history_for(20),
        }
        first = client.post("/predict", json=payload).json()
        second = client.post("/predict", json=payload).json()
        assert first["predictions"] == second["predictions"]


class TestModelCache:
    def test_models_are_written_to_the_cache_directory(self, monkeypatch, tmp_path):
        load_main(monkeypatch, token=None, cache_dir=tmp_path)
        artifacts = list(tmp_path.glob("*.joblib"))
        assert artifacts, "expected fitted models to be persisted"

    def test_second_start_reuses_the_cache(self, monkeypatch, tmp_path, capsys):
        load_main(monkeypatch, token=None, cache_dir=tmp_path)
        capsys.readouterr()

        load_main(monkeypatch, token=None, cache_dir=tmp_path)
        output = capsys.readouterr().out
        # Every worker used to refit every model on boot.
        assert "from cache" in output

    def test_a_corrupt_cache_entry_falls_back_to_retraining(self, monkeypatch, tmp_path):
        load_main(monkeypatch, token=None, cache_dir=tmp_path)
        for artifact in tmp_path.glob("*.joblib"):
            artifact.write_bytes(b"not a real joblib file")

        main = load_main(monkeypatch, token=None, cache_dir=tmp_path)
        res = TestClient(main.app).post("/predict", json={"items": [item()]})
        assert res.status_code == 200
