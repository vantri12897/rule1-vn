"""Chẩn đoán vndata: gọi thử từng chức năng, in tóm tắt (chạy trên GitHub Actions)."""
import json, sys, time, traceback
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pandas as pd
import vndata as V

def step(name, fn):
    t = time.time()
    try:
        r = fn()
        print(f"✅ {name} ({time.time()-t:.1f}s): {r}", flush=True)
    except Exception as e:
        print(f"❌ {name}: {e.__class__.__name__}: {str(e)[:300]}", flush=True)
        traceback.print_exc(limit=2)

def q(sym):
    df = V.Quote("kbs", sym).history(start="2026-10-01", end="2026-11-12")
    return f"{len(df)} nến, cuối {df['time'].iloc[-1].date()} close={df['close'].iloc[-1]} vol={df['volume'].iloc[-1]}"
step("Quote FPT", lambda: q("FPT"))
step("Quote VNINDEX", lambda: q("VNINDEX"))
step("Quote HTG", lambda: q("HTG"))
def board():
    df = V.Trading("kbs").price_board(["FPT", "HPG", "TCB", "VCB"])
    return df[["symbol","close_price","reference_price","volume_accumulated","foreign_buy_volume","foreign_sell_volume"]].to_dict("records")
step("Bảng giá", board)
step("Listing VCI", lambda: (lambda d: f"{len(d)} dòng, cột {list(d.columns)[:8]}, type={d['type'].value_counts().to_dict() if 'type' in d else '-'} ex={d['exchange'].value_counts().to_dict()}")(V.Listing("vci").symbols_by_exchange()))
step("Listing KBS", lambda: (lambda d: f"{len(d)} dòng, cột {list(d.columns)}, ex={d['exchange'].value_counts().head(5).to_dict() if 'exchange' in d else '-'}")(V.Listing("kbs").symbols_by_exchange()))
step("Phân ngành", lambda: (lambda d: f"{len(d)} dòng; FPT={d[d.symbol=='FPT'][['icb_level','icb_name','com_type_code']].values.tolist()}")(V.Listing("vci").symbols_by_industries()))
def fin(sym):
    f = V.Finance("vci", sym, period="year")
    out = [f"type={f.com_type_code}"]
    for rt in ("income_statement","balance_sheet","cash_flow"):
        df = f._get_financial_report(rt, period="year", lang="vi", limit=12, dropna=False)
        out.append(f"{rt}: {df.shape}, kỳ={[c for c in df.columns if c not in ('item','item_en','item_id')][:3]}…, dòng đầu={df['item'].head(3).tolist() if 'item' in df else '-'}")
    r = f._get_report("ratio", mode="raw", period="year", limit=200)
    out.append(f"ratio raw: {r.shape} cột có numberOfSharesMktCap={('numberOfSharesMktCap' in r.columns)} ratioType={r['ratioType'].unique().tolist()[:4] if 'ratioType' in r else '-'}")
    fq = V.Finance("vci", sym, period="quarter")
    dq = fq._get_financial_report("income_statement", period="quarter", lang="vi", limit=80, dropna=False)
    qc = [c for c in dq.columns if c not in ('item','item_en','item_id')]
    out.append(f"quý: {dq.shape} từ {qc[:1]} đến {qc[-1:]}")
    return " | ".join(out)
step("BCTC FPT", lambda: fin("FPT"))
step("BCTC VCB (ngân hàng)", lambda: fin("VCB"))
step("Sự kiện FPT", lambda: (lambda d: f"{len(d)} sự kiện, cột {list(d.columns)[:12]}, mã={d['event_code'].value_counts().head(6).to_dict() if 'event_code' in d else '-'}")(V.Company("vci","FPT").events()))
