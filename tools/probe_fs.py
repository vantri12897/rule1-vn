"""Dò cấu trúc thô API BCTC quý của VCI: các trường không phải chỉ tiêu (ngày công bố, ngày cập nhật…).
Chạy trên GitHub Actions, ghi kết quả ra diag/probe_fs.txt."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import vndata as V  # noqa: E402

out = []
for sym in ("FPT", "CTG", "HTG", "VNM"):
    for section in ("INCOME_STATEMENT",):
        try:
            js = V._request("GET", f"{V.VCI_IQ}/v1/company/{sym}/financial-statement", V.VCI_HEADERS, params={"section": section})
            data = (js or {}).get("data") or {}
            out.append(f"== {sym} {section}: keys data={list(data.keys()) if isinstance(data, dict) else type(data)}")
            for per in ("quarters", "years"):
                rows = data.get(per) or []
                if not rows:
                    continue
                keys = list(rows[0].keys())
                meta = [k for k in keys if not any(k.lower().startswith(p) for p in ("isa", "isb", "isi", "iss", "bsa", "bsb", "bsi", "bss", "cfa", "cfb", "cfi", "cfs", "nob"))]
                out.append(f"  {per}: {len(rows)} dòng; {len(keys)} khóa; khóa không phải chỉ tiêu: {meta}")
                for r in rows[:4]:
                    out.append("    " + json.dumps({k: r.get(k) for k in meta}, ensure_ascii=False))
        except Exception as e:  # noqa: BLE001
            out.append(f"!! {sym} {section}: {e}")
# Sự kiện: thử vài mã sự kiện liên quan KQKD
for codes in ("KQKD", "FIN", "BCTC", "EARN", "RESU", "OTHE"):
    try:
        js = V._request("GET", f"{V.VCI_IQ}/v1/events", V.VCI_HEADERS,
                        params={"ticker": "FPT", "fromDate": "20250101", "toDate": "20261231", "eventCode": codes, "page": 0, "size": 5})
        data = (js or {}).get("data") or {}
        rows = data.get("content", []) if isinstance(data, dict) else []
        out.append(f"== events {codes}: {len(rows)} dòng " + (json.dumps(rows[0], ensure_ascii=False)[:600] if rows else ""))
    except Exception as e:  # noqa: BLE001
        out.append(f"!! events {codes}: {e}")
Path("diag").mkdir(exist_ok=True)
Path("diag/probe_fs.txt").write_text("\n".join(out), encoding="utf-8")
print("\n".join(out))
