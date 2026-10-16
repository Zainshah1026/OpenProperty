import { cn } from "@/lib/utils";

/**
 * The page toolbar and the pane under it.
 *
 * A generous title in the display serif with its meta underneath, on the
 * canvas rather than in a ruled band. It sits OUTSIDE the scroll container: the title and the page's one action
 * stay put while the content moves, which is what makes a long table readable
 * (DESIGN.md → Layout, "The shell").
 *
 * Row one is identity: the title, then the count or period as quiet meta.
 * The right side is for the page's actions, and only the last of them is ink.
 */
export function PageShell({
  title,
  meta,
  actions,
  width = "max-w-7xl",
  children,
}: {
  title: React.ReactNode;
  /** The count or period this page is showing — `3 properties · 5 units`. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={cn("flex w-full shrink-0 flex-wrap items-end gap-x-4 gap-y-2 px-4 pb-4 pt-6 md:px-8 md:pt-8", width)}>
        <div className="min-w-0 flex-1">
          <h1 className="display truncate text-[1.875rem] font-medium leading-tight md:text-[2.125rem]">{title}</h1>
          {meta ? <div className="mt-1 truncate text-sm text-muted-foreground">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className={cn("w-full space-y-6 px-4 pb-10 pt-2 md:px-8", width)}>{children}</div>
      </div>
    </div>
  );
}
