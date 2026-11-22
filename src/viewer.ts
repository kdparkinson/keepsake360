import Marzipano from 'marzipano';

/**
 * This file is the entry point for the Universal Viewer.
 *
 * It reads the tour directory from the URL, loads the tour's `data.js`, and
 * initializes the Marzipano panorama engine. The tour's files are served by
 * the main process over the `keepsake-tour://` scheme, so they can be read
 * from wherever the tour lives (a chosen folder, or a ZIP extracted to a temp
 * directory), in both the dev server and packaged builds.
 */

const TOUR_ORIGIN = 'keepsake-tour://tour';

interface MarzipanoLevel {
  tileSize: number;
  size: number;
  fallbackOnly?: boolean;
}

interface MarzipanoViewParameters {
  pitch: number;
  yaw: number;
  fov: number;
}

interface LinkHotspot {
  yaw: number;
  pitch: number;
  rotation: number;
  target: string;
}

interface InfoHotspot {
  yaw: number;
  pitch: number;
  text: string;
}

interface MarzipanoScene {
  id: string;
  name: string;
  levels: MarzipanoLevel[];
  faceSize: number;
  initialViewParameters: MarzipanoViewParameters;
  linkHotspots?: LinkHotspot[];
  infoHotspots?: InfoHotspot[];
}

interface MarzipanoAppData {
  name: string;
  scenes: MarzipanoScene[];
  settings: any;
}

declare global {
  interface Window {
    /** Populated by the tour's `data.js`, which we inject as a script. */
    APP_DATA?: MarzipanoAppData;
  }
}

/** Replace the page with a readable message instead of a blank black screen. */
function showError(title: string, detail = ''): void {
  document.body.replaceChildren();

  const wrapper = document.createElement('div');
  wrapper.className = 'message';

  const heading = document.createElement('h1');
  heading.textContent = title;
  wrapper.append(heading);

  if (detail) {
    const paragraph = document.createElement('p');
    paragraph.textContent = detail;
    wrapper.append(paragraph);
  }

  document.body.append(wrapper);
}

/** Inject the tour's `data.js` and resolve with the data it defines. */
function loadTourData(assetBase: string): Promise<MarzipanoAppData> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // A timestamp avoids a stale cached data.js when switching tours quickly.
    script.src = `${assetBase}/data.js?t=${Date.now()}`;

    script.onload = () => {
      if (window.APP_DATA) {
        resolve(window.APP_DATA);
      } else {
        reject(new Error('data.js did not define APP_DATA.'));
      }
    };

    script.onerror = () => reject(new Error('data.js could not be read.'));

    document.head.append(script);
  });
}

/** Add the tour's navigation and information hotspots to a scene. */
function addHotspots(scene: any, sceneData: MarzipanoScene, scenes: Map<string, any>): void {
  const container = scene.hotspotContainer();

  for (const hotspot of sceneData.linkHotspots ?? []) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'hotspot hotspot-link';
    marker.setAttribute('aria-label', 'Go to another room');
    marker.addEventListener('click', () => {
      scenes.get(hotspot.target)?.switchTo();
    });
    container.createHotspot(marker, { yaw: hotspot.yaw, pitch: hotspot.pitch });
  }

  for (const hotspot of sceneData.infoHotspots ?? []) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'hotspot hotspot-info';
    marker.setAttribute('aria-label', 'Show information');
    marker.textContent = 'i';

    // The label is revealed on hover/focus by the styles in viewer.html.
    const bubble = document.createElement('span');
    bubble.className = 'hotspot-bubble';
    bubble.textContent = hotspot.text;
    marker.append(bubble);

    container.createHotspot(marker, { yaw: hotspot.yaw, pitch: hotspot.pitch });
  }
}

async function init(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const tourDir = params.get('dir');

  if (!tourDir) {
    showError('No tour was specified.');
    return;
  }

  // The main process works out which folder holds this tour's `data.js` and
  // `tiles/`, since some exports wrap both in a subfolder (`app-files/`).
  const assetRoot = (params.get('assets') ?? '').replace(/^\/+|\/+$/g, '');
  const assetBase = assetRoot ? `${TOUR_ORIGIN}/${assetRoot}` : TOUR_ORIGIN;

  let appData: MarzipanoAppData;
  try {
    appData = await loadTourData(assetBase);
  } catch (error) {
    showError('Could not load this tour.', `${(error as Error).message} (${tourDir})`);
    return;
  }

  if (!appData.scenes || appData.scenes.length === 0) {
    showError('This tour has no rooms to show.');
    return;
  }

  const element = document.getElementById('pano');
  if (!element) return;

  const viewer = new Marzipano.Viewer(element);
  const scenes = new Map<string, any>();

  for (const sceneData of appData.scenes) {
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
    addHotspots(scene, sceneData, scenes);
  }

  scenes.get(appData.scenes[0].id)?.switchTo();
  document.title = appData.name || 'keepsake360';
}

void init();
