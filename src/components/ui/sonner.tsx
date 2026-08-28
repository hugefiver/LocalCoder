import { CSSProperties } from "react"
import { Toaster as Sonner, ToasterProps } from "sonner"

import { useTheme } from "@/hooks/use-theme"

const Toaster = ({ theme: themeProp, ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()
  const toasterTheme: NonNullable<ToasterProps["theme"]> = themeProp ?? resolvedTheme

  return (
    <Sonner
      {...props}
      theme={toasterTheme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as CSSProperties
      }
    />
  )
}

export { Toaster }
