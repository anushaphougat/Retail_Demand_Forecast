"""
Generate synthetic retail sales data for development and testing.
Run once to bootstrap the project: python data/generate_sample_data.py
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os

np.random.seed(42)

STORES   = [f"STORE_{i:03d}" for i in range(1, 11)]
SKUS     = [f"SKU_{i:04d}"   for i in range(1, 51)]
START    = datetime(2022, 1, 1)
END      = datetime(2024, 12, 31)

def generate_sales(start=START, end=END):
    dates  = pd.date_range(start, end, freq="D")
    rows   = []

    for store in STORES:
        for sku in SKUS:
            base_demand = np.random.randint(10, 200)
            trend       = np.random.uniform(-0.0001, 0.0003)
            price       = round(np.random.uniform(5, 150), 2)

            for i, date in enumerate(dates):
                # Seasonality
                weekly    = 1 + 0.2 * np.sin(2 * np.pi * date.dayofweek / 7)
                yearly    = 1 + 0.3 * np.sin(2 * np.pi * date.dayofyear / 365 - np.pi / 2)
                # Holiday bump
                holiday   = 1.5 if date.month == 12 and date.day >= 20 else 1.0
                # Promotion (random 10% of days)
                promo     = np.random.choice([0, 1], p=[0.9, 0.1])
                promo_lift = 1.3 if promo else 1.0
                # Noise
                noise     = np.random.normal(1, 0.1)

                demand = int(base_demand * (1 + trend * i) * weekly * yearly
                             * holiday * promo_lift * noise)
                demand = max(0, demand)

                rows.append({
                    "date":      date.date(),
                    "store_id":  store,
                    "sku_id":    sku,
                    "sales_qty": demand,
                    "price":     price * (0.8 if promo else 1.0),
                    "is_promo":  promo,
                    "on_hand":   np.random.randint(demand, demand * 3 + 1),
                })

    df = pd.DataFrame(rows)
    os.makedirs("data/sample", exist_ok=True)
    df.to_csv("data/sample/sales.csv", index=False)
    print(f"Generated {len(df):,} rows → data/sample/sales.csv")
    return df


def generate_external():
    dates = pd.date_range(START, END, freq="D")
    df = pd.DataFrame({
        "date":        [d.date() for d in dates],
        "temperature": np.random.normal(15, 10, len(dates)).round(1),
        "is_holiday":  [1 if (d.month == 12 and d.day in range(24, 27))
                          or (d.month == 1  and d.day == 1) else 0
                        for d in dates],
        "event_score": np.random.uniform(0, 1, len(dates)).round(3),
    })
    df.to_csv("data/sample/external.csv", index=False)
    print(f"Generated {len(df):,} rows → data/sample/external.csv")
    return df


if __name__ == "__main__":
    generate_sales()
    generate_external()
    print("Done. Run the pipeline next.")