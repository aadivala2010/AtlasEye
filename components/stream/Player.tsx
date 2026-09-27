'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Stream } from '@/lib/stream';
import { IconExternal } from '@/components/chrome/icons';

export interface PlayerHandle { fullscreen(): void }

interface Props {
  ref?: Ref<PlayerHandle>;
  stream: Stream;
  muted: boolean;
  builtAt: string;
}

type Status = 'loading' | 'ready' | 'unavailable';

/** No message from the YouTube player at all within this window = the embed never came up. */
const SILENCE_TIMEOUT_MS = 12_000;

/**
 * Exactly one live player. The parent keys this component by stream id, so switching streams
 * unmounts (destroys) the old iframe / video / image before the new one exists.
 */
export default function Player({ ref, stream, muted, builtAt }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');

  useImperativeHandle(ref, () => ({
    fullscreen: () => void box.current?.requestFullscreen?.().catch(() => undefined),
  }), []);

  return (
    <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-[2px] border border-strong bg-void">
      {status !== 'unavailable' && (
        stream.kind === 'hls' ? <HlsVideo stream={stream} muted={muted} status={status} setStatus={setStatus} />
        : stream.kind === 'mjpeg' ? <Mjpeg stream={stream} status={status} setStatus={setStatus} />
        : stream.kind === 'snapshot' ? <Snapshot stream={stream} status={status} setStatus={setStatus} />
        : <YouTube stream={stream} muted={muted} status={status} setStatus={setStatus} />
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="label ellipsis">Acquiring signal</span>
        </div>
      )}
      {status === 'unavailable' && <Unavailable stream={stream} builtAt={builtAt} />}
      {/* Inset line so the frame reads as recessed. */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_var(--bg-void)]" />
    </div>
  );
}

interface PartProps { stream: Stream; status: Status; setStatus(s: Status | ((p: Status) => Status)): void }

const fade = (status: Status) =>
  `absolute inset-0 h-full w-full transition-opacity duration-400 ease-atlas ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`;

/** YouTube over the documented postMessage protocol — no IFrame API script, no key. */
function YouTube({ stream, muted, status, setStatus }: PartProps & { muted: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const heard = useRef(false);

  const command = (func: string) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let msg: { event?: string; info?: { playerState?: number } | number | null };
      try { msg = JSON.parse(e.data) as typeof msg; } catch { return; }
      heard.current = true;
      // 2 bad id, 5 html5 error, 100 removed/private, 101/150 embedding disabled.
      if (msg.event === 'onError') setStatus('unavailable');
      else if (msg.event === 'onReady' || msg.event === 'initialDelivery' || msg.event === 'infoDelivery') {
        setStatus((s) => (s === 'loading' ? 'ready' : s));
      }
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => { if (!heard.current) setStatus('unavailable'); }, SILENCE_TIMEOUT_MS);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timer); };
  }, [setStatus]);

  // Autoplay has to start muted; honour the user's unmute once the player is listening.
  useEffect(() => {
    if (status === 'ready') command(muted ? 'mute' : 'unMute');
  }, [muted, status]);

  const src = `https://www.youtube-nocookie.com/embed/${stream.id}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`
    + `&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;

  return (
    <iframe
      ref={frame}
      src={src}
      title={stream.name}
      onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: stream.id, channel: 'widget' }), '*')}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className={fade(status)}
    />
  );
}

/** An agency's live HLS video. Safari plays it natively; elsewhere hls.js is loaded on demand. */
function HlsVideo({ stream, muted, status, setStatus }: PartProps & { muted: boolean }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    const url = stream.url;
    if (!el || !url) { setStatus('unavailable'); return; }
    let destroy = () => {};
    let cancelled = false;
    // Ready once the first frame's data is in — not "playing", which background tabs and
    // autoplay policies can hold back even though the stream is fine.
    const onPlaying = () => setStatus('ready');
    const onError = () => setStatus('unavailable');
    el.addEventListener('loadeddata', onPlaying);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('error', onError);
    // Live feeds sometimes stall before the first frame; don't leave a spinner forever.
    const timer = window.setTimeout(() => setStatus((s) => (s === 'loading' ? 'unavailable' : s)), 20_000);

    // Prefer hls.js wherever Media Source Extensions exist: some browsers (recent Chrome) answer
    // "maybe" to native HLS and then stall. Native playback is the fallback (iOS Safari).
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        if (!el.canPlayType('application/vnd.apple.mpegurl')) { setStatus('unavailable'); return; }
        el.src = url;
        void el.play().catch(() => undefined);
        return;
      }
      const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setStatus('unavailable'); });
      hls.on(Hls.Events.FRAG_BUFFERED, () => setStatus((st) => (st === 'loading' ? 'ready' : st)));
      hls.loadSource(url);
      hls.attachMedia(el);
      void el.play().catch(() => undefined);
      destroy = () => hls.destroy();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      el.removeEventListener('loadeddata', onPlaying);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('error', onError);
      destroy();
      el.removeAttribute('src');
      el.load();
    };
  }, [stream.url, setStatus]);

  useEffect(() => { if (video.current) video.current.muted = muted; }, [muted]);

  return <video ref={video} muted autoPlay playsInline className={`${fade(status)} object-contain`} />;
}

/** An operator's MJPEG stream: live video that an <img> plays natively, no player library. */
function Mjpeg({ stream, status, setStatus }: PartProps) {
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const el = img.current;
    if (!el || !stream.url) { setStatus('unavailable'); return; }
    // Set here, not in JSX, so the cleanup's removal (which closes the never-ending response) is undone on remount.
    el.src = stream.url;
    // Browsers disagree on whether a multipart image fires `load`; a decoded first frame is the real signal.
    const poll = window.setInterval(() => { if (el.naturalWidth) setStatus((s) => (s === 'loading' ? 'ready' : s)); }, 250);
    const timer = window.setTimeout(() => setStatus((s) => (s === 'loading' ? 'unavailable' : s)), 20_000);
    return () => {
      clearInterval(poll);
      clearTimeout(timer);
      el.removeAttribute('src');
    };
  }, [stream.url, setStatus]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a live multipart stream, not an optimisable image
    <img
      ref={img}
      alt={`Live camera: ${stream.name}`}
      onLoad={() => setStatus('ready')}
      onError={() => setStatus((s) => (s === 'loading' ? 'unavailable' : s))}
      referrerPolicy="no-referrer"
      className={`${fade(status)} object-contain`}
    />
  );
}

/** A still from the operator, re-fetched on its published cadence. Labelled SNAPSHOT in the panel. */
function Snapshot({ stream, status, setStatus }: PartProps) {
  const [tick, setTick] = useState(() => Date.now());
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const refresh = Math.max(5, stream.refresh ?? 60);

  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), refresh * 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const base = stream.url ?? '';
  const src = `${base}${base.includes('?') ? '&' : '?'}_t=${Math.floor(tick / 1000)}`;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote, uncacheable, refreshed frames */}
      <img
        src={src}
        alt={`Latest camera image: ${stream.name}`}
        onLoad={() => { setStatus('ready'); setLoadedAt(new Date()); }}
        // A failed refresh keeps the last good frame; only a first-load failure is "unavailable".
        onError={() => setStatus((s) => (s === 'loading' ? 'unavailable' : s))}
        referrerPolicy="no-referrer"
        className={`${fade(status)} object-contain`}
      />
      {status === 'ready' && loadedAt && (
        <div className="absolute bottom-1.5 left-1.5 rounded-[2px] bg-void/80 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-secondary">
          SNAPSHOT · {loadedAt.toTimeString().slice(0, 8)} · EVERY {refresh < 60 ? `${refresh}S` : `${Math.round(refresh / 60)}M`}
        </div>
      )}
    </>
  );
}

function Unavailable({ stream, builtAt }: { stream: Stream; builtAt: string }) {
  const href = stream.kind === 'youtube' ? `https://www.youtube.com/watch?v=${stream.id}` : stream.url;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[repeating-linear-gradient(135deg,transparent_0_6px,#0B0D12_6px_7px)] px-6 text-center">
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-dead">
        <span className="h-1.5 w-1.5 rounded-full bg-dead" />
        STREAM UNAVAILABLE
      </div>
      <p className="max-w-72 text-[12px] leading-5 text-secondary">
        {stream.kind === 'youtube'
          ? 'The broadcaster may have ended this stream or blocked embedding since the catalog was built.'
          : 'The operator’s camera is not answering right now. Cameras go offline for maintenance and weather.'}
      </p>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-[2px] border border-strong bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-primary transition-colors duration-200 ease-atlas hover:bg-hover hover:text-accent"
        >
          {stream.kind === 'youtube' ? 'Open on YouTube' : 'Open source feed'} <IconExternal width={12} height={12} />
        </a>
      )}
      <span className="label">Catalog built {builtAt.slice(0, 10)}</span>
    </div>
  );
}
