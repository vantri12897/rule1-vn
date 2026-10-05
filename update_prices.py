#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
update_prices.py — Cập nhật giá đóng cửa và thanh khoản TB 20 phiên cho các mã
trong rule1_data.csv, ghi ra prices.json để website Rule #1 Screener VN tự đọc.

Chạy tự động mỗi ngày giao dịch bằng GitHub Actions (.github/workflows/prices.yml).
Chạy tay:  python update_prices.py            # tất cả mã trong rule1_data.csv
           python update_prices.py --limit 20 # thử 20 mã đầu

Nguyên tắc an toàn:
- Mã nào lấy giá lỗi thì GIỮ giá cũ trong prices.json (không xóa, không ghi 0).
- Lưu tiến độ mỗi 100 mã, nên lượt chạy bị ngắt vẫn giữ được phần đã cập nhật.
- Trả mã thoát 1 nếu dưới 50% mã cập nhật được, để GitHub báo lỗi qua email.
"""
from __future__ import annotations

import argparse
import csv
import json
import socket
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

VN_TZ = timezone(timedelta(hours=7))
socket.setdefaulttimeout(30)  # không để một lần gọi mạng treo vô thời hạn
SOURCES = ("kbs", "vci")


def import_quote():
    try:
        from vnstock import Quote
    except ImportError:
        sys.exit("Chưa cài vnstock: pip install -U --extra-index-url https://vnstocks.com/api/simple vnstock vnai")
    return Quote


def read_tickers(path: Path) -> list[str]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rd = csv.DictReader(fh)
        seen = []
        for row in rd:
            t = (row.get("ticker") or "").strip().upper()
            if t and t not in seen:
                seen.append(t)
    return seen


def fetch_price(Quote, sym: str):
    """Trả về (giá đóng cửa VND, thanh khoản TB 20 phiên tỷ VND, ngày phiên, nguồn)."""
    today = datetime.now(VN_TZ).date()  # máy chủ GitHub chạy giờ UTC, quy về giờ Việt Nam
    start = (today - timedelta(days=45)).isoformat()
    end = (today + timedelta(days=1)).isoformat()  # +1 ngày: có nguồn không tính ngày kết thúc
    last_err = None
    for src in SOURCES:
        try:
            df = Quote(source=src, symbol=sym, show_log=False).history(start=start, end=end, interval="1D")
            if df is None or df.empty or "close" not in df.columns:
                continue
            close = pd.to_numeric(df["close"], errors="coerce")
            vol = pd.to_numeric(df.get("volume"), errors="coerce") if "volume" in df.columns else None
            valid = close.dropna()
            if valid.empty:
                continue
            scale = 1000 if valid.iloc[-1] < 1000 else 1  # một số nguồn trả giá theo nghìn đồng
            price = float(valid.iloc[-1]) * scale
            adv = None
            if vol is not None:
                adv = round(float((close * scale * vol).tail(20).mean() / 1e9), 2)
            d = None
            try:
                for col in ("time", "date", "tradingDate"):
                    if col in df.columns:
                        d = str(pd.to_datetime(df.loc[valid.index[-1], col]).date())
                        break
                else:
                    if isinstance(df.index, pd.DatetimeIndex):
                        d = str(valid.index[-1].date())
            except Exception:  # noqa: BLE001
                d = None
            return round(price), adv, d, src
        except SystemExit as e:  # vnstock có thể gọi sys.exit khi vượt giới hạn lượt gọi
            last_err = RuntimeError(f"SystemExit: {e}")
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise ConnectionError(f"{last_err}")


def is_rate_limit(err: Exception) -> bool:
    s = str(err).lower()
    return any(k in s for k in ("rate", "limit", "too many", "429", "systemexit", "quota"))


def save(out: Path, prices: dict, meta: dict):
    payload = {**meta, "count": len(prices), "prices": dict(sorted(prices.items()))}
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(out)


def main():
    ap = argparse.ArgumentParser(description="Cập nhật giá cho Rule #1 Screener VN")
    ap.add_argument("--data", default="rule1_data.csv")
    ap.add_argument("--out", default="prices.json")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.4, help="Giây nghỉ giữa các mã")
    a = ap.parse_args()

    data, out = Path(a.data), Path(a.out)
    if not data.exists():
        sys.exit(f"Không thấy {data}. Hãy đưa file BCTC rule1_data.csv vào repo trước.")
    tickers = read_tickers(data)
    if a.limit:
        tickers = tickers[: a.limit]

    old = {}
    if out.exists():
        try:
            old = json.loads(out.read_text(encoding="utf-8")).get("prices", {})
        except Exception:  # noqa: BLE001
            old = {}
    prices = dict(old)

    Quote = import_quote()
    ok, fail, t0 = 0, [], time.time()
    started = datetime.now(VN_TZ).isoformat(timespec="minutes")
    trade_dates = {}

    for i, sym in enumerate(tickers, 1):
        wait = 60
        for attempt in range(4):
            try:
                p, adv, d, src = fetch_price(Quote, sym)
                prices[sym] = {"p": p, "adv": adv, "d": d}
                ok += 1
                if d:
                    trade_dates[d] = trade_dates.get(d, 0) + 1
                break
            except Exception as e:  # noqa: BLE001
                if is_rate_limit(e) and attempt < 3:
                    print(f"   ! {sym}: bị giới hạn lượt gọi, chờ {wait}s", flush=True)
                    time.sleep(wait)
                    wait *= 2
                    continue
                fail.append(sym)
                print(f"   x {sym}: {str(e)[:120]}", flush=True)
                break
        if i % 50 == 0 or i == len(tickers):
            print(f"[{i}/{len(tickers)}] thành công {ok}, lỗi {len(fail)} ({(time.time()-t0)/60:.1f} phút)", flush=True)
        if i % 25 == 0:
            save(out, prices, {"updated": started, "partial": True, "progress": f"{i}/{len(tickers)}", "ok": ok, "failed": fail})
        time.sleep(a.sleep)

    session = max(trade_dates, key=trade_dates.get) if trade_dates else None
    meta = {
        "updated": datetime.now(VN_TZ).isoformat(timespec="minutes"),
        "session": session,
        "ok": ok,
        "failed": fail,
    }
    save(out, prices, meta)
    print(f"\nXong: cập nhật {ok}/{len(tickers)} mã, phiên {session}. Lỗi {len(fail)} mã (giữ giá cũ).")
    if tickers and ok < len(tickers) * 0.5:
        print("Dưới 50% mã cập nhật được — có thể nguồn dữ liệu đang chặn hoặc lỗi.")
        sys.exit(1)


if __name__ == "__main__":
    main()
