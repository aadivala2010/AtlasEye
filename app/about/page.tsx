import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CATALOG_SOURCES, SOURCE_CREDIT } from '@/lib/stream';

export const metadata: Metadata = { title: 'About — Atlas Eye' };

const REPO = 'https://github.com/aadivala2010/AtlasEye/issues';
const OPERATORS = Object.entries(SOURCE_CREDIT).filter(([id]) => !(CATALOG_SOURCES as readonly string[]).includes(id));

export default function About() {
  return (
    <main className="min-h-dvh bg-void">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <a href="/" className="font-mono text-[10px] tracking-[0.08em] text-tertiary hover:text-accent">← BACK TO GLOBE</a>
        <h1 className="mt-6 text-[22px] font-semibold tracking-[0.14em]">ATLAS EYE</h1>
        <p className="mt-3 text-[14px] leading-6 text-secondary">
          A live window onto anywhere on Earth: a globe of public live streams, the sky as the satellites see it
          now, everything in orbit, and what is happening on the planet as it happens. Spin it, click a point, and
          watch what is happening there right now, or scrub back through time.
        </p>

        <Section title="What this is">
          <p>
            Every pin is a public live camera that its operator chose to publish: YouTube live streams (city cameras,
            beaches, harbours, wildlife feeds, volcano watches), live road-camera video from transport agencies, and
            clearly labelled snapshot cameras that refresh every few seconds to minutes. Road, weather, ocean and mountain
            cameras come straight from their operators&apos; public feeds, at the coordinates the operator publishes, plus
            webcams mapped on OpenStreetMap. The YouTube list comes from two openly licensed catalogs that verify
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
            YouTube&apos;s own policies apply to that player. Radio plays straight from each station&apos;s own server.
            Pulse alerts use your browser&apos;s notifications only if you switch them on, and are sent by your own browser.
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
              Public traffic, weather and scenic cameras, shown with each operator&apos;s published coordinates and
              linked from every stream:{' '}
              {OPERATORS.map(([id, c], i) => (
                <span key={id}>
                  <a className="text-accent hover:underline" href={c.href}>{c.label}</a>
                  {i < OPERATORS.length - 1 ? ', ' : '. '}
                </span>
              ))}
              DriveBC contains information licensed under the{' '}
              <a className="text-accent hover:underline" href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc">Open Government Licence – British Columbia</a>.
              {' '}OpenStreetMap webcams are cameras that mappers linked to a public image; each image belongs to whoever runs the camera.
              {' '}Snapshot cameras are still images the operator refreshes every few seconds to minutes; they are labelled SNAPSHOT.
            </Credit>
            <Credit k="Place data">
              <a className="text-accent hover:underline" href="https://www.geonames.org/">GeoNames</a>, licensed under{' '}
              <a className="text-accent hover:underline" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
            </Credit>
            <Credit k="Imagery">
              <a className="text-accent hover:underline" href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">Esri World Imagery</a>:
              Esri, Maxar, Earthstar Geographics, and the GIS User Community.
            </Credit>
            <Credit k="Sky">
              Live clouds and infrared from GOES-18, GOES-19 and Himawari-9 via{' '}
              <a className="text-accent hover:underline" href="https://worldview.earthdata.nasa.gov">NASA EOSDIS GIBS</a>, and
              from Meteosat-12 and Meteosat-9, © <a className="text-accent hover:underline" href="https://view.eumetsat.int">EUMETSAT</a>,
              as is the lightning (MTG Lightning Imager). The day&apos;s true-colour pass (VIIRS NOAA-20; MODIS Terra
              before 2018), Black Marble city lights, IMERG rain, GHRSST sea temperature and sea ice, MODIS aerosols and
              snow, and AIRS carbon monoxide are NASA GIBS too. Radar:{' '}
              <a className="text-accent hover:underline" href="https://www.rainviewer.com">RainViewer</a>. Aurora: NOAA
              Space Weather Prediction Center (OVATION).
            </Credit>
            <Credit k="Earth">
              Earthquakes: <a className="text-accent hover:underline" href="https://earthquake.usgs.gov">USGS</a>.
              Storms, wildfires, volcanoes and ice: <a className="text-accent hover:underline" href="https://eonet.gsfc.nasa.gov">NASA EONET</a>.
              Fire detections: <a className="text-accent hover:underline" href="https://firms.modaps.eosdis.nasa.gov">NASA FIRMS</a> (VIIRS NOAA-20).
              Launches: <a className="text-accent hover:underline" href="https://thespacedevs.com">The Space Devs</a> Launch Library 2.
              Geomagnetic storms: NOAA SWPC.
            </Credit>
            <Credit k="Orbits">
              Orbital elements from <a className="text-accent hover:underline" href="https://celestrak.org">CelesTrak</a>,
              propagated with satellite.js (MIT). ISS video: the station&apos;s public live streams, from the stream catalogs above.
            </Credit>
            <Credit k="Flights">
              <a className="text-accent hover:underline" href="https://adsb.lol">adsb.lol</a>, licensed under the ODbL.
            </Credit>
            <Credit k="Radio">
              Station list from <a className="text-accent hover:underline" href="https://www.radio-browser.info">Radio Browser</a>, the
              free, community-kept radio directory. Each stream belongs to its station.
            </Credit>
            <Credit k="Dossier">
              Weather, air quality and sea state: <a className="text-accent hover:underline" href="https://open-meteo.com">Open-Meteo</a>{' '}
              (CC BY 4.0). What&apos;s here: <a className="text-accent hover:underline" href="https://www.wikipedia.org">Wikipedia</a>{' '}
              (CC BY-SA). Street-level photos: <a className="text-accent hover:underline" href="https://panoramax.fr">Panoramax</a>,
              each under its contributor&apos;s licence.
            </Credit>
            <Credit k="Terrain">Mapzen Terrarium elevation tiles (AWS Open Data).</Credit>
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
