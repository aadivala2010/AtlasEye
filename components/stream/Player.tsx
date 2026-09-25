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

/** No message from the player at all within this window = the embed never came up. */
const SILENCE_TIMEOUT_MS = 12_000;

/**
 * Exactly one YouTube iframe. The parent keys this component by stream id, so switching
 * streams unmounts (destroys) the old iframe before the new one exists.
 * Talks to the player over the documented postMessage protocol; no IFrame API script needed.
 */
export default function Player({ ref, stream, muted, builtAt }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const heard = useRef(false);

  const command = (func: string) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');

  useImperativeHandle(ref, () => ({
    fullscreen: () => void box.current?.requestFullscreen?.().catch(() => undefined),
  }), []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return;
      let msg: { event?: string; info?: { playerState?: number } | number | null };
      try { msg = JSON.parse(e.data) as typeof msg; } catch { return; }
      heard.current = true;
      // 2 bad id, 5 html5 error, 100 removed/private, 101/150 embedding disabled.
      if (msg.event === 'onError') setStatus('unavailable');
      else if (msg.event === 'onReady' || msg.event === 'initialDelivery') setStatus((s) => (s === 'loading' ? 'ready' : s));
      else if (msg.event === 'infoDelivery' && typeof msg.info === 'object' && msg.info?.playerState !== undefined) {
        setStatus((s) => (s === 'loading' ? 'ready' : s));
      }
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => { if (!heard.current) setStatus('unavailable'); }, SILENCE_TIMEOUT_MS);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timer); };
  }, []);

  // Autoplay has to start muted; honour the user's unmute once the player is listening.
  useEffect(() => {
    if (status === 'ready') command(muted ? 'mute' : 'unMute');
  }, [muted, status]);

  const onLoad = () => {
    // Subscribe to player events (what the official IFrame API does under the hood).
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: stream.id, channel: 'widget' }), '*');
  };

  const src = `https://www.youtube-nocookie.com/embed/${stream.id}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1`
    + `&enablejsapi=1&origin=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`;

  return (
    <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-[2px] border border-strong bg-void">
      {status !== 'unavailable' && (
        <iframe
          ref={frame}
          src={src}
          title={stream.name}
          onLoad={onLoad}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className={`absolute inset-0 h-full w-full transition-opacity duration-400 ease-atlas ${status === 'ready' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="label ellipsis">Acquiring signal</span>
        </div>
      )}
      {status === 'unavailable' && <Unavailable id={stream.id} builtAt={builtAt} />}
      {/* Inset line so the frame reads as recessed. */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_var(--bg-void)]" />
    </div>
  );
}

function Unavailable({ id, builtAt }: { id: string; builtAt: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[repeating-linear-gradient(135deg,transparent_0_6px,#0B0D12_6px_7px)] px-6 text-center">
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-dead">
        <span className="h-1.5 w-1.5 rounded-full bg-dead" />
        STREAM UNAVAILABLE
      </div>
      <p className="max-w-72 text-[12px] leading-5 text-secondary">
        The broadcaster may have ended this stream or blocked embedding since the catalog was built.
      </p>
      <a
        href={`https://www.youtube.com/watch?v=${id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 rounded-[2px] border border-strong bg-raised px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-primary transition-colors duration-200 ease-atlas hover:bg-hover hover:text-accent"
      >
        Open on YouTube <IconExternal width={12} height={12} />
      </a>
      <span className="label">Catalog built {builtAt.slice(0, 10)}</span>
    </div>
  );
}
