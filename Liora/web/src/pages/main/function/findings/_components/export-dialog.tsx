"use client";

import { Radio } from "@mantine/core";
import { DownloadIcon } from "lucide-react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Stack,
  Text,
} from "@/components/mantine-compat";

/** 导出范围:当前筛选 / 全部 / 勾选项。 */
export type ExportScope = "filtered" | "all" | "selected";

/** 导出格式:md 单文件 / md 分文件 zip / csv / json。 */
export type ExportFormat = "md-single" | "md-zip" | "csv" | "json";

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ExportScope;
  onScopeChange: (scope: ExportScope) => void;
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  /** 「当前筛选」口径下的条数:平铺/资产视图取列表总数,分组视图取组接口的 finding_total。 */
  filteredTotal: number;
  /** 跨页勾选的条数;为 0 时「导出勾选」不可选。 */
  selectedCount: number;
  exporting: boolean;
  onExport: () => void;
}

// ExportDialog 只负责「范围 × 格式」的选择与提交按钮,真正的导出请求由页面发起。
export function ExportDialog({
  open,
  onOpenChange,
  scope,
  onScopeChange,
  format,
  onFormatChange,
  filteredTotal,
  selectedCount,
  exporting,
  onExport,
}: ExportDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (exporting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent busy={exporting}>
        <DialogHeader>
          <DialogTitle>导出发现</DialogTitle>
          <DialogDescription>选择导出范围与格式,生成后浏览器会自动下载。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Stack gap="lg">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                导出范围
              </Text>
              <Radio.Group value={scope} onChange={(value) => onScopeChange(value as ExportScope)}>
                <Stack gap="xs">
                  <Radio value="filtered" label={`导出当前筛选结果（共 ${filteredTotal} 条）`} />
                  <Radio value="all" label="导出全部" />
                  <Radio value="selected" label={`导出勾选的 ${selectedCount} 条`} disabled={selectedCount === 0} />
                </Stack>
              </Radio.Group>
            </Stack>

            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                导出格式
              </Text>
              <Radio.Group value={format} onChange={(value) => onFormatChange(value as ExportFormat)}>
                <Stack gap="xs">
                  <Radio value="md-single" label="Markdown 汇总报告（单个 .md 文件）" />
                  <Radio value="md-zip" label="Markdown 分文件（一漏洞一 .md，打包 .zip）" />
                  <Radio value="csv" label="CSV 表格（.csv）" />
                  <Radio value="json" label="JSON（.json）" />
                </Stack>
              </Radio.Group>
            </Stack>
          </Stack>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={exporting}>
            取消
          </Button>
          <Button
            variant="filled"
            size="sm"
            onClick={onExport}
            disabled={exporting || (scope === "selected" && selectedCount === 0)}
            leftSection={<DownloadIcon className="size-3.5" />}
          >
            {exporting ? "导出中…" : "导出"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
