import { Badge, Box, Text, Tooltip, TooltipContent, TooltipTrigger } from "@/components/mantine-compat";
import type { Asset } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PAGE_SIZES = [25, 50, 100, 200];

// 统一低饱和 tint 口径：bg-{hue}-500/12 + text-{hue}-600（深色 400），不再用 100 实底。
// 色相按分类色板映射：DELETE=rose、GET=emerald、POST=indigo、PUT=amber、PATCH=sky、
// HEAD=violet、OPTIONS=slate；amber 浅底文字降为 700（#b45309）才够 4.5:1 对比。
const METHOD_COLOR: Record<string, string> = {
  DELETE: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  GET: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  HEAD: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  OPTIONS: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
  PATCH: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  POST: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400",
  PUT: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
};

export function MethodBadge({ method }: { method: string }) {
  const normalized = method.toUpperCase();
  return (
    <Text
      className={cn(
        "inline-block rounded-md px-1.5 py-0.5 font-mono font-semibold text-[11px] leading-none tabular-nums",
        METHOD_COLOR[normalized] ?? "bg-muted text-muted-foreground",
      )}
    >
      {normalized || "—"}
    </Text>
  );
}

// 500/400 档在深色底上用 400 亮度才够清楚，浅色仍走 600。
export function statusTone(code: number) {
  if (code >= 500) return "text-red-600 dark:text-red-400";
  if (code >= 400) return "text-amber-600 dark:text-amber-400";
  if (code >= 300) return "text-blue-600 dark:text-blue-400";
  if (code >= 200) return "text-emerald-600 dark:text-emerald-400";
  return "text-muted-foreground";
}

export function Chips({
  items,
  mono,
  dense = false,
  maxVisible = 3,
}: {
  items: string[];
  mono?: boolean;
  /** 全局资产页的表格更密，历史上把 chip 压到 10px；任务资产页保持 Badge 默认字号。 */
  dense?: boolean;
  /** 默认最多展示 3 个标签，超出收敛为 +N 徽章（悬停展示完整列表），确保表格行高恒定。 */
  maxVisible?: number;
}) {
  const clean = items.filter(Boolean);
  // 空值占位也要过 AA：深色下 muted-foreground/40 只剩 ~1.8:1，直接用完整次要文字色。
  if (clean.length === 0) return <Text className="text-muted-foreground text-xs select-none">—</Text>;
  const visible = clean.slice(0, maxVisible);
  const rest = clean.slice(maxVisible);
  return (
    <Box className="flex flex-nowrap items-center gap-1 overflow-hidden">
      {/* 按索引做 key：items 可能有重复标签（如接口参数都缺名称时的 "?"），用标签做 key 会撞 key。 */}
      {visible.map((item, i) => (
        <Badge
          key={i}
          variant="outline"
          className={cn(
            "max-w-[140px] truncate rounded-md border-border/80 bg-surface-muted/50 font-normal text-foreground/85",
            mono && "font-mono tabular-nums",
            dense && "h-5 px-1.5 text-[11px]",
          )}
          title={item}
        >
          {item}
        </Badge>
      ))}
      {rest.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="h-5 shrink-0 rounded-md px-1.5 font-mono text-[11px] tabular-nums">
              +{rest.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <Box className="flex flex-wrap gap-1 py-0.5">
              {clean.map((item, i) => (
                <Text key={i} className="rounded bg-background/15 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
                  {item}
                </Text>
              ))}
            </Box>
          </TooltipContent>
        </Tooltip>
      )}
    </Box>
  );
}

export function firstText(values: Array<string | undefined>, fallback: string): string {
  return values.find((value) => value?.trim()) ?? fallback;
}

export function assetLabel(asset: Asset): string {
  switch (asset.type) {
    case "root_domain":
    case "subdomain":
      return firstText([asset.domain], `#${asset.id}`);
    case "ip":
      return firstText([asset.ip], `#${asset.id}`);
    case "app":
      return firstText([asset.app_name, asset.url], `#${asset.id}`);
    case "service": {
      const host = firstText([asset.ip, asset.domain], "");
      const address = [host, asset.port].filter((value) => value !== undefined && value !== "").join(":");
      return firstText([asset.url, address, asset.service_name], `#${asset.id}`);
    }
    case "endpoint":
      return firstText([[asset.method, asset.url].filter(Boolean).join(" ")], `#${asset.id}`);
  }
}
