"use client"

import * as React from "react"
import { Box } from "@mantine/core"
import { cn } from "@/lib/utils"

type PanelContextValue = { orientation: "horizontal" | "vertical"; register: (id: string, size: number) => void; resize: (id: string, size: number) => void; sizes: Record<string, number> }
const PanelContext = React.createContext<PanelContextValue | null>(null)
type ResizablePanelGroupProps = Omit<React.ComponentProps<"div">, "onChange"> & { orientation?: "horizontal" | "vertical"; direction?: "horizontal" | "vertical"; defaultLayout?: Record<string, number>; onLayoutChange?: (layout: Record<string, number>) => void; autoSaveId?: string }
function ResizablePanelGroup({ className, orientation = "horizontal", direction, defaultLayout = {}, onLayoutChange, autoSaveId: _autoSaveId, children, ...props }: ResizablePanelGroupProps) {
  const resolved = direction ?? orientation
  const [sizes, setSizes] = React.useState<Record<string, number>>(defaultLayout)
  const register = React.useCallback((id: string, size: number) => setSizes((previous) => previous[id] === undefined ? { ...previous, [id]: size } : previous), [])
  const resize = React.useCallback((id: string, size: number) => setSizes((previous) => { const next = { ...previous, [id]: Math.max(0, Math.min(100, size)) }; onLayoutChange?.(next); return next }), [onLayoutChange])
  return <PanelContext.Provider value={{ orientation: resolved, register, resize, sizes }}><Box data-slot="resizable-panel-group" data-panel-group-direction={resolved} className={cn("flex h-full w-full", resolved === "vertical" && "flex-col", className)} {...props}>{children}</Box></PanelContext.Provider>
}
type ResizablePanelProps = React.ComponentProps<"div"> & { id?: string; defaultSize?: number | string; minSize?: number | string; maxSize?: number | string; collapsible?: boolean; collapsedSize?: number | string; order?: number }
function sizeToPercent(value: number | string | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}
function sizeToCss(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === "number" ? `${value}%` : value
}
function ResizablePanel({ id, defaultSize = 50, minSize, maxSize, collapsible: _collapsible, collapsedSize: _collapsedSize, order, style, ...props }: ResizablePanelProps) {
  const context = React.useContext(PanelContext)
  const key = id ?? React.useId()
  const initial = sizeToPercent(defaultSize, 50)
  React.useEffect(() => { context?.register(key, initial) }, [context?.register, key, initial])
  const size = context?.sizes[key] ?? initial
  const horizontal = context?.orientation !== "vertical"
  const min = sizeToCss(minSize)
  const max = sizeToCss(maxSize)
  // 面板的 flex 比例是内部计算值；调用方的 style 只做覆盖，不能整块替换。
  return <Box
    data-slot="resizable-panel"
    data-panel-id={key}
    id={id}
    {...props}
    style={{
      flexGrow: size,
      flexBasis: 0,
      order,
      ...(horizontal ? { minWidth: min, maxWidth: max } : { minHeight: min, maxHeight: max }),
      ...style,
    }}
  />
}
type ResizableHandleProps = Omit<React.ComponentProps<"div">, "onChange"> & { withHandle?: boolean; disabled?: boolean; onDragging?: (dragging: boolean) => void; id?: string }
function ResizableHandle({ withHandle, className, disabled, onDragging, onPointerDown, ...props }: ResizableHandleProps) {
  const context = React.useContext(PanelContext)
  return <Box role="separator" tabIndex={disabled ? -1 : 0} aria-orientation={context?.orientation === "vertical" ? "horizontal" : "vertical"} data-slot="resizable-handle" className={cn("relative flex w-px shrink-0 cursor-col-resize items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden", context?.orientation === "vertical" && "h-px w-full cursor-row-resize", disabled && "pointer-events-none", className)} onPointerDown={(event) => {
    onPointerDown?.(event)
    if (disabled || event.defaultPrevented || !context) return
    event.preventDefault()
    onDragging?.(true)
    const panel = event.currentTarget.previousElementSibling as HTMLElement | null
    const group = event.currentTarget.parentElement
    const id = panel?.dataset.panelId ?? panel?.id
    if (!group || !panel || !id) return
    const start = context.orientation === "vertical" ? event.clientY : event.clientX
    const groupRect = group.getBoundingClientRect()
    // 以实际渲染尺寸为起点：CSS min/max 可能已经把面板夹到与 state 不同的值。
    const panelRect = panel.getBoundingClientRect()
    const initial = context.orientation === "vertical"
      ? (panelRect.height / (groupRect.height || 1)) * 100
      : (panelRect.width / (groupRect.width || 1)) * 100
    const move = (next: PointerEvent) => {
      const rect = group.getBoundingClientRect()
      const delta = ((context.orientation === "vertical" ? next.clientY : next.clientX) - start) / (context.orientation === "vertical" ? rect.height : rect.width) * 100
      context.resize(id, initial + delta)
    }
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); onDragging?.(false) }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up, { once: true })
  }} {...props}>{withHandle && <Box className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}</Box>
}
export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
