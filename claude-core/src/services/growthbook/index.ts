export interface GrowthbookAttributes {
  [key: string]: string | number | boolean | null | undefined;
}

export interface GrowthbookFeature<T = unknown> {
  key: string;
  defaultValue: T;
  rules?: Array<{
    attribute: string;
    equals: string | number | boolean;
    value: T;
  }>;
}

/**
 * Browser-safe lightweight feature flag evaluator inspired by GrowthBook.
 */
export class GrowthbookFacade {
  private readonly features = new Map<string, GrowthbookFeature>();
  private attributes: GrowthbookAttributes = {};

  setAttributes(attributes: GrowthbookAttributes): void {
    this.attributes = { ...attributes };
  }

  registerFeature<T>(feature: GrowthbookFeature<T>): void {
    this.features.set(feature.key, feature as GrowthbookFeature);
  }

  evaluate<T>(key: string): T | undefined {
    const feature = this.features.get(key) as GrowthbookFeature<T> | undefined;
    if (!feature) return undefined;

    for (const rule of feature.rules ?? []) {
      if (this.attributes[rule.attribute] === rule.equals) {
        return rule.value;
      }
    }

    return feature.defaultValue;
  }
}
