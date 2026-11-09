import { useEffect, useRef, useState } from 'react';
import type { LeaderGuide } from '../../../shared/leader-guide.js';
import type { ConnectedClient } from '../api.js';
import { api } from '../api.js';
import { copyText } from '../desktop.js';
import { Icon } from '../components/Icon.js';
import { Logo, Notice, PageHead } from './Common.js';
import { useLanguage } from './language.js';

export function Guide() {
  const { t } = useLanguage();
  const [guide, setGuide] = useState<LeaderGuide | null>(null);
  const [clients, setClients] = useState<ConnectedClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const preview = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setGuide(null);

    void api.leaderGuide().then(
      (value) => {
        if (!cancelled) setGuide(value);
      },
      (cause) => {
        if (!cancelled) setError(String(cause));
      },
    );

    const fetchConnections = () => {
      void api.connections().then(
        (list) => {
          if (!cancelled) setClients(list);
        },
        () => {
          // Keep previous connections state if background poll fails
        },
      );
    };

    fetchConnections();
    const interval = setInterval(fetchConnections, 3000);

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
      setError(
        t(
          'Clipboard unavailable. Select the content below and press Ctrl+C.',
          'Chưa sao chép được. Chọn nội dung bên dưới rồi nhấn Ctrl+C.',
        ),
      );
      preview.current?.focus();
      preview.current?.select();
    }
  };

  const isKnownAgent = (id: string): id is 'agy' | 'codex' | 'qodercli' | 'opencode' =>
    id === 'agy' || id === 'codex' || id === 'qodercli' || id === 'opencode';

  return (
    <div className="wrap guide-page" data-page="guide">
      <PageHead
        title="LEAD"
        accent="ER"
        label={t('Leader guide', 'Hướng dẫn leader')}
        eyebrow={t('Connect & dispatch', 'Kết nối & giao việc')}
        actions={
          <button className="btn primary" disabled={!guide} onClick={() => guide && void copy(guide.content)}>
            <Icon name="copy" size={14} />
            {t('Copy for conversation', 'Sao chép gửi hội thoại')}
          </button>
        }
      />
      {error && <Notice message={error} error onRetry={!guide ? () => setAttempt((value) => value + 1) : undefined} />}
      {copied && (
        <Notice
          message={t(
            'Copied. Paste into your leader conversation.',
            'Đã sao chép. Dán vào hội thoại với leader.',
          )}
        />
      )}
      <div className="guide-steps">
        <div>
          <b>01</b>
          {t('Copy the guide', 'Sao chép hướng dẫn')}
        </div>
        <div>
          <b>02</b>
          {t('Paste into your leader conversation', 'Dán vào hội thoại với leader')}
        </div>
        <div>
          <b>03</b>
          {t('Dispatch and review in the app', 'Giao việc và duyệt trong app')}
        </div>
      </div>
      {guide ? (
        <>
          <section className="panel guide-connection">
            <div>
              <h4>{t('Current connection', 'Kết nối hiện tại')}</h4>
              <strong>{guide.baseUrl}</strong>
              <p className="mono small muted">{guide.dataDir}</p>
            </div>
            <button className="btn" onClick={() => void copy(guide.connect)}>
              <Icon name="terminal" size={15} />
              {t('Copy connection commands', 'Sao chép lệnh kết nối')}
            </button>
          </section>

          <section className="panel guide-connected-tools">
            <div className="guide-connected-head">
              <h4>
                {t('Connected tools', 'Công cụ đang kết nối')} ({clients.length})
              </h4>
            </div>
            {clients.length === 0 ? (
              <p className="muted small">
                {t(
                  'No tools connected yet. Run connection commands in your terminal or agent.',
                  'Chưa có công cụ nào kết nối. Chạy lệnh kết nối trong terminal hoặc agent của bạn.',
                )}
              </p>
            ) : (
              <div className="guide-connected-list">
                {clients.map((client) => {
                  const isActive = Date.now() - client.lastSeenAt < 5 * 60_000;
                  return (
                    <div key={client.id} className="guide-connected-item">
                      <span className="row">
                        {isKnownAgent(client.toolId) ? (
                          <Logo agent={client.toolId} small />
                        ) : (
                          <Icon name="terminal" size={14} />
                        )}
                        <b>{client.toolName}</b>
                      </span>
                      <span className="mono small muted">PID {client.pid ?? '—'}</span>
                      <code className="mono small muted conn-cmd-inline" title={client.lastCommand}>
                        {client.lastCommand}
                      </code>
                      <span className={`badge ${isActive ? 'ok' : 'plain'}`}>
                        {isActive ? t('Active', 'Đang kết nối') : t('Idle', 'Đã kết nối')}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel fill guide-content">
            <h4>
              <label htmlFor="leader-content">{t('Content for your leader', 'Nội dung gửi cho leader')}</label>
            </h4>
            <textarea id="leader-content" ref={preview} readOnly spellCheck={false} value={guide.content} />
          </section>
        </>
      ) : (
        !error && <p role="status">{t('Loading connection guide…', 'Đang tải hướng dẫn kết nối…')}</p>
      )}
    </div>
  );
}
