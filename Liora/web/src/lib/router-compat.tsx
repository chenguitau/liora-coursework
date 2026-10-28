import { type ComponentProps, useMemo } from "react";

import { Link as RouterLink, useLocation, useNavigate, useSearchParams as useRouterSearchParams } from "react-router";

// 把 React Router 的 Link / 路由 hooks 适配为页面使用的 href 形式。
// prefetch 参数为兼容旧调用保留，SPA 下不产生预取行为。
export default function Link({
  href,
  prefetch: _prefetch,
  ...props
}: Omit<ComponentProps<typeof RouterLink>, "to" | "prefetch"> & {
  href: string;
  prefetch?: boolean;
}) {
  return <RouterLink to={href} {...props} />;
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  return useRouterSearchParams()[0];
}

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => navigate(-1),
    }),
    [navigate],
  );
}
