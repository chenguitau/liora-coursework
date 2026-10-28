const TOKEN_KEY = "liora_token";
const USER_AVATAR_KEY_PREFIX = "liora_user_avatar:";
export const DEFAULT_USER_AVATAR = "/avatars/liora-profile.jpg";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 天（秒）

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
}

// redirecting guards against a burst of parallel 401s each pushing a new
// history entry; the first expired response wins.
let redirecting = false;

export const auth = {
  subscribe(onChange: () => void): () => void {
    window.addEventListener("liora-auth-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("liora-auth-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  },
  getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    window.dispatchEvent(new Event("liora-auth-change"));
    // 同步写 cookie，供同源下载与流式接口读取
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  },

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event("liora-auth-change"));
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
  },

  setUserAvatar(username: string, avatar: string): void {
    localStorage.setItem(`${USER_AVATAR_KEY_PREFIX}${username}`, avatar);
    window.dispatchEvent(new Event("liora-auth-change"));
  },

  // A 401 means the 7-day token expired (or the signing key rotated). Clearing it
  // without navigating leaves every panel stuck on "未授权" until a manual reload,
  // so route to /login with a reason the page can explain.
  redirectToLogin(reason: "expired" | "signed-out" = "expired"): void {
    if (typeof window === "undefined" || redirecting) return;
    if (window.location.pathname === "/login") return;
    redirecting = true;
    const query = reason === "expired" ? "?expired=1" : "";
    window.location.replace(`/login${query}`);
  },

  // 从 JWT payload 的 sub 字段解析当前用户，仅用于展示，不做签名验证。
  getCurrentUser(): CurrentUser | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      // base64url → base64
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      const username: string | null = typeof payload.sub === "string" && payload.sub.trim() ? payload.sub : null;
      if (!username) return null;
      return {
        id: "1",
        name: username,
        username,
        email: "",
        avatar: localStorage.getItem(`${USER_AVATAR_KEY_PREFIX}${username}`) || DEFAULT_USER_AVATAR,
        role: "operator",
      };
    } catch {
      return null;
    }
  },
};
