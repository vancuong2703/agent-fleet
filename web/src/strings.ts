/**
 * Chuỗi giao diện dùng chung cho toàn app.
 *
 * T6 đặt chuỗi của dải "Nên dùng ngay" ở đây; T12 mở rộng ra các màn còn lại.
 * Quy ước ngôn ngữ: task → công việc, Log → Nhật ký, Diff → Thay đổi,
 * Brief → Yêu cầu, Local workspace → Máy cục bộ, LIVE → Trực tiếp,
 * `file_edit` → Sửa tệp. Giữ nguyên tên agent, Git, Merge, CPU, RAM, GPU.
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

/** Nhãn hiển thị cho từng loại sự kiện trong Nhật ký. */
export const eventKindLabels = {
  message: 'Tin nhắn',
  command: 'Lệnh',
  file_edit: 'Sửa tệp',
  tool: 'Công cụ',
  usage: 'Mức sử dụng',
  model: 'Model',
  session: 'Phiên',
  error: 'Lỗi',
  raw: 'Dữ liệu thô',
  status: 'Trạng thái',
  check: 'Kiểm tra',
} as const;

export type EventKind = keyof typeof eventKindLabels;

/** Tên hiển thị của một loại sự kiện; kind lạ vẫn đọc được thay vì rỗng. */
export function eventKindLabel(kind: string): string {
  return eventKindLabels[kind as EventKind] ?? kind;
}

/** Nhãn tab Thay đổi, tách riêng để `diffBadge` dùng lại đúng một nguồn. */
const appTabDiff = 'Thay đổi';

export const appStrings = {
  tabs: {
    log: 'Nhật ký',
    diff: 'Thay đổi',
    brief: 'Yêu cầu',
  },
  tabNotes: {
    log: 'Hoạt động trực tiếp',
    diff: 'Thay đổi trong worktree',
    brief: 'Nội dung giao việc',
  },
  newTask: 'Công việc mới',
  createFirstTask: 'Tạo công việc đầu tiên',
  searchPlaceholder: 'Tìm công việc, dự án...',
  searchLabel: 'Tìm công việc hoặc dự án',
  localWorkspace: 'Máy cục bộ',
  live: 'Trực tiếp',
  usageTitle: 'Tài nguyên & sử dụng',
  workspaceFallback: 'Không gian làm việc',
  tasksDone: (count: number) => `${count} công việc hoàn tất`,
  /** Nhãn tab Thay đổi: chỉ hiện số khi đã đọc xong, tránh "Thay đổi (0)" giả. */
  diffBadge: (loaded: boolean, fileCount: number) => (loaded ? `${appTabDiff} (${fileCount})` : appTabDiff),
  log: {
    empty: 'Chưa có sự kiện.',
    loading: 'Đang tải nhật ký...',
    error: (detail: string) => `Không tải được nhật ký: ${detail}`,
    attempt: (attempt: number) => `lần ${attempt}`,
    rawToggle: (count: number) => `... ${count} dòng dữ liệu thô`,
    rawKind: eventKindLabels.raw,
  },
  brief: {
    empty: 'Chưa có yêu cầu.',
    original: 'Yêu cầu gốc',
    note: (attempt: number) => `Ghi chú lần thử ${attempt}`,
  },
  sidebar: {
    emptySearch: 'Không tìm thấy công việc phù hợp.',
    emptyRunning: 'Không có công việc nào đang chạy.',
    emptyWaiting: 'Không có công việc nào đang chờ.',
    emptyFailed: 'Không có công việc nào lỗi.',
    emptyAll: 'Chưa có dự án. Tạo công việc để bắt đầu.',
  },
  usage: {
    viewTask: 'Xem công việc',
  },
  inspector: {
    chooseTask: 'Chọn công việc để xem model và hoạt động hiện tại.',
    pathHint: 'Đường dẫn repo và worktree của công việc sẽ xuất hiện ở đây.',
  },
  keyPool: {
    /** Dấu phân cách giữa hạn mức và lý do pool tắt, tránh dính chữ. */
    reasonSeparator: ' · ',
  },
} as const;
