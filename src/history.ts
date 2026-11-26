/**
 * A snapshot undo stack for one document.
 *
 * Snapshots are whole serialised documents: a tour's `data.js` is a couple of
 * kilobytes, so copying it is cheaper than tracking which field changed, and it
 * cannot drift out of sync with what is on disk. This module knows nothing
 * about tours — it deals in strings — so the shell decides what a snapshot is
 * and what to do with the one it hands back.
 */
export interface History {
  /**
   * Record a state. `label` names the kind of change; a repeat of the same
   * label in quick succession folds into the previous step rather than
   * stacking one per keystroke.
   */
  push(label: string, snapshot: string): void;
  /** Step back and return the snapshot to apply, or null at the start. */
  undo(): string | null;
  /** Step forward and return the snapshot to apply, or null at the end. */
  redo(): string | null;
  /** Forget everything (a different tour was opened, say). */
  reset(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface HistoryOptions {
  /** Steps kept before the oldest is dropped. */
  limit?: number;
  /** Edits with the same label closer together than this fold into one step. */
  coalesceMs?: number;
}

export function createHistory(options: HistoryOptions = {}): History {
  const limit = options.limit ?? 100;
  const coalesceMs = options.coalesceMs ?? 750;

  let entries: string[] = [];
  let index = -1;
  let lastLabel = '';
  let lastPushAt = 0;

  /** Applying a step must not be folded into by whatever is typed next. */
  function breakCoalescing(): void {
    lastLabel = '';
    lastPushAt = 0;
  }

  return {
    push(label, snapshot) {
      if (index >= 0 && entries[index] === snapshot) return;

      // Never merge into entry 0: that is the state the tour opened in, and it
      // has to survive as the floor of the stack.
      const coalesce = index > 0 && label === lastLabel && Date.now() - lastPushAt < coalesceMs;

      if (coalesce) {
        entries[index] = snapshot;
      } else {
        entries.splice(index + 1);
        entries.push(snapshot);

        if (entries.length > limit) entries.shift();

        index = entries.length - 1;
      }

      lastLabel = label;
      lastPushAt = Date.now();
    },

    undo() {
      if (index <= 0) return null;
      index -= 1;
      breakCoalescing();
      return entries[index] ?? null;
    },

    redo() {
      if (index < 0 || index >= entries.length - 1) return null;
      index += 1;
      breakCoalescing();
      return entries[index] ?? null;
    },

    reset() {
      entries = [];
      index = -1;
      breakCoalescing();
    },

    canUndo: () => index > 0,
    canRedo: () => index >= 0 && index < entries.length - 1,
  };
}
