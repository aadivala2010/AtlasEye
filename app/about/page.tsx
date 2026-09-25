import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'About — Atlas Eye' };

const REPO = 'https://github.com/aadivala2010/AtlasEye/issues';

export default function About() {
  return (
    <main className="min-h-dvh bg-void">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <a href="/" className="font-mono text-[10px] tracking-[0.08em] text-tertiary hover:text-accent">← BACK TO GLOBE</a>
        <h1 className="mt-6 text-[22px] font-semibold tracking-[0.14em]">ATLAS EYE</h1>
        <p className="mt-3 text-[14px] leading-6 text-secondary">
          A live window onto anywhere on Earth: a globe of public live streams. Spin it, click a point, and watch
          what is happening there right now.
        </p>

        <Section title="What this is">
          <p>
            Every pin is a public live camera that its operator chose to publish: YouTube live streams (city cameras,
            beaches, harbours, wildlife feeds, volcano watches), live road-camera video from transport agencies, and
            clearly labelled snapshot cameras that refresh every few seconds to minutes. The list comes from two openly licensed catalogs that verify
            the streams are live and embeddable. Atlas Eye places each one on the globe from its title using an offline
            gazetteer, or from hand-placed coordinates for famous landmarks. A stream whose location can&apos;t be
            resolved with confidence is left off the globe rather than guessed.
          </p>
          <p>
            Atlas Eye is <strong className="text-primary">not affiliated with YouTube, Google, or any broadcaster</strong>.
            Streams are embedded with YouTube&apos;s standard privacy-enhanced player and remain the property of their
            respective broadcasters.
          </p>
        </Section>

        <Section title="Privacy">
          <p>
            Atlas Eye collects no personal data: no accounts, no analytics, no cookies of its own, no tracking. The
            &ldquo;distance from me&rdquo; readout asks your browser for your location only when you click it, and that
            position never leaves your device. Video plays through youtube-nocookie.com; once you play a stream,
            YouTube&apos;s own policies apply to that player.
          </p>
        </Section>

        <Section title="Removal requests">
          <p>
            If you operate a stream shown here and want it removed, open an issue on the{' '}
            <a className="text-accent hover:underline" href={REPO}>project repository</a> with the YouTube video ID.
            It will be added to the exclusion list and disappear at the next catalog build. You can also request
            removal from the upstream catalogs (Famelack: dmca@famelack.com).
          </p>
        </Section>

        <Section title="Credits">
          <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3">
            <Credit k="Stream catalog">
              <a className="text-accent hover:underline" href="https://github.com/famelack/famelack-data">Famelack</a> (MIT,
              © 2026 Famelack) and{' '}
              <a className="text-accent hover:underline" href="https://github.com/tantran21501/camlisted">camlisted</a> (MIT,
              © 2026 zenith605). License notices are retained in ATTRIBUTION.md.
            </Credit>
            <Credit k="Camera operators">
              Public traffic and weather cameras, shown with each operator&apos;s published coordinates:{' '}
              <a className="text-accent hover:underline" href="https://cwwp2.dot.ca.gov/">Caltrans</a> (California),{' '}
              <a className="text-accent hover:underline" href="https://deldot.gov/map/">Delaware DOT</a>,{' '}
              <a className="text-accent hover:underline" href="https://webcams.nyctmc.org/">NYC DOT</a>,{' '}
              <a className="text-accent hover:underline" href="https://www.drivebc.ca/">DriveBC</a> — contains information licensed under the{' '}
              <a className="text-accent hover:underline" href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc">Open Government Licence – British Columbia</a>,{' '}
              <a className="text-accent hover:underline" href="https://www.digitraffic.fi/en/">Fintraffic / digitraffic.fi</a> (road weather cameras, CC BY 4.0), and the{' '}
              Transport Department of the Hong Kong SAR via <a className="text-accent hover:underline" href="https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images">DATA.GOV.HK</a>.
              {' '}Snapshot cameras are still images the operator refreshes every few seconds to minutes; they are labelled SNAPSHOT.
            </Credit>
            <Credit k="Place data">
              <a className="text-accent hover:underline" href="https://www.geonames.org/">GeoNames</a>, licensed under{' '}
              <a className="text-accent hover:underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </Credit>
            <Credit k="Imagery">
              <a className="text-accent hover:underline" href="https://s2maps.eu">Sentinel-2 cloudless 2016</a> by EOX IT Services
              GmbH (contains modified Copernicus Sentinel data 2016), licensed under{' '}
              <a className="text-accent hover:underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </Credit>
            <Credit k="Map tiles">
              © <a className="text-accent hover:underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>,
              served by <a className="text-accent hover:underline" href="https://openfreemap.org/">OpenFreeMap</a>
              {' '}(fallback: <a className="text-accent hover:underline" href="https://carto.com/attributions">CARTO</a>).
            </Credit>
            <Credit k="Streams">
              Property of their respective broadcasters, embedded via YouTube&apos;s public player.
            </Credit>
            <Credit k="Rendering">MapLibre GL JS (BSD-3-Clause). Type: Geist Sans &amp; Geist Mono (OFL).</Credit>
          </dl>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 border-t border-subtle pt-4">
      <h2 className="label">{title}</h2>
      <div className="mt-3 space-y-3 text-[13px] leading-6 text-secondary">{children}</div>
    </section>
  );
}

function Credit({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="label pt-1">{k}</dt>
      <dd>{children}</dd>
    </>
  );
}
