"""Chẩn đoán tạm: cột tỷ số và dòng BCTC ngân hàng có trên VCI."""
import pandas as pd, sys
from vnstock import Finance
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 400); pd.set_option("display.max_colwidth", 80)
for sym in sys.argv[1:]:
    f = Finance(source="vci", symbol=sym, period="year", show_log=False)
    print("=====", sym, getattr(f, "com_type_code", None))
    r = f._get_report("ratio", mode="raw", period="year", limit=200)
    print("ratio shape", r.shape); print("COLS:", list(r.columns))
    t = r[r["ratioType"].astype(str).str.upper() == "RATIO_TTM"] if "ratioType" in r.columns else r
    keep = [c for c in r.columns if any(k in c.lower() for k in ("pb", "npl", "bad", "loan", "llr", "provision", "car", "deposit", "ldr", "roe", "year", "quarter", "ratiotype", "nim", "cir", "credit"))]
    print(t[keep].tail(6).T.to_string())
    for rt in ("balance_sheet", "income_statement"):
        df = f._get_financial_report(rt, period="year", lang="vi", limit=3, dropna=False)
        col = [c for c in df.columns if df[c].dtype == object][:1]
        print("---", rt, "rows/cols", df.shape)
        print(list(df.columns)[:200])
