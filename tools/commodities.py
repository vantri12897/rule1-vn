#!/usr/bin/env python3
"""Lấy chuỗi giá hàng hóa / vĩ mô (Yahoo Finance, qua yfinance) → commodities.json.

Dùng cho TREND 03 (chi phí, giá cả) và TREND 08 (vĩ mô, ngành) của Cẩm nang CI Growth:
mỗi mục có giá mới nhất, % thay đổi 1 tháng / 3 tháng / cùng kỳ năm trước, MA200 và chuỗi tuần 2 năm.

Chạy: python3 tools/commodities.py  (ghi commodities.json ở thư mục hiện tại)
"""
import json
import math
import sys
from datetime import datetime, timezone, timedelta

import yfinance as yf

# key: (mã Yahoo, tên, đơn vị)
ITEMS = {
    "brent":  ("BZ=F", "Dầu Brent", "USD/thùng"),
    "wti":    ("CL=F", "Dầu WTI", "USD/thùng"),
    "diesel": ("HO=F", "Dầu diesel/heating oil (NY)", "USD/gallon"),
    "gasoline": ("RB=F", "Xăng RBOB (NY)", "USD/gallon"),
    "natgas": ("NG=F", "Khí tự nhiên Henry Hub", "USD/MMBtu"),
    "hrc":    ("HRC=F", "Thép cuộn cán nóng HRC (Mỹ)", "USD/tấn"),
    "iron":   ("TIO=F", "Quặng sắt 62% (SGX)", "USD/tấn"),
    "copper": ("HG=F", "Đồng", "USD/lb"),
    "alu":    ("ALI=F", "Nhôm", "USD/tấn"),
    "gold":   ("GC=F", "Vàng", "USD/oz"),
    "silver": ("SI=F", "Bạc", "USD/oz"),
    "cotton": ("CT=F", "Bông (ICE)", "US cent/lb"),
    "sugar":  ("SB=F", "Đường thô số 11", "US cent/lb"),
    "soy":    ("ZS=F", "Đậu tương", "US cent/bushel"),
    "corn":   ("ZC=F", "Ngô", "US cent/bushel"),
    "wheat":  ("ZW=F", "Lúa mì", "US cent/bushel"),
    "coffee": ("KC=F", "Cà phê Arabica", "US cent/lb"),
    "robusta": ("RC=F", "Cà phê Robusta", "USD/tấn"),
    "rice":   ("ZR=F", "Gạo thô (CBOT)", "USD/cwt"),
    "usdvnd": ("VND=X", "Tỷ giá USD/VND", "VND"),
    "usdjpy": ("JPY=X", "Tỷ giá USD/JPY", "JPY"),
    "dxy":    ("DX-Y.NYB", "Chỉ số USD (DXY)", "điểm"),
    "us10y":  ("^TNX", "Lợi suất TPCP Mỹ 10 năm", "%"),
}


def pct(a, b):
    return round(a / b - 1, 4) if a is not None and b not in (None, 0) and not math.isnan(b) else None


def at_or_before(s, dt):
    sub = s[s.index <= dt]
    return float(sub.iloc[-1]) if len(sub) else None


def main():
    out = {"updated": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M"), "src": "Yahoo Finance (hợp đồng tương lai gần nhất / tỷ giá)", "items": {}}
    syms = [v[0] for v in ITEMS.values()]
    data = yf.download(syms, period="2y", interval="1d", auto_adjust=False, progress=False, group_by="ticker", threads=True)
    ok = 0
    for key, (sym, name, unit) in ITEMS.items():
        try:
            s = data[sym]["Close"].dropna()
            if len(s) < 30:
                print(f"bỏ qua {key} ({sym}): ít dữ liệu ({len(s)})")
                continue
            last_dt = s.index[-1]
            last = float(s.iloc[-1])
            # chuỗi tuần, nhãn = ngày giao dịch thực tế cuối mỗi tuần (không dùng nhãn thứ Sáu tương lai)
            dts = s.index.to_series().resample("W-FRI").last().dropna()
            wk = s.loc[dts.values]
            rec = {
                "sym": sym, "name": name, "unit": unit, "d": last_dt.strftime("%Y-%m-%d"), "last": round(last, 4),
                "c1w": pct(last, at_or_before(s, last_dt - timedelta(days=7))),
                "c1m": pct(last, at_or_before(s, last_dt - timedelta(days=30))),
                "c3m": pct(last, at_or_before(s, last_dt - timedelta(days=91))),
                "yoy": pct(last, at_or_before(s, last_dt - timedelta(days=365))),
                "avg3m": round(float(s[s.index > last_dt - timedelta(days=91)].mean()), 4),
                "ma200": round(float(s.iloc[-200:].mean()), 4) if len(s) >= 200 else None,
                "w": [[d.strftime("%Y-%m-%d"), round(float(v), 4)] for d, v in wk.items()],
            }
            out["items"][key] = rec
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"lỗi {key} ({sym}): {e}")
    # Crack spread diesel xấp xỉ = heating oil (USD/gallon × 42) − Brent
    it = out["items"]
    if "diesel" in it and "brent" in it:
        hw = dict(it["diesel"]["w"]); bw = dict(it["brent"]["w"])
        w = [[d, round(hw[d] * 42 - bw[d], 2)] for d in hw if d in bw]
        if len(w) > 10:
            last = w[-1][1]
            def back(n):
                return w[-1 - n][1] if len(w) > n else None
            it["crack"] = {"sym": "HO×42−BZ", "name": "Crack spread diesel xấp xỉ (NY HO − Brent)", "unit": "USD/thùng", "d": min(it["diesel"]["d"], it["brent"]["d"]), "last": last,
                           "c1m": pct(last, back(4)), "c3m": pct(last, back(13)), "yoy": pct(last, back(52)), "avg3m": round(sum(x[1] for x in w[-13:]) / min(13, len(w)), 2), "ma200": None, "w": w}
    if ok < 5:
        print(f"chỉ lấy được {ok} mục — không ghi đè commodities.json")
        sys.exit(1)
    with open("commodities.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Đã ghi commodities.json: {len(out['items'])} mục")


if __name__ == "__main__":
    main()
