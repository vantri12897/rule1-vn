#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vn_rule1_export.py — Xuất dữ liệu báo cáo tài chính TTCK Việt Nam sang CSV
cho web app "Rule #1 Screener VN".

Nguồn: thư viện vnstock (>= 4.0.9), nguồn VCI.
Đầu ra: rule1_data.csv, mỗi dòng = 1 mã × 1 năm, đúng cột app yêu cầu:
  ticker,name,exchange,sector,is_financial,price,shares_mil,avg_pe,adv_bn,analyst_g,
  year,revenue,net_income,equity,debt,cash,ebit,cfo,capex,dividends
Đơn vị: tiền tệ = tỷ VND; giá = VND; số cổ phiếu = triệu cp.

Cách dùng:
  python vn_rule1_export.py --inspect FPT          # kiểm tra ánh xạ dòng BCTC cho 1 mã
  python vn_rule1_export.py --symbols FPT VNM DGC  # chạy vài mã
  python vn_rule1_export.py --exchanges HOSE HNX   # chạy toàn bộ sàn (lâu)
  python vn_rule1_export.py --exchanges HOSE --limit 20   # chạy thử 20 mã đầu

Chạy lại lệnh sẽ bỏ qua mã đã có trong thư mục cache (tiếp tục khi bị ngắt).
Dùng --refresh để tải lại toàn bộ.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
import time
import traceback
import unicodedata
from datetime import date, timedelta
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    sys.exit("Thiếu pandas: pip install pandas")

# --------------------------------------------------------------------------
# 1. Chuẩn hóa tên dòng BCTC và bộ quy tắc ánh xạ
# --------------------------------------------------------------------------

def norm(s) -> str:
    """Bỏ dấu tiếng Việt, chữ thường, bỏ ký tự đặc biệt."""
    if s is None or (isinstance(s, float) and math.isnan(s)):
        return ""
    s = str(s).replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-zA-Z0-9]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


# Mỗi trường: danh sách quy tắc theo thứ tự ưu tiên.
# Quy tắc = (các cụm phải có, các cụm không được có). Khớp trên "tên VN + tên EN".
# pick: "first" = dòng khớp đầu tiên; "max" = giá trị tuyệt đối lớn nhất (cho dòng tổng).
X_BORROW = ["phai thu", "cho vay", "dau tu", "receivable", "loans to", "lending"]
RULES = {
    # ---- Doanh nghiệp thường (CT) ----
    "CT": {
        "revenue": ("IS", "first", [
            (["doanh thu thuan"], ["tai chinh", "financial"]),
            (["net revenue"], ["financial"]),
            (["net sales"], []),
        ]),
        "net_income": ("IS", "first", [
            (["loi nhuan sau thue", "cong ty me"], []),
            (["co dong cua cong ty me"], ["khong kiem soat"]),
            (["attributable", "parent"], ["non controlling", "minority"]),
            (["loi nhuan sau thue thu nhap doanh nghiep"], ["khong kiem soat"]),
            (["profit after tax"], ["minority", "non controlling"]),
        ]),
        "equity_total": ("BS", "max", [
            (["von chu so huu"], ["no phai tra", "nguon von", "tong cong", "khac", "dau tu cua chu", "quy"]),
            (["owner s equity"], ["liabilities", "other", "contributed"]),
        ]),
        "nci": ("BS", "first", [
            (["loi ich co dong khong kiem soat"], []),
            (["non controlling interest"], []),
            (["minority interest"], []),
        ]),
        "debt_st": ("BS", "first", [
            (["vay", "ngan han"], X_BORROW),
            (["short term borrowings"], X_BORROW),
        ]),
        "debt_lt": ("BS", "first", [
            (["vay", "dai han"], X_BORROW),
            (["long term borrowings"], X_BORROW),
        ]),
        "cash": ("BS", "first", [
            (["tien va cac khoan tuong duong tien"], ["luu chuyen", "dau ky", "cuoi ky", "anh huong"]),
            (["tien va tuong duong tien"], ["luu chuyen", "dau ky", "cuoi ky", "anh huong"]),
            (["cash and cash equivalents"], ["beginning", "end of", "effect"]),
        ]),
        "pbt": ("IS", "first", [
            (["tong loi nhuan ke toan truoc thue"], []),
            (["loi nhuan truoc thue"], ["chi phi"]),
            (["profit before tax"], ["expense"]),
            (["truoc thue"], ["chi phi", "thue thu nhap", "thay doi", "von luu dong"]),
            (["before tax"], ["expense", "tax expense"]),
        ]),
        "interest": ("IS", "first", [
            (["chi phi lai vay"], []),
            (["interest expense"], []),
        ]),
        "cfo": ("CF", "first", [
            (["luu chuyen tien thuan tu hoat dong kinh doanh"], []),
            (["net cash", "operating activities"], []),
            (["luu chuyen", "tien", "rong", "kinh doanh"], []),
        ]),
        "capex": ("CF", "first", [
            (["tien chi", "mua sam", "tai san co dinh"], []),
            (["tien chi", "mua sam", "tscd"], []),
            (["tien chi", "mua sam"], ["co phieu", "cong cu no"]),
            (["purchase", "fixed assets"], []),
            (["acquisition", "fixed assets"], []),
        ]),
        "dividends": ("CF", "first", [
            (["co tuc", "da tra"], ["nhan", "received"]),
            (["dividends paid"], ["received"]),
        ]),
    },
}
# Ngân hàng / bảo hiểm / chứng khoán: chỉ cần doanh thu, LNST, vốn chủ, cổ tức.
RULES_FIN = {
    "revenue": ("IS", "first", [
        (["tong thu nhap hoat dong"], []),
        (["total operating income"], []),
        (["thu nhap lai thuan"], []),
        (["net interest income"], []),
        (["doanh thu thuan"], ["tai chinh"]),
        (["doanh thu hoat dong"], []),
        (["net revenue"], []),
    ]),
    "net_income": RULES["CT"]["net_income"],
    "equity_total": RULES["CT"]["equity_total"],
    "nci": RULES["CT"]["nci"],
    "dividends": RULES["CT"]["dividends"],
}


def has(text: str, phrase: str) -> bool:
    """Khớp cụm từ trọn từ (tránh 'nhan' khớp nhầm trong 'nhuan')."""
    return f" {phrase} " in f" {text} "


def year_cols(df: pd.DataFrame) -> dict:
    """Map tên cột kỳ báo cáo -> năm (int). Nhận '2024', '2024-Năm', 2024..."""
    out = {}
    for c in df.columns:
        m = re.match(r"^\s*(\d{4})(?:\s*-\s*(?:Năm|Nam|Y|FY))?\s*$", str(c))
        if m:
            out[c] = int(m.group(1))
    return out


def label_series(df: pd.DataFrame) -> pd.Series:
    parts = [df[c].astype(str) for c in ("item", "item_en", "item_id") if c in df.columns]
    if not parts:
        return pd.Series([""] * len(df), index=df.index)
    s = parts[0]
    for p in parts[1:]:
        s = s + " | " + p
    return s.map(norm)


def match_row(df: pd.DataFrame, labels: pd.Series, rules, pick: str):
    """Trả về (index dòng, nhãn) khớp quy tắc, hoặc (None, None)."""
    ycols = list(year_cols(df).keys())
    for must, avoid in rules:
        mask = labels.map(lambda t: all(has(t, m) for m in must) and not any(has(t, a) for a in avoid))
        idx = list(df.index[mask])
        if not idx:
            continue
        if pick == "max" and ycols:
            best = max(idx, key=lambda i: pd.to_numeric(df.loc[i, ycols], errors="coerce").abs().max(skipna=True) or 0)
            return best, labels[best]
        return idx[0], labels[idx[0]]
    return None, None


def extract(stmts: dict, rules: dict) -> tuple[dict, dict]:
    """stmts = {'IS': df, 'BS': df, 'CF': df}. Trả về {field: {year: value}}, {field: nhãn khớp}."""
    vals, used = {}, {}
    for field, (st, pick, rl) in rules.items():
        df = stmts.get(st)
        if df is None or df.empty:
            continue
        labels = label_series(df)
        i, lab = match_row(df, labels, rl, pick)
        if i is None:
            continue
        used[field] = lab
        yc = year_cols(df)
        vals[field] = {}
        for c, y in yc.items():
            v = pd.to_numeric(df.loc[i, c], errors="coerce")
            if pd.notna(v):
                vals[field][y] = float(v)
    return vals, used


# --------------------------------------------------------------------------
# 2. Truy xuất dữ liệu qua vnstock
# --------------------------------------------------------------------------

def import_vnstock():
    try:
        import vnstock  # noqa: F401
        from vnstock import Finance, Listing, Quote
    except ImportError:
        sys.exit("Chưa cài vnstock. Chạy:\n  python -m pip install -U --extra-index-url "
                 "https://vnstocks.com/api/simple vnstock vnai")
    try:
        from importlib.metadata import version as _v
        ver = _v("vnstock")
    except Exception:  # noqa: BLE001
        ver = getattr(vnstock, "__version__", "0")
    try:
        if tuple(int(x) for x in re.findall(r"\d+", ver)[:3]) < (4, 0, 9):
            print(f"[CẢNH BÁO] vnstock {ver} < 4.0.9. Nên nâng cấp (bản cũ tự ghi nội dung vào file cấu hình trợ lý AI).")
    except Exception:
        pass
    return Finance, Listing, Quote


def with_retry(fn, tries=3, wait=20, label=""):
    for k in range(tries):
        try:
            return fn()
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            print(f"   ! {label}: {e.__class__.__name__}: {str(e)[:120]} — thử lại sau {wait}s")
            time.sleep(wait)
            wait *= 2


def get_statements(Finance, sym: str, years: int):
    f = Finance(source="vci", symbol=sym, period="year", show_log=False)
    out = {}
    for key, rtype in (("IS", "income_statement"), ("BS", "balance_sheet"), ("CF", "cash_flow")):
        try:
            # Hàm nội bộ cho phép lấy nhiều năm hơn mặc định (mặc định vnstock chỉ trả 4 kỳ).
            df = f._get_financial_report(rtype, period="year", lang="vi", limit=years + 2, dropna=False)
        except TypeError:
            df = getattr(f, rtype)(period="year", lang="vi", dropna=False)
        out[key] = df if isinstance(df, pd.DataFrame) else pd.DataFrame()
    ratio = pd.DataFrame()
    try:
        ratio = f._get_report("ratio", mode="raw", period="year", limit=200)
    except Exception:  # noqa: BLE001
        pass
    com_type = getattr(f, "com_type_code", "CT") or "CT"
    return out, ratio, com_type


def ratio_info(ratio: pd.DataFrame):
    """Số CP lưu hành (triệu) mới nhất và P/E trung bình lịch sử theo năm."""
    if ratio is None or ratio.empty:
        return None, None, None
    df = ratio.copy()
    if "lengthReport" in df.columns:
        yearly = df[pd.to_numeric(df["lengthReport"], errors="coerce") == 5]
        if not yearly.empty:
            df = yearly
    sort_cols = [c for c in ("yearReport", "lengthReport", "quarter") if c in df.columns]
    if sort_cols:
        df = df.sort_values(sort_cols)
    shares = mcap = None
    if "numberOfSharesMktCap" in ratio.columns:
        rs = ratio.sort_values([c for c in ("yearReport", "lengthReport", "quarter") if c in ratio.columns]) if sort_cols else ratio
        s = pd.to_numeric(rs["numberOfSharesMktCap"], errors="coerce").dropna()
        if len(s):
            shares = float(s.iloc[-1])
            if shares > 1e5:  # đang là số cổ phiếu thô
                shares /= 1e6
    if "marketCap" in ratio.columns:
        rs = ratio.sort_values([c for c in ("yearReport", "lengthReport", "quarter") if c in ratio.columns]) if sort_cols else ratio
        m = pd.to_numeric(rs["marketCap"], errors="coerce").dropna()
        if len(m):
            mcap = float(m.iloc[-1])
    avg_pe = None
    if "pe" in df.columns:
        pe = pd.to_numeric(df["pe"], errors="coerce")
        pe = pe[(pe > 0) & (pe < 100)].tail(10)
        if len(pe) >= 3:
            avg_pe = round(float(pe.mean()), 2)
    return shares, avg_pe, mcap


def price_info(Quote, sym: str, fallback_mcap=None, fallback_shares=None):
    """Giá đóng cửa gần nhất (VND) và thanh khoản TB 20 phiên (tỷ VND).
    Thử lần lượt KBS, VCI; nếu đều bị chặn thì suy ra giá từ vốn hóa / số CP (dữ liệu ratio)."""
    start = (date.today() - timedelta(days=45)).isoformat()
    last_err = None
    for src in ("kbs", "vci"):
        try:
            q = Quote(source=src, symbol=sym, show_log=False)
            df = q.history(start=start, end=date.today().isoformat(), interval="1D")
            if df is None or df.empty:
                continue
            close = pd.to_numeric(df["close"], errors="coerce")
            vol = pd.to_numeric(df["volume"], errors="coerce")
            last = close.dropna()
            if last.empty:
                continue
            scale = 1000 if last.iloc[-1] < 1000 else 1  # một số nguồn trả giá theo nghìn đồng
            price = float(last.iloc[-1]) * scale
            adv = float((close * scale * vol).tail(20).mean() / 1e9)
            return price, round(adv, 2), src
        except Exception as e:  # noqa: BLE001
            last_err = e
    if fallback_mcap and fallback_shares:
        mc = fallback_mcap
        # marketCap có thể là VND hoặc tỷ VND
        price = mc / (fallback_shares * 1e6) if mc > 1e9 else mc * 1e9 / (fallback_shares * 1e6)
        return round(price), None, "ratio"
    raise ConnectionError(f"Không lấy được giá từ KBS/VCI: {last_err}")


def pick_divisor(eq_raw, price, shares_mil):
    """Chọn hệ số quy đổi BCTC về tỷ VND sao cho P/B hợp lý (~0.1–20)."""
    if not eq_raw or not price or not shares_mil:
        return 1e9
    mcap_bn = price * shares_mil / 1000
    best, bestd = 1e9, 1e9
    for d in (1e9, 1e6, 1e3, 1):
        eq_bn = eq_raw / d
        if eq_bn <= 0:
            continue
        dist = abs(math.log10(mcap_bn / eq_bn) - 0.1)
        if dist < bestd:
            best, bestd = d, dist
    return best


# --------------------------------------------------------------------------
# 3. Dựng bản ghi 1 mã
# --------------------------------------------------------------------------

def build_record(sym, meta, stmts, ratio, com_type, price, adv, years):
    fin = com_type in ("NH", "BH", "CK")
    rules = RULES_FIN if fin else RULES["CT"]
    vals, used = extract(stmts, rules)
    shares, avg_pe, _ = ratio_info(ratio)
    missing = [k for k in ("revenue", "net_income", "equity_total") if k not in vals]
    if missing:
        raise ValueError("Không tìm thấy dòng BCTC: " + ", ".join(missing) + " (chạy --inspect để xem tên dòng)")
    if not shares:
        raise ValueError("Không có số cổ phiếu lưu hành")
    if not price:
        raise ValueError("Không có giá")

    yrs = sorted(set(vals["net_income"]) & set(vals["equity_total"]) & set(vals["revenue"]))[-years:]
    last_eq = vals["equity_total"][yrs[-1]] - vals.get("nci", {}).get(yrs[-1], 0.0)
    d = pick_divisor(last_eq, price, shares)

    def g(field, y, default=None):
        v = vals.get(field, {}).get(y)
        return default if v is None else v / d

    rows = []
    for y in yrs:
        eq = g("equity_total", y) - (g("nci", y, 0.0) or 0.0)
        debt = (g("debt_st", y, 0.0) or 0.0) + (g("debt_lt", y, 0.0) or 0.0)
        pbt, it = g("pbt", y), g("interest", y)
        ebit = None if fin or pbt is None else pbt + abs(it or 0.0)
        capex = g("capex", y)
        div = g("dividends", y)
        rows.append({
            "year": y,
            "revenue": r1(g("revenue", y)),
            "net_income": r1(g("net_income", y)),
            "equity": r1(eq),
            "debt": None if fin else r1(debt),
            "cash": None if fin else r1(g("cash", y)),
            "ebit": r1(ebit),
            "cfo": None if fin else r1(g("cfo", y)),
            "capex": None if fin or capex is None else r1(abs(capex)),
            "dividends": None if div is None else r1(abs(div)),
        })
    return {
        "ticker": sym, "name": meta.get("name", sym), "exchange": meta.get("exchange", ""),
        "sector": meta.get("sector", "Khác"), "is_financial": 1 if fin else 0,
        "price": round(price), "shares_mil": round(shares, 3), "avg_pe": avg_pe, "adv_bn": adv,
        "analyst_g": None, "rows": rows, "mapping": used, "divisor": d, "com_type": com_type,
    }


def r1(v):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(v, 2)


# --------------------------------------------------------------------------
# 4. Danh sách mã
# --------------------------------------------------------------------------
EX_MAP = {"HSX": "HOSE", "HOSE": "HOSE", "HNX": "HNX", "UPCOM": "UPCoM", "UPCOM ": "UPCoM"}


def load_universe(Listing, exchanges):
    """Danh sách mã theo sàn: thử KBS trước (VCI chặn một số IP như Colab), rồi VCI."""
    ex, last_err = None, None
    for src in ("kbs", "vci"):
        try:
            df = Listing(source=src).symbols_by_exchange()
            if df is not None and not df.empty and "exchange" in df.columns:
                ex = df
                print(f"Danh sách mã lấy từ nguồn {src.upper()}: {len(df)} dòng")
                break
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"   ! Không lấy được danh sách mã từ {src.upper()}: {str(e)[:100]}")
    if ex is None:
        raise ConnectionError(f"Không lấy được danh sách mã: {last_err}")
    if "type" in ex.columns:
        ex = ex[ex["type"].astype(str).str.upper() == "STOCK"].copy()
    ex["exchange"] = ex["exchange"].astype(str).str.strip().str.upper().map(lambda x: EX_MAP.get(x, x))
    print("Các sàn có trong danh sách:", sorted(ex["exchange"].unique().tolist()))
    want = {EX_MAP.get(e.upper(), e) for e in exchanges}
    ex = ex[ex["exchange"].isin(want)]
    meta = {}
    try:
        ind = Listing(source="vci").symbols_by_industries()
        lv2 = ind[ind["icb_level"] == 2].drop_duplicates("symbol").set_index("symbol")
    except Exception:  # noqa: BLE001
        lv2 = pd.DataFrame()
    name_col = "organ_name" if "organ_name" in ex.columns else None
    for _, r in ex.iterrows():
        s = r["symbol"]
        meta[s] = {
            "name": (r[name_col] if name_col else s),
            "exchange": r["exchange"],
            "sector": (lv2.loc[s, "icb_name"] if s in lv2.index else "Khác"),
        }
    return meta


# --------------------------------------------------------------------------
# 5. Chương trình chính
# --------------------------------------------------------------------------
CSV_COLS = ["ticker", "name", "exchange", "sector", "is_financial", "price", "shares_mil", "avg_pe",
            "adv_bn", "analyst_g", "year", "revenue", "net_income", "equity", "debt", "cash", "ebit",
            "cfo", "capex", "dividends"]


def write_csv(records, path):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLS)
        for rec in records:
            for row in rec["rows"]:
                w.writerow([rec["ticker"], rec["name"], rec["exchange"], rec["sector"], rec["is_financial"],
                            rec["price"], rec["shares_mil"], fmt(rec["avg_pe"]), fmt(rec["adv_bn"]),
                            fmt(rec["analyst_g"])] + [fmt(row[c]) for c in CSV_COLS[10:]])


def fmt(v):
    return "" if v is None else v


def inspect(Finance, Quote, sym, years):
    stmts, ratio, com_type = with_retry(lambda: get_statements(Finance, sym, years), label=sym)
    print(f"\n=== {sym} — loại doanh nghiệp VCI: {com_type} ===")
    for k, df in stmts.items():
        print(f"\n--- {k}: {len(df)} dòng, cột kỳ: {list(year_cols(df).values())}")
        cols = [c for c in ("item", "item_en") if c in df.columns]
        yc = list(year_cols(df).keys())[-1:] if year_cols(df) else []
        with pd.option_context("display.max_rows", 500, "display.width", 200, "display.max_colwidth", 70):
            print(df[cols + yc].to_string())
    shares, avg_pe, mcap = ratio_info(ratio)
    print(f"\nRatio: cp lưu hành (triệu)={shares}, P/E TB={avg_pe}, cột ratio={list(ratio.columns)[:25]}")
    price, adv, psrc = price_info(Quote, sym, mcap, shares)
    rec = build_record(sym, {"name": sym}, stmts, ratio, com_type, price, adv, years)
    print(f"\nGiá={price} (nguồn {psrc}), thanh khoản TB={adv} tỷ, hệ số quy đổi tiền tệ = /{rec['divisor']:.0e}")
    print("Dòng BCTC đã khớp:")
    for k, v in rec["mapping"].items():
        print(f"  {k:13s} <- {v}")
    print("\nKết quả (tỷ VND):")
    print(pd.DataFrame(rec["rows"]).to_string(index=False))
    Path(f"inspect_{sym}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Xuất dữ liệu Rule #1 cho TTCK Việt Nam (vnstock)")
    ap.add_argument("--symbols", nargs="*", help="Danh sách mã, ví dụ FPT VNM DGC")
    ap.add_argument("--exchanges", nargs="*", default=[], help="HOSE HNX UPCOM")
    ap.add_argument("--years", type=int, default=10, help="Số năm BCTC (mặc định 10)")
    ap.add_argument("--limit", type=int, default=0, help="Chỉ chạy N mã đầu (để thử)")
    ap.add_argument("--out", default="rule1_data.csv")
    ap.add_argument("--cache", default="rule1_cache")
    ap.add_argument("--refresh", action="store_true", help="Bỏ qua cache, tải lại")
    ap.add_argument("--sleep", type=float, default=1.0, help="Giây nghỉ giữa các mã")
    ap.add_argument("--inspect", metavar="MÃ", help="In toàn bộ dòng BCTC và kết quả ánh xạ cho 1 mã")
    a = ap.parse_args()

    Finance, Listing, Quote = import_vnstock()
    if a.inspect:
        inspect(Finance, Quote, a.inspect.upper(), a.years)
        return

    if a.symbols:
        syms = [s.upper() for s in a.symbols]
        try:
            meta = load_universe(Listing, ["HOSE", "HNX", "UPCOM"])
        except Exception:  # noqa: BLE001
            meta = {}
    elif a.exchanges:
        meta = load_universe(Listing, a.exchanges)
        syms = sorted(meta)
    else:
        ap.error("Cần --symbols, --exchanges hoặc --inspect")
    if a.limit:
        syms = syms[: a.limit]

    cache = Path(a.cache)
    cache.mkdir(exist_ok=True)
    errors, records = [], []
    t0 = time.time()
    for i, s in enumerate(syms, 1):
        cf = cache / f"{s}.json"
        if cf.exists() and not a.refresh:
            records.append(json.loads(cf.read_text(encoding="utf-8")))
            continue
        el = time.time() - t0
        print(f"[{i}/{len(syms)}] {s}  ({el/60:.1f} phút)")
        try:
            stmts, ratio, com_type = with_retry(lambda: get_statements(Finance, s, a.years), label=s)
            sh, _, mc = ratio_info(ratio)
            price, adv, psrc = price_info(Quote, s, mc, sh)
            rec = build_record(s, meta.get(s, {"name": s}), stmts, ratio, com_type, price, adv, a.years)
            cf.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            records.append(rec)
        except KeyboardInterrupt:
            print("Đã dừng. Chạy lại lệnh để tiếp tục từ mã chưa xong.")
            break
        except Exception as e:  # noqa: BLE001
            errors.append((s, f"{e.__class__.__name__}: {e}"))
            print(f"   x {s}: {e}")
            if "--debug" in sys.argv:
                traceback.print_exc()
        time.sleep(a.sleep)

    write_csv(records, a.out)
    print(f"\nXong: {len(records)} mã -> {a.out}")
    if errors:
        with open("rule1_errors.csv", "w", newline="", encoding="utf-8-sig") as fh:
            csv.writer(fh).writerows([("ticker", "error")] + errors)
        print(f"{len(errors)} mã lỗi -> rule1_errors.csv")


if __name__ == "__main__":
    main()
