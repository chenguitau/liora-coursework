import { useEffect, useState } from "react";

import { auth, type CurrentUser, DEFAULT_USER_AVATAR } from "@/lib/auth";

const FALLBACK: CurrentUser = {
  id: "1",
  name: "Liora",
  username: "Liora",
  email: "",
  avatar: DEFAULT_USER_AVATAR,
  role: "operator",
};

export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<CurrentUser>(FALLBACK);

  useEffect(() => {
    const syncUser = () => setUser(auth.getCurrentUser() ?? FALLBACK);
    syncUser();
    return auth.subscribe(syncUser);
  }, []);

  return user;
}
