/**
 * This file is loaded by Vite and runs in the "renderer" (Window) context.
 *
 * It is the whole application shell: one page holding three states — the
 * landing screen, viewing a tour, and editing it. The tour itself lives in the
 * engine (`./tour/engine`), which is mounted once per tour and kept alive
 * across a mode change, so the camera stays exactly where the user left it.
 *
 * Two pieces are deliberately not here: the undo stack (`./history`) and the
 * library list (`./library-view`). What is left is the wiring that has to know
 * about all of it at once — which tour is open, what is selected, when to save.
 */
import './index.css';
import { createHistory } from './history';
import { createLibraryView } from './library-view';
import { createSceneNav } from './scene-nav';
import { assetBaseFor, loadTourData } from './tour/data';
import {
  createTourEngine,
  EIGHTH_TURN,
  type EngineMode,
  type HotspotSelection,
  type TourEngine,
} from './tour/engine';
import type { TourAppData, TourInfoHotspot, TourLinkHotspot } from './tour/types';
import type { LoadedTour, TourSummary } from './types';

type AppState = 'landing' | 'view' | 'edit';

// These elements live in our own index.html, so they always exist.
const app = document.querySelector<HTMLDivElement>('#app')!;
const importZipBtn = document.querySelector<HTMLButtonElement>('#import-zip')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const library = document.querySelector<HTMLDivElement>('#library')!;
const libraryList = document.querySelector<HTMLUListElement>('#library-list')!;
const sceneNavSection = document.querySelector<HTMLElement>('#scene-nav')!;
const sceneNavList = document.querySelector<HTMLUListElement>('#scene-nav-list')!;
const pano = document.querySelector<HTMLDivElement>('#pano')!;
const stageStatus = document.querySelector<HTMLParagraphElement>('#stage-status')!;
const tourName = document.querySelector<HTMLInputElement>('#tour-name')!;
const saveState = document.querySelector<HTMLSpanElement>('#save-state')!;
const detail = document.querySelector<HTMLSpanElement>('#detail')!;
const modeViewBtn = document.querySelector<HTMLButtonElement>('#mode-view')!;
const modeEditBtn = document.querySelector<HTMLButtonElement>('#mode-edit')!;
const exitTourBtn = document.querySelector<HTMLButtonElement>('#exit-tour')!;
const exitMenu = document.querySelector<HTMLDivElement>('#exit-menu')!;
const exitPlainBtn = document.querySelector<HTMLButtonElement>('#exit-plain')!;
const exitExportBtn = document.querySelector<HTMLButtonElement>('#exit-export')!;
const addNoteBtn = document.querySelector<HTMLButtonElement>('#add-note')!;
const addLinkBtn = document.querySelector<HTMLButtonElement>('#add-link')!;
const deleteHotspotBtn = document.querySelector<HTMLButtonElement>('#delete-hotspot')!;
const editorPopover = document.querySelector<HTMLDivElement>('#editor')!;
const undoBtn = document.querySelector<HTMLButtonElement>('#undo')!;
const redoBtn = document.querySelector<HTMLButtonElement>('#redo')!;
const infoFields = document.querySelector<HTMLDivElement>('#info-fields')!;
const infoText = document.querySelector<HTMLTextAreaElement>('#info-text')!;
const linkField = document.querySelector<HTMLDivElement>('#link-field')!;
const linkTarget = document.querySelector<HTMLSelectElement>('#link-target')!;
const linkRotation = document.querySelector<HTMLDivElement>('#link-rotation')!;
const linkRotationPip = document.querySelector<HTMLSpanElement>('#link-rotation .dial-pip')!;

let state: AppState = 'landing';
let engine: TourEngine | null = null;

/** The open tour, and the data being edited — the object that gets saved. */
let openTour: LoadedTour | null = null;
let tourData: TourAppData | null = null;

/** True while an edit has not reached disk yet. */
let unsaved = false;

/** Counts edits, so a write in flight cannot claim a later edit as saved. */
let editCount = 0;

/** What the edit bar's fields are currently showing. */
let currentSelection: HotspotSelection | null = null;
let selectionKey = '';

/** Serialises saves, so two quick edits cannot land out of order. */
let saveChain: Promise<void> = Promise.resolve();
let saveTimer: number | undefined;
let saveNoticeTimer: number | undefined;

const history = createHistory();

/** Incremented per open so a slow load cannot install itself over a newer one. */
let openToken = 0;

const libraryView = createLibraryView(library, libraryList, {
  onOpen: (directory) => void openFromLibrary(directory),
  onDelete: (tour) => void deleteFromLibrary(tour),
});

// The scene nav only draws rows and reports clicks; walking is the engine's job.
const sceneNav = createSceneNav(sceneNavSection, sceneNavList, {
  onSelect: (sceneId) => engine?.goToScene(sceneId),
});

/** Switch screens. The engine, not this function, owns the camera. */
function setState(next: AppState): void {
  state = next;
  app.dataset.state = next;
  modeViewBtn.setAttribute('aria-pressed', String(next === 'view'));
  modeEditBtn.setAttribute('aria-pressed', String(next === 'edit'));
  modeViewBtn.disabled = next === 'landing';
  modeEditBtn.disabled = next === 'landing';
  if (next === 'landing') closeExitMenu();
}

function destroyEngine(): void {
  engine?.destroy();
  engine = null;
}

/** A message on the landing screen: green for information, red for failures. */
function setStatus(message: string, tone: 'info' | 'error' = 'error'): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

/** Show a tour's name in the chrome, and in the window title. */
function applyTourName(name: string): void {
  tourName.value = name;
  document.title = name || 'keepsake360';
}

/** Describe a selection for the chrome, or clear it when nothing is selected. */
function describeSelection(selection: HotspotSelection | null): void {
  if (!selection || state !== 'edit') {
    detail.textContent = '';
    return;
  }

  const degrees = (radians: number) => Math.round((radians * 180) / Math.PI);
  detail.textContent = `${selection.label} · ${degrees(selection.yaw)}° / ${degrees(selection.pitch)}°`;
}

/** The hotspot a selection points at, read straight out of the tour data. */
function hotspotFor(selection: HotspotSelection): TourInfoHotspot | TourLinkHotspot | undefined {
  const scene = tourData?.scenes.find((candidate) => candidate.id === selection.sceneId);
  if (!scene) return undefined;

  return selection.kind === 'info'
    ? scene.infoHotspots?.[selection.index]
    : scene.linkHotspots?.[selection.index];
}

/** Where the dial currently shows the arrow pointing, in radians. */
let shownRotation = 0;

/** Show an arrow's rotation on the dial, wrapped into its one turn. */
function setRotationField(radians: number): void {
  const degrees = Math.round((radians * 180) / Math.PI);
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;

  shownRotation = (wrapped * Math.PI) / 180;
  linkRotationPip.style.transform = `rotate(${shownRotation}rad)`;
  // The pip is the readout; the number stays available on hover and to a
  // screen reader without taking a column of a popup that should be one line.
  linkRotation.title = `${wrapped}°`;
  linkRotation.setAttribute('aria-valuenow', String(wrapped));
  linkRotation.setAttribute('aria-valuetext', `${wrapped}°`);
}

/** Turn the selected arrow, and keep the dial showing what was set. */
function turnArrow(rotation: number): void {
  setRotationField(rotation);
  engine?.setLinkRotation(shownRotation);
}

/** Read a pointer position as an angle around the dial, snapped to an eighth. */
function turnFromPointer(event: PointerEvent): void {
  const rect = linkRotation.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width / 2);
  const dy = event.clientY - (rect.top + rect.height / 2);
  // 0 straight up, growing clockwise — the same sense as the arrow's rotation.
  const angle = Math.atan2(dx, -dy);
  turnArrow(Math.round(angle / EIGHTH_TURN) * EIGHTH_TURN);
}

/**
 * Reflect the current selection in the edit bar.
 *
 * The fields are only refilled when the selection becomes a different hotspot:
 * a drag updates the position many times a second, and rewriting the inputs
 * on each of those would fight whoever is typing in them.
 */
function renderSelection(selection: HotspotSelection | null): void {
  const key = selection ? `${selection.kind}:${selection.sceneId}:${selection.index}` : '';
  const sameHotspot = key !== '' && key === selectionKey;

  selectionKey = key;
  currentSelection = selection;

  describeSelection(selection);

  editorPopover.hidden = !selection;
  infoFields.hidden = selection?.kind !== 'info';
  linkField.hidden = selection?.kind !== 'link';

  // Delete sits in the row it deletes: one button, moved to whichever row the
  // selection shows, so the popup stays a single line.
  if (selection && !sameHotspot) {
    (selection.kind === 'info' ? infoFields : linkField).append(deleteHotspotBtn);
  }

  if (!selection || sameHotspot) return;

  if (selection.kind === 'info') {
    const hotspot = hotspotFor(selection) as TourInfoHotspot | undefined;
    infoText.value = hotspot?.text ?? '';
    return;
  }

  // A link cannot point at the room it is in.
  const rooms = tourData?.scenes.filter((scene) => scene.id !== selection.sceneId) ?? [];

  linkTarget.replaceChildren(
    ...rooms.map((room) => {
      const option = document.createElement('option');
      option.value = room.id;
      option.textContent = room.name;
      return option;
    }),
  );

  const hotspot = hotspotFor(selection) as TourLinkHotspot | undefined;
  if (!hotspot) return;

  linkTarget.value = hotspot.target;
  setRotationField(hotspot.rotation ?? 0);
}

function setSaveNotice(message: string): void {
  window.clearTimeout(saveNoticeTimer);
  saveState.textContent = message;

  if (message === 'Saved') {
    saveNoticeTimer = window.setTimeout(() => {
      if (saveState.textContent === 'Saved') saveState.textContent = '';
    }, 2000);
  }
}

function updateHistoryControls(): void {
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
}

function resetHistory(): void {
  history.reset();
  updateHistoryControls();
}

/** Record the document as a history step, if it has actually changed. */
function pushHistory(label: string): void {
  if (!tourData) return;
  history.push(label, JSON.stringify(tourData));
  updateHistoryControls();
}

/** Put a snapshot back on screen, redraw its markers, and save it. */
function restoreHistory(snapshot: string): void {
  tourData = JSON.parse(snapshot) as TourAppData;

  // Redraws the markers from the restored document; the camera stays put.
  engine?.setData(tourData);
  applyTourName(tourData.name ?? '');

  markDirty();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 400);
  updateHistoryControls();
}

function undo(): void {
  const snapshot = history.undo();
  if (snapshot) restoreHistory(snapshot);
  updateHistoryControls();
}

function redo(): void {
  const snapshot = history.redo();
  if (snapshot) restoreHistory(snapshot);
  updateHistoryControls();
}

/**
 * Write the tour's data back to its `data.js`.
 *
 * Edits are saved as they happen rather than behind a Save button: a keepsake
 * is only worth anything if what you see is what is on disk, and there is no
 * second copy to fall back to.
 */
async function saveNow(): Promise<void> {
  if (!openTour || !tourData) return;

  const saving = editCount;
  setSaveNotice('Saving…');
  const result = await window.keepsake.saveTour(openTour.directory, openTour.assets, tourData);

  if (!result.ok) {
    setSaveNotice(`Not saved — ${result.error}`);
    return;
  }

  // An edit made while this write was in flight is still unsaved, even though
  // the write itself succeeded — and `flushSave` has to know that any later
  // one is still owed, or the last few keystrokes would be lost on exit.
  unsaved = editCount !== saving;
  setSaveNotice(unsaved ? 'Saving…' : 'Saved');
}

/** Queue a save behind any save already in flight. */
function save(): Promise<void> {
  saveChain = saveChain.then(saveNow, saveNow);
  return saveChain;
}

/** Note that the document has changed since it was last written. */
function markDirty(): void {
  unsaved = true;
  editCount += 1;
}

/**
 * Record an edit and batch a burst of them into one write. Dragging lands one
 * edit per gesture, so it only waits out the same short window.
 */
function handleEdit(label: string): void {
  markDirty();
  pushHistory(label);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 400);
}

/** Land any pending edit immediately — before leaving a tour, say. */
async function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (unsaved) await save();
}

/** List the library on the landing screen, so a tour is never out of reach. */
async function refreshLibrary(): Promise<void> {
  try {
    libraryView.render(await window.keepsake.listTours());
  } catch {
    library.hidden = true;
  }
}

async function openFromLibrary(directory: string): Promise<void> {
  const result = await window.keepsake.openTour(directory);
  if (!result.ok && result.error !== 'cancelled') setStatus(result.error);
}

/** Delete a tour from the library; the main process asks for confirmation. */
async function deleteFromLibrary(tour: TourSummary): Promise<void> {
  const result = await window.keepsake.deleteTour(tour.directory);

  if (result.ok) {
    setStatus(`Deleted “${tour.folder}”.`, 'info');
    await refreshLibrary();
    return;
  }

  // A dismissed dialog is not a failure — just clear the message.
  if (result.error !== 'cancelled') setStatus(result.error);
}

/** Show the landing screen, optionally with a message about what happened. */
function showLanding(message = '', tone: 'info' | 'error' = 'error'): void {
  openToken++;
  destroyEngine();
  setState('landing');
  setStatus(message, tone);
  stageStatus.textContent = '';
  detail.textContent = '';
  setSaveNotice('');
  applyTourName('');
  renderSelection(null);
  sceneNav.clear();
  resetHistory();
  openTour = null;
  tourData = null;
  unsaved = false;
  void refreshLibrary();
}

/** Open a tour in view mode. Replaces whichever tour is already on screen. */
async function showTour(tour: LoadedTour): Promise<void> {
  const token = ++openToken;

  if (unsaved) await flushSave();
  if (token !== openToken) return;

  destroyEngine();
  // Draw the stage before mounting so Marzipano measures a laid-out element.
  setState('view');
  stageStatus.textContent = 'Opening…';
  detail.textContent = '';
  setStatus('');
  setSaveNotice('');
  renderSelection(null);

  let data;
  try {
    data = await loadTourData(assetBaseFor(tour.assets));
  } catch (error) {
    if (token !== openToken) return;
    showLanding(`Could not open that tour — ${(error as Error).message}`);
    return;
  }

  if (token !== openToken) return;

  if (!data.scenes || data.scenes.length === 0) {
    showLanding('That tour has no rooms to show.');
    return;
  }

  openTour = tour;
  tourData = data;
  unsaved = false;

  // The state the tour opened in is the floor of the undo stack.
  resetHistory();
  pushHistory('open');

  const assetBase = assetBaseFor(tour.assets);

  // Draw the scene nav before the engine mounts: mounting walks into the first
  // scene, and that reports the scene back to the nav, which is already
  // listening.
  sceneNav.render(data.scenes, assetBase);

  engine = createTourEngine(pano, data, assetBase, {
    mode: 'view',
    editor: editorPopover,
    onSelectionChange: renderSelection,
    onSceneChange: (sceneId) => sceneNav.setActive(sceneId),
    onEdit: handleEdit,
  });

  // A link needs a second room to point at.
  addLinkBtn.disabled = data.scenes.length < 2;
  addLinkBtn.title = data.scenes.length < 2 ? 'This tour has only one room' : '';

  applyTourName(data.name ?? '');
  stageStatus.textContent = '';
}

/** Move between viewing and editing without touching the engine's camera. */
function setMode(mode: EngineMode): void {
  if (!engine) return;
  // State first: the engine reports a cleared selection as it switches, and
  // the chrome should already read as the new mode when it does.
  setState(mode);
  engine.setMode(mode);
}

/** Run an import, show progress, and react to its result. */
async function importZip(): Promise<void> {
  setStatus('Adding the tour to your library…', 'info');
  const result = await window.keepsake.importZip();

  if (result.ok) {
    // The main process is handing the tour over; `showTour` takes it from here.
    setStatus('');
    return;
  }

  // A dismissed dialog is not a failure — just clear the message.
  setStatus(result.error === 'cancelled' ? '' : result.error);
}

function closeExitMenu(): void {
  exitMenu.hidden = true;
  exitTourBtn.setAttribute('aria-expanded', 'false');
}

/** Leave the tour and go back to the library, saving anything still pending. */
async function leaveTour(): Promise<void> {
  closeExitMenu();
  await flushSave();
  await window.keepsake.closeTour();
  showLanding();
}

/**
 * Zip the tour somewhere else first, then leave. A cancelled export keeps the
 * tour open, because nothing has been copied yet.
 */
async function exportAndLeave(): Promise<void> {
  closeExitMenu();
  await flushSave();

  const result = await window.keepsake.exportTour();

  if (!result.ok) {
    if (result.error !== 'cancelled') setSaveNotice(`Not exported — ${result.error}`);
    return;
  }

  await window.keepsake.closeTour();
  showLanding(`Exported to ${result.path}`, 'info');
}

importZipBtn.addEventListener('click', () => void importZip());

modeViewBtn.addEventListener('click', () => setMode('view'));
modeEditBtn.addEventListener('click', () => setMode('edit'));

addNoteBtn.addEventListener('click', () => {
  engine?.addInfoHotspot();
  // Mounting and filling the popup both happen synchronously above, so the
  // caret can go straight into the new note.
  infoText.focus();
});
addLinkBtn.addEventListener('click', () => engine?.addLinkHotspot());
deleteHotspotBtn.addEventListener('click', () => engine?.removeSelected());
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// The name is part of the document, so it goes through the engine like any
// other edit: saved and undoable, and it is what the library lists.
tourName.addEventListener('input', () => {
  engine?.setTourName(tourName.value);
  document.title = tourName.value || 'keepsake360';
});

// Typing writes straight into the tour data; the save is batched by `handleEdit`.
infoText.addEventListener('input', () => {
  engine?.setInfoText(infoText.value);
});
linkTarget.addEventListener('change', () => {
  if (currentSelection?.kind === 'link') engine?.setLinkTarget(linkTarget.value);
});
// Dragging the pip: capture the pointer so the drag survives leaving the ring.
linkRotation.addEventListener('pointerdown', (event) => {
  if (currentSelection?.kind !== 'link' || event.button !== 0) return;

  event.preventDefault();
  linkRotation.setPointerCapture(event.pointerId);
  linkRotation.classList.add('dragging');
  turnFromPointer(event);

  const move = (moveEvent: PointerEvent) => turnFromPointer(moveEvent);
  const end = () => {
    linkRotation.classList.remove('dragging');
    linkRotation.removeEventListener('pointermove', move);
    linkRotation.removeEventListener('pointerup', end);
    linkRotation.removeEventListener('pointercancel', end);
  };

  linkRotation.addEventListener('pointermove', move);
  linkRotation.addEventListener('pointerup', end);
  linkRotation.addEventListener('pointercancel', end);
});

// Without a pointer, the arrow keys turn the arrow by the same eighths.
linkRotation.addEventListener('keydown', (event) => {
  if (currentSelection?.kind !== 'link') return;

  const step =
    event.key === 'ArrowLeft' || event.key === 'ArrowDown'
      ? -EIGHTH_TURN
      : event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? EIGHTH_TURN
        : 0;

  if (step === 0) return;

  event.preventDefault();
  turnArrow(shownRotation + step);
});

// The popup lives inside Marzipano's hotspot layer, where a pointerdown starts
// a camera drag and a wheel zooms. Those gestures belong to the fields while
// the pointer is over them.
for (const type of ['pointerdown', 'wheel'] as const) {
  editorPopover.addEventListener(type, (event) => event.stopPropagation());
}

exitTourBtn.addEventListener('click', () => {
  const opening = exitMenu.hidden;
  exitMenu.hidden = !opening;
  exitTourBtn.setAttribute('aria-expanded', String(opening));
});

exitPlainBtn.addEventListener('click', () => void leaveTour());
exitExportBtn.addEventListener('click', () => void exportAndLeave());

// Close the menu on a click elsewhere, or on Escape, like any other menu.
document.addEventListener('click', (event) => {
  if (exitMenu.hidden) return;
  const target = event.target as Node;
  if (exitMenu.contains(target) || exitTourBtn.contains(target)) return;
  closeExitMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    // One step at a time: the menu if it is open, then the selected hotspot.
    if (!exitMenu.hidden) closeExitMenu();
    else engine?.clearSelection();
    return;
  }

  if (!(event.metaKey || event.ctrlKey) || state === 'landing') return;

  // Inside a field, the browser's own text undo is the right one.
  if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return;

  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    redo();
  }
});

// A tour imported from the menu arrives here rather than as a page load.
window.keepsake.onTour((tour) => void showTour(tour));

// Subscribe first, then ask: a tour can be waiting from the last session.
const current = await window.keepsake.getTour();
if (current) {
  void showTour(current);
} else {
  showLanding();
}
