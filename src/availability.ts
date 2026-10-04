import type { RawEnvelope } from "./menu.js";

/**
 * Wire shapes of CheckBranchAvailability — the availability probe the
 * SPA itself fires on page load (empty-body POST, four read headers, no
 * session needed — live-verified). Quirks encoded:
 *  - Five per-mode schedule windows ride under
 *    `<Mode>OpeningHoursSchedule` keys.
 *  - `IsAvailable:true` with epoch-zero times ("0001-01-01T00:00:00")
 *    means "not hour-gated" (orderable now); epoch-zero is the platform's
 *    null sentinel for every time field.
 *  - A closed-now mode can still carry a FUTURE `NextAvailableTime` —
 *    the pre-order trap: an order placed now would be fulfilled when the
 *    window opens. `isClosedForOrders` treats that as NOT closed.
 */

export type OrderKind = "DineIn" | "Takeaway" | "Preorder" | "Catering" | "Delivery";

export interface ScheduleWindow {
  readonly available: boolean;
  readonly nextAvailableTime: string | null;
  readonly nextAvailableClosingTime: string | null;
  readonly openingTime: string | null;
  readonly closingTime: string | null;
  readonly nextAvailableDayName: string | null;
}

export interface BranchAvailability {
  readonly dineIn: ScheduleWindow;
  readonly takeaway: ScheduleWindow;
  readonly preorder: ScheduleWindow;
  readonly catering: ScheduleWindow;
  readonly delivery: ScheduleWindow;
  readonly loyaltyEnabled: boolean;
}

interface RawScheduleWindow {
  readonly IsAvailable?: boolean;
  readonly NextAvailableTime?: string | null;
  readonly NextAvailableClosingTime?: string | null;
  readonly OpeningTime?: string | null;
  readonly ClosingTime?: string | null;
  readonly NextAvailableDayName?: string | null;
}

export type RawAvailability = RawEnvelope<{
  readonly DineInOpeningHoursSchedule?: RawScheduleWindow | null;
  readonly TakeawayOpeningHoursSchedule?: RawScheduleWindow | null;
  readonly PreorderOpeningHoursSchedule?: RawScheduleWindow | null;
  readonly CateringOpeningHoursSchedule?: RawScheduleWindow | null;
  readonly DeliveryOpeningHoursSchedule?: RawScheduleWindow | null;
  readonly IsLoyaltyEnabled?: boolean;
}>;

const EPOCH_ZERO = "0001-01-01T00:00:00";

function timeOrNone(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === "" || raw.startsWith(EPOCH_ZERO.slice(0, 10))) return null;
  return raw;
}

function windowOf(raw: RawScheduleWindow | null | undefined): ScheduleWindow {
  return {
    available: raw?.IsAvailable === true,
    nextAvailableTime: timeOrNone(raw?.NextAvailableTime),
    nextAvailableClosingTime: timeOrNone(raw?.NextAvailableClosingTime),
    openingTime: timeOrNone(raw?.OpeningTime),
    closingTime: timeOrNone(raw?.ClosingTime),
    nextAvailableDayName: raw?.NextAvailableDayName === "" ? null : raw?.NextAvailableDayName ?? null,
  };
}

export function availabilityFromPayload(payload: RawAvailability): BranchAvailability {
  const data = payload.Data;
  return {
    dineIn: windowOf(data?.DineInOpeningHoursSchedule),
    takeaway: windowOf(data?.TakeawayOpeningHoursSchedule),
    preorder: windowOf(data?.PreorderOpeningHoursSchedule),
    catering: windowOf(data?.CateringOpeningHoursSchedule),
    delivery: windowOf(data?.DeliveryOpeningHoursSchedule),
    loyaltyEnabled: data?.IsLoyaltyEnabled === true,
  };
}

/**
 * The mechanical precondition for the (future, gated) closed-venue
 * exception: true only when EVERY mode is unavailable AND no mode has a
 * scheduled future availability — a venue that opens (or accepts
 * pre-orders) tomorrow would still make the food then.
 */
export function isClosedForOrders(availability: BranchAvailability): boolean {
  const windows = [
    availability.dineIn,
    availability.takeaway,
    availability.preorder,
    availability.catering,
    availability.delivery,
  ];
  return windows.every((window) => !window.available && window.nextAvailableTime === null);
}
