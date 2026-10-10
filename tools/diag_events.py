import inspect, io, sys
from contextlib import redirect_stdout
from pathlib import Path
import pandas as pd
from vnstock import Company
pd.set_option("display.width", 250); pd.set_option("display.max_rows", 500)
buf = io.StringIO()
with redirect_stdout(buf):
    c = Company(source="vci", symbol="ACB")
    print("events sig:", inspect.signature(c.events))
    prov = getattr(c, "provider", None) or getattr(c, "_provider", None)
    print("provider:", type(prov))
    for obj in (c, prov):
        try:
            print(inspect.getsource(type(obj).events)[:3000])
        except Exception as e:
            print("src err", e)
    for sym in sys.argv[1:] or ["ACB", "DGC", "FPT"]:
        for kw in ({}, {"page_size": 500}, {"limit": 500}, {"size": 500}):
            try:
                ev = Company(source="vci", symbol=sym).events(**kw)
                iss = ev[ev["event_code"] == "ISS"] if "event_code" in ev.columns else ev
                print(f"\n== {sym} events{kw}: rows={len(ev)} ISS={len(iss)} min_date={ev['public_date'].min() if 'public_date' in ev.columns else '?'}")
                if len(iss):
                    print(iss[["event_title_vi", "exercise_ratio", "exright_date", "public_date"]].to_string()[:4000])
            except Exception as e:
                print(f"{sym} {kw} ERR {e!r}")
Path("diag").mkdir(exist_ok=True)
Path("diag/events.txt").write_text(buf.getvalue(), encoding="utf-8")
