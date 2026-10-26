#!/usr/bin/env python3
"""Gộp kết quả phân tích trend sâu (mỗi mã một file JSON trong thư mục) vào trends.json, kiểm tra định dạng.

Cách chạy:  python3 tools/merge_trends.py trend_out/   (mỗi file {MÃ}.json)

Định dạng một mã:
{"t": "VCP", "d": "2026-10-25",
 "trends": [{"id": "01", "name": "Tài chính", "sig": "tín hiệu cụ thể, có số liệu", "r": "pos|mix|neg|na"}, ... đủ 11 mục 01–11],
 "summary": "1–3 câu kết luận",
 "src": [{"t": "tiêu đề nguồn", "u": "https://..."}]}

Trường bổ sung theo Cẩm nang CI Growth (tùy chọn, có thì website dùng để chấm chữ T):
 mỗi trend: "sigs": [số thứ tự tín hiệu 1–76 rõ ràng], "cls": "A|B|C" (mạnh / bổ sung / yếu)
 "main": ["01", ...]   nhóm TREND chính (mỗi nhóm ≥ 3 tín hiệu rõ ràng)
 "score": 1–10, "calc": {"A":.., "B":.., "C":.., "R":..}   điểm tăng trưởng = A + B + C − R
 "check": {"ok": 0–7, "conflict": n, "items": [{"q": "câu hỏi", "a": "yes|no|na", "note": "..."}]}
 "conf": "cao|tb|thap"   mức tin cậy dữ liệu
 "product": {"name","now","date","base","chg","impact","src"}   giá sản phẩm chính
 "oneoff": "khoản lợi nhuận bất thường cần loại trừ", "risk": "rủi ro lớn nhất", "driver": "động lực tăng trưởng chính"
"""
import json, sys
from datetime import date
from pathlib import Path

NAMES = {"01": "Tài chính", "02": "Sản xuất, vận hành", "03": "Chi phí, giá cả", "04": "Thị trường, khách hàng",
         "05": "Nội bộ, quản trị", "06": "Nhà đầu tư, cổ đông", "07": "Phân tích kỹ thuật", "08": "Vĩ mô, ngành",
         "09": "Truyền thông, sự kiện", "10": "Tài sản ẩn, kế toán", "11": "Sản phẩm, công nghệ"}
R = {"pos", "mix", "neg", "na"}


def check(o: dict) -> dict:
    t = str(o.get("t", "")).upper().strip()
    assert t, "thiếu mã"
    tr = {str(x.get("id")).zfill(2): x for x in o.get("trends", [])}
    out = []
    for k, nm in NAMES.items():
        x = tr.get(k, {})
        r = str(x.get("r", "na")).lower()
        out.append({"id": k, "name": nm, "sig": str(x.get("sig", "Chưa đủ dữ liệu"))[:400], "r": r if r in R else "na"})
    src = [{"t": str(s.get("t", ""))[:150], "u": str(s.get("u", ""))} for s in o.get("src", []) if str(s.get("u", "")).startswith("http")][:12]
    rec = {"d": o.get("d") or date.today().isoformat(), "trends": out, "summary": str(o.get("summary", ""))[:600], "src": src}
    # --- Cẩm nang CI Growth ---
    for x, raw in zip(out, [tr.get(k, {}) for k in NAMES]):
        sg = sorted({int(v) for v in raw.get("sigs", []) if str(v).isdigit() and 1 <= int(v) <= 76})
        if sg:
            x["sigs"] = sg
        c = str(raw.get("cls", "")).upper()
        if c in ("A", "B", "C"):
            x["cls"] = c
    sc = o.get("score")
    if isinstance(sc, (int, float)) and 1 <= sc <= 10:
        rec["score"] = round(float(sc), 1)
        calc = o.get("calc") or {}
        rec["calc"] = {k: round(float(calc[k]), 2) for k in ("A", "B", "C", "R") if isinstance(calc.get(k), (int, float))}
    rec["main"] = [str(m).zfill(2) for m in o.get("main", []) if str(m).zfill(2) in NAMES]
    ck = o.get("check")
    if isinstance(ck, dict):
        items = [{"q": str(i.get("q", ""))[:160], "a": str(i.get("a", "na")).lower() if str(i.get("a", "na")).lower() in ("yes", "no", "na") else "na",
                  "note": str(i.get("note", ""))[:300]} for i in ck.get("items", [])][:7]
        okn = ck.get("ok")
        rec["check"] = {"ok": int(okn) if isinstance(okn, (int, float)) else sum(i["a"] != "na" for i in items),
                        "conflict": int(ck.get("conflict") or 0), "items": items}
    cf = str(o.get("conf", "")).lower()
    if cf in ("cao", "tb", "thap"):
        rec["conf"] = cf
    pr = o.get("product")
    if isinstance(pr, dict) and pr.get("name"):
        rec["product"] = {k: str(pr.get(k, ""))[:200] for k in ("name", "now", "date", "base", "chg", "impact", "src")}
    for k in ("oneoff", "risk", "driver"):
        if o.get(k):
            rec[k] = str(o[k])[:400]
    return rec, t


def main():
    d = Path(sys.argv[1] if len(sys.argv) > 1 else "trend_out")
    p = Path("trends.json")
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"items": {}}
    n = 0
    for f in sorted(d.glob("*.json")):
        try:
            rec, t = check(json.loads(f.read_text(encoding="utf-8")))
            data["items"][t] = rec
            n += 1
        except Exception as e:  # noqa: BLE001
            print(f"bỏ qua {f.name}: {e}")
    data["updated"] = date.today().isoformat()
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Đã gộp {n} mã vào trends.json (tổng {len(data['items'])} mã)")


if __name__ == "__main__":
    main()
