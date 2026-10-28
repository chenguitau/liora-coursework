import * as React from "react";

import { Text } from "@mantine/core";

import { fmtTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

// Compact token readout used by the session header and the task-wide total.
// One muted pill, three label/value pairs: the numbers stay scannable and
// tabular, and the pill recedes next to the session title instead of competing
// with it. Labels keep the existing short/long wording.
export const TokenMetrics = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span"> & {
    input: number;
    cache: number;
    output: number;
    labels?: "short" | "long";
    /** 嵌在已有容器里时去掉胶囊描边，只保留标签与数字。 */
    plain?: boolean;
  }
>(({ input, cache, output, labels = "short", plain = false, className, ...props }, ref) => {
  const names = labels === "short" ? ["入", "缓", "出"] : ["输入", "缓存", "输出"];
  const values = [input, cache, output];
  return (
    <Text
      component="span"
      ref={ref}
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5",
        !plain && "rounded-md border border-border/70 bg-surface-muted px-2 py-0.5",
        className,
      )}
      {...props}
    >
      {values.map((value, index) => (
        <Text component="span" key={names[index]} className="inline-flex items-baseline gap-1 whitespace-nowrap">
          <Text component="span" size="xs" c="dimmed">
            {names[index]}
          </Text>
          <Text component="span" size="xs" fw={500} ff="monospace" className="tabular-nums">
            {fmtTokens(value)}
          </Text>
        </Text>
      ))}
    </Text>
  );
});
TokenMetrics.displayName = "TokenMetrics";
