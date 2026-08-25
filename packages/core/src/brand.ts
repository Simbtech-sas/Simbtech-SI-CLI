/**
 * A brand is the single identifier a scaffolded project is named after. Templates
 * are real, compilable apps literally named `simbkit`; scaffolding rewrites that
 * token. Because `simbkit` is a strict substring of every derived identifier the
 * templates use (`simbkit_app`, `simbkit-dev`, `simbkit.local`, `@simbkit/server`),
 * a handful of case variants covers a whole project.
 *
 * Three cases, not two: environment variables are conventionally SCREAMING_SNAKE
 * (`SIMBKIT_MODE`), and a two-case rule silently leaves those pointing at the
 * template brand — which then fails at runtime rather than at scaffold time.
 */
export const TEMPLATE_BRAND = 'simbkit';

/** Lowercase, starts with a letter, 2-31 chars. Also a valid npm scope and pg role. */
export const BRAND_PATTERN = /^[a-z][a-z0-9]{1,30}$/;

export interface BrandTokens {
  /** Lowercase form, e.g. `acme` — packages, roles, db names, domains. */
  lower: string;
  /** First letter capitalised, e.g. `Acme` — prose and UI strings. Not ALL-CAPS. */
  capital: string;
  /** Upper case, e.g. `ACME` — environment-variable prefixes (`ACME_MODE`). */
  upper: string;
}

export function isValidBrand(brand: string): boolean {
  return BRAND_PATTERN.test(brand);
}

export function brandTokens(brand: string): BrandTokens {
  if (!isValidBrand(brand)) {
    throw new Error(
      `invalid brand "${brand}": must match ${BRAND_PATTERN.source} ` +
        `(lowercase, starts with a letter, 2-31 characters)`,
    );
  }
  return {
    lower: brand,
    capital: brand[0]!.toUpperCase() + brand.slice(1),
    upper: brand.toUpperCase(),
  };
}

export const templateTokens: BrandTokens = brandTokens(TEMPLATE_BRAND);
