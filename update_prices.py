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


# Chỉ số thị trường: tên lưu trên website → các mã thử theo nguồn dữ liệu
INDICES = {"VNINDEX": ["VNINDEX"], "HNXINDEX": ["HNXINDEX", "HNX"], "UPCOMINDEX": ["UPCOMINDEX", "HNXUPCOMINDEX", "UPCOM"]}


def chart_rows(df: pd.DataFrame, scale: float, dec: int = 0) -> dict:
    """OHLCV theo ngày, giá VND (đã điều chỉnh theo nguồn), dạng mảng gọn cho biểu đồ nến."""
    tcol = next((c for c in ("time", "date", "tradingDate") if c in df.columns), None)
    if tcol is None:
        return {}
    d = pd.DataFrame({
        "t": pd.to_datetime(df[tcol], errors="coerce").dt.strftime("%Y-%m-%d"),
        "o": pd.to_numeric(df.get("open"), errors="coerce") * scale,
        "h": pd.to_numeric(df.get("high"), errors="coerce") * scale,
        "l": pd.to_numeric(df.get("low"), errors="coerce") * scale,
        "c": pd.to_numeric(df.get("close"), errors="coerce") * scale,
        "v": pd.to_numeric(df.get("volume"), errors="coerce"),
    }).dropna(subset=["t", "o", "h", "l", "c"]).drop_duplicates("t", keep="last").sort_values("t")
    if d.empty:
        return {}
    out = {"t": d.t.tolist()}
    for k in "ohlc":
        out[k] = [round(float(x), dec) if dec else int(round(x)) for x in d[k]]
    out["v"] = [int(x) if pd.notna(x) else 0 for x in d.v]
    return out


def _ret(c: list, n: int):
    return round(c[-1] / c[-1 - n] - 1, 4) if len(c) > n and c[-1 - n] > 0 else None


def flow_metrics(ch: dict, idx: dict | None) -> dict:
    """Chỉ số dòng tiền / sức mạnh giá từ dữ liệu nến ngày:
    r3/r6/r9/r12: % thay đổi giá 63/126/189/252 phiên; x3, x12: chênh lệch so với VN-Index cùng kỳ;
    h52: khoảng cách tới đỉnh 52 tuần (≤ 0); bo: phiên vượt đỉnh 20 phiên với KL ≥ 1,5× TB20 gần nhất (số phiên trước);
    fl: tỷ trọng KL phiên tăng 20 phiên; rv: KL phiên cuối / TB20."""
    c, h, v, t = ch.get("c", []), ch.get("h", []), ch.get("v", []), ch.get("t", [])
    if len(c) < 30:
        return {}
    m = {f"r{k}": _ret(c, n) for k, n in ((3, 63), (6, 126), (9, 189), (12, 252))}
    if idx:
        ic = [idx.get(d) for d in t]
        for k, n in ((3, 63), (12, 252)):
            if len(c) > n and ic[-1] and ic[-1 - n] and m.get(f"r{k}") is not None:
                m[f"x{k}"] = round((1 + m[f"r{k}"]) / (ic[-1] / ic[-1 - n]) - 1, 4)
    hi = max(h[-252:]) if h else None
    m["h52"] = round(c[-1] / hi - 1, 4) if hi else None
    vma = [None] * len(v)
    for i in range(19, len(v)):
        vma[i] = sum(v[i - 19:i + 1]) / 20
    bo = None
    for i in range(len(c) - 1, max(20, len(c) - 21), -1):  # tìm trong 20 phiên gần nhất
        if vma[i] and c[i] > max(h[i - 20:i]) and v[i] >= 1.5 * vma[i]:
            bo = len(c) - 1 - i
            break
    m["bo"] = bo
    u = w = 0
    for i in range(len(c) - 20, len(c)):
        if c[i] > c[i - 1]: u += v[i]
        elif c[i] < c[i - 1]: w += v[i]
    m["fl"] = round(u / (u + w), 3) if u + w else None
    m["rv"] = round(v[-1] / vma[-1], 2) if vma[-1] else None
    return {k: x for k, x in m.items() if x is not None}


def insider_cluster(path: Path, today: date, days: int = 90) -> dict:
    """Cụm mua nội bộ: số đối tượng khác nhau đăng ký MUA trong 90 ngày gần nhất và không có ai đăng ký BÁN."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    lim = (today - timedelta(days=days)).isoformat()
    out = {}
    for sym, evs in data.items():
        rec = [e for e in evs if (e.get("d") or "") >= lim]
        buyers = {e.get("w") for e in rec if e.get("a") == "B"}
        sells = sum(1 for e in rec if e.get("a") == "S")
        if buyers:
            out[sym] = {"ib": len(buyers), "is": sells}
    return out


def fetch_foreign(tickers: list[str]) -> dict:
    """Khối ngoại mua/bán trong phiên hiện tại (bảng giá KBS, lấy sau giờ đóng cửa).
    Trả về {mã: tỷ VND mua ròng}. Nguồn chỉ có dữ liệu phiên đang xem, nên lịch sử được tích lũy dần mỗi ngày."""
    try:
        from vnstock import Trading
    except ImportError:
        return {}
    out = {}
    for k in range(0, len(tickers), 100):
        batch = tickers[k:k + 100]
        try:
            df = Trading(source="kbs").price_board(batch)
        except Exception as e:  # noqa: BLE001
            print(f"   x khối ngoại lô {k}: {str(e)[:100]}", flush=True)
            continue
        if not isinstance(df, pd.DataFrame) or df.empty:
            continue
        for _, r in df.iterrows():
            try:
                vol, val = float(r.get("volume_accumulated") or 0), float(r.get("total_value") or 0)
                fb, fs = float(r.get("foreign_buy_volume") or 0), float(r.get("foreign_sell_volume") or 0)
                if vol > 0 and val > 0:
                    out[str(r.get("symbol")).upper()] = round((fb - fs) * val / vol / 1e9, 3)
            except (TypeError, ValueError):
                continue
        time.sleep(0.5)
    return out


def fetch_price(Quote, sym: str, days: int = 45, index: bool = False):
    """Trả về (giá đóng cửa VND, thanh khoản TB 20 phiên tỷ VND, ngày phiên, nguồn, dữ liệu nến)."""
    today = datetime.now(VN_TZ).date()  # máy chủ GitHub chạy giờ UTC, quy về giờ Việt Nam
    start = (today - timedelta(days=days)).isoformat()
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
            scale = 1 if index else (1000 if valid.iloc[-1] < 1000 else 1)  # một số nguồn trả giá theo nghìn đồng; chỉ số giữ nguyên điểm
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
            return (round(price, 2) if index else round(price)), adv, d, src, chart_rows(df, scale, 2 if index else 0)
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
    ap.add_argument("--symbols", nargs="*", default=[], help="Chỉ cập nhật các mã này (chạy thử)")
    ap.add_argument("--sleep", type=float, default=0.4, help="Giây nghỉ giữa các mã")
    ap.add_argument("--charts-dir", default="", help="Thư mục ghi dữ liệu nến {MÃ}.json (để trống = không ghi)")
    ap.add_argument("--chart-days", type=int, default=1100, help="Số ngày lịch sử cho biểu đồ nến (~3 năm)")
    a = ap.parse_args()

    data, out = Path(a.data), Path(a.out)
    if not data.exists():
        sys.exit(f"Không thấy {data}. Hãy đưa file BCTC rule1_data.csv vào repo trước.")
    tickers = read_tickers(data)
    if a.symbols:
        want = {x.upper() for x in a.symbols}
        tickers = [t for t in tickers if t in want]
    if a.limit:
        tickers = tickers[: a.limit]

    old = {}
    if out.exists():
        try:
            old = json.loads(out.read_text(encoding="utf-8")).get("prices", {})
        except Exception:  # noqa: BLE001
            old = {}
    prices = dict(old)

    charts_dir = Path(a.charts_dir) if a.charts_dir else None
    if charts_dir:
        charts_dir.mkdir(parents=True, exist_ok=True)
    Quote = import_quote()
    ok, fail, t0 = 0, [], time.time()
    started = datetime.now(VN_TZ).isoformat(timespec="minutes")
    trade_dates = {}

    # Chỉ số thị trường (luôn cập nhật, kể cả khi chạy thử vài mã)
    idx_close = {}
    for name, cands in INDICES.items():
        for code in cands:
            try:
                p, adv, d, src, ch = fetch_price(Quote, code, a.chart_days if charts_dir else 45, index=True)
            except Exception as e:  # noqa: BLE001
                print(f"   x chỉ số {name} ({code}): {str(e)[:100]}", flush=True)
                continue
            prices[name] = {"p": p, "adv": adv, "d": d, "idx": 1}
            if name == "VNINDEX" and ch:
                idx_close = dict(zip(ch["t"], ch["c"]))
            if ch:
                fm = flow_metrics(ch, None)
                if fm:
                    prices[name]["m"] = fm
            if ch and len(ch.get("c", [])) > 1 and ch["t"][-1] == d:
                prices[name]["c1"] = ch["c"][-2]
            if charts_dir and ch:
                (charts_dir / f"{name}.json").write_text(
                    json.dumps({"s": name, "src": src, "idx": 1, **ch}, separators=(",", ":")), encoding="utf-8")
            print(f"   ✓ chỉ số {name} ({code}, {src}): {p} phiên {d}", flush=True)
            break
        time.sleep(a.sleep)

    ins = insider_cluster(Path("insider.json"), datetime.now(VN_TZ).date())
    # Khối ngoại: ghi nhận phiên hôm nay vào lịch sử (lưu trên nhánh charts-data, giữ 30 phiên)
    fhist = {}
    if charts_dir:
        fpath = charts_dir / "foreign.json"
        try:
            fhist = json.loads(fpath.read_text(encoding="utf-8")) if fpath.exists() else {}
        except Exception:  # noqa: BLE001
            fhist = {}
        today = datetime.now(VN_TZ).date()
        if today.weekday() < 5 and datetime.now(VN_TZ).hour >= 15:  # chỉ ghi khi phiên đã đóng cửa
            fx = fetch_foreign(tickers)
            dkey = today.isoformat()
            for sym, net in fx.items():
                h = [x for x in fhist.get(sym, []) if x[0] != dkey] + [[dkey, net]]
                fhist[sym] = h[-30:]
            if fx:
                fpath.write_text(json.dumps(fhist, separators=(",", ":")), encoding="utf-8")
            print(f"   khối ngoại: {len(fx)} mã phiên {dkey}", flush=True)
    for i, sym in enumerate(tickers, 1):
        wait = 60
        for attempt in range(4):
            try:
                p, adv, d, src, ch = fetch_price(Quote, sym, a.chart_days if charts_dir else 45)
                prices[sym] = {"p": p, "adv": adv, "d": d}
                if ch and len(ch.get("c", [])) > 1 and ch["t"][-1] == d:
                    prices[sym]["c1"] = ch["c"][-2]  # giá đóng cửa phiên trước, để tính % thay đổi trong ngày
                if ch:
                    fm = flow_metrics(ch, idx_close)
                    if ins.get(sym):
                        fm.update(ins[sym])
                    fh = fhist.get(sym, [])[-20:]
                    if fh:
                        fm["fn"] = round(sum(x[1] for x in fh), 2)  # khối ngoại mua ròng tối đa 20 phiên gần nhất, tỷ VND
                        fm["fd"] = len(fh)
                    if fm:
                        prices[sym]["m"] = fm
                if charts_dir and ch:
                    (charts_dir / f"{sym}.json").write_text(
                        json.dumps({"s": sym, "src": src, **ch}, separators=(",", ":")), encoding="utf-8")
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
