export const ADMIN_ACCESS_COOKIE = "festival_access_token";
export const ADMIN_REFRESH_COOKIE = "festival_refresh_token";

const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge,
  priority: "high" as const,
});

export function adminSessionCookies(accessToken: string, refreshToken: string, expiresIn: number) {
  return [
    { name: ADMIN_ACCESS_COOKIE, value: accessToken, options: cookieOptions(Math.max(60, expiresIn)) },
    { name: ADMIN_REFRESH_COOKIE, value: refreshToken, options: cookieOptions(REFRESH_COOKIE_MAX_AGE) },
  ];
}

export function clearedAdminSessionCookies() {
  return [
    { name: ADMIN_ACCESS_COOKIE, value: "", options: cookieOptions(0) },
    { name: ADMIN_REFRESH_COOKIE, value: "", options: cookieOptions(0) },
  ];
}
