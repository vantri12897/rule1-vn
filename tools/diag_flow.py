"""Chẩn đoán tạm: nguồn dữ liệu khối ngoại / tự doanh trong vnstock."""
import inspect, pandas as pd, vnstock
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 80)
print("vnstock", getattr(vnstock, "__version__", "?"))
print([n for n in dir(vnstock) if not n.startswith("_")])
from vnstock import Trading, Quote
for src in ("vci", "kbs"):
    try:
        t = Trading(source=src, symbol="FPT", show_log=False) if "symbol" in inspect.signature(Trading).parameters else Trading(source=src)
        print("== Trading", src, [m for m in dir(t) if not m.startswith("_")])
        for m in [m for m in dir(t) if not m.startswith("_") and any(k in m.lower() for k in ("foreign", "prop", "flow", "stat", "insider", "trade", "summary", "history", "board"))]:
            try:
                f = getattr(t, m)
                if not callable(f): continue
                sig = str(inspect.signature(f))
                print("--", m, sig)
                kw = {}
                if "symbols_list" in sig: r = f(["FPT", "VCG"])
                elif "start" in sig: r = f(start="2026-09-01", end="2026-10-23") if "symbol" not in sig else f(symbol="FPT", start="2026-09-01", end="2026-10-23")
                else: r = f()
                if isinstance(r, pd.DataFrame): print(r.shape); print(list(r.columns)[:80]); print(r.tail(3).T.head(60).to_string()[:3000])
                else: print(type(r), str(r)[:500])
            except Exception as e: print("   err", type(e).__name__, str(e)[:200])
    except Exception as e: print("Trading", src, "err", e)
q = Quote(source="vci", symbol="FPT", show_log=False)
print("Quote methods", [m for m in dir(q) if not m.startswith("_")])
