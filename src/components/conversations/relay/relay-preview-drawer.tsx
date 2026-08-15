"use client"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { RelayContextPack } from "@/lib/types"

interface RelayPreviewDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  relay: RelayContextPack | null
}

export function RelayPreviewDrawer({
  open,
  onOpenChange,
  relay,
}: RelayPreviewDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80dvh]">
        <SheetHeader>
          <SheetTitle>接力上下文预览</SheetTitle>
        </SheetHeader>
        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pb-6 text-sm">
          {relay ? (
            <>
              <p className="text-muted-foreground">
                已包含 {relay.snapshot.includedRounds.length} 个完整轮次
              </p>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                {relay.snapshot.canonicalContext}
              </pre>
            </>
          ) : (
            <p className="text-muted-foreground">暂无可预览的接力上下文</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
