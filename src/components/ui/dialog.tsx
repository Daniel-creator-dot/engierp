import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Classes that size or decorate the dialog frame go on the outer element; everything else (padding, gap,
 * layout) goes on the inner scrolling body. Callers' own height/overflow classes are dropped because the
 * frame already caps the height at the viewport and the body scrolls.
 */
const FRAME_CLASS = /^(?:[a-z0-9]+:)*(?:max-w-|min-w-|w-|rounded|border|shadow|ring)/
const MANAGED_CLASS = /^(?:[a-z0-9]+:)*(?:max-h-|h-|overflow-)/

function splitDialogClasses(className?: string) {
  const frame: string[] = []
  const body: string[] = []
  for (const c of (className || "").split(/\s+/).filter(Boolean)) {
    if (MANAGED_CLASS.test(c)) continue
    ;(FRAME_CLASS.test(c) ? frame : body).push(c)
  }
  return { frame: frame.join(" "), body: body.join(" ") }
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { frame, body } = splitDialogClasses(className)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 flex flex-col w-[calc(100vw-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] overflow-hidden border border-slate-200 bg-white shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl dark:border-slate-800 dark:bg-slate-950",
          frame
        )}
        {...props}
      >
        <div data-dialog-body className={cn("grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain p-6", body)}>
          {children}
        </div>
        <DialogPrimitive.Close className="absolute right-3 top-3 z-30 rounded-full bg-white/90 p-1.5 text-slate-500 shadow-sm ring-1 ring-black/5 backdrop-blur transition-colors hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 pr-8 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

/** Sticks to the bottom of the scrolling dialog body so the primary action is always reachable. */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "sticky bottom-0 z-20 flex flex-col-reverse gap-2 bg-white pt-3 sm:flex-row sm:justify-end before:pointer-events-none before:absolute before:inset-x-0 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-white before:to-transparent",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
