import sys, pandas as pd
from vnstock import Finance
for s in sys.argv[1:] or ["FPT","CTG","HPG"]:
    r = Finance(source="vci", symbol=s, period="year", show_log=False)._get_report("ratio", mode="raw", period="year", limit=200)
    t = r[r["ratioType"]=="RATIO_TTM"][["yearReport","quarter","pe"]]
    y = r[r["ratioType"]=="RATIO_YEAR"][["yearReport","pe"]]
    print(s, "TTM rows", len(t), "years", t.yearReport.min(), "-", t.yearReport.max(), "| YEAR rows", len(y), y.yearReport.min(), "-", y.yearReport.max())
    print(t.groupby("yearReport").pe.agg(["count","mean"]).round(2).T.to_string())
    print(y.set_index("yearReport").pe.round(2).to_dict())
