/**
 * 轻量特性开关：按属性匹配规则返回取值，否则用 defaultValue。
 */
export interface GrowthbookAttributes {
  [key: string]: string | number | boolean | null | undefined;
}

/** 单条特性定义 */
export interface GrowthbookFeature<T = unknown> {
  key: string;
  defaultValue: T;
  rules?: Array<{
    attribute: string;
    equals: string | number | boolean;
    value: T;
  }>;
}

/** GrowthBook 风格的浏览器安全特性开关门面 */
export class GrowthbookFacade {
  private readonly features = new Map<string, GrowthbookFeature>();
  private attributes: GrowthbookAttributes = {};

  /** 设置评估上下文（如 plan=pro） */
  setAttributes(attributes: GrowthbookAttributes): void {
    this.attributes = { ...attributes };
  }

  /** 注册特性键与规则 */
  registerFeature<T>(feature: GrowthbookFeature<T>): void {
    this.features.set(feature.key, feature as GrowthbookFeature);
  }

  /** 按规则求值，无匹配则 defaultValue，未注册返回 undefined */
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
