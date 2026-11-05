import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Task } from '../../../shared/types.js';
import { buildPaletteItems, filterPalette, stepIndex, type PaletteAction, type PaletteItem } from '../palette.js';
import { Icon } from './Icon.js';

export interface CommandPaletteProps {
  open: boolean;
  tasks: Task[];
  onClose: () => void;
  onAction: (action: PaletteAction) => void;
}

/**
 * Ctrl+K command palette. It owns nothing but its own query and cursor: every
 * action is handed back to `App`, so the palette never mutates navigation state
 * directly and stays trivially testable.
 *
 * Keyboard: ↑/↓ move (wrapping), Enter runs, Escape closes and returns focus to
 * whatever opened it.
 */
export function CommandPalette({ open, tasks, onClose, onAction }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const listId = useId();
  const items = useMemo(() => filterPalette(buildPaletteItems({ tasks }), query), [tasks, query]);
  // Clamp instead of trusting the stored index: filtering can shrink the list.
  const current = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Effects run after commit, so the input already exists.
    inputRef.current?.focus();
    // Listen on the document: focus can sit outside the dialog, and Escape must still close it.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('keydown', closeOnEscape, true);
      const restore = restoreRef.current;
      if (restore && restore.isConnected) restore.focus();
    };
  }, [open]);

  if (!open) return null;

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onAction(item.action);
    onClose();
  };

  return (
    <div className="palette-backdrop" role="presentation">
      <div className="palette" role="dialog" aria-modal="true" aria-label="Ô lệnh nhanh">
        <div className="palette-input">
          <Icon name="commands" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
            placeholder="Gõ để tìm công việc, màn hình, agent..."
            aria-label="Tìm lệnh"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={current < 0 ? undefined : `${listId}-${current}`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(stepIndex(current, 1, items.length)); return; }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActive(stepIndex(current, -1, items.length)); return; }
              if (event.key === 'Enter') { event.preventDefault(); run(items[current]); }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" id={listId} role="listbox" aria-label="Kết quả">
          {items.length === 0 && <li className="palette-empty">Không có lệnh nào khớp.</li>}
          {items.map((item, index) => {
            const previous = items[index - 1];
            return (
              <li key={item.id} role="presentation">
                {previous?.group !== item.group && <div className="palette-group" role="presentation">{item.group}</div>}
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === current}
                  className={`palette-item${index === current ? ' active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(item)}
                >
                  <span className="palette-label">{item.label}</span>
                  <span className="palette-hint">{item.hint}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
