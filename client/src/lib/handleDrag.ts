/**
 * Pointer wiring for a slider handle, shared by the slider tasks: grab the handle, follow the
 * pointer along the track (clamped to 0..travel), release. The caller decides what a position
 * means and what to record.
 */
export interface HandleDragOptions {
  handle: HTMLElement;
  /** The element whose left edge is position 0. */
  track: HTMLElement;
  /** Farthest handle position, in px from the track's left edge. */
  travel: number;
  /** Ignore the pointer while true (round passed, or locked while a failure shows). */
  isBlocked(): boolean;
  onGrab?(): void;
  onDrag(x: number, e: PointerEvent): void;
  onRelease?(): void;
}

export interface HandleDrag {
  readonly dragging: boolean;
  /** Drop the grip (a reroll or a pass): the handle has to be grabbed again. */
  cancelGrip(): void;
}

export function bindHandleDrag(o: HandleDragOptions): HandleDrag {
  let dragging = false;
  let grabDx = 0;
  o.handle.addEventListener("pointerdown", (e) => {
    if (o.isBlocked()) return;
    dragging = true;
    grabDx = e.clientX - o.handle.getBoundingClientRect().left;
    o.handle.setPointerCapture(e.pointerId);
    o.onGrab?.();
    e.preventDefault();
  });
  o.handle.addEventListener("pointermove", (e) => {
    if (!dragging || o.isBlocked()) return;
    const x = Math.max(0, Math.min(o.travel, e.clientX - o.track.getBoundingClientRect().left - grabDx));
    o.onDrag(x, e);
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    o.onRelease?.();
  };
  o.handle.addEventListener("pointerup", release);
  o.handle.addEventListener("pointercancel", release);
  return {
    get dragging() {
      return dragging;
    },
    cancelGrip() {
      dragging = false;
    },
  };
}
