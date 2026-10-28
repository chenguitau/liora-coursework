"use client";

import { useEffect, useRef } from "react";

import { Button, Group, Select, Text } from "@mantine/core";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { MetaSeparator } from "@/components/app/page-header";

interface TablePaginationProps {
  page: number; // 1-based
  pageSize: number;
  total: number; // total (after filtering)
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  pageSizeOptions?: number[];
}

// pageWindows returns the sequence of page numbers / ellipsis to render.
function pageWindows(page: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "...")[] = [1];
  if (page > 3) out.push("...");
  const lo = Math.max(2, page - 1);
  const hi = Math.min(total - 1, page + 1);
  for (let i = lo; i <= hi; i++) out.push(i);
  if (page < total - 2) out.push("...");
  out.push(total);
  return out;
}

/**
 * Compact pagination bar that sits inside the same card as its table.
 * Uses native Mantine controls so the select/inputs share the same height,
 * radius and focus ring as the rest of the console.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;

  useEffect(() => {
    if (page !== safePage) onPageChangeRef.current(safePage);
  }, [page, safePage]);

  return (
    <Group
      justify="space-between"
      align="center"
      gap="sm"
      wrap="wrap"
      className="border-t border-border/60 px-5 py-2.5"
    >
      <Group gap="xs" align="center" wrap="wrap" className="min-w-0 text-[12px] text-muted-foreground">
        <Select
          aria-label="每页数量"
          size="xs"
          w={104}
          allowDeselect={false}
          value={String(pageSize)}
          onChange={(value) => value && onPageSizeChange(Number(value))}
          data={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
          classNames={{ input: "text-xs font-mono tabular-nums" }}
        />
        <Text component="span" className="whitespace-nowrap">
          条/页
        </Text>
        <MetaSeparator />
        {total > 0 ? (
          <Text component="span" className="whitespace-nowrap tabular-nums font-mono">
            {from}–{to} / 共{" "}
            <Text component="span" className="font-medium text-foreground">
              {total}
            </Text>{" "}
            条
          </Text>
        ) : (
          <Text component="span" className="whitespace-nowrap">
            共 0 条
          </Text>
        )}
      </Group>

      {totalPages > 1 && (
        <Group gap={4} align="center" wrap="nowrap" className="shrink-0">
          <Button
            variant="default"
            size="compact-sm"
            disabled={safePage === 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="上一页"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          {pageWindows(safePage, totalPages).map((p, i) =>
            p === "..." ? (
              <Text
                key={`el-${i}`}
                component="span"
                className="grid size-7 place-items-center text-[12px] text-muted-foreground"
                aria-hidden="true"
              >
                …
              </Text>
            ) : (
              <Button
                key={p}
                variant={p === safePage ? "filled" : "subtle"}
                size="compact-sm"
                onClick={() => onPageChange(p)}
                aria-current={p === safePage ? "page" : undefined}
                className="text-xs tabular-nums font-mono"
              >
                {p}
              </Button>
            ),
          )}
          <Button
            variant="default"
            size="compact-sm"
            disabled={safePage === totalPages}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="下一页"
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </Group>
      )}
    </Group>
  );
}
