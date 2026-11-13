"""vndata — bộ lấy dữ liệu chứng khoán Việt Nam tối giản, thay thư viện vnstock (bản cũ ngừng từ 10/11/2026).

Gọi trực tiếp các giao diện dữ liệu công khai mà website của KB Securities (KBS) và Vietcap (VCI) dùng.
Giữ nguyên tên lớp / hàm / cột đầu ra như vnstock 4.x để các script cũ chạy không phải sửa:

    Quote(source="kbs", symbol).history(start, end, interval="1D")  -> time, open, high, low, close, volume
    Trading(source="kbs").price_board([...])                         -> symbol, close_price, reference_price, ...
    Listing(source="vci"|"kbs").symbols_by_exchange()                 -> symbol, exchange, type, organ_name
    Listing(source="vci").symbols_by_industries()                     -> symbol, com_type_code, icb_level, icb_name
    Finance(source="vci", symbol, period)._get_financial_report(...)  -> item, item_en, item_id, <kỳ>...
    Finance(...)._get_report("ratio", mode="raw", ...)                -> bảng chỉ số thô của VCI
    Company(source="vci", symbol).events()                            -> sự kiện (cổ tức, phát hành, giao dịch nội bộ)

Đây KHÔNG phải API chính thức của KBS/VCI: định dạng có thể đổi bất cứ lúc nào. Chỉ dùng cá nhân, tần suất thấp
(mỗi lời gọi cách nhau tối thiểu MIN_GAP giây).
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timedelta

import pandas as pd
import requests

__version__ = "1.0.0"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0.0.0 Safari/537.36")
BASE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    "User-Agent": UA,
}
KBS_IIS = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"
VCI_TRADING = "https://trading.vietcap.com.vn/api"
VCI_IQ = "https://iq.vietcap.com.vn/api/iq-insight-service"
VCI_HEADERS = {**BASE_HEADERS, "Referer": "https://trading.vietcap.com.vn/", "Origin": "https://trading.vietcap.com.vn"}
INDICES = {"VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30", "HNX30", "VN100"}
MIN_GAP = 0.25  # giây tối thiểu giữa hai lời gọi tới cùng một nguồn
TIMEOUT = 30

_session = requests.Session()
_last_call: dict[str, float] = {}
_lock = threading.Lock()


class DataError(RuntimeError):
    pass


def _throttle(host: str):
    with _lock:
        wait = _last_call.get(host, 0) + MIN_GAP - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call[host] = time.monotonic()


def _request(method: str, url: str, headers: dict, params=None, data=None, tries: int = 3):
    host = url.split("/")[2]
    err = None
    for k in range(tries):
        _throttle(host)
        try:
            r = _session.request(method, url, headers=headers, params=params, data=data, timeout=TIMEOUT)
            if r.status_code == 429 or r.status_code >= 500:
                err = DataError(f"HTTP {r.status_code} từ {host}")
                time.sleep(3 * (k + 1))
                continue
            if r.status_code >= 400:
                raise DataError(f"HTTP {r.status_code} từ {host}: {r.text[:150]}")
            return r.json()
        except (requests.RequestException, ValueError) as e:
            err = e
            time.sleep(2 * (k + 1))
    raise DataError(f"Lỗi gọi {host}: {err}")


def _snake(name: str) -> str:
    name = re.sub(r"[\s.\-]+", "_", str(name))
    name = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower().strip("_")


# --------------------------------------------------------------------------------------------
# Giá lịch sử (KBS)
# --------------------------------------------------------------------------------------------
class Quote:
    def __init__(self, source: str = "kbs", symbol: str = "", show_log: bool = False, **_):
        self.source = (source or "kbs").lower()
        self.symbol = symbol.upper().strip()

    def history(self, start: str | None = None, end: str | None = None, interval: str = "1D", **_) -> pd.DataFrame:
        if self.source != "kbs":
            raise DataError(f"vndata chỉ hỗ trợ giá lịch sử từ KBS (yêu cầu nguồn {self.source})")
        if interval not in ("1D", "1d", "D", "d"):
            raise DataError("vndata chỉ hỗ trợ nến ngày (1D)")
        end = end or datetime.now().strftime("%Y-%m-%d")
        start = start or (datetime.strptime(end, "%Y-%m-%d") - timedelta(days=365)).strftime("%Y-%m-%d")
        fmt = lambda s: datetime.strptime(s, "%Y-%m-%d").strftime("%d-%m-%Y")  # noqa: E731
        kind = "index" if self.symbol in INDICES else "stocks"
        js = _request("GET", f"{KBS_IIS}/{kind}/{self.symbol}/data_day", BASE_HEADERS,
                      params={"sdate": fmt(start), "edate": fmt(end)})
        rows = (js or {}).get("data_day") if isinstance(js, dict) else None
        if not rows:
            raise DataError(f"Không có dữ liệu nến cho {self.symbol}")
        df = pd.DataFrame(rows).rename(columns={"t": "time", "o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"})
        df = df[[c for c in ("time", "open", "high", "low", "close", "volume") if c in df.columns]]
        df["time"] = pd.to_datetime(df["time"])
        for c in ("open", "high", "low", "close", "volume"):
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")
        if kind == "stocks":  # KBS trả giá cổ phiếu theo đồng; giữ quy ước vnstock: nghìn đồng
            for c in ("open", "high", "low", "close"):
                df[c] = df[c] / 1000
        df = df.sort_values("time")
        df = df[df["time"] >= pd.to_datetime(start)].reset_index(drop=True)
        return df


# --------------------------------------------------------------------------------------------
# Bảng giá (KBS)
# --------------------------------------------------------------------------------------------
BOARD_MAP = {
    "SB": "symbol", "t": "time", "EX": "exchange", "CL": "ceiling_price", "FL": "floor_price",
    "RE": "reference_price", "OP": "open_price", "HI": "high_price", "LO": "low_price",
    "CP": "close_price", "AP": "average_price", "TT": "volume_accumulated", "TV": "total_value",
    "CH": "price_change", "CHP": "percent_change", "FB": "foreign_buy_volume", "FS": "foreign_sell_volume",
    "FR": "foreign_room", "FO": "foreign_ownership_ratio", "LS": "listed_shares",
}


class Trading:
    def __init__(self, source: str = "kbs", **_):
        self.source = (source or "kbs").lower()

    def price_board(self, symbols_list, **_) -> pd.DataFrame:
        if self.source != "kbs":
            raise DataError("vndata chỉ hỗ trợ bảng giá KBS")
        syms = [s.upper() for s in symbols_list]
        js = _request("POST", f"{KBS_IIS}/stock/iss", {**BASE_HEADERS, "x-lang": "vi"},
                      data=json.dumps({"code": ",".join(syms)}))
        rows = js.get("data") if isinstance(js, dict) else js
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows).rename(columns=BOARD_MAP)
        return df[[c for c in BOARD_MAP.values() if c in df.columns]]


# --------------------------------------------------------------------------------------------
# Danh sách mã, phân ngành (VCI, dự phòng KBS)
# --------------------------------------------------------------------------------------------
_industries_cache: pd.DataFrame | None = None


class Listing:
    def __init__(self, source: str = "vci", **_):
        self.source = (source or "vci").lower()

    def symbols_by_exchange(self, **_) -> pd.DataFrame:
        if self.source == "kbs":
            js = _request("GET", f"{KBS_IIS}/stock/search/data", BASE_HEADERS)
            rows = js.get("data") if isinstance(js, dict) else js
            df = pd.DataFrame(rows or []).rename(columns={"name": "organ_name", "nameEn": "en_organ_name", "index": "id"})
            return df[[c for c in ("symbol", "organ_name", "en_organ_name", "exchange", "type") if c in df.columns]]
        js = _request("GET", f"{VCI_TRADING}/price/symbols/getAll", VCI_HEADERS)
        df = pd.DataFrame(js if isinstance(js, list) else [js])
        df.columns = [_snake(c) for c in df.columns]
        df = df.rename(columns={"board": "exchange"}).drop(columns=["id"], errors="ignore")
        return df[[c for c in df.columns if not c.startswith("en_")]]

    def symbols_by_industries(self, **_) -> pd.DataFrame:
        global _industries_cache
        if _industries_cache is not None:
            return _industries_cache
        js = _request("GET", f"{VCI_IQ}/v2/company/search-bar?language=1", VCI_HEADERS)
        out = []
        for c in (js or {}).get("data") or []:
            for lv in range(1, 5):
                icb = c.get(f"icbLv{lv}")
                if icb and icb.get("code"):
                    out.append({"symbol": c.get("code"), "organ_name": c.get("name"), "com_type_code": c.get("comTypeCode"),
                                "icb_level": lv, "icb_code": icb.get("code"), "icb_name": icb.get("name")})
        df = pd.DataFrame(out)
        if not df.empty:
            df = df.sort_values(["symbol", "icb_level"]).reset_index(drop=True)
        _industries_cache = df
        return df


# --------------------------------------------------------------------------------------------
# Báo cáo tài chính (VCI)
# --------------------------------------------------------------------------------------------
_SECTION = {"balance_sheet": "BALANCE_SHEET", "income_statement": "INCOME_STATEMENT", "cash_flow": "CASH_FLOW", "ratio": "RATIO"}
_meta_cache: dict[str, pd.DataFrame] = {}
_handshake_done = False


def _vci_handshake():
    global _handshake_done
    if _handshake_done:
        return
    try:
        _session.get("https://trading.vietcap.com.vn/priceboard", headers=VCI_HEADERS, timeout=10)
    except requests.RequestException:
        pass
    _handshake_done = True


class Finance:
    def __init__(self, source: str = "vci", symbol: str = "", period: str = "quarter", show_log: bool = False, **_):
        if (source or "vci").lower() != "vci":
            raise DataError("vndata chỉ hỗ trợ BCTC từ VCI")
        self.symbol = symbol.upper().strip()
        self.period = "year" if period in ("year", "Y") else "quarter"
        self.public_dates = {}
        _vci_handshake()
        self.com_type_code = self._company_type()

    def _company_type(self) -> str:
        try:
            df = Listing("vci").symbols_by_industries()
            m = df[(df["symbol"] == self.symbol) & (df["icb_level"] == 4)]
            if not m.empty and m["com_type_code"].iloc[0]:
                return m["com_type_code"].iloc[0]
        except Exception:  # noqa: BLE001
            pass
        return "CT"

    def _metadata(self) -> pd.DataFrame:
        # Danh mục chỉ tiêu (mã trường -> tên Việt/Anh) giống nhau trong cùng loại hình doanh nghiệp
        key = self.com_type_code or self.symbol
        if key not in _meta_cache:
            js = _request("GET", f"{VCI_IQ}/v1/company/{self.symbol}/financial-statement/metrics", VCI_HEADERS)
            data = (js or {}).get("data")
            if not data:
                raise DataError(f"Không có danh mục chỉ tiêu BCTC cho {self.symbol}")
            parts = []
            for name, items in data.items():
                d = pd.DataFrame(items)
                if d.empty or "field" not in d.columns:
                    continue
                d["report_name"] = name
                parts.append(d[[c for c in ("report_name", "field", "titleVi", "titleEn") if c in d.columns]])
            _meta_cache[key] = pd.concat(parts).drop_duplicates("field")
        return _meta_cache[key]

    def _get_report(self, report_type: str, lang: str = "vi", mode: str = "final", period: str | None = None,
                    limit: int | None = None, **_) -> pd.DataFrame:
        section = _SECTION.get(report_type)
        if section is None:
            raise DataError(f"Loại báo cáo không hỗ trợ: {report_type}")
        per = period or self.period
        lim = limit if limit is not None else 4
        if section == "RATIO":
            js = _request("GET", f"{VCI_IQ}/v1/company/{self.symbol}/statistics-financial", VCI_HEADERS)
            df = pd.DataFrame((js or {}).get("data") or [])
        else:
            js = _request("GET", f"{VCI_IQ}/v1/company/{self.symbol}/financial-statement", VCI_HEADERS,
                          params={"section": section})
            data = (js or {}).get("data") or {}
            df = pd.DataFrame(data.get("years" if per in ("year", "Y") else "quarters") or [])
        if not df.empty and len(df) > lim:
            df = df.head(lim)
        if mode == "raw" or section == "RATIO" or df.empty:
            return df
        meta = self._metadata()
        vi = dict(zip(meta["field"], meta.get("titleVi", meta["field"])))
        en = dict(zip(meta["field"], meta.get("titleEn", meta["field"])))
        items = [c for c in df.columns if c in vi]
        ycol = "yearReport" if "yearReport" in df.columns else ("year" if "year" in df.columns else None)
        qcol = "lengthReport" if "lengthReport" in df.columns else ("quarter" if "quarter" in df.columns else None)

        def label(r):
            try:
                y = int(r[ycol])
                q = int(r[qcol]) if qcol else 5
                return f"{y}-Q{q}" if (q < 5 and per in ("quarter", "Q")) else f"{y}"
            except Exception:  # noqa: BLE001
                return "N/A"
        df = df.copy()
        df["period"] = df.apply(label, axis=1) if ycol else df.index.astype(str)
        # Ngày công bố từng kỳ (VCI: publicDate) — dùng cho nhãn "BCTC mới"
        self.public_dates = ({p: str(d)[:10] for p, d in zip(df["period"], df["publicDate"]) if d}
                             if "publicDate" in df.columns else {})
        out = df[["period"] + items].set_index("period").T
        out.index.name = "item_id"
        out = out.reset_index()
        out["item"] = out["item_id"].map(vi)
        out["item_en"] = out["item_id"].map(en)
        out["item_id"] = out["item_en"].map(lambda x: re.sub(r"[^a-z0-9]+", "_", str(x).lower()).strip("_") if pd.notna(x) else x)
        pcols = [c for c in out.columns if c not in ("item", "item_en", "item_id")]
        return out[["item", "item_en", "item_id"] + pcols]

    def _get_financial_report(self, report_type: str, period: str | None = None, lang: str = "vi",
                              dropna: bool = True, limit: int | None = None, **_) -> pd.DataFrame:
        df = self._get_report(report_type, lang=lang, period=period, limit=limit)
        if dropna and not df.empty:
            df = df.fillna(0)
            df = df.loc[:, (df != 0).any(axis=0)]
        return df

    def income_statement(self, period=None, lang="vi", dropna=True, **_):
        return self._get_financial_report("income_statement", period=period, lang=lang, dropna=dropna)

    def balance_sheet(self, period=None, lang="vi", dropna=True, **_):
        return self._get_financial_report("balance_sheet", period=period, lang=lang, dropna=dropna)

    def cash_flow(self, period=None, lang="vi", dropna=True, **_):
        return self._get_financial_report("cash_flow", period=period, lang=lang, dropna=dropna)


# --------------------------------------------------------------------------------------------
# Sự kiện doanh nghiệp (VCI)
# --------------------------------------------------------------------------------------------
class Company:
    def __init__(self, source: str = "vci", symbol: str = "", **_):
        self.symbol = symbol.upper().strip()

    def events(self, size: int = 50) -> pd.DataFrame:
        codes = "DIV,ISS,DDIND,DDINS,DDRP,AGME,AGMR,EGME,AIS,MA,MOVE,NLIS,OTHE,RETU,SUSP"
        frm = (datetime.now() - timedelta(days=3650)).strftime("%Y%m%d")
        to = datetime.now().strftime("%Y%m%d")
        js = _request("GET", f"{VCI_IQ}/v1/events", VCI_HEADERS,
                      params={"ticker": self.symbol, "fromDate": frm, "toDate": to, "eventCode": codes, "page": 0, "size": size})
        data = (js or {}).get("data") or {}
        rows = data.get("content", []) if isinstance(data, dict) else []
        if not rows:
            return pd.DataFrame()
        df = pd.DataFrame(rows)
        df.columns = [_snake(c) for c in df.columns]
        df = df.drop(columns=[c for c in ("organ_code", "symbol", "__typename", "is_event", "event",
                                          "organ_name_en", "organ_name_vi") if c in df.columns])
        for c in ("public_date", "issue_date", "record_date", "exright_date", "display_date"):
            if c in df.columns:
                s = df[c]
                if pd.api.types.is_numeric_dtype(s):
                    df[c] = pd.to_datetime(s, unit="ms", errors="coerce").dt.strftime("%Y-%m-%d")
                else:
                    df[c] = pd.to_datetime(s, errors="coerce").dt.strftime("%Y-%m-%d")
        return df
