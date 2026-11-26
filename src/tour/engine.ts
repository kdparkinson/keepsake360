import Marzipano from 'marzipano';
import type { TourAppData, TourInfoHotspot, TourLinkHotspot, TourScene } from './types';

/**
 * The tour renderer, lifted out of the old viewer page.
 *
 * It owns the Marzipano viewer, the scene graph and the hotspot markers, and
 * knows one thing about the app's mode: whether a hotspot click navigates
 * (view) or selects and drags (edit). Switching modes therefore never rebuilds
 * a scene, which is what keeps the camera where the user left it when they
 * move between viewing and editing.
 *
 * Edits are applied to the tour data in place and then reported through
 * `onEdit`; the shell owns saving, so there is one write path for every kind
 * of change.
 */

export type EngineMode = 'view' | 'edit';

/** What the shell is told when an edit-mode hotspot selection changes. */
export interface HotspotSelection {
  kind: 'link' | 'info';
  sceneId: string;
  /** Index into the scene's `linkHotspots` or `infoHotspots` array. */
  index: number;
  /** Human-readable summary for the chrome (target room, or hotspot title). */
  label: string;
  yaw: number;
  pitch: number;
}

export interface TourEngineOptions {
  mode: EngineMode;
  /**
   * The shell's editing popup. The engine mounts it beside whatever is
   * selected — the same kind of job as mounting a marker — so nothing outside
   * has to know where a hotspot is on screen.
   */
  editor?: HTMLElement;
  onSelectionChange?: (selection: HotspotSelection | null) => void;
  /**
   * Called once an edit has changed the tour data, so the shell can save it.
   * `label` names the kind of change (`text:<scene>:<index>`, `move:…`), which
   * is what lets the shell fold a burst of typing into one undo step.
   */
  onEdit?: (label: string) => void;
}

export interface TourEngine {
  mode: EngineMode;
  setMode(mode: EngineMode): void;
  /** Add an info hotspot where the camera is looking, and select it. */
  addInfoHotspot(): void;
  /** Add a link hotspot to the next room, and select it. */
  addLinkHotspot(): void;
  /** Rewrite the selected note's text. */
  setInfoText(text: string): void;
  /** Point the selected link hotspot at another room. */
  setLinkTarget(targetSceneId: string): void;
  /** Turn the selected link hotspot's arrow, in radians. */
  setLinkRotation(rotation: number): void;
  /** Delete the selected hotspot. */
  removeSelected(): void;
  /** Drop the selection, which puts the editing popup away. */
  clearSelection(): void;
  /** Rename the tour — the `name` the archive carries and the library shows. */
  setTourName(name: string): void;
  /**
   * Replace the whole document — undo/redo — and redraw the markers without
   * touching the camera: scenes and views are not rebuilt, only hotspots.
   */
  setData(data: TourAppData): void;
  destroy(): void;
}

/** Movement below this is a tap (selection), not a drag. */
const DRAG_THRESHOLD_PX = 3;

/** A north-pointing arrow; each link hotspot turns it by its own `rotation`. */
const ARROW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M12 4 19 11.5h-4.5v8.5h-5v-8.5H5z" /></svg>';

/** The arrow dial's step: an eighth of a turn (45°). */
export const EIGHTH_TURN = Math.PI / 4;

/** Wrap an angle into (-π, π], so guessed values stay small and readable. */
function normaliseAngle(radians: number): number {
  const turn = Math.PI * 2;
  const wrapped = ((radians % turn) + turn) % turn;
  return wrapped > Math.PI ? wrapped - turn : wrapped;
}

/**
 * A starting rotation for a link that has just been dropped.
 *
 * Marzipano markers face the camera, so an arrow has no true direction to
 * point in. What can be kept consistent is the room: holding every new arrow
 * along the panorama's own forward direction makes it lean with the spot it
 * sits on, and gives the same doorway the same arrow twice. The guess lands on
 * the same eighths the dial snaps to, so it never looks half-placed while the
 * dial still overrides it, and the value is saved with the hotspot.
 */
function guessLinkRotation(yaw: number): number {
  const eighth = Math.round(-yaw / EIGHTH_TURN) * EIGHTH_TURN;
  return normaliseAngle(eighth);
}

interface Marker {
  element: HTMLButtonElement;
  /** The hotspot this marker draws — the object the tour's data holds. */
  hotspot: TourLinkHotspot | TourInfoHotspot;
  sceneId: string;
  /** The Marzipano scene the marker is projected against. */
  scene: any;
  container: any;
  marzipanoHotspot: any;
  selection: HotspotSelection;
  /** Info markers only: the bubble whose text the editor rewrites. */
  bubble?: HTMLElement;
  /** Link markers only: the element that carries the arrow's rotation. */
  arrow?: HTMLElement;
}

/**
 * Mount a tour into `element` and return a handle for viewing and editing it.
 *
 * `assetBase` is the URL prefix the tour's `tiles/` live under, already
 * resolved by the main process (see `assetBaseFor`).
 */
export function createTourEngine(
  element: HTMLElement,
  initialData: TourAppData,
  assetBase: string,
  options: TourEngineOptions,
): TourEngine {
  const viewer = new Marzipano.Viewer(element);
  const scenes = new Map<string, any>();
  const markers: Marker[] = [];

  /** The live document. Undo replaces it wholesale; markers are redrawn from it. */
  let data = initialData;
  let mode = options.mode;
  let selected: Marker | null = null;
  let currentSceneId: string | null = null;
  /** The shell's editing popup while it is on the scene, as its own hotspot. */
  let editorHotspot: { marker: Marker; container: any; hotspot: any } | null = null;
  /** How to stop watching for the moves that re-place the panel. */
  let editorTracking: (() => void) | null = null;

  // Everything this engine adds to the pano goes through this, so closing a
  // tour leaves no listener behind on an element the next tour reuses.
  const lifetime = new AbortController();

  // CSS hangs the editing affordances (dashed rings, grab cursors) off this.
  element.dataset.mode = mode;

  /** Write a panel offset only when it changed, so idle frames cost no layout. */
  function setEditorOffset(panel: HTMLElement, property: 'left' | 'top', value: number): void {
    const next = `${Math.round(value)}px`;
    if (panel.style[property] !== next) panel.style[property] = next;
  }

  /**
   * Place the popup's panel against the marker without letting it leave the
   * window: centred on the marker, pushed back inside the edges, and moved
   * above the marker when there is no room below it.
   */
  function placeEditor(): void {
    const popup = options.editor;
    const panel = popup?.firstElementChild as HTMLElement | null | undefined;
    if (!popup || !panel || !editorHotspot) return;

    const anchor = popup.getBoundingClientRect();
    const margin = 10;
    const gap = 14;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    const minLeft = margin - anchor.left;
    const maxLeft = window.innerWidth - margin - anchor.left - width;
    const left = Math.min(Math.max(-width / 2, minLeft), Math.max(minLeft, maxLeft));

    const below = anchor.top + gap + height <= window.innerHeight - margin;
    const minTop = margin - anchor.top;
    const maxTop = window.innerHeight - margin - anchor.top - height;
    const top = Math.min(Math.max(below ? gap : -height - gap, minTop), Math.max(minTop, maxTop));

    setEditorOffset(panel, 'left', left);
    setEditorOffset(panel, 'top', top);
  }

  /**
   * Follow the marker while it is selected.
   *
   * Three things can move the panel: the camera, which the view reports
   * itself; a marker drag, which places it directly; and its own size, which
   * changes as a note is written. A window resize counts as the third, and the
   * observer also covers the first placement, after the fields are filled and
   * laid out but before anything is painted.
   */
  function trackEditor(marker: Marker): void {
    const view = marker.scene.view();
    const panel = options.editor?.firstElementChild;

    view.addEventListener('change', placeEditor);
    window.addEventListener('resize', placeEditor);

    // The panel's box only changes size, never position, so re-placing it here
    // cannot feed back into the observer.
    const resized = new ResizeObserver(placeEditor);
    if (panel) resized.observe(panel);

    editorTracking = () => {
      view.removeEventListener('change', placeEditor);
      window.removeEventListener('resize', placeEditor);
      resized.disconnect();
    };
  }

  /** Take the editing popup off the scene. Its element stays with the shell. */
  function detachEditor(): void {
    editorTracking?.();
    editorTracking = null;

    if (!editorHotspot) return;
    editorHotspot.container.destroyHotspot(editorHotspot.hotspot);
    editorHotspot = null;
  }

  /**
   * Move the selection ring, put the editing popup beside the new hotspot, and
   * tell the shell what is now selected.
   *
   * The popup is mounted as a hotspot of its own rather than as a panel
   * floating over the stage, so Marzipano keeps it with its marker: it moves
   * with the camera, hides when the marker turns away, and follows a drag
   * without anyone measuring the marker's screen position.
   */
  function applySelection(marker: Marker | null): void {
    selected?.element.classList.remove('selected');
    detachEditor();

    selected = marker;
    selected?.element.classList.add('selected');

    if (marker && options.editor) {
      const container = marker.container;
      const hotspot = container.createHotspot(options.editor, {
        yaw: marker.selection.yaw,
        pitch: marker.selection.pitch,
      });

      editorHotspot = { marker, container, hotspot };
      trackEditor(marker);
    }

    options.onSelectionChange?.(marker ? marker.selection : null);
  }

  function goToScene(sceneId: string): void {
    const scene = scenes.get(sceneId);
    if (!scene) return;
    scene.switchTo();
    currentSceneId = sceneId;
  }

  /** A client-coordinate point, projected back onto a scene, as yaw/pitch. */
  function coordinatesAt(scene: any, clientX: number, clientY: number) {
    const rect = element.getBoundingClientRect();
    return scene.view().screenToCoordinates({ x: clientX - rect.left, y: clientY - rect.top });
  }

  /** Where the camera is looking: where a newly added hotspot appears. */
  function viewCentre(): { yaw: number; pitch: number } | null {
    const scene = currentSceneId ? scenes.get(currentSceneId) : null;
    if (!scene) return null;
    const { yaw, pitch } = scene.view().parameters();
    return { yaw, pitch };
  }

  function sceneDataFor(sceneId: string | null): TourScene | undefined {
    return data.scenes.find((scene) => scene.id === sceneId);
  }

  /**
   * Let a marker be dragged to a new position in edit mode.
   *
   * Marzipano watches the same gesture on an ancestor to rotate the camera, so
   * the marker's pointerdown stops there. Releasing without moving is a tap,
   * which selects the hotspot instead of moving it.
   */
  function enableDragging(marker: Marker): void {
    const node = marker.element;

    node.addEventListener('pointerdown', (event: PointerEvent) => {
      if (mode !== 'edit' || event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;

      node.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        if (!dragging) {
          const travelled = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (travelled < DRAG_THRESHOLD_PX) return;
          dragging = true;
          node.classList.add('dragging');
          // Grabbing a hotspot is also picking it: the chrome should show it.
          applySelection(marker);
        }

        const position = coordinatesAt(marker.scene, moveEvent.clientX, moveEvent.clientY);
        if (!position) return;

        // Keep the marker, the tour data and the readout in step: the tour
        // object is the one that gets saved.
        marker.marzipanoHotspot.setPosition(position);
        marker.hotspot.yaw = position.yaw;
        marker.hotspot.pitch = position.pitch;
        marker.selection.yaw = position.yaw;
        marker.selection.pitch = position.pitch;

        // The popup is a hotspot in its own right, so it has to be moved too,
        // and re-placed: a drag does not change the view.
        if (editorHotspot?.marker === marker) {
          editorHotspot.hotspot.setPosition(position);
          placeEditor();
        }

        options.onSelectionChange?.(marker.selection);
      };

      const end = () => {
        node.removeEventListener('pointermove', move);
        node.removeEventListener('pointerup', end);
        node.removeEventListener('pointercancel', end);
        node.classList.remove('dragging');

        if (dragging) {
          options.onEdit?.(
            `move:${marker.selection.kind}:${marker.selection.sceneId}:${marker.selection.index}`,
          );
        } else {
          applySelection(selected === marker ? null : marker);
        }
      };

      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', end);
      node.addEventListener('pointercancel', end);
    });
  }

  /** Put a finished marker element on the scene and wire up its behaviour. */
  function mountMarker(
    container: any,
    scene: any,
    hotspot: TourLinkHotspot | TourInfoHotspot,
    markerElement: HTMLButtonElement,
    selection: HotspotSelection,
    bubble?: HTMLElement,
  ): Marker {
    const marzipanoHotspot = container.createHotspot(markerElement, {
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
    });

    const marker: Marker = {
      element: markerElement,
      hotspot,
      sceneId: selection.sceneId,
      scene,
      container,
      marzipanoHotspot,
      selection,
      bubble,
    };

    markers.push(marker);

    markerElement.addEventListener('click', () => {
      // Edit mode handles both tap and drag through pointer events.
      if (mode === 'edit') return;
      if (selection.kind === 'link') goToScene((hotspot as TourLinkHotspot).target);
    });

    enableDragging(marker);
    return marker;
  }

  function createLinkMarker(
    container: any,
    scene: any,
    sceneData: TourScene,
    hotspot: TourLinkHotspot,
    index: number,
  ): Marker {
    const markerElement = document.createElement('button');
    markerElement.type = 'button';
    markerElement.className = 'hotspot hotspot-link';
    markerElement.setAttribute('aria-label', 'Go to another room');

    // The export's rotation is in radians, with 0 pointing straight up. Turn
    // this inner element because Marzipano owns the marker's own transform.
    const arrow = document.createElement('span');
    arrow.className = 'hotspot-arrow';
    arrow.innerHTML = ARROW_SVG;
    arrow.style.transform = `rotate(${hotspot.rotation ?? 0}rad)`;
    markerElement.append(arrow);

    const targetName =
      data.scenes.find((candidate) => candidate.id === hotspot.target)?.name ?? hotspot.target;

    const marker = mountMarker(container, scene, hotspot, markerElement, {
      kind: 'link',
      sceneId: sceneData.id,
      index,
      label: `Go to ${targetName}`,
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
    });

    marker.arrow = arrow;
    return marker;
  }

  function createInfoMarker(
    container: any,
    scene: any,
    sceneData: TourScene,
    hotspot: TourInfoHotspot,
    index: number,
  ): Marker {
    const markerElement = document.createElement('button');
    markerElement.type = 'button';
    markerElement.className = 'hotspot hotspot-info';
    markerElement.setAttribute('aria-label', 'Show information');

    // Centred by the styles in index.css rather than by the marker's own
    // layout, because Marzipano forces `display: block` on the marker.
    const label = document.createElement('span');
    label.className = 'hotspot-label';
    label.textContent = 'i';
    markerElement.append(label);

    // The label is revealed on hover/focus by the styles in index.css, and
    // suppressed entirely in edit mode.
    const bubble = document.createElement('span');
    bubble.className = 'hotspot-bubble';
    // Left empty when there is no text, which the styles in index.css hide: a
    // note that has been placed but not written yet must not show an empty box.
    bubble.textContent = hotspot.text;
    markerElement.append(bubble);

    return mountMarker(
      container,
      scene,
      hotspot,
      markerElement,
      {
        kind: 'info',
        sceneId: sceneData.id,
        index,
        label: hotspot.title || 'Note',
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
      },
      bubble,
    );
  }

  /** Add the tour's navigation and information hotspots to a scene. */
  function addHotspots(scene: any, sceneData: TourScene): void {
    const container = scene.hotspotContainer();

    (sceneData.linkHotspots ?? []).forEach((hotspot, index) => {
      createLinkMarker(container, scene, sceneData, hotspot, index);
    });

    (sceneData.infoHotspots ?? []).forEach((hotspot, index) => {
      createInfoMarker(container, scene, sceneData, hotspot, index);
    });
  }

  /** Remove every marker belonging to a scene, leaving the tour data alone. */
  function clearSceneMarkers(sceneId: string): void {
    for (let index = markers.length - 1; index >= 0; index--) {
      const marker = markers[index];
      if (marker.sceneId !== sceneId) continue;
      marker.container.destroyHotspot(marker.marzipanoHotspot);
      markers.splice(index, 1);
    }
  }

  /**
   * Throw away a scene's markers and draw them again from the tour data.
   *
   * Adding or deleting a hotspot shifts the indices of the ones after it, so
   * the markers are rebuilt rather than patched: a handful of elements, and
   * the camera is untouched either way.
   */
  function rebuildScene(sceneData: TourScene): void {
    applySelection(null);
    clearSceneMarkers(sceneData.id);

    const scene = scenes.get(sceneData.id);
    if (scene) addHotspots(scene, sceneData);
  }

  /**
   * Take a whole new document (an undo or redo) and redraw its hotspots.
   *
   * The Marzipano scenes themselves are left alone, so the camera stays put and
   * the tiles are not fetched again.
   */
  function setData(next: TourAppData): void {
    data = next;
    applySelection(null);

    for (const sceneData of data.scenes) {
      const scene = scenes.get(sceneData.id);
      if (!scene) continue;
      clearSceneMarkers(sceneData.id);
      addHotspots(scene, sceneData);
    }
  }

  /** Select a hotspot by its coordinates in the tour data. */
  function selectAt(sceneId: string, kind: 'link' | 'info', index: number): void {
    const marker =
      markers.find(
        (candidate) =>
          candidate.selection.sceneId === sceneId &&
          candidate.selection.kind === kind &&
          candidate.selection.index === index,
      ) ?? null;

    applySelection(marker);
  }

  function addInfoHotspot(): void {
    const sceneData = sceneDataFor(currentSceneId);
    const centre = viewCentre();
    if (!sceneData || !centre) return;

    sceneData.infoHotspots ??= [];
    sceneData.infoHotspots.push({ yaw: centre.yaw, pitch: centre.pitch, title: '', text: '' });

    rebuildScene(sceneData);
    selectAt(sceneData.id, 'info', sceneData.infoHotspots.length - 1);
    options.onEdit?.('add:info');
  }

  function addLinkHotspot(): void {
    const sceneData = sceneDataFor(currentSceneId);
    const centre = viewCentre();
    if (!sceneData || !centre) return;

    // A link needs somewhere to go, so it points at the first other room; the
    // shell's target picker retargets it afterwards.
    const target = data.scenes.find((candidate) => candidate.id !== sceneData.id);
    if (!target) return;

    sceneData.linkHotspots ??= [];
    sceneData.linkHotspots.push({
      yaw: centre.yaw,
      pitch: centre.pitch,
      rotation: guessLinkRotation(centre.yaw),
      target: target.id,
    });

    rebuildScene(sceneData);
    selectAt(sceneData.id, 'link', sceneData.linkHotspots.length - 1);
    options.onEdit?.('add:link');
  }

  function setInfoText(text: string): void {
    if (selected?.selection.kind !== 'info') return;

    const hotspot = selected.hotspot as TourInfoHotspot;
    hotspot.text = text;
    selected.bubble!.textContent = text;
    options.onEdit?.(`text:${selected.selection.sceneId}:${selected.selection.index}`);
  }

  function setLinkTarget(targetSceneId: string): void {
    if (selected?.selection.kind !== 'link') return;

    const hotspot = selected.hotspot as TourLinkHotspot;
    hotspot.target = targetSceneId;
    const name = data.scenes.find((scene) => scene.id === targetSceneId)?.name ?? targetSceneId;
    selected.selection.label = `Go to ${name}`;
    options.onEdit?.(`target:${selected.selection.sceneId}:${selected.selection.index}`);
  }

  function setLinkRotation(rotation: number): void {
    if (selected?.selection.kind !== 'link') return;

    const hotspot = selected.hotspot as TourLinkHotspot;
    hotspot.rotation = rotation;
    selected.arrow?.style.setProperty('transform', `rotate(${rotation}rad)`);
    options.onEdit?.(`rotate:${selected.selection.sceneId}:${selected.selection.index}`);
  }

  /** Put the editing tools away: drop the selection and its popup. */
  function clearSelection(): void {
    applySelection(null);
  }

  function setTourName(name: string): void {
    data.name = name;
    options.onEdit?.('name');
  }

  function removeSelected(): void {
    if (!selected) return;

    const { sceneId, kind, index } = selected.selection;
    const sceneData = sceneDataFor(sceneId);
    if (!sceneData) return;

    const list = kind === 'info' ? sceneData.infoHotspots : sceneData.linkHotspots;
    list?.splice(index, 1);

    rebuildScene(sceneData);
    options.onEdit?.(`delete:${kind}:${sceneId}`);
  }

  // A tap on the empty pano puts the editing tools away. A tap rather than a
  // click: looking around while editing is common, and the browser still
  // reports a click after a drag. Markers and the popup stop their own
  // pointerdowns, so only the pano itself reaches this.
  element.addEventListener(
    'pointerdown',
    (event: PointerEvent) => {
      if (mode !== 'edit' || event.button !== 0) return;
      if ((event.target as Element | null)?.closest('.hotspot, .hotspot-editor')) return;

      const startX = event.clientX;
      const startY = event.clientY;

      const finish = (upEvent: PointerEvent) => {
        element.removeEventListener('pointerup', finish);
        element.removeEventListener('pointercancel', finish);

        if (upEvent.type !== 'pointerup') return;
        if (Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
          applySelection(null);
        }
      };

      element.addEventListener('pointerup', finish);
      element.addEventListener('pointercancel', finish);
    },
    { signal: lifetime.signal },
  );

  for (const sceneData of data.scenes) {
    // Marzipano tile layout, inside whichever asset folder this tour uses:
    // <assets>/tiles/<scene>/<z>/<face>/<y>/<x>.jpg
    const source = Marzipano.ImageUrlSource.fromString(
      `${assetBase}/tiles/${sceneData.id}/{z}/{f}/{y}/{x}.jpg`,
    );
    const geometry = new Marzipano.CubeGeometry(sceneData.levels);
    const limiter = Marzipano.RectilinearView.limit.traditional(
      sceneData.faceSize,
      (100 * Math.PI) / 180,
    );
    const view = new Marzipano.RectilinearView(sceneData.initialViewParameters, limiter);

    const scene = viewer.createScene({
      source,
      geometry,
      view,
      pinFirstLevel: true,
    });

    scenes.set(sceneData.id, scene);
    addHotspots(scene, sceneData);
  }

  const first = data.scenes[0];
  if (first) goToScene(first.id);

  function setMode(next: EngineMode): void {
    mode = next;
    element.dataset.mode = next;
    // A selection is an editing concept, so it does not survive a mode change.
    applySelection(null);
  }

  function destroy(): void {
    lifetime.abort();
    applySelection(null);
    viewer.destroy?.();
    element.replaceChildren();
    element.removeAttribute('data-mode');
  }

  return {
    get mode() {
      return mode;
    },
    setMode,
    addInfoHotspot,
    addLinkHotspot,
    setInfoText,
    setLinkTarget,
    setLinkRotation,
    removeSelected,
    clearSelection,
    setTourName,
    setData,
    destroy,
  };
}
