/**
 * Professional-profile data comes from a data vendor under contract or not at
 * all. This system never requests the professional network's own hosts. A
 * profile link may be retained as a lookup key, but is never fetched.
 *
 * To add a vendor, implement ProfileDataVendor in one file and pass it to
 * createPeopleDataAdapter in index.ts.
 */

import type { SourceAdapter, SourceFetchRequest, SourceFetchResult } from "../contracts";

export const NOT_CONFIGURED_DETAIL =
  "Not configured. Professional-profile data comes from a data vendor under contract or not at all. The system never requests the professional network's own site.";

export const NOT_CONFIGURED_ERROR =
  "Professional-profile data is not configured. It must come from a data vendor under contract or not at all. The system never requests the professional network's own site.";

/** What a licensed vendor adapter implements. Same contract as a SourceAdapter, without the id. */
export interface ProfileDataVendor {
  /** Vendor name, for logs and status. Not a secret. */
  readonly name: string;
  /** Cheap readiness check. Must not call the vendor. */
  status(): Promise<{ configured: boolean; detail: string }>;
  /** Items newest first, at most req.limit, with a cursor that avoids repeats. */
  fetch(req: SourceFetchRequest): Promise<SourceFetchResult>;
}

export function createPeopleDataAdapter(vendor: ProfileDataVendor | null = null): SourceAdapter {
  return {
    id: "people_data",

    async status() {
      return vendor ? vendor.status() : { configured: false, detail: NOT_CONFIGURED_DETAIL };
    },

    async fetch(req: SourceFetchRequest): Promise<SourceFetchResult> {
      if (!vendor) throw new Error(NOT_CONFIGURED_ERROR);
      return vendor.fetch(req);
    },
  };
}
