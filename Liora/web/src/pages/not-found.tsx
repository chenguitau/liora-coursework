import { Box, Button, Card, Flex, Group, Image, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { ArrowLeftIcon, CompassIcon, HomeIcon } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import Link from "@/lib/router-compat";

export default function NotFound() {
  return (
    <Flex
      component="main"
      align="center"
      justify="center"
      className="relative min-h-dvh overflow-hidden bg-background px-5 py-16"
    >
      <Box
        aria-hidden="true"
        className="app-grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]"
      />
      <Stack className="relative w-full max-w-sm" align="center" gap="md">
        <Card withBorder radius="md" padding="xl" shadow="sm" className="w-full text-center">
          <Stack align="center" gap="xs">
            <ThemeIcon size="xl" radius="md" variant="light" color="blue">
              <CompassIcon size={22} aria-hidden="true" />
            </ThemeIcon>
            <Text
              mt="md"
              size="xs"
              ff="monospace"
              fw={600}
              c="dimmed"
              tt="uppercase"
              className="tracking-widest tabular-nums"
            >
              Error 404
            </Text>
            <Title order={1}>页面不存在</Title>
            <Text size="sm" c="dimmed" lh={1.7}>
              这个地址可能已失效，或页面已被移除。
            </Text>
            <Group mt="md" justify="center" gap="xs">
              <Button
                component={Link}
                prefetch={false}
                href="/function/tasks"
                variant="default"
                size="sm"
                leftSection={<ArrowLeftIcon size={16} aria-hidden="true" />}
              >
                任务列表
              </Button>
              <Button
                component={Link}
                prefetch={false}
                href="/dashboard"
                size="sm"
                leftSection={<HomeIcon size={16} aria-hidden="true" />}
              >
                返回总览
              </Button>
            </Group>
          </Stack>
        </Card>
        <Group gap="xs" wrap="nowrap">
          <Image src={APP_CONFIG.logoIcon} alt="" w={20} h={20} fit="contain" />
          <Text size="xs" c="dimmed">
            {APP_CONFIG.name} · 授权测试 · 全程留证
          </Text>
        </Group>
      </Stack>
    </Flex>
  );
}
