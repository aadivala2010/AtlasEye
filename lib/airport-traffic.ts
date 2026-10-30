import { distanceKm } from './geo';
import { project, type Flight } from './flights';

export interface Airport { name: string; code: string; kind: string; lon: number; lat: number }
export type Movement = 'Ground nearby' | 'Toward airport' | 'Away from airport' | 'Passing nearby';
export const TRAFFIC_RANGE_NM = 25;

/** Proximity and direction only: ADS-B positions do not identify a flight's destination. */
export function airportTraffic(airport: Airport, flights: Flight[], now: number) {
  return flights.flatMap((flight) => {
    if (![flight.lat, flight.lon, flight.at, flight.gs, flight.track].every(Number.isFinite)
      || now - flight.at > 90_000 || flight.at > now + 10_000) return [];
    const position = project(flight, now);
    const nm = distanceKm(airport.lat, airport.lon, position.lat, position.lon) / 1.852;
    if (nm > TRAFFIC_RANGE_NM || (flight.ground && nm > 3)) return [];
    const future = project(flight, now + 30_000);
    const change = distanceKm(airport.lat, airport.lon, future.lat, future.lon) / 1.852 - nm;
    const movement: Movement = flight.ground ? 'Ground nearby'
      : change < -0.2 ? 'Toward airport' : change > 0.2 ? 'Away from airport' : 'Passing nearby';
    const deltaLon = ((position.lon - airport.lon + 540) % 360) - 180;
    return [{ flight, nm, movement,
      x: deltaLon * Math.cos(airport.lat * Math.PI / 180) * 60 / TRAFFIC_RANGE_NM,
      y: -(position.lat - airport.lat) * 60 / TRAFFIC_RANGE_NM }];
  }).sort((a, b) => a.nm - b.nm);
}
