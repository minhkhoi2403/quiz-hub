# Quiz Hub

Ứng dụng tiếng Việt để tự tạo bài học, học bằng câu hỏi và luyện quiz. Node.js 24 + Express; PostgreSQL cho Docker; SQLite cho chạy trực tiếp trên máy.

## Chạy ngay trên máy

### Mở bằng shortcut trên Windows

Nhấp đúp **Mo Quiz Hub** trên Desktop để chạy server ngầm và mở trình duyệt. Nhấp **Dung Quiz Hub** để dừng server. Đóng tab trình duyệt không dừng server; nhấp nút mở nhiều lần sẽ dùng lại server đang chạy. Hai shortcut trỏ tới `scripts/desktop.vbs` và `scripts/desktop.ps1`, vì vậy hãy giữ nguyên vị trí thư mục dự án. Log nằm tại `data/server.log` và `data/server-error.log`.

### Chạy bằng terminal

Yêu cầu Node.js 24 trở lên. Mở terminal tại thư mục dự án:

```powershell
npm ci
node scripts/setup.mjs
npm start
```

Truy cập **http://localhost:3100** và chọn **Tạo tài khoản**. Không có tài khoản quản trị hay mật khẩu mặc định. Có nút tạo bài mẫu trong thư viện trống. SQLite tự tạo tại `data/quizhub.db`; giữ thư mục này để giữ tài khoản, bài và lịch sử. Dừng bằng Ctrl+C.

Trong lần bàn giao này server được chạy nền trên Windows. PID nằm trong `data/server.pid`, log ở `data/server.log` và `data/server-error.log`. Để dừng đúng tiến trình nền trước khi chuyển sang Docker hoặc khởi động lại:

```powershell
$quizPid = [int](Get-Content data/server.pid)
$quizProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $quizPid"
if ($quizProcess.Name -eq 'node.exe' -and $quizProcess.CommandLine -like '*server/index.js*') {
    Stop-Process -Id $quizPid
}
```

Script setup tạo `.env` và mật khẩu PostgreSQL ngẫu nhiên, không ghi đè cấu hình đã tồn tại. `.env` và dữ liệu không được đưa vào Git hoặc Docker image.

## Chạy nhiều người dùng bằng Docker + PostgreSQL

Cài và khởi động Docker Desktop (Linux containers) hoặc Docker Engine cùng Compose trên server. Máy triển khai hiện tại chưa cài Docker, vì vậy cấu hình container đã được chuẩn bị nhưng chưa chạy được ở đây.

```powershell
node scripts/setup.mjs
docker compose up -d --build
docker compose ps
```

Compose tạo hai container `web`, `db`, database `quizhub`, schema và volume `postgres_data`. Database không mở cổng ra ngoài; ứng dụng mở cổng 3100. Dữ liệu vẫn giữ khi container được tạo lại.

Nếu đang chạy `npm start` ở cổng 3100, dừng tiến trình đó trước khi chạy Compose. Dữ liệu SQLite khi chạy trực tiếp và PostgreSQL trong Docker là hai database độc lập; ứng dụng không tự chuyển dữ liệu giữa chúng.

```powershell
docker compose logs --tail 100 web
docker compose stop
docker compose up -d
```

Không dùng `docker compose down -v` nếu muốn giữ dữ liệu: tùy chọn `-v` xóa volume database.

### Truy cập từ máy khác

- Trong mạng nội bộ, đặt `APP_ORIGIN=http://DIA_CHI_IP_SERVER:3100` trong `.env`, chạy lại container và mở đúng URL đó trên các máy khách. Cổng 3100 phải được cho phép trong firewall theo cấu hình mạng của bạn.
- Trên Internet, trỏ tên miền vào server và dùng reverse proxy HTTPS như Caddy/Nginx. Đặt `APP_ORIGIN=https://ten-mien-cua-ban`, `COOKIE_SECURE=true`. Chỉ đặt `TRUST_PROXY=1` khi có đúng một reverse proxy đáng tin cậy và cổng ứng dụng chỉ nhận từ proxy đó.
- Một `APP_ORIGIN` được cho phép cho thao tác ghi. Dùng nhất quán hostname cấu hình; `localhost` và `127.0.0.1` là hai origin khác nhau.
- Bản này chạy một instance ứng dụng với connection pool PostgreSQL 10 kết nối, phù hợp điểm khởi đầu cho nhiều người dùng. Chưa đo tải đồng thời. Nếu nhân nhiều replica cần bổ sung rate limit dùng chung (Redis) và giới hạn công việc AI dùng chung.

### Sao lưu PostgreSQL

Xuất bản sao vào container rồi copy ra máy, tránh lỗi mã hóa khi redirect dữ liệu qua PowerShell:

```powershell
docker compose exec -T db pg_dump -U quizhub -d quizhub -Fc -f /tmp/quizhub.dump
docker compose cp db:/tmp/quizhub.dump ./quizhub-backup.dump
```

Giữ file backup ở nơi riêng tư. Để phục hồi, copy file vào container và dùng `pg_restore` vào database đích phù hợp. Hãy sao lưu trước khi phục hồi đè dữ liệu.

## Cấu hình AI

Thêm API key riêng trong `.env`:

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

Sau khi sửa, khởi động lại `npm start` hoặc chạy `docker compose up -d`. Model phải hỗ trợ ảnh và Structured Outputs trên Responses API, có quyền truy cập trong tài khoản API của bạn. Chi phí API tính cho chủ API key. Key chỉ được đọc phía server, không gửi xuống trình duyệt.

Trong **Tạo bài học → Tạo bằng AI**:

1. Chọn ảnh JPG, PNG, WebP hoặc ZIP chứa ảnh; cũng có thể chỉ nhập prompt.
2. Nhập yêu cầu và số câu mong muốn nếu tạo câu mới.
3. Bấm **Tạo câu hỏi**. Ảnh và prompt được gửi đến OpenAI; server yêu cầu `store: false` và không lưu ảnh nguồn xuống disk/database.
4. Kiểm tra đề, lựa chọn và đáp án, sửa nếu cần rồi **Lưu bài học**.

Bạn cũng có thể dán đề vào ô **Văn bản nguồn**, không cần ảnh hoặc prompt. Ví dụ:

```text
Câu 1: 2 + 3 bằng bao nhiêu?
A. 4
B. 5
C. 6
D. 7

Câu 2: Thủ đô của Việt Nam là gì?
A. Hà Nội
B. Huế
C. Đà Nẵng
D. Cần Thơ
```

AI được yêu cầu giữ nguyên thứ tự câu và các lựa chọn; giữ đáp án nếu nguồn có ghi, hoặc đề xuất đáp án kèm giải thích nếu chưa có. Bạn kiểm tra và sửa bằng nút tròn bên cạnh đáp án rồi lưu bài. Nếu dán đoạn kiến thức chưa có câu hỏi, AI tạo câu mới theo số lượng đã chọn. Văn bản nguồn tối đa 60.000 ký tự, tổng mỗi bài tối đa 500 câu; chia đề dài thành nhiều đợt nhập. Văn bản được gửi tới OpenAI khi bấm tạo và vẫn cần API key có hạn mức.

Ảnh có câu A–D: yêu cầu AI chép đúng 4 lựa chọn và frontend hiển thị đúng mảng lựa chọn nhận được, không đệm thêm E/F. Các câu có số lựa chọn khác nhau được hỗ trợ (2–8). AI có thể đọc nhầm hoặc suy luận sai nên cần kiểm tra trước khi lưu. Câu phụ thuộc hình vẽ phải được diễn đạt bằng văn bản đầy đủ, nếu không AI được yêu cầu bỏ qua kèm cảnh báo; bản này không đính kèm hình nguồn vào từng câu hỏi.

Giới hạn: 20 ảnh, 10 MB mỗi tệp, 30 MB tổng upload/giải nén, 25 triệu pixel/ảnh; ZIP không mật khẩu, tối đa 200 entry, không hỗ trợ ZIP lồng nhau. Ảnh được kiểm tra, xoay và chuẩn hóa trước khi gửi. Không giải nén thành file trên disk. Mỗi tài khoản tối đa 10 lần tạo mỗi giờ. Server xử lý tối đa 2 yêu cầu AI đồng thời và 1 yêu cầu/tài khoản. Chờ AI tối đa 120 giây.

Tích hợp dựa trên [tài liệu Responses API chính thức](https://developers.openai.com/api/reference/resources/responses/methods/create). Kiểm thử AI hiện dùng response giả lập; chưa gọi API thực tế vì chưa có key.

## Các chức năng

### Thi thử theo môn

Trong thư viện, bấm **Thi thử theo môn**, hoặc chọn một môn rồi bấm **Thi thử môn này**. Chọn số câu (1–500, không vượt số câu hiện có của môn) và thời gian (1–180 phút). Hệ thống lấy ngẫu nhiên không lặp từ tất cả bài trong môn của tài khoản hiện tại; các câu giống hệt đề, lựa chọn và đáp án được gộp trước khi lấy mẫu.

Lượt thi lưu riêng đề đã lấy và thời hạn trên server. Đáp án tự lưu mỗi lần chọn, có thể sửa hoặc bỏ lựa chọn, bỏ qua câu và quay lại. Đáp án đúng, giải thích và điểm được giữ kín cho đến khi nộp bài hoặc hết giờ. Câu nhiều đáp án chỉ đúng khi chọn đủ và không chọn thừa. Câu chưa trả lời tính chưa đúng.

Rời trang hoặc tải lại không dừng thời gian; vào **Lịch sử luyện tập → Tiếp tục** để trở lại. Khi hết giờ, server khóa đáp án và chốt theo thời hạn, kể cả nếu trình duyệt đóng hoặc mất mạng; trạng thái được cập nhật khi truy cập lại. Khi mất mạng, lựa chọn chưa được server xác nhận không được tính là đã lưu. Không có gia hạn thời gian do mất mạng. Thi thử là công cụ tự học, không phải hệ thống giám sát thi.

Lịch sử thi thử nằm chung với lịch sử quiz và có nhãn **Thi thử · Tên môn**. Chỉnh sửa hoặc xóa bài nguồn không làm thay đổi lượt thi đã tạo; xóa môn/học kỳ sẽ xóa lịch sử thi thử thuộc môn đó.

### Nhập đề không cần AI

Vào **Tạo/chỉnh sửa bài → Nhập văn bản**, dán đề rồi bấm **Tách câu hỏi (không AI)**. Bộ tách chạy trong trình duyệt, không gọi OpenAI/Gemini. Mỗi câu bắt đầu bằng `Question 1:` hoặc `Câu 1:` trên một dòng riêng, tiếp theo các lựa chọn `A.`, `B.`, `C.`, `D.` (cũng nhận `A)` hoặc nhãn A riêng một dòng). Dòng `Answer: B` / `Đáp án: B` xác định đáp án; `Answer: AB` hoặc `Answer: A, C` xác định nhiều đáp án. Có thể thêm `Explanation:` hoặc `Giải thích:`.

Đáp án thiếu, ngoài phạm vi hoặc mô tả mơ hồ được đánh dấu, không suy luận hay mặc định chọn A; phải chọn lại trước khi lưu. Câu sai cấu trúc sẽ báo số câu cần sửa và không nhập dở dang. Mỗi lần dán tối đa 100 câu và 200.000 ký tự; các đợt nhập được cộng dồn vào cùng bài, tối đa 500 câu/bài. Có thể lưu rồi mở chỉnh sửa để nhập tiếp. Bộ tách không xác minh tính đúng của kiến thức trong đáp án nguồn.

Câu nhiều đáp án hỗ trợ cả sửa bài, học, làm quiz và lịch sử. Chấm theo tập đáp án chính xác, không tính điểm một phần. Dữ liệu bài và lượt làm cũ có một đáp án vẫn tương thích.

- Đăng ký, đăng nhập, đăng xuất; mật khẩu hash bằng scrypt và salt; session HttpOnly/SameSite lưu trong DB, hết hạn sau 30 ngày.
- Mỗi tài khoản chỉ truy cập được học kỳ, môn, bài và lượt quiz của chính mình. Chưa có chia sẻ bài, xác minh email hoặc khôi phục mật khẩu qua email.
- Thêm, đổi tên, xóa học kỳ và môn; thêm/sửa/xóa bài, tối đa 500 câu/bài. Xóa nội dung sẽ xóa cả dữ liệu con và lịch sử liên quan, có hộp thoại xác nhận.
- Mỗi câu có đề, 2–8 lựa chọn, một hoặc nhiều đáp án đúng, giải thích tùy chọn. Phần AI hiện tạo câu một đáp án; nhập văn bản và trình sửa hỗ trợ nhiều đáp án.
- **Học bài**: hiện toàn bộ câu hỏi với lựa chọn ở dưới; hiện/ẩn đáp án riêng hoặc **hiện/ẩn tất cả đáp án** bằng một nút cho toàn bài. Bảng chọn số câu cố định bên phải giúp nhảy đến từng câu và đánh dấu câu đang đọc. Bấm **Ẩn bảng câu hỏi** để thu gọn thành nút **Hiện câu hỏi** ở mép phải; có thể mở lại ở bất kỳ vị trí cuộn nào mà không trở về đầu trang.
- **Làm quiz**: trước khi bắt đầu, có thể bật **Trộn thứ tự câu hỏi**; thứ tự được lưu theo lượt làm và không đổi khi tiếp tục. Không trộn các lựa chọn A/B/C/D hoặc thay thứ tự bài gốc.
- Nút tiến ở dưới câu hỏi gộp kiểm tra và đi tiếp: chưa chọn đáp án → bỏ qua; đã chọn → kiểm tra, hiện đúng/sai và giữ nguyên câu; bấm lần nữa → sang câu sau. Câu cuối được kiểm tra trước, lần bấm tiếp theo mở xác nhận kết thúc. Có thể quay lại hoặc chọn số câu. Câu đã chấm được khóa để giữ tính chính xác của lịch sử.
- Lưu câu trả lời sau từng lần chấm; có thể rời trang và tiếp tục từ thư viện/lịch sử. Lựa chọn chưa bấm kiểm tra chưa được lưu.
- Kết thúc bài: chấm điểm phía server, câu bỏ qua tính chưa đúng; xem lại hoặc bắt đầu lượt mới. Lịch sử hiển thị tối đa 200 lượt mới nhất.
- Lượt làm bài giữ snapshot câu hỏi nên chỉnh sửa bài không làm đổi kết quả cũ. Các cập nhật đồng thời dùng version để tránh ghi đè tiến độ.

## Kiểm thử

```powershell
npm run check
npm test
npm audit
```

Các bài test dùng database riêng, không sửa dữ liệu thật. Kiểm tra đăng nhập, phân quyền, CSRF origin, validate lựa chọn, quiz bỏ qua/quay lại, lưu kết quả, snapshot, concurrent updates, ảnh lỗi, ZIP và cấu trúc AI. PostgreSQL/Docker cần kiểm thử thêm trên máy có Docker; chưa có kiểm thử tải hoặc gọi AI thật.

## Cấu trúc

```text
server/          API, xác thực, database và xử lý AI/ZIP
public/          Giao diện HTML/CSS/JavaScript tiếng Việt
tests/           Kiểm thử API và nhập ảnh
scripts/         Thiết lập .env
Dockerfile       Image chạy server không dùng root
compose.yaml     PostgreSQL + server + health checks + volume
.env.example     Các biến cấu hình, không chứa key thật
```
