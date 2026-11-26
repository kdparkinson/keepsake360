import type { TourSummary } from './types';

export interface LibraryHandlers {
  onOpen: (directory: string) => void;
  onDelete: (tour: TourSummary) => void;
}

export interface LibraryView {
  /** Draw the list, or hide the section when there is nothing to show. */
  render(tours: TourSummary[]): void;
}

/**
 * The landing screen's list of tours.
 *
 * It only draws rows and reports clicks back; listing the library, confirming a
 * delete and the IPC behind both stay with the shell and the main process, so
 * this module never touches the filesystem or the bridge.
 */
export function createLibraryView(
  section: HTMLElement,
  list: HTMLUListElement,
  handlers: LibraryHandlers,
): LibraryView {
  function row(tour: TourSummary): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'library-item';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'library-tour';

    const name = document.createElement('span');
    name.className = 'library-name';
    name.textContent = tour.name;

    // Exports often all call themselves "Untitled Project", so the folder —
    // which is unique — is what tells two of them apart.
    const folder = document.createElement('span');
    folder.className = 'library-folder';
    folder.textContent = tour.folder;

    open.append(name, folder);
    open.addEventListener('click', () => handlers.onOpen(tour.directory));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'library-delete';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete the tour in ${tour.folder}`);
    remove.addEventListener('click', () => handlers.onDelete(tour));

    item.append(open, remove);
    return item;
  }

  return {
    render(tours) {
      list.replaceChildren(...tours.map(row));
      section.hidden = tours.length === 0;
    },
  };
}
