/**
 * The shape of a tour's `data.js` — the format Marzipano exports and the
 * marzipano-editor tool writes. Kept independent of Marzipano's own types so
 * the shell can reason about a tour without touching the render engine.
 */

export interface TourLevel {
  tileSize: number;
  size: number;
  fallbackOnly?: boolean;
}

export interface TourViewParameters {
  pitch: number;
  yaw: number;
  fov: number;
}

export interface TourLinkHotspot {
  yaw: number;
  pitch: number;
  /** Direction the arrow points, in radians; 0 points straight up. */
  rotation: number;
  target: string;
}

export interface TourInfoHotspot {
  yaw: number;
  pitch: number;
  title?: string;
  text: string;
}

export interface TourScene {
  id: string;
  name: string;
  levels: TourLevel[];
  faceSize: number;
  initialViewParameters: TourViewParameters;
  linkHotspots?: TourLinkHotspot[];
  infoHotspots?: TourInfoHotspot[];
}

export interface TourSettings {
  mouseViewMode?: 'drag' | 'qtvr';
  autorotateEnabled?: boolean;
  autorotateSpeed?: number;
  fullscreenButton?: boolean;
  viewControlButtons?: boolean;
}

export interface TourAppData {
  name: string;
  scenes: TourScene[];
  settings?: TourSettings;
}
