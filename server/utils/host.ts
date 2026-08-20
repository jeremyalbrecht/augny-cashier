import { getRequestHost, type H3Event } from "h3";

/** The member area is served from compte.<domain>; the treasurer dashboard
 *  and cashier tablet share the main host. */
export function isMemberHost(event: H3Event): boolean {
  return getRequestHost(event).toLowerCase().startsWith("compte.");
}
