# YD-English

Website tạo và chấm đề trắc nghiệm tiếng Anh từ file PDF. Chạy **miễn phí** trên Vercel (Hobby) + Supabase (Free) + Google Gemini (Free tier).

- Giáo viên upload PDF → AI tách câu hỏi, lấy đáp án từ PDF (nếu có) hoặc tự giải → giáo viên duyệt → xuất bản → nhận link.
- Học viên mở link (không cần tài khoản), làm bài trên điện thoại, nộp → xem điểm và đáp án đúng ngay.
- Giáo viên xem kết quả (tự cập nhật mỗi 5 giây), thống kê từng câu, xuất CSV, reset từng học viên hoặc cả đề.

---

## Hướng dẫn đưa website lên mạng (khoảng 20–30 phút, không cần biết lập trình)

Bạn cần 4 tài khoản miễn phí: **Google**, **GitHub**, **Supabase**, **Vercel**. Không cần thẻ thanh toán.

### Bước 1 — Lấy API key Gemini (miễn phí)
1. Vào https://aistudio.google.com/apikey, đăng nhập Google.
2. Bấm **Create API key** → copy chuỗi bắt đầu bằng `AIza…`. Giữ bí mật.

### Bước 2 — Tạo cơ sở dữ liệu Supabase
1. Vào https://supabase.com → **Start your project** → đăng nhập bằng GitHub.
2. **New project**: đặt tên `yd-english`, đặt mật khẩu database (lưu lại), Region chọn **Southeast Asia (Singapore)** → Create.
3. Khi project sẵn sàng: menu trái **SQL Editor** → **New query** → mở file `supabase/schema.sql` trong thư mục này, copy toàn bộ, dán vào → bấm **Run**. Thấy "Success" là xong.
4. Menu **Project Settings → API** (hoặc **API Keys**), copy 3 giá trị:
   - **Project URL** → dùng cho `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY` (tuyệt đối không chia sẻ)
5. (Khuyến nghị) **Authentication → Sign In / Providers → Email**: tắt **Confirm email** nếu không muốn phải xác nhận email khi tạo tài khoản giáo viên.

### Bước 3 — Đưa mã nguồn lên GitHub
1. Vào https://github.com → **New repository** → tên `yd-english`, chọn **Private** → Create.
2. Trong trang repo vừa tạo, bấm **uploading an existing file** → kéo **toàn bộ nội dung** thư mục `yd-english` (giải nén từ file zip) vào → **Commit changes**.
   (Không có thư mục `node_modules` trong zip — đúng như vậy.)

### Bước 4 — Deploy lên Vercel
1. Vào https://vercel.com → đăng nhập bằng GitHub → **Add New… → Project** → chọn repo `yd-english` → **Import**.
2. Mở mục **Environment Variables**, thêm 4 biến:

| Tên | Giá trị |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL ở Bước 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `GEMINI_API_KEY` | key `AIza…` ở Bước 1 |

3. Bấm **Deploy**, chờ 2–3 phút. Bạn nhận được địa chỉ dạng `https://yd-english-xxxx.vercel.app`.

### Bước 5 — Khai báo địa chỉ website cho Supabase
Supabase → **Authentication → URL Configuration**:
- **Site URL**: dán địa chỉ Vercel của bạn.
- **Redirect URLs**: thêm `https://<địa-chỉ-vercel>/**`.

### Bước 6 — Dùng thử
1. Mở địa chỉ Vercel → **Bắt đầu miễn phí** → tạo tài khoản giáo viên.
2. **+ Tạo đề mới** → chọn PDF → **Bắt đầu xử lý** (giữ tab mở).
3. Duyệt đề: xem các câu gắn nhãn **⚠️ Cần kiểm tra**, sửa nếu cần → **Lưu thay đổi** → **🚀 Xuất bản**.
4. Copy link (hoặc mã QR) gửi học viên.

> Lần đầu nên thử bằng một đề **có sẵn bảng đáp án** để đánh giá độ chính xác của bước tách câu.

---

## Lưu ý vận hành

- **Giới hạn AI miễn phí**: Gemini free tier giới hạn số lượt gọi mỗi phút/ngày. Khi chạm giới hạn, website tự chờ rồi chạy tiếp. Nếu hết lượt trong ngày, tiến độ được lưu trên trình duyệt — hôm sau chọn lại đúng file đó để làm tiếp, hoặc dùng chế độ **Dán nội dung (không cần AI)**. Xem hạn mức thực tế tại Google AI Studio.
- **AI chỉ dùng khi tạo đề.** Học viên làm bài và chấm điểm không tốn lượt AI.
- **Dữ liệu gửi cho Gemini free tier có thể được Google dùng để cải thiện sản phẩm** — không đưa thông tin cá nhân nhạy cảm vào đề.
- **Đáp án do AI giải không đảm bảo đúng 100%** — luôn duyệt trước khi xuất bản. Sau khi có bài nộp, xem mục **Thống kê từng câu**: câu có tỉ lệ đúng thấp bất thường có thể đang bị đặt sai đáp án; sửa rồi bấm **Chấm lại toàn bộ**.
- **File PDF không được lưu lên cloud**, chỉ nội dung câu hỏi. Nút "Xem PDF gốc" chỉ có trên máy đã upload file.
- **Supabase Free tạm dừng project sau 7 ngày không hoạt động.** File `vercel.json` đã cài một tác vụ tự động gọi `/api/cron/keepalive` mỗi ngày để tránh việc này.
- **Chống làm lại**: mỗi thiết bị/trình duyệt chỉ nộp được 1 bài cho mỗi đề cho tới khi giáo viên reset. Học viên đổi trình duyệt hoặc dùng tab ẩn danh vẫn làm lại được — bảng kết quả sẽ tô cam các bài trùng họ tên để giáo viên phát hiện.
- **Vercel Hobby** dành cho mục đích phi thương mại theo điều khoản của Vercel — kiểm tra điều khoản nếu bạn dùng cho lớp thu phí.

## Đổi model AI
Mặc định website tự chọn model Flash miễn phí (`gemini-flash-latest`, dự phòng `gemini-3-flash-preview`, `gemini-2.5-flash`). Muốn chỉ định: thêm biến `GEMINI_MODEL` trên Vercel (có thể liệt kê nhiều, cách nhau bởi dấu phẩy) rồi **Redeploy**.

## Đổi màu giao diện
Sửa các biến `--color-primary…` ở đầu file `src/app/globals.css`.

---

## Dành cho lập trình viên

```bash
npm install          # tự copy pdf.worker vào public/
cp .env.example .env.local   # điền khoá
npm run dev          # http://localhost:3000
npm test             # unit test: parser đáp án, chấm điểm, ghép cụm trang, sanitize
npm run build
```

Kiến trúc:
- `src/lib/pdf-client.ts` — đọc PDF trong trình duyệt (pdf.js), tách cụm 3 trang chồng lấn 1 trang, render JPEG nén, mỗi request < 3.8 MB.
- `src/app/api/ai/extract` — Gemini tách câu hỏi + nhận diện đáp án đánh dấu/bảng đáp án. `src/app/api/ai/solve` — Gemini giải câu chưa có đáp án (chạy 2 lượt, lệch nhau hoặc confidence < 0.8 → "Cần kiểm tra").
- `src/lib/merge.ts` — ghép kết quả các cụm, khử trùng lặp, áp bảng đáp án.
- `src/app/api/public/quiz/[slug]/*` — API cho học viên (service role, chấm ở server, không trả đáp án trước khi nộp).
- `supabase/schema.sql` — bảng, RLS (giáo viên chỉ thấy dữ liệu của mình), unique index 1 bài/thiết bị/đề.
