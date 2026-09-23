declare global {
  interface CamoxIconRegistry {}
}
export type IconId = CamoxIconRegistry extends { ids: infer IDs extends string } ? IDs : never;
declare const iconBrand: unique symbol;
export type IconValue = string & { readonly [iconBrand]: true };
