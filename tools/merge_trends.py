#!/usr/bin/env python3
"""Gộp kết quả phân tích trend sâu (mỗi mã một file JSON trong thư mục) vào trends.json, kiểm tra định dạng.

Cách chạy:  python3 tools/merge_trends.py trend_out/   (mỗi file {MÃ}.json)

Định dạng một mã:
{"t": "VCP", "d": "2026-10-25",
 "trends": [{"id": "01", "name": "Tài chính", "sig": "tín hiệu cụ thể, có số liệu", "r": "pos|mix|neg|na"}, ... đủ 11 mục 01–11],
 "summary": "1–3 câu kết luận",
 "src": [{"t": "tiêu đề nguồn", "u": "https://..."}]}
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
    return {"d": o.get("d") or date.today().isoformat(), "trends": out, "summary": str(o.get("summary", ""))[:600], "src": src}, t


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
