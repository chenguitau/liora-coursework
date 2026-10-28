"use client";

import { useRef, useState } from "react";

import { Avatar, Button, Group, Menu, Stack, Text } from "@mantine/core";
import { Camera, ChevronDown, KeyRound, LogOut } from "lucide-react";

import { auth, type CurrentUser } from "@/lib/auth";
import { toast } from "@/lib/notifications";
import { getInitials } from "@/lib/utils";

import { ChangePasswordDialog } from "./change-password-dialog";

// 深色下 Mantine 菜单项悬停默认用 dark-4（#334155），比 --popover 亮一大截；统一改用 accent 令牌。
const MENU_ITEM_HOVER = "[--menu-item-hover:var(--accent)]";

export function AccountSwitcher({ user, labeled = false }: { readonly user: CurrentUser; labeled?: boolean }) {
  const [pwOpen, setPwOpen] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  function handleLogout() {
    auth.clearToken();
    window.location.href = "/login";
  }

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("图片不能超过 10 MB");
      return;
    }

    try {
      const avatar = await resizeAvatar(file);
      auth.setUserAvatar(user.username, avatar);
      toast.success("头像已更新");
    } catch {
      toast.error("头像更新失败，请换一张图片重试");
    }
  }

  return (
    <>
      <Menu position="bottom-end" offset={6} width={232} shadow="md">
        <Menu.Target>
          {labeled ? (
            <Button
              variant="subtle"
              radius="md"
              className="h-8 shrink-0 px-2 whitespace-nowrap max-sm:size-9 max-sm:justify-center max-sm:p-0"
              aria-label={`账户菜单：${user.name}`}
              title={`账户菜单：${user.name}`}
              leftSection={
                <Avatar
                  src={user.avatar || null}
                  alt=""
                  size={24}
                  radius="sm"
                  color="blue"
                  autoContrast
                  className="ring-1 ring-border"
                >
                  {getInitials(user.name)}
                </Avatar>
              }
              rightSection={
                <ChevronDown size={14} className="hidden text-muted-foreground md:block" aria-hidden="true" />
              }
            >
              <Text
                span
                size="sm"
                fw={500}
                lh={1}
                className="hidden max-w-40 truncate text-left text-foreground md:block"
              >
                {user.name}
              </Text>
            </Button>
          ) : (
            <Button
              variant="subtle"
              radius="md"
              className="size-8 p-0 max-sm:size-11"
              aria-label={`账户菜单：${user.name}`}
              title={`账户菜单：${user.name}`}
            >
              <Avatar src={user.avatar || null} alt="" size={32} radius="md" autoContrast>
                {getInitials(user.name)}
              </Avatar>
            </Button>
          )}
        </Menu.Target>
        <Menu.Dropdown styles={{ dropdown: { borderColor: "var(--border)" } }}>
          <Menu.Label>
            <Group gap="xs" wrap="nowrap" data-slot="account-menu-user" className="select-none py-0.5">
              <Avatar
                src={user.avatar || null}
                alt=""
                size="sm"
                radius="sm"
                color="blue"
                autoContrast
                className="ring-1 ring-border"
              >
                {getInitials(user.name)}
              </Avatar>
              <Stack gap={0} className="min-w-0">
                <Text span size="sm" fw={500} className="truncate text-foreground">
                  {user.name}
                </Text>
                <Text span size="xs" c="dimmed">
                  登录用户
                </Text>
              </Stack>
            </Group>
          </Menu.Label>
          <Menu.Divider />
          <Menu.Item
            className={MENU_ITEM_HOVER}
            leftSection={<Camera size={16} aria-hidden="true" />}
            onClick={() => window.setTimeout(() => avatarInput.current?.click(), 0)}
          >
            更换头像
          </Menu.Item>
          <Menu.Item
            className={MENU_ITEM_HOVER}
            leftSection={<KeyRound size={16} aria-hidden="true" />}
            onClick={() => setPwOpen(true)}
          >
            修改密码
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            className={MENU_ITEM_HOVER}
            leftSection={<LogOut size={16} aria-hidden="true" />}
            onClick={handleLogout}
            // 危险操作走 --destructive：深色 rose-400、浅色 rose-600，替换 Mantine 红（浅底仅 ~3:1）。
            styles={{
              item: { color: "var(--destructive)" },
              itemLabel: { color: "var(--destructive)" },
              itemSection: { color: "var(--destructive)" },
            }}
          >
            退出登录
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <input
        ref={avatarInput}
        type="file"
        accept="image/*"
        aria-label="选择头像文件"
        className="sr-only"
        tabIndex={-1}
        onChange={handleAvatarChange}
      />
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}

function resizeAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas is unavailable"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Image conversion failed"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image read failed"));
          reader.onerror = () => reject(new Error("Image read failed"));
          reader.readAsDataURL(blob);
        },
        "image/webp",
        0.86,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    image.src = url;
  });
}
