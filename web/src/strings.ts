/**
 * Chuỗi giao diện của dashboard.
 *
 * T6 chỉ đặt ở đây chuỗi của dải "Nên dùng ngay"; T12 sẽ mở rộng file này ra
 * các màn khác. Không thêm chuỗi của component ngoài dashboard vào đây, và
 * không đổi nội dung chuỗi mà test đang khẳng định nếu không sửa cả test.
 */
export const dashboardStrings = {
  picks: {
    title: 'Nên dùng ngay',
    ariaLabel: 'Gợi ý dùng ngay',
    empty: 'Chưa có gợi ý nào. Kiểm tra một công cụ để đọc hạn mức và model miễn phí.',
    hint: 'bấm để dùng',
    /** Nhãn đầy đủ cho trình đọc màn hình khi gợi ý là một tool. */
    openCli: (title: string) => `Mở CLI ${title}`,
    /** Nhãn ngắn hiện trên nút. */
    openCliShort: 'Mở CLI',
    /** Nhãn đầy đủ khi gợi ý là một model: sao chép cờ model. */
    copyModel: (command: string) => `Sao chép lệnh ${command}`,
    copyShort: 'Sao chép --model',
    copied: (command: string) => `Đã sao chép ${command}`,
    /** Không sao chép được thì vẫn phải đọc được lệnh để gõ tay. */
    copyFailed: (command: string) => `Không sao chép được. Lệnh cần dùng: ${command}`,
    warning: 'Cảnh báo',
  },
} as const;
