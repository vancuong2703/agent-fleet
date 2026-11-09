import { useEffect, useState } from 'react';
import type { ConnectedClient } from '../api.js';
import type { LeaderGuide } from '../../../shared/leader-guide.js';
import { api } from '../api.js';
import { copyText } from '../desktop.js';
import { Icon } from '../components/Icon.js';
import { Logo, Notice, PageHead } from './Common.js';
import { useLanguage } from './language.js';
import { clock } from './model.js';

export function Connections() {
  const { t } = useLanguage();
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [guide, setGuide] = useState<LeaderGuide | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchGuide = async () => {
      try {
        const data = await api.leaderGuide();
        if (!cancelled) setGuide(data);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    };

    const fetchConnections = async () => {
      try {
        const list = await api.connections();
        if (!cancelled) {
          setClients(list);
          setLoaded(true);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    };

    void fetchGuide();
    void fetchConnections();

    const interval = setInterval(() => {
      void fetchConnections();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [attempt]);

  const copy = async (text: string) => {
    setError(null);
    setCopied(false);
    try {
      await copyText(text);
      setCopied(true);
    } catch {
      setError(t('Clipboard unavailable. Select the content manually.', 'Chưa sao chép được. Vui lòng chọn và sao chép thủ công.'));
    }
  };

  const isKnownAgent = (id: string): id is 'agy' | 'codex' | 'qodercli' | 'opencode' =>
    id === 'agy' || id === 'codex' || id === 'qodercli' || id === 'opencode';

  return (
    <div className="wrap connections-page" data-page="connections">
      <PageHead
        title="CONN"
        accent="ECTED"
        label={t('Connected tools', 'Công cụ kết nối')}
        eyebrow={t('Live CLI & leader sessions', 'Phiên CLI & leader đang kết nối')}
        actions={
          <>
            <button className="btn" onClick={() => setAttempt((value) => value + 1)}>
              <Icon name="refresh" size={14} />
              {t('Refresh', 'Làm mới')}
            </button>
            <button className="btn" disabled={!guide} onClick={() => guide && void copy(guide.connect)}>
              <Icon name="terminal" size={14} />
              {t('Copy connection commands', 'Sao chép lệnh kết nối')}
            </button>
          </>
        }
      />

      {error && <Notice message={error} error onRetry={() => setAttempt((value) => value + 1)} />}
      {copied && <Notice message={t('Copied connection commands to clipboard.', 'Đã sao chép lệnh kết nối vào bộ nhớ tạm.')} />}

      {guide && (
        <section className="panel guide-connection">
          <div>
            <h4>{t('Server session', 'Phiên máy chủ')}</h4>
            <strong>{guide.baseUrl}</strong>
            <p className="mono small muted">{guide.dataDir}</p>
          </div>
          <div className="conn-stat">
            <span className="muted">{t('Connected tools', 'Tổng số công cụ đã kết nối')}:</span>{' '}
            <strong>{clients.length}</strong>
          </div>
        </section>
      )}

      {loaded && clients.length === 0 && (
        <section className="panel conn-empty">
          <p>
            {t(
              'No tools have sent commands to this Fleet session yet. Copy connection commands and run in Antigravity, Codex, Qoder, OpenCode or PowerShell to see them appear here.',
              'Chưa có công cụ nào gửi lệnh tới phiên Fleet này. Sao chép lệnh kết nối và chạy trong Antigravity, Codex, Qoder, OpenCode hoặc PowerShell để thấy công cụ xuất hiện tại đây.'
            )}
          </p>
          {guide && (
            <button className="btn primary" onClick={() => void copy(guide.connect)}>
              <Icon name="terminal" size={14} />
              {t('Copy connection commands', 'Sao chép lệnh kết nối')}
            </button>
          )}
        </section>
      )}

      {clients.length > 0 && (
        <div className="conn-grid">
          {clients.map((client) => {
            const isActive = Date.now() - client.lastSeenAt < 5 * 60_000;
            return (
              <section key={client.id} className="conn-card panel">
                <div className="conn-header">
                  <div className="conn-title-group">
                    {isKnownAgent(client.toolId) ? (
                      <Logo agent={client.toolId} />
                    ) : (
                      <span className="tool-logo">
                        <Icon name="terminal" size={20} />
                      </span>
                    )}
                    <h3>{client.toolName}</h3>
                  </div>
                  {isActive ? (
                    <span className="badge ok">{t('Active', 'Đang kết nối')}</span>
                  ) : (
                    <span className="badge plain">{t('Idle', 'Đã kết nối')}</span>
                  )}
                </div>
                <div className="conn-meta">
                  <div className="conn-row">
                    <span className="conn-label">{t('Last command', 'Lệnh gần nhất')}</span>
                    <code className="mono conn-cmd" title={client.lastCommand}>
                      {client.lastCommand}
                    </code>
                  </div>
                  <div className="conn-row">
                    <span className="conn-label">{t('Working directory', 'Thư mục')}</span>
                    <code className="mono conn-cwd" title={client.cwd ?? undefined}>
                      {client.cwd ?? '—'}
                    </code>
                  </div>
                  <div className="conn-row">
                    <span className="conn-label">{t('PID & Requests', 'PID & Số lệnh')}</span>
                    <span>
                      PID {client.pid ?? '—'} · {client.requestCount} {t('requests', 'lệnh')}
                    </span>
                  </div>
                  <div className="conn-row">
                    <span className="conn-label">{t('Last seen', 'Gọi lúc')}</span>
                    <span>{clock(client.lastSeenAt)}</span>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
