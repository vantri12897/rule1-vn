"""Khảo sát dữ liệu VCI (chỉ dùng để phát triển). Ghi kết quả vào diag/."""
import io, sys, json, traceback, inspect
from contextlib import redirect_stdout
from pathlib import Path
import pandas as pd
import vnstock
from vnstock import Finance

pd.set_option("display.width", 250); pd.set_option("display.max_columns", 80); pd.set_option("display.max_rows", 200)
out = Path("diag"); out.mkdir(exist_ok=True)
syms = sys.argv[1:] or ["FPT", "VCB", "PNJ", "DGC", "HPG"]

def section(t): print("\n" + "=" * 20 + " " + t + " " + "=" * 20)

buf = io.StringIO()
with redirect_stdout(buf):
    print("vnstock", getattr(vnstock, "__version__", "?"))
    print("vnstock attrs:", [a for a in dir(vnstock) if not a.startswith("_")])
    f0 = Finance(source="vci", symbol="FPT", period="quarter", show_log=False)
    print("Finance methods:", [m for m in dir(f0) if not m.startswith("__")])
    for m in ("_get_financial_report", "_get_report", "ratio"):
        if hasattr(f0, m):
            try: print(m, inspect.signature(getattr(f0, m)))
            except Exception as e: print(m, e)
    try:
        from vnstock import Company
        c = Company(source="vci", symbol="FPT", show_log=False) if "show_log" in str(inspect.signature(Company)) else Company(source="vci", symbol="FPT")
        print("Company methods:", [m for m in dir(c) if not m.startswith("_")])
    except Exception as e:
        print("Company err", e)
(out / "_api.txt").write_text(buf.getvalue(), encoding="utf-8")

for s in syms:
    buf = io.StringIO()
    with redirect_stdout(buf):
        for per in ("year", "quarter"):
            try:
                f = Finance(source="vci", symbol=s, period=per, show_log=False)
                section(f"{s} RATIO raw {per}")
                r = f._get_report("ratio", mode="raw", period=per, limit=40)
                print("columns:", list(r.columns))
                keep = [c for c in r.columns if any(k in c.lower() for k in ("year", "quarter", "length", "share", "eps", "bvps", "pe", "pb", "marketcap", "roe"))]
                print(r[keep].tail(14).to_string())
            except Exception as e:
                print("ERR ratio", per, repr(e)); traceback.print_exc()
        try:
            f = Finance(source="vci", symbol=s, period="quarter", show_log=False)
            section(f"{s} IS quarter")
            try:
                df = f._get_financial_report("income_statement", period="quarter", lang="vi", limit=10, dropna=False)
            except TypeError:
                df = f.income_statement(period="quarter", lang="vi", dropna=False)
            print("columns:", list(df.columns)[:40])
            cols = [c for c in ("item", "item_en") if c in df.columns]
            print(df[cols + list(df.columns[-6:])].to_string()[:12000])
        except Exception as e:
            print("ERR IS quarter", repr(e)); traceback.print_exc()
        try:
            f = Finance(source="vci", symbol=s, period="year", show_log=False)
            section(f"{s} CF year (rows with phat hanh / co phieu)")
            df = f._get_financial_report("cash_flow", period="year", lang="vi", limit=10, dropna=False)
            cols = [c for c in ("item", "item_en") if c in df.columns]
            m = df[cols[0]].astype(str).str.lower()
            print(df[m.str.contains("phát hành|góp vốn|cổ phiếu|vốn góp")][cols + list(df.columns[-8:])].to_string())
        except Exception as e:
            print("ERR CF", repr(e)); traceback.print_exc()
        try:
            from vnstock import Company
            c = Company(source="vci", symbol=s)
            for m in ("events", "dividends", "capital_history"):
                if hasattr(c, m):
                    section(f"{s} Company.{m}")
                    try:
                        d = getattr(c, m)()
                        print(d.head(30).to_string() if isinstance(d, pd.DataFrame) else d)
                    except Exception as e:
                        print("ERR", m, repr(e))
        except Exception as e:
            print("ERR Company", repr(e))
    (out / f"{s}.txt").write_text(buf.getvalue(), encoding="utf-8")
    print(s, "done")
