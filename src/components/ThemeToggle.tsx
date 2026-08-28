import { Moon, Sun } from "@phosphor-icons/react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export function ThemeToggle() {
  const { persistenceError, resolvedTheme, setTheme } = useTheme();

  const isDark = useMemo(() => resolvedTheme === "dark", [resolvedTheme]);

  return (
    <div className="theme-control">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
        title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
        onClick={() => {
          void setTheme(isDark ? "light" : "dark").catch(() => undefined);
        }}
      >
        {isDark ? <Sun aria-hidden="true" weight="bold" /> : <Moon aria-hidden="true" weight="bold" />}
      </Button>
      {persistenceError === null ? null : (
        <span className="theme-control__error" role="alert">{persistenceError}</span>
      )}
    </div>
  );
}
