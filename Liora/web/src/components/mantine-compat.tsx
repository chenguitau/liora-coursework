"use client";

import * as React from "react";

import {
  Box,
  Collapse,
  Divider,
  Flex,
  Group,
  Loader,
  Alert as MAlert,
  Avatar as MAvatar,
  Badge as MBadge,
  Button as MButton,
  Card as MCard,
  Checkbox as MCheckbox,
  CloseButton,
  Drawer as MDrawer,
  Input as MInput,
  Modal as MModal,
  Popover as MPopover,
  Radio as MRadio,
  ScrollArea as MScrollArea,
  Select as MSelect,
  Skeleton as MSkeleton,
  Switch as MSwitch,
  Table as MTable,
  Tabs as MTabs,
  Textarea as MTextarea,
  Tooltip as MTooltip,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

/* Local migration boundary: legacy call sites retain their public API while every
 * rendered control is supplied by Mantine. Business code stays outside this file. */
type AnyProps = Record<string, any>;
const childArray = (children: React.ReactNode): React.ReactNode[] => React.Children.toArray(children);
const validChild = (child: React.ReactNode): child is React.ReactElement<AnyProps> => React.isValidElement(child);

/* 兼容层只负责把旧的组合式 API 映射到 Mantine；文本提取用于给没有
 * Mantine title 的弹层补可访问名称，以及把 SelectItem 的可见文案作为
 * 选项 label（而不是把 value 直接展示给用户）。 */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return validChild(node) ? textOf(node.props.children) : "";
}

function findChildDeep(children: React.ReactNode, type: React.ElementType): React.ReactElement<AnyProps> | undefined {
  let found: React.ReactElement<AnyProps> | undefined;
  const walk = (nodes: React.ReactNode) => {
    childArray(nodes).forEach((node) => {
      if (found || !validChild(node)) return;
      if (node.type === type) {
        found = node;
        return;
      }
      walk(node.props.children);
    });
  };
  walk(children);
  return found;
}

export { Box };
export function TextView({ component, ...props }: AnyProps) {
  return <Text component={component ?? "span"} {...props} />;
}
export type CompatEventProps = {
  onClick?: (event: React.MouseEvent<any>) => void;
  onKeyDown?: (event: React.KeyboardEvent<any>) => void;
  onOpenChange?: (open: boolean) => void;
  onCheckedChange?: (checked: any) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
};

export function Heading({ order = 2, ...props }: AnyProps) {
  return <Title order={order} {...props} />;
}

export const Button = React.forwardRef<HTMLButtonElement, AnyProps & CompatEventProps>(function Button(
  { asChild, children, size, variant, className, ...props },
  ref,
) {
  const variants: AnyProps = {
    default: "filled",
    destructive: "filled",
    outline: "outline",
    secondary: "light",
    ghost: "subtle",
    link: "transparent",
  };
  const resolvedSize = (size as string | undefined) ?? "default";
  const isIcon = resolvedSize.startsWith("icon");
  const compact = resolvedSize === "xs" || resolvedSize === "icon-xs";
  const large = resolvedSize === "lg" || resolvedSize === "icon-lg";
  // 旧 API 的 default/sm 都是 32px，xs 24px，lg 40px；用工具类覆盖
  // Mantine 的默认高度，保证表格工具栏和弹层页脚一致。
  const sizeClass = isIcon
    ? compact
      ? "size-6 p-0"
      : large
        ? "size-10 p-0"
        : "size-8 p-0"
    : compact
      ? "h-6"
      : large
        ? "h-10"
        : "h-8";
  const classes = cn(sizeClass, !compact && !isIcon && "text-[13px]", className);
  const mantineProps = {
    ...props,
    ref,
    size: compact ? "xs" : large ? "lg" : "sm",
    variant: variants[variant as string] ?? variant,
    color: variant === "destructive" ? "red" : props.color,
    className: classes,
    "data-slot": "button",
    "data-variant": variant ?? "default",
    "data-size": resolvedSize,
  };
  if (asChild && validChild(children)) {
    return (
      <MButton
        {...mantineProps}
        renderRoot={(rootProps) =>
          React.cloneElement(children, {
            ...rootProps,
            className: cn(rootProps.className, children.props.className),
            children: children.props.children,
          })
        }
      />
    );
  }
  return <MButton {...mantineProps}>{children}</MButton>;
});

export const AsyncButton = React.forwardRef<HTMLButtonElement, AnyProps>(function AsyncButton(
  { loading, loadingLabel, children, disabled, ...props },
  ref,
) {
  return (
    <Button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Loader size="xs" aria-label={loadingLabel ?? "加载中"} /> : null}
      {children}
    </Button>
  );
});
export const Input = TextInput;
export const Textarea = MTextarea;
export const Label = React.forwardRef<HTMLLabelElement, AnyProps>(function Label(props, ref) {
  return <MInput.Label ref={ref} {...props} />;
});
export const Badge = React.forwardRef<HTMLDivElement, AnyProps>(function Badge({ variant, className, ...props }, ref) {
  const variants: AnyProps = {
    default: "light",
    secondary: "light",
    outline: "outline",
    destructive: "light",
    ghost: "light",
    link: "transparent",
  };
  const resolved = (variant as string | undefined) ?? "default";
  return (
    <MBadge
      ref={ref}
      {...props}
      variant={variants[resolved] ?? resolved}
      color={resolved === "destructive" ? "red" : props.color}
      className={cn("font-mono tabular-nums", className)}
      data-slot="badge"
      data-variant={resolved}
    />
  );
});
export const Skeleton = React.forwardRef<HTMLDivElement, AnyProps>(function Skeleton(props, ref) {
  return <MSkeleton ref={ref} {...props} />;
});
export const Spinner = React.forwardRef<HTMLDivElement, AnyProps>(function Spinner({ label, ...props }, ref) {
  return <Loader ref={ref} size="xs" aria-label={label ?? "加载中"} {...props} />;
});
export const Alert = React.forwardRef<HTMLDivElement, AnyProps>(function Alert({ variant, children, ...props }, ref) {
  return (
    <MAlert ref={ref} color={variant === "destructive" ? "red" : "blue"} {...props}>
      {children}
    </MAlert>
  );
});
export function AlertDescription(props: AnyProps) {
  return <Text {...props} />;
}
export const Card = React.forwardRef<HTMLDivElement, AnyProps>(function Card(props, ref) {
  return <MCard ref={ref} withBorder {...props} />;
});
export const CardContent = Box;
export const Separator = Divider;

export const Checkbox = React.forwardRef<HTMLInputElement, AnyProps & CompatEventProps>(function Checkbox(
  { checked, onCheckedChange, onChange, children, ...props },
  ref,
) {
  return (
    <MCheckbox
      {...props}
      ref={ref}
      checked={checked === "indeterminate" ? false : checked}
      indeterminate={checked === "indeterminate"}
      onChange={(event) => {
        onChange?.(event);
        onCheckedChange?.(event.currentTarget.checked);
      }}
    />
  );
});
export function RadioGroup({
  value,
  onValueChange,
  children,
  ...props
}: AnyProps & { onValueChange?: (value: string) => void }) {
  return (
    <MRadio.Group value={value} onChange={(next) => onValueChange?.(next)} {...props}>
      <Stack gap="xs">{children}</Stack>
    </MRadio.Group>
  );
}
export const RadioGroupItem = MRadio;

export const Switch = React.forwardRef<HTMLInputElement, AnyProps & CompatEventProps>(function Switch(
  { checked, onCheckedChange, onChange, ...props },
  ref,
) {
  return (
    <MSwitch
      {...props}
      ref={ref}
      checked={checked}
      onChange={(event) => {
        onChange?.(event);
        onCheckedChange?.(event.currentTarget.checked);
      }}
    />
  );
});

export function Tooltip({ children }: { children: React.ReactElement<AnyProps>[] }) {
  const parts = childArray(children);
  const trigger = parts.find((part) => validChild(part) && part.type === TooltipTrigger);
  const content = parts.find(
    (part): part is React.ReactElement<AnyProps> => validChild(part) && part.type === TooltipContent,
  );
  return (
    <MTooltip
      label={content?.props.children ?? ""}
      position={content?.props.side}
      className={content?.props.className}
      withinPortal
      zIndex={300}
      multiline
    >
      {validChild(trigger) ? trigger.props.children : null}
    </MTooltip>
  );
}
export function TooltipTrigger({ children }: AnyProps) {
  return children;
}
export function TooltipContent({ children }: AnyProps) {
  return children;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  placeholder,
  children,
  classNames,
  ...props
}: AnyProps & { onValueChange?: (value: string) => void }) {
  const items: React.ReactElement<AnyProps>[] = [];
  let triggerProps: AnyProps | undefined;
  let triggerPlaceholder: string | undefined;
  const collect = (nodes: React.ReactNode) =>
    childArray(nodes).forEach((node) => {
      if (!validChild(node)) return;
      if (node.type === SelectItem) items.push(node);
      else {
        if (node.type === SelectTrigger) triggerProps = node.props;
        if (node.type === SelectValue && node.props.placeholder) triggerPlaceholder = node.props.placeholder;
        collect(node.props.children);
      }
    });
  collect(children);
  const trigger: AnyProps = triggerProps ?? {};
  return (
    <MSelect
      {...props}
      // Mantine 的 Select input 不带 role，辅助技术和 e2e 都按 combobox 识别它。
      // 旧封装暴露的是原生 combobox 语义，这里显式补齐，保持公共可访问性契约。
      role={props.role ?? "combobox"}
      id={props.id ?? trigger.id}
      aria-label={props["aria-label"] ?? trigger["aria-label"]}
      placeholder={placeholder ?? triggerPlaceholder}
      value={value ?? null}
      defaultValue={defaultValue}
      size={props.size ?? trigger.size}
      disabled={props.disabled ?? trigger.disabled}
      onChange={(next) => {
        if (next !== null) onValueChange?.(next);
      }}
      comboboxProps={{ withinPortal: true, zIndex: 300, ...props.comboboxProps }}
      classNames={{
        ...classNames,
        // 旧 API 把尺寸/响应式宽度写在 SelectTrigger 上；root 决定整体盒模型，
        // input 决定内层高度，因此两处都合并，避免宽度类只作用到内层 input。
        root: cn(trigger.className, classNames?.root),
        input: cn(trigger.className, classNames?.input),
      }}
      data={items.map((item) => ({
        value: item.props.value,
        // 可见文案才是用户应看到的 label；value 只作为表单值。
        label: textOf(item.props.children) || item.props.value,
        disabled: item.props.disabled,
      }))}
      renderOption={({ option }) =>
        items.find((item) => item.props.value === option.value)?.props.children ?? option.label
      }
    />
  );
}
function SelectItem(_props: { value: string; disabled?: boolean; children?: React.ReactNode }) {
  return null;
}
export function SelectGroup({ children }: AnyProps) {
  return children;
}
export const SelectTrigger = MSelect;
export function SelectContent(_props: AnyProps) {
  return null;
}
export function SelectValue({ children }: AnyProps) {
  return children ?? null;
}
export { SelectItem };

export const Table = MTable;
// Mantine 8 的 ScrollContainer 挂在 Table 静态属性上；显式导出便于业务页统一做横向滚动约束。
export const TableScrollContainer = MTable.ScrollContainer;
export const TableHeader = MTable.Thead;
export const TableBody = MTable.Tbody;
export const TableRow = MTable.Tr;
export const TableHead = MTable.Th;
export const TableCell = MTable.Td;

export function Tabs({ onValueChange, ...props }: AnyProps & { onValueChange?: (value: string) => void }) {
  return <MTabs keepMounted={false} onChange={(value) => onValueChange?.(value ?? "")} {...props} />;
}
export function TabsList({ variant, children, ...props }: AnyProps) {
  // 旧 API: default 是胶囊式分段标签，line 是下划线标签。
  const resolved = variant === "line" ? "default" : (variant ?? "pills");
  return (
    <MTabs.List variant={resolved} {...props}>
      {children}
    </MTabs.List>
  );
}
export const TabsTrigger = MTabs.Tab;
export const TabsContent = MTabs.Panel;

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
};
const DialogContext = React.createContext<DialogContextValue | null>(null);
export function Dialog({ open, defaultOpen = false, onOpenChange, children }: AnyProps & CompatEventProps) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const [busy, setBusy] = React.useState(false);
  const actual = open ?? internal;
  return (
    <DialogContext.Provider
      value={{
        open: actual,
        busy,
        setBusy,
        setOpen: (next) => {
          setInternal(next);
          onOpenChange?.(next);
        },
      }}
    >
      {children}
    </DialogContext.Provider>
  );
}
export function DialogTrigger({ asChild, children, onClick }: AnyProps & CompatEventProps) {
  const context = React.useContext(DialogContext);
  if (validChild(children))
    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        onClick?.(event);
        context?.setOpen(true);
      },
    });
  return <Button onClick={() => context?.setOpen(true)}>{children}</Button>;
}
export const DialogContent = React.forwardRef<HTMLDivElement, AnyProps>(function DialogContent(
  {
    children,
    className,
    busy = false,
    showCloseButton = true,
    onEscapeKeyDown,
    classNames,
    attributes,
    overlayProps,
    closeButtonProps,
    ...props
  },
  ref,
) {
  const context = React.useContext(DialogContext);
  const open = context?.open ?? false;
  const blocked = busy || !!context?.busy;

  React.useEffect(() => {
    context?.setBusy(busy);
    return () => context?.setBusy(false);
  }, [busy, context?.setBusy]);

  // Mantine 的 Modal 在 window capture 阶段处理 Escape，回调里再 preventDefault
  // 已经来不及。这里关掉 Mantine 的 Escape，自己实现同一套"先询问、再关闭"
  // 语义，并避开 Select/Combobox 等内部弹层。
  React.useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest("[data-mantine-stop-propagation='true']")) return;
      if (target?.closest("[role='menu'], [role='listbox']")) return;
      const nestedDialog = target?.closest("[role='dialog']");
      if (nestedDialog && !nestedDialog.hasAttribute("data-modal-content")) return;
      if (blocked) {
        event.preventDefault();
        return;
      }
      onEscapeKeyDown?.(event);
      if (event.defaultPrevented) return;
      context?.setOpen(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, blocked, onEscapeKeyDown, context]);

  const titleText = props.title == null ? textOf(findChildDeep(children, DialogTitle)?.props.children).trim() : "";
  const mergedAttributes = titleText ? { content: { "aria-label": titleText }, ...attributes } : attributes;
  const {
    className: closeClassName,
    onClick: closeOnClick,
    disabled: closeDisabled,
    ...restCloseButtonProps
  } = closeButtonProps ?? {};

  return (
    <MModal
      {...props}
      ref={ref}
      opened={open}
      onClose={() => {
        if (!blocked) context?.setOpen(false);
      }}
      centered
      withCloseButton={false}
      closeOnEscape={false}
      closeOnClickOutside={!blocked}
      trapFocus
      returnFocus
      zIndex={200}
      yOffset="6dvh"
      padding={0}
      radius="md"
      overlayProps={{ backgroundOpacity: 0.45, blur: 3, ...overlayProps }}
      attributes={mergedAttributes}
      classNames={{
        ...classNames,
        content: cn(
          "relative flex flex-col overflow-hidden border border-border bg-popover p-0 text-[13px] text-popover-foreground shadow-none",
          classNames?.content,
          className,
        ),
        body: cn("flex min-h-0 flex-1 flex-col p-0", classNames?.body),
      }}
    >
      {showCloseButton ? (
        <CloseButton
          data-slot="dialog-close"
          aria-label="关闭弹窗"
          size="sm"
          variant="subtle"
          className={cn(
            "absolute top-3 right-3 z-20 size-7 bg-transparent text-muted-foreground hover:bg-surface-muted",
            closeClassName,
          )}
          disabled={blocked || closeDisabled}
          onClick={(event) => {
            closeOnClick?.(event);
            if (!event.defaultPrevented && !blocked) context?.setOpen(false);
          }}
          {...restCloseButtonProps}
        />
      ) : null}
      {children}
    </MModal>
  );
});
export function DialogHeader({ icon: Icon, children, className, ...props }: AnyProps) {
  return (
    <Stack
      data-slot="dialog-header"
      gap="xs"
      className={cn("min-w-0 shrink-0 bg-surface-muted/40 px-5 py-5 pr-14 text-left", className)}
      {...props}
    >
      {Icon ? (
        <Group align="flex-start" gap="sm" wrap="nowrap">
          <Icon size={18} />
          <Box className="min-w-0">{children}</Box>
        </Group>
      ) : (
        children
      )}
    </Stack>
  );
}
export function DialogBody({ className, ...props }: AnyProps) {
  return (
    <Box
      data-slot="dialog-body"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}
export function DialogFooter({ className, ...props }: AnyProps) {
  return (
    <Group
      data-slot="dialog-footer"
      justify="flex-end"
      gap="xs"
      wrap="wrap"
      className={cn(
        "shrink-0 border-t border-border/60 bg-surface-muted/40 px-5 py-4",
        "*:data-[slot=button]:h-8 *:data-[slot=button]:rounded-md *:data-[slot=button]:px-3 *:data-[slot=button]:text-[13px]",
        className,
      )}
      {...props}
    />
  );
}
export function DialogTitle({ className, ...props }: AnyProps) {
  return (
    <Title
      order={3}
      data-slot="dialog-title"
      className={cn("text-base leading-6 font-semibold", className)}
      {...props}
    />
  );
}
export function DialogDescription({ asChild, children, className, ...props }: AnyProps) {
  return asChild ? (
    children
  ) : (
    <Text data-slot="dialog-description" c="dimmed" size="xs" className={cn("leading-5", className)} {...props}>
      {children}
    </Text>
  );
}
export function DialogClose({ asChild, children, onClick, ...props }: AnyProps & CompatEventProps) {
  const context = React.useContext(DialogContext);
  if (validChild(children)) {
    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        onClick?.(event);
        if (!event.defaultPrevented) context?.setOpen(false);
      },
    });
  }
  return (
    <Button {...props} onClick={() => context?.setOpen(false)}>
      {children}
    </Button>
  );
}
export const AlertDialog = Dialog;
export const AlertDialogContent = DialogContent;
export const AlertDialogHeader = DialogHeader;
export const AlertDialogFooter = DialogFooter;
export const AlertDialogTitle = DialogTitle;
export const AlertDialogDescription = DialogDescription;
export function AlertDialogMedia(props: AnyProps) {
  return <Flex {...props} />;
}
export function AlertDialogCancel({ children, onClick, ...props }: AnyProps & CompatEventProps) {
  const context = React.useContext(DialogContext);
  return (
    <Button
      variant="outline"
      {...props}
      onClick={(event: React.MouseEvent) => {
        onClick?.(event);
        context?.setOpen(false);
      }}
    >
      {children}
    </Button>
  );
}
export const AlertDialogTrigger = DialogTrigger;
export function AlertDialogAction({ children, onClick, ...props }: AnyProps & CompatEventProps) {
  const context = React.useContext(DialogContext);
  return (
    <Button
      {...props}
      onClick={(event: React.MouseEvent) => {
        onClick?.(event);
        if (!event.defaultPrevented) context?.setOpen(false);
      }}
    >
      {children}
    </Button>
  );
}
export const Drawer = Dialog;
export const DrawerContent = React.forwardRef<HTMLDivElement, AnyProps>(function DrawerContent(
  {
    children,
    className,
    busy = false,
    position = "bottom",
    size,
    withCloseButton = false,
    onEscapeKeyDown,
    classNames,
    attributes,
    overlayProps,
    ...props
  },
  ref,
) {
  const context = React.useContext(DialogContext);
  const open = context?.open ?? false;
  const blocked = busy || !!context?.busy;

  React.useEffect(() => {
    context?.setBusy(busy);
    return () => context?.setBusy(false);
  }, [busy, context?.setBusy]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest("[data-mantine-stop-propagation='true']")) return;
      if (target?.closest("[role='menu'], [role='listbox']")) return;
      const nestedDialog = target?.closest("[role='dialog']");
      if (nestedDialog && !nestedDialog.hasAttribute("data-modal-content")) return;
      if (blocked) {
        event.preventDefault();
        return;
      }
      onEscapeKeyDown?.(event);
      if (event.defaultPrevented) return;
      context?.setOpen(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, blocked, onEscapeKeyDown, context]);

  const titleText = textOf(findChildDeep(children, DrawerTitle)?.props.children).trim();
  const mergedAttributes = titleText ? { content: { "aria-label": titleText }, ...attributes } : attributes;
  const side = position === "left" || position === "right";

  return (
    <MDrawer
      {...props}
      ref={ref}
      opened={open}
      onClose={() => {
        if (!blocked) context?.setOpen(false);
      }}
      position={position}
      size={size ?? (side ? "min(75%, 24rem)" : "80%")}
      withCloseButton={withCloseButton}
      closeOnEscape={false}
      closeOnClickOutside={!blocked}
      trapFocus
      returnFocus
      zIndex={200}
      padding={0}
      radius="md"
      overlayProps={{ backgroundOpacity: 0.45, blur: 3, ...overlayProps }}
      attributes={mergedAttributes}
      classNames={{
        ...classNames,
        content: cn(
          "flex flex-col border border-border bg-popover text-[13px] shadow-none",
          classNames?.content,
          className,
        ),
        body: cn("flex min-h-0 flex-1 flex-col p-0", classNames?.body),
      }}
      data-slot="drawer-content"
      data-busy={blocked || undefined}
    >
      {children}
    </MDrawer>
  );
});
export function DrawerHeader({ className, ...props }: AnyProps) {
  return <Stack data-slot="drawer-header" gap="xs" className={cn("shrink-0 px-5 pb-3 pt-4", className)} {...props} />;
}
export function DrawerFooter({ className, ...props }: AnyProps) {
  return (
    <Group
      data-slot="drawer-footer"
      justify="flex-end"
      gap="sm"
      wrap="wrap"
      className={cn("mt-auto shrink-0 border-t border-border/60 px-5 py-4", className)}
      {...props}
    />
  );
}
export function DrawerTitle({ className, ...props }: AnyProps) {
  return (
    <Text
      component="h2"
      data-slot="drawer-title"
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  );
}
export function DrawerDescription({ className, ...props }: AnyProps) {
  return (
    <Text
      component="p"
      data-slot="drawer-description"
      c="dimmed"
      size="sm"
      className={cn("leading-snug", className)}
      {...props}
    />
  );
}

const CompatPopoverContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export function Popover({
  open,
  onOpenChange,
  children,
  position,
  offset,
  withRoles,
  ...props
}: AnyProps & CompatEventProps) {
  const [internal, setInternal] = React.useState(false);
  const actual = open ?? internal;
  const setOpen = (next: boolean) => {
    setInternal(next);
    onOpenChange?.(next);
  };
  // Radix 的 side/align 组合映射到 Mantine 的 FloatingPosition；
  // 同时保留调用方直接传 position/offset/withRoles 的能力。
  const content = childArray(children).find(
    (part): part is React.ReactElement<AnyProps> => validChild(part) && part.type === PopoverContent,
  );
  const side = content?.props.side as string | undefined;
  const align = content?.props.align as string | undefined;
  const mappedPosition =
    position ?? (side ? `${side}-${align === "start" ? "start" : align === "end" ? "end" : "center"}` : undefined);
  // Mantine 的 aria-labelledby 由 withRoles 注入且无法用 undefined 覆盖
  // （filterProps 会丢弃 undefined）。当调用方用 aria-label 命名弹层时关闭
  // withRoles，由 PopoverContent 自己补 role="dialog"，保证可访问名称正确。
  const labelledContent = !!content?.props["aria-label"];
  const effectiveWithRoles = withRoles ?? (labelledContent ? false : undefined);
  // 不要显式传 undefined：Mantine 的默认值（position=bottom / withRoles=true）
  // 会被 undefined 覆盖，导致 Dropdown 失去 role="dialog" 与默认定位。
  const behaviorProps = {
    ...(mappedPosition ? { position: mappedPosition } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(effectiveWithRoles !== undefined ? { withRoles: effectiveWithRoles } : {}),
  };
  // Mantine 的 Escape 监听挂在 Dropdown 上，而弹层默认不抢焦点（焦点仍在触发器），
  // 键盘事件到不了 Dropdown。旧 Radix API 是全局关闭，这里补一个文档级监听。
  React.useEffect(() => {
    if (!actual) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
        setInternal(false);
        onOpenChange?.(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [actual, onOpenChange]);
  return (
    <CompatPopoverContext.Provider value={{ open: actual, setOpen }}>
      <MPopover {...props} opened={actual} onChange={setOpen} {...behaviorProps} withinPortal zIndex={300}>
        {children}
      </MPopover>
    </CompatPopoverContext.Provider>
  );
}
export function PopoverTrigger({ children, asChild: _asChild, onClick, ...props }: AnyProps) {
  const context = React.useContext(CompatPopoverContext);
  // Mantine 的 Popover.Target 在受控模式下不再注入 onClick；旧 API 的触发器
  // 依赖点击切换，因此在兼容层显式合并调用方 onClick 并写回上下文。
  if (React.isValidElement(children)) {
    const child = children as React.ReactElement<AnyProps>;
    return (
      <MPopover.Target>
        {React.cloneElement(child, {
          ...props,
          // withRoles 关闭时 Mantine 不再补触发器状态，这里显式维护。
          "aria-haspopup": "dialog",
          "aria-expanded": context?.open ?? false,
          onClick: (event: React.MouseEvent) => {
            child.props.onClick?.(event);
            onClick?.(event);
            if (!event.defaultPrevented) context?.setOpen(!context.open);
          },
        })}
      </MPopover.Target>
    );
  }
  return <MPopover.Target>{children}</MPopover.Target>;
}
export function PopoverAnchor({ children }: AnyProps) {
  return <MPopover.Target>{children}</MPopover.Target>;
}
export function PopoverContent({ children, side: _side, align: _align, ...props }: AnyProps) {
  // 调用方用 aria-label 命名弹层时，Popover 根节点会关闭 withRoles，
  // Mantine 不再注入 aria-labelledby=<trigger id>，这里补回 dialog 语义；
  // 未传 aria-label 时保留 Mantine 的默认关联。
  const accessibleName =
    props["aria-label"] && !props["aria-labelledby"]
      ? { "aria-labelledby": undefined, role: props.role ?? "dialog" }
      : {};
  return (
    <MPopover.Dropdown data-slot="popover-content" {...props} {...accessibleName}>
      {children}
    </MPopover.Dropdown>
  );
}
const CompatScrollArea = React.forwardRef<HTMLDivElement, AnyProps>(function ScrollArea(
  { viewportProps, ...props },
  ref,
) {
  return <MScrollArea ref={ref} {...props} viewportProps={{ "data-slot": "scroll-area-viewport", ...viewportProps }} />;
});
// Mantine 8 只暴露 Autosize 静态组件；旧版 Viewport/Scrollbar/Thumb/Corner 已不存在，
// 不能继续引用，否则类型检查会报属性不存在。
export const ScrollArea = Object.assign(CompatScrollArea, {
  Autosize: MScrollArea.Autosize,
});

const CollapseContext = React.createContext<{ open: boolean; setOpen: (value: boolean) => void } | null>(null);
export function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: AnyProps & CompatEventProps) {
  const [internal, setInternal] = React.useState(defaultOpen);
  const actual = open ?? internal;
  return (
    <CollapseContext.Provider
      value={{
        open: actual,
        setOpen: (value) => {
          setInternal(value);
          onOpenChange?.(value);
        },
      }}
    >
      <Box {...props}>{children}</Box>
    </CollapseContext.Provider>
  );
}
export function CollapsibleTrigger({ children, onClick }: AnyProps) {
  const context = React.useContext(CollapseContext);
  if (validChild(children))
    return React.cloneElement(children, {
      "aria-expanded": context?.open ?? false,
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        onClick?.(event);
        context?.setOpen(!context.open);
      },
    });
  return (
    <Button aria-expanded={context?.open ?? false} onClick={() => context?.setOpen(!context.open)}>
      {children}
    </Button>
  );
}
export function CollapsibleContent({ children, ...props }: AnyProps) {
  const context = React.useContext(CollapseContext);
  return (
    <Collapse in={context?.open ?? false} {...props}>
      {children}
    </Collapse>
  );
}

export function Empty(props: AnyProps) {
  return <Stack align="center" {...props} />;
}
export function EmptyHeader(props: AnyProps) {
  return <Stack align="center" gap="xs" {...props} />;
}
export function EmptyTitle(props: AnyProps) {
  return <Title order={4} {...props} />;
}
export function EmptyDescription(props: AnyProps) {
  return <Text c="dimmed" {...props} />;
}
export function EmptyMedia(props: AnyProps) {
  return <Flex {...props} />;
}

export function Field(props: AnyProps) {
  return <Stack gap="xs" {...props} />;
}
export function FieldGroup(props: AnyProps) {
  return <Stack {...props} />;
}
export const FieldLabel = Label;
export function FieldDescription(props: AnyProps) {
  return <Text c="dimmed" size="xs" {...props} />;
}
export function FieldError(props: AnyProps) {
  return <Text c="red" size="xs" role="alert" {...props} />;
}

export function InputGroup({ className, ...props }: AnyProps) {
  return (
    <Group
      data-slot="input-group"
      gap={0}
      wrap="nowrap"
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
        className,
      )}
      {...props}
    />
  );
}
export function InputGroupAddon({ align = "inline-start", className, ...props }: AnyProps) {
  return (
    <Flex
      data-slot="input-group-addon"
      align="center"
      justify="center"
      className={cn("shrink-0 px-2 text-muted-foreground", align === "inline-end" && "order-last", className)}
      {...props}
    />
  );
}
export const InputGroupButton = Button;
export function InputGroupText({ className, ...props }: AnyProps) {
  return <Text className={cn("text-xs text-muted-foreground", className)} {...props} />;
}
export const InputGroupInput = React.forwardRef<HTMLInputElement, AnyProps>(function InputGroupInput(
  { className, classNames, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      {...props}
      variant="unstyled"
      classNames={{
        ...classNames,
        // TextInput 的 root 才是 InputGroup 的 flex 子项；只给 input 加 flex-1
        // 会让外层 root 收缩为内容宽度，导致 w-full/sm:w-64 失效。
        root: cn("min-w-0 flex-1", classNames?.root),
        input: cn("h-8 min-w-0 flex-1 bg-transparent px-3 text-[13px]", classNames?.input, className),
      }}
    />
  );
});
export const InputGroupTextarea = React.forwardRef<HTMLTextAreaElement, AnyProps>(function InputGroupTextarea(
  { className, classNames, ...props },
  ref,
) {
  return (
    <MTextarea
      ref={ref}
      {...props}
      variant="unstyled"
      classNames={{
        ...classNames,
        root: cn("min-w-0 flex-1", classNames?.root),
        input: cn("min-h-16 min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px]", classNames?.input, className),
      }}
    />
  );
});

export function Pagination({ children, ...props }: AnyProps) {
  return (
    <Box component="nav" {...props}>
      {children}
    </Box>
  );
}
export function PaginationContent(props: AnyProps) {
  return <Group {...props} />;
}
export function PaginationItem(props: AnyProps) {
  return <Box {...props} />;
}
export function PaginationEllipsis(props: AnyProps) {
  return <Text {...props}>…</Text>;
}

export function Avatar({ children, ...props }: AnyProps) {
  let src: string | undefined;
  let alt: string | undefined;
  let fallback: React.ReactNode = children;
  childArray(children).forEach((child) => {
    if (!validChild(child)) return;
    if (child.type === AvatarImage) {
      src = child.props.src;
      alt = child.props.alt;
    }
    if (child.type === AvatarFallback) fallback = child.props.children;
  });
  return (
    <MAvatar src={src} alt={alt} {...props}>
      {fallback}
    </MAvatar>
  );
}
export function AvatarImage(_props: { src?: string; alt?: string }) {
  return null;
}
export function AvatarFallback({ children }: AnyProps) {
  return children;
}

export {
  Flex,
  Group,
  MRadio,
  MSelect,
  Paper,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  Stack,
  Text,
  Title,
  UnstyledButton,
};
export function Combobox({ children }: AnyProps) {
  return <Box>{children}</Box>;
}
export function ComboboxChips(props: AnyProps) {
  return <Group {...props} />;
}
export function ComboboxValue({ children }: AnyProps) {
  return children;
}
export function ComboboxChip({ children }: AnyProps) {
  return <Badge>{children}</Badge>;
}
export function ComboboxChipsInput(props: AnyProps) {
  return <TextInput {...props} />;
}
export function ComboboxContent({ children }: AnyProps) {
  return <Box>{children}</Box>;
}
export function ComboboxEmpty(props: AnyProps) {
  return <Text {...props} />;
}
export function ComboboxList({ children }: AnyProps) {
  return typeof children === "function" ? children("") : children;
}
export function ComboboxItem(props: AnyProps) {
  return <Button {...props} />;
}
