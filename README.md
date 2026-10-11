# Rule #1 Screener VN

Lọc cổ phiếu HOSE, HNX, UPCoM theo phương pháp Phil Town (Big 5, Sticker Price, MOS Price, Payback Time, 3M).
Website tự đọc dữ liệu báo cáo tài chính và giá mới nhất mỗi khi mở.

## Các file

| File | Vai trò | Cập nhật |
|---|---|---|
| `index.html` | Website | Khi sửa giao diện |
| `rule1_data.csv` | Báo cáo tài chính (tỷ VND) + LNST 4 quý gần nhất (TTM) + số CP điều chỉnh | **Tự động** 01:00 Chủ nhật hằng tuần trong mùa BCTC (T1–5, 7–8, 10–11), ngày 1 các tháng 6, 9, 12 |
| `prices.json` | Giá đóng cửa + thanh khoản TB 20 phiên | **Tự động** 16:30 thứ Hai–thứ Sáu |
| `update_prices.py` | Script lấy giá | — |
| `.github/workflows/prices.yml` | Lịch chạy tự động | — |

## Cập nhật giá ngay (không chờ lịch)

Vào tab **Actions → Cập nhật giá hàng ngày → Run workflow**.

## Cập nhật báo cáo tài chính

Tự động theo lịch (workflow **Cập nhật BCTC**, 3 sàn chạy song song, ~4 giờ). Sàn nào lỗi hoặc thiếu dữ liệu (< 90% số mã) thì giữ dữ liệu cũ và GitHub gửi email báo.
Chạy ngay: **Actions → Cập nhật BCTC → Run workflow** (để trống ô mã).

Giá trong `rule1_data.csv` sẽ được thay bằng giá trong `prices.json` khi mở website.
