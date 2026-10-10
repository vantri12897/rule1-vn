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
import socket
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


def get_extras(Finance, sym: str) -> dict:
    """BCTC quý (để tính TTM) và lịch sự kiện phát hành (để điều chỉnh số cổ phiếu).
    Lỗi ở đây không làm hỏng cả mã: trả về phần lấy được."""
    out = {"QIS": pd.DataFrame(), "events": pd.DataFrame()}
    try:
        f = Finance(source="vci", symbol=sym, period="quarter", show_log=False)
        try:
            # VCI trả các quý TỪ CŨ ĐẾN MỚI theo limit → lấy dư để chắc chắn có quý gần nhất.
            df = f._get_financial_report("income_statement", period="quarter", lang="vi", limit=80, dropna=False)
        except TypeError:
            df = f.income_statement(period="quarter", lang="vi", dropna=False)
        if isinstance(df, pd.DataFrame):
            out["QIS"] = df
    except Exception as e:  # noqa: BLE001
        out["QIS_err"] = f"{e.__class__.__name__}: {str(e)[:100]}"
    try:
        from vnstock import Company
        ev = Company(source="vci", symbol=sym).events()
        if isinstance(ev, pd.DataFrame):
            out["events"] = ev
    except Exception as e:  # noqa: BLE001
        out["events_err"] = f"{e.__class__.__name__}: {str(e)[:100]}"
    return out


def quarter_cols(df: pd.DataFrame) -> dict:
    """Map tên cột '2026-Q2' -> (2026, 2)."""
    out = {}
    for c in df.columns:
        m = re.match(r"^\s*(\d{4})\s*-\s*Q([1-4])\s*$", str(c))
        if m:
            out[c] = (int(m.group(1)), int(m.group(2)))
    return out


def ttm_net_income(qis: pd.DataFrame, rules: dict):
    """Tổng LNST cổ đông công ty mẹ 4 quý liên tiếp gần nhất (đơn vị thô của nguồn).
    Trả về (giá trị, 'YYYY-Qn' của quý cuối) hoặc (None, None)."""
    if qis is None or qis.empty:
        return None, None
    labels = label_series(qis)
    i, _ = match_row(qis, labels, rules["net_income"][2], "first")
    if i is None:
        return None, None
    pts = []
    for c, (y, q) in quarter_cols(qis).items():
        v = pd.to_numeric(qis.loc[i, c], errors="coerce")
        if pd.notna(v):
            pts.append((y * 4 + q - 1, float(v), f"{y}-Q{q}"))
    pts.sort()
    if len(pts) < 4:
        return None, None
    last4 = pts[-4:]
    if last4[-1][0] - last4[0][0] != 3:  # phải là 4 quý liên tiếp
        return None, None
    return sum(p[1] for p in last4), last4[-1][2]


NON_DILUTIVE = ("co phieu thuong", "bonus issue", "co tuc bang co phieu", "stock dividend")


def bonus_events(ev: pd.DataFrame) -> list:
    """Các đợt cổ phiếu thưởng / cổ tức bằng cổ phiếu ĐÃ thực hiện: [(ngày GDKHQ, tỷ lệ)].
    Phát hành thu tiền (riêng lẻ, cho cổ đông hiện hữu, ESOP, chuyển đổi) KHÔNG nằm ở đây vì đó là pha loãng thật."""
    if ev is None or ev.empty:
        return []
    out, today = [], date.today()
    for _, r in ev.iterrows():
        if str(r.get("event_code", "")).upper() != "ISS":
            continue
        title = norm(f"{r.get('event_title_vi', '')} {r.get('event_title_en', '')}")
        if not any(has(title, k) for k in NON_DILUTIVE):
            continue
        ratio = pd.to_numeric(r.get("exercise_ratio"), errors="coerce")
        d = pd.to_datetime(r.get("exright_date"), errors="coerce")
        if pd.isna(ratio) or ratio <= 0 or ratio > 5 or pd.isna(d) or d.date() > today:
            continue  # chưa có ngày GDKHQ = kế hoạch chưa thực hiện
        out.append((d.date(), float(ratio)))
    return sorted(set(out))


def shares_by_year(ratio: pd.DataFrame) -> dict:
    """Số cổ phiếu lưu hành cuối mỗi năm (triệu cp, CHƯA điều chỉnh) từ dòng ratio năm."""
    if ratio is None or ratio.empty or "numberOfSharesMktCap" not in ratio.columns:
        return {}
    df = ratio
    if "ratioType" in df.columns and (df["ratioType"] == "RATIO_YEAR").any():
        df = df[df["ratioType"] == "RATIO_YEAR"]
    elif "quarter" in df.columns:
        df = df[pd.to_numeric(df["quarter"], errors="coerce") == 5]
    ycol = "yearReport" if "yearReport" in df.columns else "year"
    out = {}
    for _, r in df.iterrows():
        y = pd.to_numeric(r.get(ycol), errors="coerce")
        v = pd.to_numeric(r.get("numberOfSharesMktCap"), errors="coerce")
        if pd.notna(y) and pd.notna(v) and v > 0:
            out[int(y)] = float(v) / 1e6 if v > 1e5 else float(v)
    return out


def adjusted_shares(years, raw: dict, events: list, current: float) -> dict:
    """Số cổ phiếu từng năm quy về cùng mặt bằng hiện tại:
    raw_năm × Π(1 + tỷ lệ thưởng/cổ tức CP) của các đợt có GDKHQ SAU cuối năm đó.
    Không có số liệu tin cậy → None (website sẽ dùng số cổ phiếu hiện tại như trước)."""
    out = {}
    for y in years:
        r = raw.get(y)
        if not r:
            out[y] = None
            continue
        f = 1.0
        for d, k in events:
            if d > date(y, 12, 31):
                f *= 1 + k
        adj = r * f
        # Chặn số liệu vô lý: số CP điều chỉnh không thể lớn hơn hiện tại quá 25%
        # (trừ khi mua lại cổ phiếu lớn) hay nhỏ hơn 15% hiện tại.
        out[y] = round(adj, 3) if current and 0.15 * current <= adj <= 1.25 * current else None
    return out


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

def build_record(sym, meta, stmts, ratio, com_type, price, adv, years, extras=None):
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

    extras = extras or {}
    ttm_raw, ttm_period = ttm_net_income(extras.get("QIS"), rules)
    ttm_ni = r1(ttm_raw / d) if ttm_raw is not None else None
    if ttm_period and int(ttm_period[:4]) < yrs[-1]:
        ttm_ni, ttm_period = None, None  # dữ liệu quý cũ hơn BCTC năm → bỏ, dùng EPS năm
    adj = adjusted_shares(yrs, shares_by_year(ratio), bonus_events(extras.get("events")), shares)

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
            "shares_adj": adj.get(y),
        })
    return {
        "ticker": sym, "name": meta.get("name", sym), "exchange": meta.get("exchange", ""),
        "sector": meta.get("sector", "Khác"), "is_financial": 1 if fin else 0,
        "price": round(price), "shares_mil": round(shares, 3), "avg_pe": avg_pe, "adv_bn": adv,
        "analyst_g": None, "ttm_ni": ttm_ni, "ttm_period": ttm_period,
        "rows": rows, "mapping": used, "divisor": d, "com_type": com_type,
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
            "cfo", "capex", "dividends", "shares_adj", "ttm_ni", "ttm_period"]


def write_csv(records, path):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLS)
        for rec in records:
            for row in rec["rows"]:
                w.writerow([rec["ticker"], rec["name"], rec["exchange"], rec["sector"], rec["is_financial"],
                            rec["price"], rec["shares_mil"], fmt(rec["avg_pe"]), fmt(rec["adv_bn"]),
                            fmt(rec["analyst_g"])] + [fmt(row.get(c)) for c in CSV_COLS[10:20]]
                           + [fmt(row.get("shares_adj")), fmt(rec.get("ttm_ni")), fmt(rec.get("ttm_period"))])


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
    extras = get_extras(Finance, sym)
    rec = build_record(sym, {"name": sym}, stmts, ratio, com_type, price, adv, years, extras)
    print(f"\nTTM: {rec['ttm_ni']} tỷ (đến {rec['ttm_period']}); sự kiện thưởng/cổ tức CP: {bonus_events(extras.get('events'))}")
    print("Số CP điều chỉnh theo năm:", {r['year']: r['shares_adj'] for r in rec['rows']}, "| hiện tại:", rec['shares_mil'])
    print(f"\nGiá={price} (nguồn {psrc}), thanh khoản TB={adv} tỷ, hệ số quy đổi tiền tệ = /{rec['divisor']:.0e}")
    print("Dòng BCTC đã khớp:")
    for k, v in rec["mapping"].items():
        print(f"  {k:13s} <- {v}")
    print("\nKết quả (tỷ VND):")
    print(pd.DataFrame(rec["rows"]).to_string(index=False))
    Path(f"inspect_{sym}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    socket.setdefaulttimeout(60)  # không để một lần gọi mạng treo vô thời hạn
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
            extras = get_extras(Finance, s)
            rec = build_record(s, meta.get(s, {"name": s}), stmts, ratio, com_type, price, adv, a.years, extras)
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
