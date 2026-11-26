import { sceneThumbnailUrl } from './tour/data';
import type { TourScene } from './tour/types';

export interface SceneNavHandlers {
  onSelect: (sceneId: string) => void;
}

export interface SceneNav {
  /** Draw a tour's scenes, or hide the nav rail when there are none to show. */
  render(scenes: TourScene[], assetBase: string): void;
  /** Mark the scene on screen, or clear the mark when no scene is known. */
  setActive(sceneId: string | null): void;
  /** Empty the rail, so a closed tour leaves no rows behind. */
  clear(): void;
}

/**
 * The scene nav beside the stage.
 *
 * Marzipano calls a room a scene, and so does the tour data; the nav shows one
 * square per scene, in the order the document lists them.
 *
 * Like the library list, it draws rows and reports clicks and nothing else: the
 * camera, the open tour and the saving all stay with the shell and the engine.
 */
export function createSceneNav(
  section: HTMLElement,
  list: HTMLUListElement,
  handlers: SceneNavHandlers,
): SceneNav {
  function row(scene: TourScene, index: number, assetBase: string): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'scene-nav-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-nav-item';
    // Which scene a row stands for — the only thing `setActive` has to match on.
    button.dataset.sceneId = scene.id;

    // Exports name scenes after the panorama file they came from, and a scene
    // can also go unnamed; the nav always shows something to click.
    const name = scene.name?.trim() || `Room ${index + 1}`;
    button.title = name;
    button.setAttribute('aria-label', `Go to ${name}`);

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
      // A tile that is missing must not leave a broken-image box on the square.
      image.addEventListener('error', () => image.remove());
      image.src = url;
      thumb.append(image);
    }

    const label = document.createElement('span');
    label.className = 'scene-nav-name';
    label.textContent = name;

    button.append(thumb, label);
    button.addEventListener('click', () => handlers.onSelect(scene.id));

    item.append(button);
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
