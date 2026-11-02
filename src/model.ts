export interface Place { id: string; x: number; y: number }
export interface Household { id: string; name: string; placeId: string; seats: number }
export interface Kid { id: string; name: string; householdId: string }
export interface Venue { id: string; name: string; placeId: string }
export interface Leg { id: string; day: number; venueId: string; dir: 'to' | 'from'; kidIds: string[]; driverIds: string[]; winStart: number; winEnd: number }
export interface Params { speedKmh: number; detour: number; dwell: number; maxRide: number; lambda: number; seed: number }
export type History = Record<string, number>;
export interface Instance { places: Place[]; households: Household[]; kids: Kid[]; venues: Venue[]; legs: Leg[]; params: Params; history: History; travelOverride?: Record<string, Record<string, number>> | undefined }
export interface Route { driverId: string; stops: string[]; kidIds: string[]; minutes: number }
export type Reason = { code: 'CAPACITY_SHORT' | 'NO_DRIVER'; legId: string } | { code: 'RIDE_CAP'; kidId: string } | { code: 'OVERLAP' };
export interface Schedule { status: 'ok' | 'infeasible'; reason?: Reason; legs: { legId: string; routes: Route[] }[]; loads: Record<string, number>; J: number; F: number }
export const defaults: Params = { speedKmh: 28, detour: 1.3, dwell: 2, maxRide: 45, lambda: 0.5, seed: 1 };
