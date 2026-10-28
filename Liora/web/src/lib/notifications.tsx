import type { ReactNode } from "react";

import { notifications } from "@mantine/notifications";
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";

type NotificationKind = "default" | "success" | "error" | "info" | "warning";

type ToastOptions = {
  id?: string | number;
  title?: ReactNode;
  description?: ReactNode;
  duration?: number;
  icon?: ReactNode;
};

const colors: Record<NotificationKind, string> = {
  default: "blue",
  success: "green",
  error: "red",
  info: "blue",
  warning: "yellow",
};

const icons: Record<NotificationKind, ReactNode> = {
  default: <InfoIcon size={16} />,
  success: <CircleCheckIcon size={16} />,
  error: <OctagonXIcon size={16} />,
  info: <InfoIcon size={16} />,
  warning: <TriangleAlertIcon size={16} />,
};

function show(message: ReactNode, kind: NotificationKind = "default", options: ToastOptions = {}) {
  const duration = options.duration ?? 4500;
  return notifications.show({
    id: options.id === undefined ? undefined : String(options.id),
    title: options.title ?? message,
    message: options.title !== undefined && options.title !== null ? message : (options.description ?? ""),
    color: colors[kind],
    icon: options.icon ?? icons[kind],
    autoClose: duration,
    withBorder: false,
    radius: 10,
    classNames: {
      root: "liora-toast",
      icon: "liora-toast-icon",
      body: "liora-toast-body",
      title: "liora-toast-title",
      description: "liora-toast-description",
      closeButton: "liora-toast-close",
    },
  });
}

export const toast = Object.assign((message: ReactNode, options?: ToastOptions) => show(message, "default", options), {
  success: (message: ReactNode, options?: ToastOptions) => show(message, "success", options),
  error: (message: ReactNode, options?: ToastOptions) => show(message, "error", options),
  info: (message: ReactNode, options?: ToastOptions) => show(message, "info", options),
  warning: (message: ReactNode, options?: ToastOptions) => show(message, "warning", options),
  dismiss: (id?: string | number) => (id === undefined ? notifications.clean() : notifications.hide(String(id))),
});

export { notifications };
