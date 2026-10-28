import { Alert, Box, Button, Loader, Stack, Text, ThemeIcon } from "@mantine/core";

("use client");

import * as React from "react";

import { DownloadIcon, FileTextIcon, RefreshCwIcon } from "lucide-react";

import { SectionCard } from "@/components/app/section-card";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/api";
import { toast } from "@/lib/notifications";
import { parseReportSections, summarizeReport } from "@/lib/report-sections";
import { statusMeta, toneDot } from "@/lib/status";
import { cn } from "@/lib/utils";

import { ReportReader } from "./report-reader";

// 页头只放「报告有多重」：发现条数 + 严重度分布，和报告正文的摘要口径一致。
const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

function ReportSeveritySummary({ bySeverity }: { bySeverity: Record<string, number> }) {
  const total = SEVERITY_ORDER.reduce((sum, level) => sum + (bySeverity[level] ?? 0), 0);
  if (!total) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-baseline gap-1">
        <span className="font-semibold text-foreground/80 tabular-nums">{total}</span>
        <span>条发现</span>
      </span>
      {SEVERITY_ORDER.map((level) => {
        const count = bySeverity[level] ?? 0;
        if (!count) return null;
        const meta = statusMeta("severity", level);
        return (
          <span key={level} className="inline-flex items-center gap-1.5" title={`${meta.label} ${count} 条`}>
            <span className={cn("size-1.5 rounded-full", toneDot[meta.tone])} aria-hidden="true" />
            <span className="tabular-nums">{count}</span>
            <span className="sr-only">{meta.label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function ReportTab({ taskId }: { taskId: string }) {
  const [report, setReport] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const requestSeq = React.useRef(0);
  const sections = React.useMemo(() => parseReportSections(report), [report]);
  const stats = React.useMemo(() => summarizeReport(sections), [sections]);

  // 统一加载入口：首次加载展示整块 loading；手动刷新只切按钮态，失败时保留旧内容。
  const load = React.useCallback(
    async (silent = false): Promise<string | null> => {
      const seq = ++requestSeq.current;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const text = await api.report(taskId);
        if (seq !== requestSeq.current) return null;
        setReport(text);
        setError("");
        return text;
      } catch (e) {
        if (seq !== requestSeq.current) return null;
        if (!silent) setReport("");
        setError((e as Error).message || "报告加载失败");
        return null;
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [taskId],
  );

  React.useEffect(() => {
    void load();
    return () => {
      requestSeq.current++;
    };
  }, [load]);

  function download() {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `liora-report-${taskId}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function refresh() {
    if (refreshing || loading) return;
    const text = await load(true);
    // 失败原因已经内联常驻在卡片里，这里不再叠一条 toast。
    if (text === null) return;
    toast.success(text ? "报告已刷新" : "报告尚未生成");
  }

  let content: React.ReactNode;
  if (loading) {
    content = (
      <Stack role="status" aria-live="polite" aria-busy="true" align="center" justify="center" gap="sm" py="xl">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          加载中…
        </Text>
      </Stack>
    );
  } else if (report) {
    content = <ReportReader sections={sections} source={report} focused={focused} onFocusedChange={setFocused} />;
  } else if (error) {
    // A failed read is not an empty report: show the reason and a retry action.
    content = (
      <Alert color="red" title="报告加载失败">
        <Stack align="flex-start" gap="sm">
          <Text component="span" size="sm">
            {error}
          </Text>
          <Button
            size="sm"
            variant="default"
            loading={refreshing}
            leftSection={refreshing ? undefined : <RefreshCwIcon size={14} />}
            onClick={() => void refresh()}
          >
            {refreshing ? "重试中…" : "重试"}
          </Button>
        </Stack>
      </Alert>
    );
  } else {
    // 空态给出下一步：报告由 Agent 生成，用户需要知道去哪拿、怎么刷新。
    content = (
      <Stack align="center" justify="center" gap="xs" px="md" py="xl" className="text-center">
        <ThemeIcon variant="light" color="gray" size="lg" radius="md">
          <FileTextIcon size={20} aria-hidden="true" />
        </ThemeIcon>
        <Text size="sm" fw={500}>
          暂无报告
        </Text>
        <Text size="xs" c="dimmed" maw={384}>
          报告由 Agent 在任务中生成，生成后点「刷新」查看
        </Text>
        <Button
          size="sm"
          variant="default"
          mt={6}
          loading={refreshing}
          leftSection={refreshing ? undefined : <RefreshCwIcon size={14} />}
          onClick={() => void refresh()}
        >
          {refreshing ? "刷新中…" : "刷新"}
        </Button>
      </Stack>
    );
  }

  return (
    <SectionCard
      icon={FileTextIcon}
      title="渗透测试报告"
      // 文件名与体量并进页头描述，不再单独占一行工具栏：报告页只有一条说明，
      // 文件级动作放进页头右侧，阅读控件留在阅读器自己的工具条里。
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>由 Agent 生成</span>
          {report ? (
            <>
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
              <span className="hidden font-mono sm:inline">liora-report-{taskId}.md</span>
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
              <span className="hidden tabular-nums sm:inline">{report.length.toLocaleString("zh-CN")} 字符</span>
              {stats.findings > 0 ? (
                <>
                  <span aria-hidden="true" className="hidden sm:inline">
                    ·
                  </span>
                  <ReportSeveritySummary bySeverity={stats.bySeverity} />
                </>
              ) : null}
            </>
          ) : null}
        </span>
      }
      actions={
        <>
          {/* 页头三个动作统一 36px：右侧是 Mantine size="sm"，兼容层 CopyButton 默认 32px，这里补到同高。 */}
          {report ? <CopyButton text={report} variant="outline" className="h-9" /> : null}
          <Button
            size="sm"
            variant="default"
            disabled={!report}
            leftSection={<DownloadIcon size={14} />}
            onClick={download}
          >
            <span className="sm:hidden">下载</span>
            <span className="hidden sm:inline">下载 Markdown</span>
          </Button>
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            disabled={loading}
            loading={refreshing}
            leftSection={refreshing ? undefined : <RefreshCwIcon size={14} />}
            onClick={() => void refresh()}
          >
            {refreshing ? "刷新中…" : "刷新"}
          </Button>
        </>
      }
      // 报告页只有一层卡片：阅读器自己就是卡片正文，不再套一层带边框的面板。
      // dense 让工具栏贴到卡片头部下沿，吸顶时与页头共用同一条边线。
      // 卡片宽度与其他页签保持一致（铺满内容区），宽屏下的留白交给阅读器内部的
      // 「目录 | 正文 | 概览」三栏去分配，而不是把整张卡片收窄。
      dense
      className="overflow-visible"
    >
      {error && report ? (
        <Alert color="red" className="mx-4 mt-4">
          刷新失败：{error}
        </Alert>
      ) : null}
      {report && !loading ? content : <Box p="lg">{content}</Box>}
    </SectionCard>
  );
}
