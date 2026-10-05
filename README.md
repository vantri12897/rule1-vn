# Rule #1 Screener VN

Lọc cổ phiếu HOSE, HNX, UPCoM theo phương pháp Phil Town (Big 5, Sticker Price, MOS Price, Payback Time, 3M).
Website tự đọc dữ liệu báo cáo tài chính và giá mới nhất mỗi khi mở.

## Các file

| File | Vai trò | Cập nhật |
|---|---|---|
| `index.html` | Website | Khi sửa giao diện |
| `rule1_data.csv` | Báo cáo tài chính (tỷ VND), tạo bằng `vn_rule1_export.py` | Vài lần mỗi năm, khi có BCTC mới |
| `prices.json` | Giá đóng cửa + thanh khoản TB 20 phiên | **Tự động** 16:30 thứ Hai–thứ Sáu |
| `update_prices.py` | Script lấy giá | — |
| `.github/workflows/prices.yml` | Lịch chạy tự động | — |

## Cập nhật giá ngay (không chờ lịch)

Vào tab **Actions → Cập nhật giá hàng ngày → Run workflow**.

## Cập nhật báo cáo tài chính

1. Chạy `vn_rule1_export.py --exchanges HOSE HNX UPCOM --refresh` trên Google Colab.
2. Upload `rule1_data.csv` mới vào repo (nút **Add file → Upload files**, ghi đè file cũ).

Giá trong `rule1_data.csv` sẽ được thay bằng giá trong `prices.json` khi mở website.
