/**
 * Real cockpit photos (Wikimedia Commons, see ATTRIBUTION.md) with the windscreen cut to alpha,
 * so the synthetic outside view shows through. `horizon`: centre of the window band, % from top.
 * `credit` is shown on the photo, as CC BY / BY-SA require.
 */
export interface CockpitPhoto { src: string; aspect: number; horizon: number; credit: string }

const photo = (k: string, w: number, h: number, horizon: number, credit: string): CockpitPhoto =>
  ({ src: `/cockpits/${k}.webp`, aspect: w / h, horizon, credit });

const A320 = photo('a320', 1600, 907, 29, 'Joao Carlos Medau · CC BY 2.0');
const B737 = photo('b737', 1600, 608, 46, 'Matti Blume · CC BY-SA 4.0');
const B787 = photo('b787', 1280, 427, 60, 'Alex Beltyukov · CC BY-SA 3.0');
const B777 = photo('b777', 1600, 900, 22, 'Aaron Davis · CC BY-SA 4.0');
const A330 = photo('a330', 1200, 520, 32, 'Curimedia · CC BY 2.0');
const A350 = photo('a350', 1600, 512, 39, 'Joao Carlos Medau · CC BY 2.0');
const B757 = photo('b757', 1600, 640, 29, 'JHenryW · CC BY-SA 3.0');
const EJET = photo('ejet', 1600, 469, 47, 'EneasMx · CC BY 4.0');
const CRJ = photo('crj', 1280, 499, 40, 'Cory W. Watts · CC BY-SA 2.0');
const DH8D = photo('dh8d', 1600, 768, 35, 'Rick Rydell · CC0');
const ATR = photo('atr', 1600, 715, 32, 'Aviationbystirling · CC BY 4.0');

const BY_TYPE: Record<string, CockpitPhoto> = {
  A319: A320, A320: A320, A20N: A320, A321: A320, A21N: A320,
  B737: B737, B738: B737, B739: B737, B38M: B737,
  B788: B787, B789: B787, B77W: B777, A332: A330, A333: A330, A359: A350,
  B752: B757, B763: B757, // 757 and 767 share one flight deck design
  E75L: EJET, E190: EJET, E145: EJET, // ponytail: E145 borrows the E-Jet deck; add its own photo if it matters
  CRJ7: CRJ, CRJ9: CRJ, DH8D: DH8D, AT76: ATR,
};

export const cockpitFor = (type?: string): CockpitPhoto | undefined => (type ? BY_TYPE[type] : undefined);
