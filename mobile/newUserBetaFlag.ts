/** Explicit build selection. No runtime preference or configuration value. */
export const MOBILE_NEW_USER_BETA_ENV_NAME = "CURLING_MOBILE_NEW_USER_BETA";
export const MOBILE_NEW_USER_BETA_DEFINE_NAME = "__CURLING_MOBILE_NEW_USER_BETA__";
export function isNewUserBetaRequested(value: string | undefined): boolean { return value === "1"; }
