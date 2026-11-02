import type { Instance, Schedule } from './model.js';
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const time = (minute: number) => `${String(Math.floor(minute % 1440 / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function parentMessage(i: Instance, s: Schedule, householdId: string): string {
  const h = i.households.find(h => h.id === householdId);
  if (!h) throw new Error('Unknown household');
  if (s.status !== 'ok') return `${h.name}: no feasible carpool schedule (${s.reason?.code ?? 'unknown'}).`;
  const lines = [`${h.name} — weekly carpool`];
  for (const leg of i.legs) for (const r of s.legs.find(l => l.legId === leg.id)?.routes ?? []) {
    const kids = r.kidIds.map(k => i.kids.find(x => x.id === k)!);
    if (r.driverId !== householdId && !kids.some(k => k.householdId === householdId)) continue;
    const venue = i.venues.find(v => v.id === leg.venueId)!.name, driver = i.households.find(h => h.id === r.driverId)!.name;
    const stops = r.stops.map(h => i.households.find(x => x.id === h)!.name).join(' → ');
    lines.push(`${days[leg.day]} ${time(leg.winStart)}–${time(leg.winEnd)} | ${leg.dir === 'to' ? 'To' : 'From'} ${venue} | Driver: ${driver} | Riders: ${kids.map(k => k.name).join(', ')} | Stops: ${stops} | ${r.minutes} min`);
  }
  lines.push(`Your driving: ${s.loads[householdId] ?? 0} min.`);
  return lines.join('\n');
}
