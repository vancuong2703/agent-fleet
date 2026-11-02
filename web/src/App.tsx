import { useEffect, useMemo, useState } from 'react';

import type { Run } from '../../shared/types.js';
import { LogView } from './components/LogView.js';
import { Sidebar } from './components/Sidebar.js';
import { TaskHeader } from './components/TaskHeader.js';
import { taskCounts, useFleet } from './store.js';

const EMPTY_RUNS: Run[] = [];

type View = 'tasks' | 'compare';
type Tab = 'log' | 'diff' | 'brief';

export function App() {
  const { state, connected, error, loadEvents } = useFleet();
  const [view, setView] = useState<View>('tasks');
  const [tab, setTab] = useState<Tab>('log');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { plans, tasks } = state;
  const counts = useMemo(() => taskCounts(tasks), [tasks]);

  useEffect(() => {
    if (selectedTaskId === null && tasks.length > 0) setSelectedTaskId(tasks[0]!.id);
  }, [tasks, selectedTaskId]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const runs = selectedTask ? state.runsByTask[selectedTask.id] ?? EMPTY_RUNS : EMPTY_RUNS;
  const latestRun = runs.length > 0 ? runs[runs.length - 1]! : null;

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (selectedRunId === null || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[runs.length - 1]!.id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (selectedRunId !== null) loadEvents(selectedRunId);
  }, [selectedRunId, loadEvents]);

  const events = selectedRunId !== null ? state.eventsByRun[selectedRunId] ?? [] : [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Agent fleet</div>
        <nav className="tabs">
          <button
            type="button"
            className={`tab${view === 'tasks' ? ' active' : ''}`}
            onClick={() => setView('tasks')}
          >
            Tasks
          </button>
          <button
            type="button"
            className={`tab${view === 'compare' ? ' active' : ''}`}
            onClick={() => setView('compare')}
          >
            So sánh agent
          </button>
        </nav>
        <div className="counts">
          <span className="count">
            <b>{counts.running}</b> đang chạy
          </span>
          <span className="sep">·</span>
          <span className="count">
            <b>{counts.waiting}</b> chờ
          </span>
          <span className="sep">·</span>
          <span className="count">
            <b>{counts.done}</b> xong
          </span>
        </div>
        <div
          className={`connection${connected ? ' on' : ''}`}
          title={connected ? 'Đã kết nối' : 'Mất kết nối'}
        >
          {connected ? '●' : '○'}
        </div>
      </header>

      {view === 'compare' ? (
        <main className="main standalone">
          <h2>So sánh agent</h2>
          <p className="muted">Trang so sánh agent sẽ có ở bước sau.</p>
        </main>
      ) : (
        <div className="body">
          <Sidebar
            plans={plans}
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelect={(taskId) => {
              setSelectedTaskId(taskId);
              setSelectedRunId(null);
              setTab('log');
            }}
          />
          <main className="main">
            {error !== null && (
              <div className="banner banner-error">Không tải được dữ liệu: {error}</div>
            )}
            {selectedTask === null ? (
              <div className="empty-state">Chọn một task ở cột bên trái.</div>
            ) : (
              <>
                <TaskHeader task={selectedTask} run={latestRun} />
                <div className="task-tabs">
                  <button
                    type="button"
                    className={`tab${tab === 'log' ? ' active' : ''}`}
                    onClick={() => setTab('log')}
                  >
                    Log
                  </button>
                  <button
                    type="button"
                    className={`tab${tab === 'diff' ? ' active' : ''}`}
                    onClick={() => setTab('diff')}
                  >
                    Diff
                  </button>
                  <button
                    type="button"
                    className={`tab${tab === 'brief' ? ' active' : ''}`}
                    onClick={() => setTab('brief')}
                  >
                    Brief
                  </button>
                </div>
                {tab === 'log' ? (
                  <LogView
                    runs={runs}
                    events={events}
                    runId={selectedRunId}
                    onSelectRun={setSelectedRunId}
                  />
                ) : (
                  <div className="placeholder">
                    {tab === 'diff'
                      ? 'Diff sẽ có ở bước sau.'
                      : 'Brief sẽ có ở bước sau.'}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
