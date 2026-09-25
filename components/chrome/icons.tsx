import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const Svg = ({ children, ...p }: P) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    {children}
  </svg>
);

export const IconPrev = (p: P) => <Svg {...p}><path d="M10 3.5 5.5 8l4.5 4.5" /></Svg>;
export const IconNext = (p: P) => <Svg {...p}><path d="M6 3.5 10.5 8 6 12.5" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="7" cy="7" r="4.25" /><path d="m10.2 10.2 3.3 3.3" /></Svg>;
export const IconRandom = (p: P) => (
  <Svg {...p}><path d="M2 4.5h2.5c3.5 0 3.5 7 7 7H14M2 11.5h2.5c1.2 0 1.9-.8 2.5-1.9M9 6.4c.6-1.1 1.3-1.9 2.5-1.9H14" /><path d="m12.3 2.8 1.7 1.7-1.7 1.7M12.3 9.8l1.7 1.7-1.7 1.7" /></Svg>
);
export const IconMuted = (p: P) => (
  <Svg {...p}><path d="M2.5 6v4h2.5L8.5 13V3L5 6H2.5Z" /><path d="m10.5 6 3.5 4M14 6l-3.5 4" /></Svg>
);
export const IconSound = (p: P) => (
  <Svg {...p}><path d="M2.5 6v4h2.5L8.5 13V3L5 6H2.5Z" /><path d="M10.8 5.5a3.5 3.5 0 0 1 0 5M12.6 3.8a6 6 0 0 1 0 8.4" /></Svg>
);
export const IconFullscreen = (p: P) => (
  <Svg {...p}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></Svg>
);
export const IconLink = (p: P) => (
  <Svg {...p}><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.8-.8" /></Svg>
);
export const IconCheck = (p: P) => <Svg {...p}><path d="m3.5 8.5 3 3 6-7" /></Svg>;
export const IconExternal = (p: P) => (
  <Svg {...p}><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></Svg>
);
export const IconSun = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="2.75" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></Svg>
);
export const IconMoon = (p: P) => <Svg {...p}><path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6Z" /></Svg>;
export const IconLocate = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" /></Svg>
);
export const IconEye = (p: P) => (
  <Svg {...p}><circle cx="8" cy="8" r="6.25" /><ellipse cx="8" cy="8" rx="2.6" ry="6.25" /><path d="M1.75 8h12.5" /></Svg>
);
