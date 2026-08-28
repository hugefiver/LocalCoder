import { Cpu, History, Home, ListChecks, TerminalSquare } from "lucide-react";
import { NavLink } from "react-router-dom";

import { ThemeToggle } from "../ThemeToggle.js";
import { Button } from "../ui/button.js";
import { RuntimeDetailsDialog } from "../../features/runtimes/RuntimeDetailsDialog.js";
import { ENABLE_EXECUTOR, ENABLE_PROBLEMS } from "../../app/app-mode.js";

export function AppNav() {
  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="主导航">
        <NavLink className={navClassName} end to="/"><Home aria-hidden="true" />首页</NavLink>
        {ENABLE_PROBLEMS ? (
          <NavLink className={navClassName} to="/problems"><ListChecks aria-hidden="true" />题库</NavLink>
        ) : null}
        {ENABLE_EXECUTOR ? (
          <NavLink className={navClassName} to="/executor"><TerminalSquare aria-hidden="true" />执行器</NavLink>
        ) : null}
        <NavLink className={navClassName} to="/submissions"><History aria-hidden="true" />提交历史</NavLink>
      </nav>
      <div className="app-nav__utilities" aria-label="工作台设置">
        <RuntimeDetailsDialog trigger={(
          <Button aria-label="查看运行时详情" size="icon" title="运行时详情" variant="ghost">
            <Cpu aria-hidden="true" />
          </Button>
        )} />
        <ThemeToggle />
      </div>
    </div>
  );
}

function navClassName({ isActive }: { isActive: boolean }): string {
  return isActive ? "app-nav__link app-nav__link--active" : "app-nav__link";
}
