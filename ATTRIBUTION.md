# Attribution

Atlas Eye redistributes derived data from the projects below. Their license
texts are reproduced in full here and in `licenses/`.

| Source | What we use | License | Where it lives in this repo |
|---|---|---|---|
| [Famelack](https://github.com/famelack/famelack-data) | webcam catalog (`webcams/raw/categories/*.json`) | MIT, © 2026 Famelack | `data/upstream/famelack.json`, derived `public/data/streams.json` and `public/data/iss.json` |
| [camlisted](https://github.com/tantran21501/camlisted) | `data/streams.json` | MIT, © 2026 zenith605 | `data/upstream/camlisted.json`, derived `public/data/streams.json` and `public/data/iss.json` |
| [GeoNames](https://www.geonames.org/) | `cities1000`, `alternateNamesV2`, `admin1CodesASCII` | CC BY 4.0 | `data/gazetteer/cities.tsv` (pruned; see below) |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9): Esri, Maxar, Earthstar Geographics, and the GIS User Community | satellite imagery of the globe and cockpit view | Esri terms of use, attribution required | not stored; tiles are fetched from server.arcgisonline.com at runtime |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | map data in the basemap tiles | ODbL 1.0 | not stored; tiles are fetched from OpenFreeMap / CARTO at runtime |
| [NASA EOSDIS GIBS](https://nasa-gibs.github.io/gibs-api-docs/) / [Worldview](https://worldview.earthdata.nasa.gov) | GOES-East/-West and Himawari infrared, VIIRS (NOAA-20) and MODIS (Terra) true colour, Black Marble night lights, IMERG rain, GHRSST sea temperature and ice, MODIS aerosol and snow, AIRS carbon monoxide | NASA open data, [EOSDIS data use policy](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies) — attribution requested | not stored; tiles are fetched from gibs.earthdata.nasa.gov at runtime, only while a layer is on |
| [EUMETSAT View Service](https://view.eumetsat.int) | Meteosat-12 (MTG) and Meteosat-9 (IODC) infrared, MTG Lightning Imager | © EUMETSAT, [EUMETSAT data policy](https://www.eumetsat.int/eumetsat-data-licensing) — attribution required | not stored; tiles fetched at runtime |
| [RainViewer](https://www.rainviewer.com/api.html) | weather radar tiles | RainViewer API terms, attribution | not stored; fetched at runtime |
| [NOAA SWPC](https://www.swpc.noaa.gov/) | OVATION aurora nowcast, planetary K index | US government work, public domain | not stored; fetched at runtime |
| [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/) | earthquake feeds and archive | US government work, public domain | not stored; fetched at runtime |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | natural events: storms, wildfires, volcanoes, ice | NASA open data | not stored; fetched at runtime |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) | VIIRS (NOAA-20) active fires, last 24 h | NASA open data; acknowledgement: NASA LANCE FIRMS | not stored; binned per request in `app/api/fires` and cached at the CDN |
| [The Space Devs](https://thespacedevs.com/) Launch Library 2 | upcoming launches | free API, attribution | not stored; fetched at runtime |
| [CelesTrak](https://celestrak.org/) | GP orbital elements of active satellites | free to use, attribution | not stored; cached at the CDN by `app/api/satellites` |
| [Radio Browser](https://www.radio-browser.info/) | station names, coordinates, stream URLs, tags | free and open (usable in free and non-free software) | `public/data/radio.json` (filtered; streams are not stored) |
| [Open-Meteo](https://open-meteo.com/) | weather, air quality, marine conditions for the dossier | CC BY 4.0 | not stored; fetched at runtime |
| [Wikipedia](https://www.wikipedia.org/) | titles, descriptions and thumbnails of nearby articles | CC BY-SA 4.0 (text), per-file (images) | not stored; fetched at runtime |
| [Panoramax](https://panoramax.fr/) | street-level photo thumbnails near a dossier point | per photo, as each instance publishes it | not stored; fetched at runtime |
| [adsb.lol](https://adsb.lol/) | live aircraft positions | ODbL 1.0 | not stored; proxied at runtime by `app/api/flights` |
| Mapzen Terrarium ([AWS Open Data](https://registry.opendata.aws/terrain-tiles/)) | elevation tiles for 3D terrain and the cockpit | open data, attribution | not stored; fetched at runtime |
| [Caltrans](https://cwwp2.dot.ca.gov/) CCTV status feeds | camera list, coordinates, live video / still URLs | public California state data | `data/upstream/agencies.json` (normalised); video and images are not stored |
| [Delaware DOT](https://tmc.deldot.gov/json/videocamera.json) | camera list, coordinates, live video URLs | public state data | as above |
| [NYC DOT](https://webcams.nyctmc.org/) | camera list, coordinates, still-image URLs | public city data | as above |
| [DriveBC](https://www.drivebc.ca/) | webcam list, coordinates, still-image URLs | [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc) | as above |
| [Fintraffic / Digitraffic](https://www.digitraffic.fi/en/) | road weather camera stations and image URLs | CC BY 4.0 | as above |
| Transport Department, HKSAR via [DATA.GOV.HK](https://data.gov.hk/) | traffic snapshot camera locations and image URLs | [DATA.GOV.HK terms of use](https://data.gov.hk/en/terms-and-conditions) | as above |
| US state and Canadian provincial 511 traveller-information sites: [511NY](https://511ny.org/), [511GA](https://511ga.org/), [AZ511](https://az511.gov/), [511WI](https://511wi.gov/), [511LA](https://511la.org/), [Idaho 511](https://511.idaho.gov/), [UDOT Traffic](https://udottraffic.utah.gov/), [NVRoads](https://www.nvroads.com/), [511PA](https://www.511pa.com/), [CTroads](https://ctroads.org/), [FL511](https://fl511.com/), [New England 511](https://newengland511.org/), [DriveNC](https://www.drivenc.gov/), [Alaska 511](https://511.alaska.gov/), [511MN](https://511mn.org/), [511IA](https://511ia.org/), [511IN](https://511in.org/), [KanDrive](https://kandrive.gov/), [Nebraska 511](https://511.nebraska.gov/), [Mass511](https://mass511.com/), [511 Virginia](https://511.vdot.virginia.gov/), [MoDOT](https://traveler.modot.org/), [CHART Maryland](https://chart.maryland.gov/), [TripCheck Oregon](https://tripcheck.com/), [Ontario 511](https://511on.ca/), [511 Alberta](https://511.alberta.ca/), [Saskatchewan Highway Hotline](https://hotline.gov.sk.ca/), [Manitoba 511](https://www.manitoba511.ca/), [New Brunswick 511](https://511.gnb.ca/), [Nova Scotia 511](https://511.novascotia.ca/), [Newfoundland and Labrador 511](https://511nl.ca/), [Yukon 511](https://511yukon.ca/) | camera list, coordinates, live video / still URLs, as each site publishes them to its public map (no key) | public traveller information, credited to each operator on every stream | as above |
| [DGT](https://nap.dgt.es/) (Spain, DATEX II), [Ayuntamiento de Madrid](https://informo.madrid.es/), [Servei Català de Trànsit](https://transit.gencat.cat/) | traffic camera locations and image URLs | Spanish public-sector information, reuse with attribution | as above |
| [Transport for London](https://tfl.gov.uk/info-for/open-data-users/) JamCams | camera locations and image URLs | TfL open data terms: Powered by TfL Open Data; contains OS data © Crown copyright and database rights | as above |
| [Vegagerðin](https://www.vegagerdin.is/) (Iceland), [eismoinfo.lt](https://eismoinfo.lt/) (Lithuania) | road weather / traffic camera locations and image URLs | public traveller information, attribution | as above |
| [foto-webcam.eu](https://www.foto-webcam.eu/) | webcam list, coordinates, image URLs | images © their webcam operators; shown from foto-webcam.eu with credit, not stored | as above |
| [NZ Transport Agency Waka Kotahi](https://www.journeys.nzta.govt.nz/traffic-cameras), [Live Traffic NSW](https://www.livetraffic.com/traffic-cameras) (Transport for NSW) | traffic camera locations and image URLs | NZ Government / Transport for NSW open data, attribution | as above |
| [i-traffic](https://www.i-traffic.co.za/) (SANRAL, South Africa) | camera locations, names and image URLs | public traveller information, attribution | as above |
| Taiwan [Freeway Bureau](https://www.freeway.gov.tw/) and [Highway Bureau](https://www.thb.gov.tw/), MOTC | CCTV locations and live MJPEG stream URLs | Open Government Data License, version 1.0 (Taiwan), attribution | as above |
| [NOAA National Data Buoy Center](https://www.ndbc.noaa.gov/buoycams.shtml) | buoy camera locations and image URLs | US government work, public domain | as above |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | locations, names and image links of mapped webcams (`source: "osm"` records) | ODbL 1.0: those records in `public/data/streams.json` and `data/upstream/agencies.json` remain available under the ODbL; each image belongs to the camera's operator | as above |
| [Wikimedia Commons](https://commons.wikimedia.org/) photographers (list below) | cockpit photos | CC BY / CC BY-SA / GFDL / CC0, per photo | `public/cockpits/*.webp` (modified, see below) |
| YouTube | stream playback | YouTube Terms of Service | not stored; streams embedded via the public player |

Data sourced from Famelack (famelack.com).

**Changes made to GeoNames data (CC BY 4.0 §3(a)(1)(B)).** `data/gazetteer/cities.tsv`
is a derivative of GeoNames: it keeps the id, name, coordinates, country,
first-level admin code and name, population and timezone of each place in
`cities1000`, plus alternate names that are tagged with a language and not
marked historic or colloquial. All other columns and records are dropped.

**Required notices.** Contains information licensed under the Open Government Licence – British Columbia.
Source: Fintraffic / digitraffic.fi, licence CC 4.0 BY. Traffic snapshot data: Transport Department,
The Government of the Hong Kong SAR, via DATA.GOV.HK. Powered by TfL Open Data; contains OS data ©
Crown copyright and database rights. Camera data © OpenStreetMap contributors, available under the
Open Database License.


**Cockpit photos.** Each is cropped, resized, re-encoded as WebP, and has its windscreen made
transparent; the modified files are licensed under the same terms as the originals.

- `a320.webp`: [Cockpit View PR-AVP A320-214 msn 4891 (6349154954).jpg](https://commons.wikimedia.org/wiki/File:Cockpit_View_PR-AVP_A320-214_msn_4891_(6349154954).jpg) by Joao Carlos Medau from Campinas, Brazil, CC BY 2.0
- `b737.webp`: [Boeing 737-800 BCF, Paris Air Show 2019, Le Bourget (SIAE1220-HDR).jpg](https://commons.wikimedia.org/wiki/File:Boeing_737-800_BCF,_Paris_Air_Show_2019,_Le_Bourget_(SIAE1220-HDR).jpg) by Matti Blume, CC BY-SA 4.0
- `b787.webp`: [Boeing 787-8 N787BA cockpit.jpg](https://commons.wikimedia.org/wiki/File:Boeing_787-8_N787BA_cockpit.jpg) by Alex Beltyukov, CC BY-SA 3.0
- `b777.webp`: [Boeing 777-200LR Flightdeck.jpg](https://commons.wikimedia.org/wiki/File:Boeing_777-200LR_Flightdeck.jpg) by Aaron Davis, CC BY-SA 4.0
- `a330.webp`: [Airbus A330-302 Iberia EC-LYF cockpit (10983484845).jpg](https://commons.wikimedia.org/wiki/File:Airbus_A330-302_Iberia_EC-LYF_cockpit_(10983484845).jpg) by Curimedia | P H O T O G R A P H Y, CC BY 2.0
- `a350.webp`: [Airbus A-350 XWB F-WWYB cockpit view.jpg](https://commons.wikimedia.org/wiki/File:Airbus_A-350_XWB_F-WWYB_cockpit_view.jpg) by Joao Carlos Medau (https://secure.flickr.com/photos/medau/), CC BY 2.0
- `b757.webp`: [Boeing 757-300 Cockpit.JPG](https://commons.wikimedia.org/wiki/File:Boeing_757-300_Cockpit.JPG) by JHenryW, CC BY-SA 3.0
- `ejet.webp`: [Embraer E195-E2 cockpit.jpg](https://commons.wikimedia.org/wiki/File:Embraer_E195-E2_cockpit.jpg) by EneasMx, CC BY 4.0
- `crj.webp`: [The CRJ-900ER Flight Deck (2806000295).jpg](https://commons.wikimedia.org/wiki/File:The_CRJ-900ER_Flight_Deck_(2806000295).jpg) by Cory W. Watts from Madison, Wisconsin, United States of America, CC BY-SA 2.0
- `dh8d.webp`: [Q400 NextGen aircraft cockpit.jpg](https://commons.wikimedia.org/wiki/File:Q400_NextGen_aircraft_cockpit.jpg) by Rick Rydell, CC0
- `atr.webp`: [Virgin Australia ATR cockpit in hangar - Brisbane Airport.jpg](https://commons.wikimedia.org/wiki/File:Virgin_Australia_ATR_cockpit_in_hangar_-_Brisbane_Airport.jpg) by Aviationbystirling, CC BY 4.0

**Streams** are the property of their respective broadcasters. Atlas Eye stores
only their public YouTube video IDs and titles, and plays them through
YouTube's embedded player. Atlas Eye is not affiliated with YouTube or any
broadcaster.

---

## Famelack — MIT License

```
MIT License

Copyright (c) 2026 Famelack

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## camlisted — MIT License

```
MIT License

Copyright (c) 2026 zenith605

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## GeoNames — Creative Commons Attribution 4.0 International

```
Attribution 4.0 International

=======================================================================

Creative Commons Corporation ("Creative Commons") is not a law firm and
does not provide legal services or legal advice. Distribution of
Creative Commons public licenses does not create a lawyer-client or
other relationship. Creative Commons makes its licenses and related
information available on an "as-is" basis. Creative Commons gives no
warranties regarding its licenses, any material licensed under their
terms and conditions, or any related information. Creative Commons
disclaims all liability for damages resulting from their use to the
fullest extent possible.

Using Creative Commons Public Licenses

Creative Commons public licenses provide a standard set of terms and
conditions that creators and other rights holders may use to share
original works of authorship and other material subject to copyright
and certain other rights specified in the public license below. The
following considerations are for informational purposes only, are not
exhaustive, and do not form part of our licenses.

     Considerations for licensors: Our public licenses are
     intended for use by those authorized to give the public
     permission to use material in ways otherwise restricted by
     copyright and certain other rights. Our licenses are
     irrevocable. Licensors should read and understand the terms
     and conditions of the license they choose before applying it.
     Licensors should also secure all rights necessary before
     applying our licenses so that the public can reuse the
     material as expected. Licensors should clearly mark any
     material not subject to the license. This includes other CC-
     licensed material, or material used under an exception or
     limitation to copyright. More considerations for licensors:
    wiki.creativecommons.org/Considerations_for_licensors

     Considerations for the public: By using one of our public
     licenses, a licensor grants the public permission to use the
     licensed material under specified terms and conditions. If
     the licensor's permission is not necessary for any reason--for
     example, because of any applicable exception or limitation to
     copyright--then that use is not regulated by the license. Our
     licenses grant only permissions under copyright and certain
     other rights that a licensor has authority to grant. Use of
     the licensed material may still be restricted for other
     reasons, including because others have copyright or other
     rights in the material. A licensor may make special requests,
     such as asking that all changes be marked or described.
     Although not required by our licenses, you are encouraged to
     respect those requests where reasonable. More considerations
     for the public:
    wiki.creativecommons.org/Considerations_for_licensees

=======================================================================

Creative Commons Attribution 4.0 International Public License

By exercising the Licensed Rights (defined below), You accept and agree
to be bound by the terms and conditions of this Creative Commons
Attribution 4.0 International Public License ("Public License"). To the
extent this Public License may be interpreted as a contract, You are
granted the Licensed Rights in consideration of Your acceptance of
these terms and conditions, and the Licensor grants You such rights in
consideration of benefits the Licensor receives from making the
Licensed Material available under these terms and conditions.


Section 1 -- Definitions.

  a. Adapted Material means material subject to Copyright and Similar
     Rights that is derived from or based upon the Licensed Material
     and in which the Licensed Material is translated, altered,
     arranged, transformed, or otherwise modified in a manner requiring
     permission under the Copyright and Similar Rights held by the
     Licensor. For purposes of this Public License, where the Licensed
     Material is a musical work, performance, or sound recording,
     Adapted Material is always produced where the Licensed Material is
     synched in timed relation with a moving image.

  b. Adapter's License means the license You apply to Your Copyright
     and Similar Rights in Your contributions to Adapted Material in
     accordance with the terms and conditions of this Public License.

  c. Copyright and Similar Rights means copyright and/or similar rights
     closely related to copyright including, without limitation,
     performance, broadcast, sound recording, and Sui Generis Database
     Rights, without regard to how the rights are labeled or
     categorized. For purposes of this Public License, the rights
     specified in Section 2(b)(1)-(2) are not Copyright and Similar
     Rights.

  d. Effective Technological Measures means those measures that, in the
     absence of proper authority, may not be circumvented under laws
     fulfilling obligations under Article 11 of the WIPO Copyright
     Treaty adopted on December 20, 1996, and/or similar international
     agreements.

  e. Exceptions and Limitations means fair use, fair dealing, and/or
     any other exception or limitation to Copyright and Similar Rights
     that applies to Your use of the Licensed Material.

  f. Licensed Material means the artistic or literary work, database,
     or other material to which the Licensor applied this Public
     License.

  g. Licensed Rights means the rights granted to You subject to the
     terms and conditions of this Public License, which are limited to
     all Copyright and Similar Rights that apply to Your use of the
     Licensed Material and that the Licensor has authority to license.

  h. Licensor means the individual(s) or entity(ies) granting rights
     under this Public License.

  i. Share means to provide material to the public by any means or
     process that requires permission under the Licensed Rights, such
     as reproduction, public display, public performance, distribution,
     dissemination, communication, or importation, and to make material
     available to the public including in ways that members of the
     public may access the material from a place and at a time
     individually chosen by them.

  j. Sui Generis Database Rights means rights other than copyright
     resulting from Directive 96/9/EC of the European Parliament and of
     the Council of 11 March 1996 on the legal protection of databases,
     as amended and/or succeeded, as well as other essentially
     equivalent rights anywhere in the world.

  k. You means the individual or entity exercising the Licensed Rights
     under this Public License. Your has a corresponding meaning.


Section 2 -- Scope.

  a. License grant.

       1. Subject to the terms and conditions of this Public License,
          the Licensor hereby grants You a worldwide, royalty-free,
          non-sublicensable, non-exclusive, irrevocable license to
          exercise the Licensed Rights in the Licensed Material to:

            a. reproduce and Share the Licensed Material, in whole or
               in part; and

            b. produce, reproduce, and Share Adapted Material.

       2. Exceptions and Limitations. For the avoidance of doubt, where
          Exceptions and Limitations apply to Your use, this Public
          License does not apply, and You do not need to comply with
          its terms and conditions.

       3. Term. The term of this Public License is specified in Section
          6(a).

       4. Media and formats; technical modifications allowed. The
          Licensor authorizes You to exercise the Licensed Rights in
          all media and formats whether now known or hereafter created,
          and to make technical modifications necessary to do so. The
          Licensor waives and/or agrees not to assert any right or
          authority to forbid You from making technical modifications
          necessary to exercise the Licensed Rights, including
          technical modifications necessary to circumvent Effective
          Technological Measures. For purposes of this Public License,
          simply making modifications authorized by this Section 2(a)
          (4) never produces Adapted Material.

       5. Downstream recipients.

            a. Offer from the Licensor -- Licensed Material. Every
               recipient of the Licensed Material automatically
               receives an offer from the Licensor to exercise the
               Licensed Rights under the terms and conditions of this
               Public License.

            b. No downstream restrictions. You may not offer or impose
               any additional or different terms or conditions on, or
               apply any Effective Technological Measures to, the
               Licensed Material if doing so restricts exercise of the
               Licensed Rights by any recipient of the Licensed
               Material.

       6. No endorsement. Nothing in this Public License constitutes or
          may be construed as permission to assert or imply that You
          are, or that Your use of the Licensed Material is, connected
          with, or sponsored, endorsed, or granted official status by,
          the Licensor or others designated to receive attribution as
          provided in Section 3(a)(1)(A)(i).

  b. Other rights.

       1. Moral rights, such as the right of integrity, are not
          licensed under this Public License, nor are publicity,
          privacy, and/or other similar personality rights; however, to
          the extent possible, the Licensor waives and/or agrees not to
          assert any such rights held by the Licensor to the limited
          extent necessary to allow You to exercise the Licensed
          Rights, but not otherwise.

       2. Patent and trademark rights are not licensed under this
          Public License.

       3. To the extent possible, the Licensor waives any right to
          collect royalties from You for the exercise of the Licensed
          Rights, whether directly or through a collecting society
          under any voluntary or waivable statutory or compulsory
          licensing scheme. In all other cases the Licensor expressly
          reserves any right to collect such royalties.


Section 3 -- License Conditions.

Your exercise of the Licensed Rights is expressly made subject to the
following conditions.

  a. Attribution.

       1. If You Share the Licensed Material (including in modified
          form), You must:

            a. retain the following if it is supplied by the Licensor
               with the Licensed Material:

                 i. identification of the creator(s) of the Licensed
                    Material and any others designated to receive
                    attribution, in any reasonable manner requested by
                    the Licensor (including by pseudonym if
                    designated);

                ii. a copyright notice;

               iii. a notice that refers to this Public License;

                iv. a notice that refers to the disclaimer of
                    warranties;

                 v. a URI or hyperlink to the Licensed Material to the
                    extent reasonably practicable;

            b. indicate if You modified the Licensed Material and
               retain an indication of any previous modifications; and

            c. indicate the Licensed Material is licensed under this
               Public License, and include the text of, or the URI or
               hyperlink to, this Public License.

       2. You may satisfy the conditions in Section 3(a)(1) in any
          reasonable manner based on the medium, means, and context in
          which You Share the Licensed Material. For example, it may be
          reasonable to satisfy the conditions by providing a URI or
          hyperlink to a resource that includes the required
          information.

       3. If requested by the Licensor, You must remove any of the
          information required by Section 3(a)(1)(A) to the extent
          reasonably practicable.

       4. If You Share Adapted Material You produce, the Adapter's
          License You apply must not prevent recipients of the Adapted
          Material from complying with this Public License.


Section 4 -- Sui Generis Database Rights.

Where the Licensed Rights include Sui Generis Database Rights that
apply to Your use of the Licensed Material:

  a. for the avoidance of doubt, Section 2(a)(1) grants You the right
     to extract, reuse, reproduce, and Share all or a substantial
     portion of the contents of the database;

  b. if You include all or a substantial portion of the database
     contents in a database in which You have Sui Generis Database
     Rights, then the database in which You have Sui Generis Database
     Rights (but not its individual contents) is Adapted Material; and

  c. You must comply with the conditions in Section 3(a) if You Share
     all or a substantial portion of the contents of the database.

For the avoidance of doubt, this Section 4 supplements and does not
replace Your obligations under this Public License where the Licensed
Rights include other Copyright and Similar Rights.


Section 5 -- Disclaimer of Warranties and Limitation of Liability.

  a. UNLESS OTHERWISE SEPARATELY UNDERTAKEN BY THE LICENSOR, TO THE
     EXTENT POSSIBLE, THE LICENSOR OFFERS THE LICENSED MATERIAL AS-IS
     AND AS-AVAILABLE, AND MAKES NO REPRESENTATIONS OR WARRANTIES OF
     ANY KIND CONCERNING THE LICENSED MATERIAL, WHETHER EXPRESS,
     IMPLIED, STATUTORY, OR OTHER. THIS INCLUDES, WITHOUT LIMITATION,
     WARRANTIES OF TITLE, MERCHANTABILITY, FITNESS FOR A PARTICULAR
     PURPOSE, NON-INFRINGEMENT, ABSENCE OF LATENT OR OTHER DEFECTS,
     ACCURACY, OR THE PRESENCE OR ABSENCE OF ERRORS, WHETHER OR NOT
     KNOWN OR DISCOVERABLE. WHERE DISCLAIMERS OF WARRANTIES ARE NOT
     ALLOWED IN FULL OR IN PART, THIS DISCLAIMER MAY NOT APPLY TO YOU.

  b. TO THE EXTENT POSSIBLE, IN NO EVENT WILL THE LICENSOR BE LIABLE
     TO YOU ON ANY LEGAL THEORY (INCLUDING, WITHOUT LIMITATION,
     NEGLIGENCE) OR OTHERWISE FOR ANY DIRECT, SPECIAL, INDIRECT,
     INCIDENTAL, CONSEQUENTIAL, PUNITIVE, EXEMPLARY, OR OTHER LOSSES,
     COSTS, EXPENSES, OR DAMAGES ARISING OUT OF THIS PUBLIC LICENSE OR
     USE OF THE LICENSED MATERIAL, EVEN IF THE LICENSOR HAS BEEN
     ADVISED OF THE POSSIBILITY OF SUCH LOSSES, COSTS, EXPENSES, OR
     DAMAGES. WHERE A LIMITATION OF LIABILITY IS NOT ALLOWED IN FULL OR
     IN PART, THIS LIMITATION MAY NOT APPLY TO YOU.

  c. The disclaimer of warranties and limitation of liability provided
     above shall be interpreted in a manner that, to the extent
     possible, most closely approximates an absolute disclaimer and
     waiver of all liability.


Section 6 -- Term and Termination.

  a. This Public License applies for the term of the Copyright and
     Similar Rights licensed here. However, if You fail to comply with
     this Public License, then Your rights under this Public License
     terminate automatically.

  b. Where Your right to use the Licensed Material has terminated under
     Section 6(a), it reinstates:

       1. automatically as of the date the violation is cured, provided
          it is cured within 30 days of Your discovery of the
          violation; or

       2. upon express reinstatement by the Licensor.

     For the avoidance of doubt, this Section 6(b) does not affect any
     right the Licensor may have to seek remedies for Your violations
     of this Public License.

  c. For the avoidance of doubt, the Licensor may also offer the
     Licensed Material under separate terms or conditions or stop
     distributing the Licensed Material at any time; however, doing so
     will not terminate this Public License.

  d. Sections 1, 5, 6, 7, and 8 survive termination of this Public
     License.


Section 7 -- Other Terms and Conditions.

  a. The Licensor shall not be bound by any additional or different
     terms or conditions communicated by You unless expressly agreed.

  b. Any arrangements, understandings, or agreements regarding the
     Licensed Material not stated herein are separate from and
     independent of the terms and conditions of this Public License.


Section 8 -- Interpretation.

  a. For the avoidance of doubt, this Public License does not, and
     shall not be interpreted to, reduce, limit, restrict, or impose
     conditions on any use of the Licensed Material that could lawfully
     be made without permission under this Public License.

  b. To the extent possible, if any provision of this Public License is
     deemed unenforceable, it shall be automatically reformed to the
     minimum extent necessary to make it enforceable. If the provision
     cannot be reformed, it shall be severed from this Public License
     without affecting the enforceability of the remaining terms and
     conditions.

  c. No term or condition of this Public License will be waived and no
     failure to comply consented to unless expressly agreed to by the
     Licensor.

  d. Nothing in this Public License constitutes or may be interpreted
     as a limitation upon, or waiver of, any privileges and immunities
     that apply to the Licensor or You, including from the legal
     processes of any jurisdiction or authority.


=======================================================================

Creative Commons is not a party to its public
licenses. Notwithstanding, Creative Commons may elect to apply one of
its public licenses to material it publishes and in those instances
will be considered the “Licensor.” The text of the Creative Commons
public licenses is dedicated to the public domain under the CC0 Public
Domain Dedication. Except for the limited purpose of indicating that
material is shared under a Creative Commons public license or as
otherwise permitted by the Creative Commons policies published at
creativecommons.org/policies, Creative Commons does not authorize the
use of the trademark "Creative Commons" or any other trademark or logo
of Creative Commons without its prior written consent including,
without limitation, in connection with any unauthorized modifications
to any of its public licenses or any other arrangements,
understandings, or agreements concerning use of licensed material. For
the avoidance of doubt, this paragraph does not form part of the
public licenses.

Creative Commons may be contacted at creativecommons.org.

```

## OpenStreetMap — Open Database License 1.0

Map data © OpenStreetMap contributors, available under the Open Database
License: https://opendatacommons.org/licenses/odbl/1-0/ . Atlas Eye does not
store or redistribute OSM data; it displays tiles served by OpenFreeMap
(https://openfreemap.org) or, as a fallback, CARTO (https://carto.com/attributions).
