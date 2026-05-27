import type { ComponentProps } from "react";
import { LoaderIcon } from "lucide-react";

import { cn } from "@/lib/cn";

export function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <LoaderIcon
      aria-label="Loading"
      className={cn("size-4 animate-spin text-fd-muted-foreground", className)}
      role="status"
      {...props}
    />
  );
}

export function PageSpinner() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-fd-background text-fd-muted-foreground">
      <Spinner />
    </div>
  );
}
