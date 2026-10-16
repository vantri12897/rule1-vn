import sys, io, inspect, pandas as pd
from datetime import date, timedelta
from vnstock import Company, Quote
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 40); pd.set_option("display.max_colwidth", 60)
for s in sys.argv[1:] or ["FPT", "HPG"]:
    c = Company(source="vci", symbol=s)
    try:
        d = c.insider_trading()
        print(f"== {s} insider_trading rows={len(d)} cols={list(d.columns)}"); print(d.head(12).to_string())
    except Exception as e:
        print(s, "insider_trading ERR", repr(e))
    try:
        ev = c.events(); dd = ev[ev["event_code"].astype(str).str.startswith("DD")]
        print(f"== {s} events DD* rows={len(dd)} of {len(ev)}; codes={ev.event_code.value_counts().to_dict()}")
        print(dd[[c for c in ["event_code","event_title_vi","public_date","start_date","end_date","action_type_vi"] if c in dd.columns]].head(8).to_string())
    except Exception as e:
        print(s, "events ERR", repr(e))
    for src in ("kbs", "vci"):
        try:
            h = Quote(source=src, symbol=s, show_log=False).history(start=(date.today()-timedelta(days=365*5)).isoformat(), end=date.today().isoformat(), interval="1D")
            print(f"== {s} history {src}: rows={len(h)} cols={list(h.columns)} first={h.iloc[0].to_dict()} last={h.iloc[-1].to_dict()}")
        except Exception as e:
            print(s, src, "history ERR", repr(e))
