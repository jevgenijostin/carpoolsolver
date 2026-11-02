import type { Instance, Schedule } from '../src/model';
const escape = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
// Floating local times deliberately preserve the organizer's wall-clock windows.
function stamp(monday: string, minutes: number): string {
  const date = new Date(`${monday}T00:00:00Z`);
  date.setUTCMinutes(minutes);
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').slice(0, 15);
}
function fold(line: string): string {
  let result = '', bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
    result += char; bytes += size;
  }
  return result;
}
export function calendar(i: Instance, s: Schedule, monday: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CarpoolSolver//Team week//EN', 'CALSCALE:GREGORIAN'];
  for (const leg of i.legs) {
    const venue = i.venues.find(v => v.id === leg.venueId)!;
    const routes = s.legs.find(l => l.legId === leg.id)!.routes;
    const description = routes.map(r => `${i.households.find(h => h.id === r.driverId)!.name}: ${r.kidIds.map(id => i.kids.find(k => k.id === id)!.name).join(', ')}; stops ${r.stops.map(id => i.households.find(h => h.id === id)!.name).join(' → ')}`).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${monday}-${leg.id}@carpoolsolver.local`, 'DTSTAMP:20261102T000000Z', `DTSTART:${stamp(monday, leg.winStart)}`, `DTEND:${stamp(monday, leg.winEnd)}`, `SUMMARY:${escape(`${leg.dir === 'to' ? 'To' : 'From'} ${venue.name} · U10 Tigers`)}`, `LOCATION:${escape(venue.name)}`, `DESCRIPTION:${escape(description)}`, 'END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
