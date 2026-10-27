#!/usr/bin/env python3
"""Cập nhật NHANH giá đóng cửa phiên hôm nay cho mọi mã bằng bảng giá KBS (100 mã/lần gọi, ~1 phút).

Chỉ cập nhật p (giá), c1 (giá tham chiếu = đóng cửa phiên trước), d (ngày phiên) trong prices.json;
giữ nguyên adv, m (chỉ báo) — các trường này do update_prices.py (chạy sau, lâu hơn) tính lại cùng dữ liệu nến.
Chạy: python3 tools/quick_prices.py   (sau 15:00 giờ Việt Nam, ngày giao dịch)
"""
import csv
import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd

VN = timezone(timedelta(hours=7))
PRICE_COLS = ["match_price", "close_price", "last_price", "matched_price", "price", "close", "current_price"]
REF_COLS = ["reference_price", "ref_price", "basic_price", "prior_close_price", "reference", "ref"]


def pick(r, cols):
    for c in cols:
        if c in r and r[c] not in (None, "") and not pd.isna(r[c]):
            try:
                v = float(r[c])
                if v > 0:
                    return v
            except (TypeError, ValueError):
                pass
    return None


def scale(v, old):
    """Bảng giá có thể trả đơn vị nghìn đồng; chọn hệ số 1 hoặc 1000 khớp với giá cũ (đơn vị đồng)."""
    if v is None:
        return None
    if old and old > 0:
        return v if abs(v / old - 1) < abs(v * 1000 / old - 1) else v * 1000
    return v * 1000 if v < 1000 else v


def main():
    now = datetime.now(VN)
    if now.weekday() >= 5:
        print("Cuối tuần — không có phiên.")
        return
    today = now.strftime("%Y-%m-%d")
    out = Path("prices.json")
    doc = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {"prices": {}}
    prices = doc.get("prices", {})
    tickers = []
    with open("rule1_data.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            t = (r.get("ticker") or "").strip().upper()
            if t and t not in tickers:
                tickers.append(t)
    from vnstock import Trading
    n, cols_shown, vol0 = 0, False, 0
    for k in range(0, len(tickers), 100):
        batch = tickers[k:k + 100]
        df = None
        for attempt in range(3):
            try:
                df = Trading(source="kbs").price_board(batch)
                break
            except Exception as e:  # noqa: BLE001
                print(f"   x lô {k} lần {attempt + 1}: {str(e)[:120]}", flush=True)
                time.sleep(5 * (attempt + 1))
        if not isinstance(df, pd.DataFrame) or df.empty:
            continue
        if not cols_shown:
            print("Cột bảng giá:", list(df.columns), flush=True)
            cols_shown = True
        for _, r in df.iterrows():
            sym = str(r.get("symbol", "")).upper()
            if sym not in tickers:
                continue
            old = prices.get(sym, {})
            p = scale(pick(r, PRICE_COLS), old.get("p"))
            ref = scale(pick(r, REF_COLS), old.get("p"))
            vol = 0.0
            try:
                vol = float(r.get("volume_accumulated") or r.get("total_volume") or 0)
            except (TypeError, ValueError):
                pass
            if p is None:
                continue
            if vol <= 0:  # không khớp lệnh hôm nay: giữ giá cũ, không đổi ngày phiên
                vol0 += 1
                continue
            rec = dict(old)
            rec["p"] = round(p)
            if ref:
                rec["c1"] = round(ref)
            rec["d"] = today
            prices[sym] = rec
            n += 1
        time.sleep(0.5)
    if n < 100:
        print(f"Chỉ cập nhật được {n} mã — không ghi đè prices.json")
        sys.exit(1)
    doc["prices"] = prices
    doc["updated"] = now.isoformat(timespec="minutes")
    doc["session"] = today
    doc["quick"] = True
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Đã cập nhật nhanh giá phiên {today}: {n} mã có khớp lệnh ({vol0} mã không giao dịch, giữ giá cũ).")


if __name__ == "__main__":
    main()
