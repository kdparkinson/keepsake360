/**
 * This file is loaded by Vite and runs in the "renderer" (Window) context.
 *
 * Its only job here is the landing experience: when the user picks a tour ZIP,
 * ask the main process (via the preload bridge) to load it, then react to the
 * result.
 */
import './index.css';
import type { TourImportResult } from './types';

// These elements live in our own index.html, so they always exist.
const importZipBtn = document.querySelector<HTMLButtonElement>('#import-zip')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

/** Run an import, show progress, and react to its result. */
async function run(importer: () => Promise<TourImportResult>, label: string): Promise<void> {
  status.textContent = label;
  const result = await importer();
  if (result.ok) {
    // The main process is switching the window to the tour now.
    status.textContent = `Loading "${result.directory}"…`;
  } else if (result.error !== 'cancelled') {
    status.textContent = result.error;
  } else {
    // The user simply dismissed the dialog — clear any message.
    status.textContent = '';
  }
}

importZipBtn.addEventListener(
  'click',
  () => void run(() => window.keepsake.importZip(), 'Extracting the ZIP…'),
);

console.log('🏠 keepsake360 — main and renderer are connected.');
