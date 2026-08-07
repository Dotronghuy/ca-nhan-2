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

Ảnh được nén nhẹ; video được giữ ở dạng tệp gốc. Cả hai được lưu bằng IndexedDB trong chính trình duyệt đang dùng và không được gửi lên máy chủ. Ảnh tối đa 25 MB/tệp, video tối đa 200 MB/tệp.

## Kiểm tra bản dựng

```bash
npm run build
npm test
```
