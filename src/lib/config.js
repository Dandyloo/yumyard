export const APP_CONFIG = {
  branchSlug: "abura",
  sessionStorageKey: "yumyard-pos-session",
  adminSessionStorageKey: "yumyard-admin-session",
  sessionExpiresWarningMinutes: 15,
  // Minutes of no touch/click/key activity while a worker is signed in
  // before the POS locks itself back to the profile+PIN screen.
  inactivityLockMinutes: 5,
  // Roles allowed into the admin area. Mirrors the server-side check in
  // authenticate_worker_by_id() (p_access_area = 'admin') - kept here too
  // so the frontend can filter the login profile list and gate UI without
  // a round trip.
  adminRoles: ["owner", "admin", "manager"],
};