/**
 * Transport-level failure (network down, DNS, timeout). A thrown
 * OrderMonkeyError always means "we could not talk to the platform"; a null
 * return from a client method always means "the platform answered: absent"
 * (tier-3 dead pair answering defaults, empty menu surface, unknown product
 * id).
 */
export type OrderMonkeyFailureReason = "network";

export class OrderMonkeyError extends Error {
  constructor(readonly reason: OrderMonkeyFailureReason, message: string) {
    super(message);
    this.name = "OrderMonkeyError";
  }
}

export function asTransportError(error: unknown): OrderMonkeyError {
  return new OrderMonkeyError("network", error instanceof Error ? error.message : String(error));
}

export function isTransportFailure(error: unknown): boolean {
  return error instanceof Error || typeof DOMException === "function" && error instanceof DOMException;
}
