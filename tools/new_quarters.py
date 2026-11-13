#!/usr/bin/env python3
"""Quét BCTC quý mới HẰNG NGÀY cho mọi mã (1 lần gọi VCI/mã) → newq.json.

Mỗi mã ghi:
  p   : kỳ quý mới nhất nguồn đã có ('YYYY-Qn')
  pub : ngày công bố kỳ đó (VCI publicDate, 'YYYY-MM-DD')
  q   : (chỉ khi kỳ mới hơn chuỗi quý trong rule1_data.csv) các quý mới [kỳ, LNST cty mẹ tỷ đồng, doanh thu tỷ đồng]
Website dùng newq.json để gắn nhãn 📰 "BCTC mới", lọc theo ngày công bố và cập nhật cột LN quý ngay,
không chờ lượt BCTC đầy đủ sáng Chủ nhật. update_prices.py dùng 'pub' để tính phản ứng giá sau công bố.

Chạy: python3 tools/new_quarters.py [--symbols FPT HPG] [--days 400]
"""
import argparse
import csv
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import vn_rule1_export as X  # noqa: E402
from vndata import Finance  # noqa: E402

VN = timezone(timedelta(hours=7))


def load_csv(path: Path) -> dict:
    out = {}
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            t = (r.get("ticker") or "").strip().upper()
            if not t or t in out:
                continue
            q = {}
            for part in (r.get("q_series") or "").split("|"):
                bits = part.split("/")
                if len(bits) >= 2 and bits[0]:
                    try:
                        q[bits[0]] = float(bits[1])
                    except ValueError:
                        pass
            out[t] = {"fin": (r.get("is_financial") or "0").strip() in ("1", "True", "true"), "q": q}
    return out


def pkey(p: str) -> int:
    y, q = p.split("-Q")
    return int(y) * 4 + int(q)


def divisor(series, known: dict):
    """Hệ số đổi đơn vị nguồn → tỷ đồng, so khớp với chuỗi quý đang có trong CSV (luôn là lũy thừa của 10)."""
    for p, ni, _ in reversed(series):
        base = known.get(p)
        if base and ni and abs(base) > 0.05:
            r = ni / base
            if r > 0:
                return 10 ** round(math.log10(r))
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="rule1_data.csv")
    ap.add_argument("--out", default="newq.json")
    ap.add_argument("--symbols", nargs="*", default=[])
    a = ap.parse_args()

    base = load_csv(ROOT / a.data)
    tickers = [t for t in base if not a.symbols or t in {s.upper() for s in a.symbols}]
    out_path = ROOT / a.out
    old = {}
    if out_path.exists():
        try:
            old = json.loads(out_path.read_text(encoding="utf-8")).get("items", {})
        except Exception:  # noqa: BLE001
            old = {}
    items = dict(old)
    ok, fail, newer, t0 = 0, [], 0, time.time()
    for i, sym in enumerate(tickers, 1):
        try:
            f = Finance(source="vci", symbol=sym, period="quarter")
            df = f._get_financial_report("income_statement", period="quarter", lang="vi", limit=80, dropna=False)
            rules = X.RULES_FIN if base[sym]["fin"] else X.RULES["CT"]
            ser = X.quarter_series(df, rules, n=9)
            if not ser:
                raise ValueError("không có chuỗi LNST quý")
            last = ser[-1][0]
            rec = {"p": last, "pub": f.public_dates.get(last)}
            known = base[sym]["q"]
            latest_csv = max(known, key=pkey) if known else None
            if latest_csv is None or pkey(last) > pkey(latest_csv):
                d = divisor(ser, known)
                if d:
                    rec["q"] = [[p, round(ni / d, 2), None if rv is None else round(rv / d, 2)]
                                for p, ni, rv in ser if latest_csv is None or pkey(p) > pkey(latest_csv)]
                    newer += 1
            items[sym] = rec
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail.append(sym)
            print(f"   x {sym}: {str(e)[:120]}", flush=True)
        if i % 100 == 0 or i == len(tickers):
            print(f"[{i}/{len(tickers)}] thành công {ok}, lỗi {len(fail)}, có quý mới hơn CSV {newer} ({(time.time()-t0)/60:.1f} phút)", flush=True)
    if tickers and ok < len(tickers) * 0.5:
        print("Dưới 50% mã lấy được — không ghi đè newq.json")
        sys.exit(1)
    # bỏ mã không còn trong danh sách
    items = {k: v for k, v in items.items() if k in base}
    doc = {"updated": datetime.now(VN).isoformat(timespec="minutes"), "ok": ok, "failed": fail, "items": items}
    out_path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    today = datetime.now(VN).date()
    fresh = sum(1 for v in items.values() if v.get("pub") and (today - datetime.strptime(v["pub"], "%Y-%m-%d").date()).days <= 14)
    print(f"Xong: {ok}/{len(tickers)} mã; {newer} mã có quý mới hơn CSV; {fresh} mã công bố BCTC trong 14 ngày.")


if __name__ == "__main__":
    main()
