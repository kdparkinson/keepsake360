import { sceneThumbnailUrl } from './tour/data';
import type { TourScene } from './tour/types';

export interface SceneNavHandlers {
  onSelect: (sceneId: string) => void;
  /** Called as a scene's name is typed; the shell records it as an edit. */
  onRename?: (sceneId: string, name: string) => void;
  /** Called when a row is dropped somewhere else in the rail, by index. */
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

export interface SceneNav {
  /** Draw a tour's scenes, or hide the nav rail when there are none to show. */
  render(scenes: TourScene[], assetBase: string): void;
  /** Mark the scene on screen, or clear the mark when no scene is known. */
  setActive(sceneId: string | null): void;
  /** Empty the rail, so a closed tour leaves no rows behind. */
  clear(): void;
}

/** What a scene with no name of its own is called, in the row and the label. */
function fallbackName(index: number): string {
  return `Room ${index + 1}`;
}

/** Travel, in pixels, that turns a press into a reorder rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The scene nav beside the stage.
 *
 * Marzipano calls a room a scene, and so does the tour data; the nav shows one
 * square per scene, in the order the document lists them. The square is the way
 * into a scene and the name beneath it is a field, so renaming is done where
 * the name is read. A row can also be dragged to another place in the rail,
 * which is how the tour's order — and so the viewer's — is changed.
 *
 * Like the library list, it draws rows and reports clicks, renames and drops
 * and nothing else: the camera, the open tour and the saving all stay with the
 * shell and the engine.
 */
export function createSceneNav(
  section: HTMLElement,
  list: HTMLUListElement,
  handlers: SceneNavHandlers,
): SceneNav {
  /**
   * Set by a drop, so the click that ends the gesture does not walk anywhere.
   * Cleared as the next gesture starts, in case that click never arrived.
   */
  let dropped = false;

  /** A row's place in the rail right now, which a drag changes. */
  function indexOf(item: HTMLElement): number {
    return Array.from(list.children).indexOf(item);
  }

  /** Put a dragged row where the pointer is, between its siblings. */
  function placeRow(item: HTMLLIElement, clientY: number): void {
    const before = Array.from(list.children).find((row) => {
      if (row === item) return false;
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });

    list.insertBefore(item, before ?? null);
  }

  /**
   * Let a row be picked up and dropped further along the rail.
   *
   * Press and drag: the row follows the pointer through its neighbours, and the
   * list is already in the new order when the pointer is released, so letting
   * go only has to record the move. A press that does not travel is a click,
   * which is why the square still navigates and the name is still a field.
   */
  function enableReordering(item: HTMLLIElement): void {
    // Nothing inside a row may start a browser drag of its own — a thumbnail
    // image, say — because that would take the gesture away from the reorder
    // and end it with a `pointercancel`. A name field keeps its text behaviour.
    item.addEventListener('dragstart', (event) => {
      if ((event.target as Element | null)?.closest('textarea')) return;
      event.preventDefault();
    });

    item.addEventListener('pointerdown', (event: PointerEvent) => {
      // A press starts a new gesture, whether or not the last one left a click
      // for us to swallow.
      dropped = false;

      if (event.button !== 0) return;

      // The name is a field: dragging in it selects text, it does not move a
      // room.
      if ((event.target as Element | null)?.closest('textarea')) return;

      const fromIndex = indexOf(item);
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;

      // Listening on the window rather than capturing the pointer keeps a plain
      // click's target the row's own square, so clicking a scene still works.
      const move = (moveEvent: PointerEvent) => {
        if (!dragging) {
          // Any direction counts, so a slightly crooked pull still reorders.
          const travelled = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (travelled < DRAG_THRESHOLD_PX) return;
          dragging = true;
          item.classList.add('dragging');
          // Own the pointer for the rest of the gesture, so a release outside
          // the window still ends the drag rather than leaving the row lifted.
          item.setPointerCapture(moveEvent.pointerId);
        }

        placeRow(item, moveEvent.clientY);
      };

      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        item.classList.remove('dragging');

        if (!dragging) return;

        dropped = true;
        // The gesture's own click comes before any timer, so this clears the
        // flag after it rather than leaving the next activation to swallow it.
        window.setTimeout(() => {
          dropped = false;
        }, 0);

        const toIndex = indexOf(item);
        if (toIndex !== fromIndex) handlers.onReorder?.(fromIndex, toIndex);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  }

  function row(scene: TourScene, index: number, assetBase: string): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'scene-nav-row';

    // The square: the one thing in the row that navigates.
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'scene-nav-item';
    // Which scene a row stands for — the only thing `setActive` has to match on.
    open.dataset.sceneId = scene.id;

    // A square of the scene's starting view. The tour's own tiles supply it, so
    // a tour without a tile pyramid still gets the square, only empty.
    const thumb = document.createElement('span');
    thumb.className = 'scene-nav-thumb';

    const url = sceneThumbnailUrl(assetBase, scene);
    if (url) {
      const image = document.createElement('img');
      image.className = 'scene-nav-image';
      // Decorative: the button already carries the scene's name.
      image.alt = '';
      image.decoding = 'async';
      // An image is a browser-level drag handle by default: pressing it and
      // moving would start a native image drag and cancel the row's own
      // reorder. The square is draggable, the picture in it is not.
      image.draggable = false;
      // A tile that is missing must not leave a broken-image box on the square.
      image.addEventListener('error', () => image.remove());
      image.src = url;
      thumb.append(image);
    }

    open.append(thumb);
    open.addEventListener('click', (event) => {
      // A drag ends with a pointer click on the row it grabbed; that is the
      // drop, not a request to walk into the scene. A click from the keyboard
      // has no click count, and is always a real one.
      if (dropped && event.detail > 0) {
        dropped = false;
        return;
      }
      handlers.onSelect(scene.id);
    });

    // The name: a field, edited in place. Exports name scenes after the
    // panorama file they came from, and a scene can also go unnamed, so the
    // placeholder is the name the rest of the app falls back to. A textarea so
    // a long export name wraps instead of being elided.
    const name = document.createElement('textarea');
    name.className = 'scene-nav-name';
    name.rows = 1;
    name.value = scene.name ?? '';
    name.placeholder = fallbackName(index);
    name.maxLength = 120;
    name.spellcheck = false;
    name.setAttribute('aria-label', 'Scene name');

    // The button's label is what the nav reads aloud and what a hover shows, so
    // it follows what is being typed rather than the document it started from.
    const describe = (text: string) => {
      const shown = text.trim() || fallbackName(index);
      open.title = shown;
      open.setAttribute('aria-label', `Go to ${shown}`);
    };
    describe(name.value);

    name.addEventListener('input', () => {
      describe(name.value);
      handlers.onRename?.(scene.id, name.value);
    });
    // Enter finishes the rename; the edit was already saved as it was typed.
    name.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      name.blur();
    });

    item.append(open, name);
    enableReordering(item);
    return item;
  }

  return {
    render(scenes, assetBase) {
      list.replaceChildren(...scenes.map((scene, index) => row(scene, index, assetBase)));
      section.hidden = scenes.length === 0;
    },
    setActive(sceneId) {
      for (const button of list.querySelectorAll<HTMLButtonElement>('.scene-nav-item')) {
        if (sceneId !== null && button.dataset.sceneId === sceneId) {
          button.setAttribute('aria-current', 'true');
        } else {
          button.removeAttribute('aria-current');
        }
      }
    },
    clear() {
      list.replaceChildren();
      section.hidden = true;
    },
  };
}
