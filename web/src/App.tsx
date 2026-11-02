import { useEffect, useMemo, useState } from 'react';

import type { Run } from '../../shared/types.js';
import { api, type DiffResult } from './api.js';
import { BriefView } from './components/BriefView.js';
import { DiffView } from './components/DiffView.js';
import { LogView } from './components/LogView.js';
import { Sidebar } from './components/Sidebar.js';
import { TaskActions } from './components/TaskActions.js';
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
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  const { plans, tasks } = state;
  const counts = useMemo(() => taskCounts(tasks), [tasks]);

  useEffect(() => {
    if (selectedTaskId === null && tasks.length > 0) setSelectedTaskId(tasks[0]!.id);
  }, [tasks, selectedTaskId]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const plan = useMemo(
    () => (selectedTask ? plans.find((entry) => entry.id === selectedTask.planId) ?? null : null),
    [plans, selectedTask],
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

  // Diff is not part of the live store; refetch it whenever the selected task
  // or its status changes so the file list follows the agent's edits.
  const selectedStatus = selectedTask?.status ?? null;
  useEffect(() => {
    if (selectedTaskId === null) {
      setDiff(null);
      setDiffError(null);
      return;
    }
    let cancelled = false;
    api
      .diff(selectedTaskId)
      .then((result) => {
        if (cancelled) return;
        setDiff(result);
        setDiffError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setDiff(null);
        setDiffError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId, selectedStatus]);

  const events = selectedRunId !== null ? state.eventsByRun[selectedRunId] ?? [] : [];
  const fileCount = diff?.files.length ?? 0;

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
                <TaskActions task={selectedTask} baseBranch={plan?.baseBranch ?? ''} />
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
                    Diff ({fileCount})
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
                ) : tab === 'diff' ? (
                  <DiffView
                    files={diff?.files ?? []}
                    patch={diff?.patch ?? ''}
                    error={diffError}
                  />
                ) : (
                  <BriefView runs={runs} />
                )}
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
