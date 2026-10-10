#!/usr/bin/env python3
"""Gộp kết quả BCTC của từng sàn thành rule1_data.csv, có kiểm tra an toàn.

Sàn nào có dữ liệu mới đạt ≥ 90% số mã của bản cũ thì thay bằng dữ liệu mới;
không đạt (lỗi, bị chặn, chạy dở) thì GIỮ dữ liệu cũ của sàn đó.
Thoát mã 1 nếu có sàn phải giữ dữ liệu cũ, để GitHub gửi email báo.
"""
import csv, json, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PART_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else "parts")
OUT = Path("rule1_data.csv")
META = Path("fundamentals_meta.json")
EXCH = {"HOSE": "HOSE", "HNX": "HNX", "UPCOM": "UPCoM"}
MIN_RATIO = 0.90


def read(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rd = csv.DictReader(fh)
        return rd.fieldnames, list(rd)


old_cols, old_rows = read(OUT) if OUT.exists() else (None, [])
new_cols, out_rows, report, failed = None, [], {}, []
for key, ex in EXCH.items():
    old_ex = [r for r in old_rows if r.get("exchange") == ex]
    n_old = len({r["ticker"] for r in old_ex})
    part = PART_DIR / f"part_{key}.csv"
    if part.exists():
        cols, rows = read(part)
        n_new = len({r["ticker"] for r in rows})
    else:
        cols, rows, n_new = None, [], 0
    if n_new and n_new >= MIN_RATIO * n_old:
        new_cols = new_cols or cols
        out_rows += rows
        report[ex] = {"status": "updated", "tickers": n_new, "previous": n_old}
    else:
        out_rows += old_ex
        failed.append(ex)
        report[ex] = {"status": "kept_old", "tickers_new": n_new, "previous": n_old}

cols = new_cols or old_cols
if not cols or not out_rows:
    sys.exit("Không có dữ liệu để ghi.")
with open(OUT, "w", newline="", encoding="utf-8-sig") as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in out_rows:
        w.writerow({c: r.get(c, "") for c in cols})

now = datetime.now(timezone(timedelta(hours=7))).isoformat(timespec="minutes")
prev = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}
meta = {"updated": now if len(failed) < 3 else prev.get("updated"), "checked": now, "exchanges": report}
META.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(meta, ensure_ascii=False, indent=1))
if failed:
    print("Giữ dữ liệu cũ cho:", ", ".join(failed))
    sys.exit(1)
