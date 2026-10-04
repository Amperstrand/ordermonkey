import { translationsText, type NameTranslations } from "./localize.js";
import type { RawEnvelope } from "./menu.js";
import type { BranchId, OrgId } from "./types.js";
import { branchId as parseBranchId, orgId as parseOrgId } from "./types.js";

/**
 * Webshop-lane wire shapes (`webshop.ordermonkey.com/<slug>` — the same
 * endpoints also answer on the QR-app origin, live-verified). Quirks
 * encoded (each maps to a test + a Lessons line):
 *  - Branch rows duplicate `BranchName`/`Name` (plain strings) AND carry
 *    `NameTranslations[]` (the third localization shape) — the translated
 *    name is the venue-facing one.
 *  - `Address.HouseNo` can carry venue ops text (counter-pickup
 *    instructions), not a house number — passed through verbatim.
 *  - `PaymentProviderType` on the branch row ("cloud") differs from the
 *    config's `PaymentProviders` (e.g. "ADYEN-ONLINE-WEBSHOP").
 *  - Webshop config carries `MinimumOrderValue` (0 = none published) —
 *    the QR-app config has NO such key; the min-order quirk is lane-scoped.
 */
export interface RawWebshopOrganization {
  readonly OrganizationId?: string | null;
}

export interface RawWebshopAddress {
  readonly Country?: string | null;
  readonly City?: string | null;
  readonly ZipCode?: string | null;
  readonly StreetNo?: string | null;
  readonly HouseNo?: string | null;
}

export interface RawWebshopBranch {
  readonly BranchUUID?: string | null;
  readonly BranchName?: string | null;
  readonly Name?: string | null;
  readonly NameTranslations?: NameTranslations | null;
  readonly Address?: RawWebshopAddress | null;
  readonly PaymentProviderType?: string | null;
  readonly IsMainBranch?: boolean;
  readonly DefaultLanguage?: string | null;
}

export interface WebshopAddress {
  readonly country: string | null;
  readonly city: string | null;
  readonly zipCode: string | null;
  readonly streetNo: string | null;
  readonly houseNo: string | null;
}

export interface WebshopBranchInfo {
  readonly branchId: BranchId;
  readonly name: string | null;
  readonly displayName: string | null;
  readonly address: WebshopAddress | null;
  readonly paymentProviderType: string | null;
  readonly isMainBranch: boolean;
  readonly defaultLanguage: string | null;
}

export interface WebshopVenue {
  readonly slug: string;
  readonly orgId: OrgId;
  readonly branches: readonly WebshopBranchInfo[];
}

export function webshopVenueFromSlug(
  slug: string,
  org: RawEnvelope<RawWebshopOrganization>,
  branches: RawEnvelope<readonly RawWebshopBranch[]>,
): WebshopVenue | null {
  const organizationId = org.Data?.OrganizationId;
  if (org.IsSuccess === false || organizationId === undefined || organizationId === null || organizationId === "") {
    return null;
  }
  const venue: WebshopVenue = {
    slug,
    orgId: parseOrgId(organizationId),
    branches: [],
  };
  const rows = branches.Data ?? [];
  return {
    ...venue,
    branches: rows.flatMap((row) => {
      const uuid = row.BranchUUID;
      if (uuid === undefined || uuid === null || uuid === "") return [];
      let id: BranchId;
      try {
        id = parseBranchId(uuid);
      } catch {
        return [];
      }
      const address = row.Address;
      return [
        {
          branchId: id,
          name: row.BranchName ?? row.Name ?? null,
          displayName: translationsText(row.NameTranslations),
          address: address === null || address === undefined
            ? null
            : {
                country: address.Country ?? null,
                city: address.City ?? null,
                zipCode: address.ZipCode ?? null,
                streetNo: address.StreetNo ?? null,
                houseNo: address.HouseNo ?? null,
              },
          paymentProviderType: row.PaymentProviderType ?? null,
          isMainBranch: row.IsMainBranch === true,
          defaultLanguage: row.DefaultLanguage ?? null,
        },
      ];
    }),
  };
}

export function isWebshopSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(value.trim());
}
