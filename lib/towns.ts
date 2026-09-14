import type { LatLng } from "./geo";

/**
 * HDB towns. `code` is Dataset A's bldg_contract_town; `resaleName` is Dataset
 * B's town label. Tengah has no resale transactions yet, so its resale label
 * is HDB's expected spelling and is unverified until the first Tengah resale.
 *
 * `center` is the median of the town's HDB block footprints (Sep 2026). It is
 * shipped here so nearest-town matching needs no network call; the data
 * pipeline fails if a computed centre drifts more than 1 km from these values.
 */
export interface Town {
  code: string;
  name: string;
  slug: string;
  resaleName: string;
  center: LatLng;
}

export const TOWNS: readonly Town[] = [
  { code: "AMK", name: "Ang Mo Kio", slug: "ang-mo-kio", resaleName: "ANG MO KIO", center: { lat: 1.3702, lng: 103.8476 } },
  { code: "BB", name: "Bukit Batok", slug: "bukit-batok", resaleName: "BUKIT BATOK", center: { lat: 1.3515, lng: 103.7482 } },
  { code: "BD", name: "Bedok", slug: "bedok", resaleName: "BEDOK", center: { lat: 1.3301, lng: 103.9282 } },
  { code: "BH", name: "Bishan", slug: "bishan", resaleName: "BISHAN", center: { lat: 1.3512, lng: 103.8481 } },
  { code: "BM", name: "Bukit Merah", slug: "bukit-merah", resaleName: "BUKIT MERAH", center: { lat: 1.2829, lng: 103.8256 } },
  { code: "BP", name: "Bukit Panjang", slug: "bukit-panjang", resaleName: "BUKIT PANJANG", center: { lat: 1.3825, lng: 103.7688 } },
  { code: "BT", name: "Bukit Timah", slug: "bukit-timah", resaleName: "BUKIT TIMAH", center: { lat: 1.3382, lng: 103.7745 } },
  { code: "CCK", name: "Choa Chu Kang", slug: "choa-chu-kang", resaleName: "CHOA CHU KANG", center: { lat: 1.3819, lng: 103.7455 } },
  { code: "CL", name: "Clementi", slug: "clementi", resaleName: "CLEMENTI", center: { lat: 1.3139, lng: 103.7664 } },
  { code: "CT", name: "Central Area", slug: "central-area", resaleName: "CENTRAL AREA", center: { lat: 1.2986, lng: 103.8507 } },
  { code: "GL", name: "Geylang", slug: "geylang", resaleName: "GEYLANG", center: { lat: 1.3231, lng: 103.8884 } },
  { code: "HG", name: "Hougang", slug: "hougang", resaleName: "HOUGANG", center: { lat: 1.373, lng: 103.8885 } },
  { code: "JE", name: "Jurong East", slug: "jurong-east", resaleName: "JURONG EAST", center: { lat: 1.3404, lng: 103.7392 } },
  { code: "JW", name: "Jurong West", slug: "jurong-west", resaleName: "JURONG WEST", center: { lat: 1.344, lng: 103.7047 } },
  { code: "KWN", name: "Kallang/Whampoa", slug: "kallang-whampoa", resaleName: "KALLANG/WHAMPOA", center: { lat: 1.3209, lng: 103.8605 } },
  { code: "MP", name: "Marine Parade", slug: "marine-parade", resaleName: "MARINE PARADE", center: { lat: 1.3039, lng: 103.9127 } },
  { code: "PG", name: "Punggol", slug: "punggol", resaleName: "PUNGGOL", center: { lat: 1.4022, lng: 103.9074 } },
  { code: "PRC", name: "Pasir Ris", slug: "pasir-ris", resaleName: "PASIR RIS", center: { lat: 1.372, lng: 103.9529 } },
  { code: "QT", name: "Queenstown", slug: "queenstown", resaleName: "QUEENSTOWN", center: { lat: 1.3017, lng: 103.8004 } },
  { code: "SB", name: "Sembawang", slug: "sembawang", resaleName: "SEMBAWANG", center: { lat: 1.4497, lng: 103.8205 } },
  { code: "SGN", name: "Serangoon", slug: "serangoon", resaleName: "SERANGOON", center: { lat: 1.357, lng: 103.8723 } },
  { code: "SK", name: "Sengkang", slug: "sengkang", resaleName: "SENGKANG", center: { lat: 1.3906, lng: 103.8946 } },
  { code: "TAP", name: "Tampines", slug: "tampines", resaleName: "TAMPINES", center: { lat: 1.3541, lng: 103.9461 } },
  { code: "TG", name: "Tengah", slug: "tengah", resaleName: "TENGAH", center: { lat: 1.3594, lng: 103.7346 } },
  { code: "TP", name: "Toa Payoh", slug: "toa-payoh", resaleName: "TOA PAYOH", center: { lat: 1.336, lng: 103.8566 } },
  { code: "WL", name: "Woodlands", slug: "woodlands", resaleName: "WOODLANDS", center: { lat: 1.4381, lng: 103.7925 } },
  { code: "YS", name: "Yishun", slug: "yishun", resaleName: "YISHUN", center: { lat: 1.4268, lng: 103.8389 } },
];

const BY_CODE = new Map(TOWNS.map((town) => [town.code, town]));
const BY_RESALE_NAME = new Map(TOWNS.map((town) => [town.resaleName, town]));
const BY_SLUG = new Map(TOWNS.map((town) => [town.slug, town]));

export function townByCode(code: string): Town | undefined {
  return BY_CODE.get(code);
}

export function townByResaleName(name: string): Town | undefined {
  return BY_RESALE_NAME.get(name);
}

export function townBySlug(slug: string): Town | undefined {
  return BY_SLUG.get(slug);
}
