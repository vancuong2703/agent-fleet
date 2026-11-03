type NativeResult = { type: 'fleet:native-result'; requestId: string; ok: boolean; error?: string };
type NativeBridge = { postMessage: (message: unknown) => void; addEventListener: (type: 'message', callback: (event: MessageEvent<NativeResult>) => void) => void; removeEventListener: (type: 'message', callback: (event: MessageEvent<NativeResult>) => void) => void };
declare global { interface Window { chrome?: { webview?: NativeBridge }; __FLEET_DESKTOP__?: { version: string; theme?: 'system' | 'light' | 'dark'; layout?: { sidebarWidth: number; inspectorWidth: number; terminalHeight: number } } } }

export function isDesktop(): boolean { return Boolean(window.__FLEET_DESKTOP__ && window.chrome?.webview); }
export async function openLocation(location: { taskId?: string; planId?: string; relativePath?: string; action?: 'open' | 'reveal' }): Promise<void> {
  const bridge = window.chrome?.webview;
  if (!bridge || !isDesktop()) throw new Error('Mở vị trí chỉ có trong Agent Fleet Desktop. Có thể dùng nút sao chép đường dẫn.');
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (error?: string) => { clearTimeout(timer); bridge.removeEventListener('message', receive); error ? reject(new Error(error)) : resolve(); };
    const receive = (event: MessageEvent<NativeResult>) => { const result = event.data; if (result?.type === 'fleet:native-result' && result.requestId === requestId) finish(result.ok ? undefined : result.error ?? 'Không mở được vị trí.'); };
    const timer = window.setTimeout(() => finish('Ứng dụng không phản hồi yêu cầu mở vị trí.'), 10_000);
    bridge.addEventListener('message', receive);
    try { bridge.postMessage({ type: 'fleet:open-path', requestId, ...location, action: location.action ?? 'open' }); }
    catch (cause) { finish(cause instanceof Error ? cause.message : String(cause)); }
  });
}

export async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard chưa sẵn sàng.');
  await navigator.clipboard.writeText(value);
}
