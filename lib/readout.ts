import { useSyncExternalStore } from 'react';

/**
 * Per-frame globe readouts (cursor, zoom, streams in view). Kept outside React state so a
 * drag re-renders only the status bar, not the whole app.
 */
export interface Readout {
  cursor: { lat: number; lon: number } | null;
  zoom: number;
  inView: number | null;
}

let state: Readout = { cursor: null, zoom: 0, inView: null };
const listeners = new Set<() => void>();

export const readout = {
  set(patch: Partial<Readout>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const snapshot = () => state;

export const useReadout = () => useSyncExternalStore(subscribe, snapshot, snapshot);
