# Lặp Gallery

Trang bảng ảnh và video cá nhân chạy hoàn toàn trên máy. Chỉ cần thêm vài tệp, trang sẽ tự lặp chúng thành một bảng lớn; nội dung được đánh dấu **Đặc biệt** sẽ chiếm ô lớn hơn.

## Mở trang

Cách nhanh nhất trên Windows: bấm đúp `MO-LAP-GALLERY.bat`.

Hoặc mở terminal tại thư mục này và chạy:

```bash
npm run dev
```

Sau đó mở <http://localhost:3000/>.

## Cách dùng

1. Bấm **Thêm ảnh / video** hoặc kéo thả tệp vào trang.
2. Bấm dấu sao / **Đánh dấu** trên nội dung muốn làm nổi bật.
3. Chọn 24, 42, 72 hoặc 108 ô. Nội dung gốc sẽ tự lặp đến đủ số ô.
4. Dùng ô tìm kiếm để lọc theo tên ảnh hoặc video.

Khi một thẻ video hiện ít nhất 65% trên màn hình, trang sẽ tự phát bản xem trước không tiếng trong 4 giây. Mỗi lần chỉ có một video xem trước được phát; cuộn khỏi thẻ sẽ dừng và tua về đầu.

Nền trang có tim, cánh hoa hồng và ánh lấp lánh rơi nhẹ. Khi rê chuột trên vùng nền, một quầng sáng cùng các trái tim nhỏ sẽ bung theo con trỏ; nhấn chuột tạo một chùm tim. Có thể bật hoặc tắt toàn bộ hiệu ứng bằng nút **Hiệu ứng** cạnh phần chọn nhịp lặp. Trang tự tắt chuyển động nếu thiết bị đang bật chế độ giảm chuyển động.

Ảnh được nén nhẹ; video được giữ ở dạng tệp gốc. Trang không đặt giới hạn cứng theo dung lượng từng tệp và không gửi nội dung lên máy chủ. Trang ưu tiên lưu bằng IndexedDB trong trình duyệt; nếu hạn mức bộ nhớ lâu dài đã đầy, tệp hợp lệ vẫn được thêm để quay trong phiên hiện tại và được gắn nhãn **Chỉ trong phiên này**. Các mục tạm sẽ mất khi tải lại hoặc đóng trang. Thư viện có thể xóa từng mục hoặc xóa tất cả bằng hộp thoại xác nhận riêng.

## Kiểm tra bản dựng

```bash
npm run build
npm test
```
