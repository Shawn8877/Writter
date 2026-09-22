import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./brand";
import { AuthControls } from "./auth/auth-controls";

export function SiteHeader({ active }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand />
        <nav aria-label="主导航">
          <Link href="/#workflow">创作流程</Link>
          <Link href="/#memory">长篇记忆</Link>
          <Link
            className={active === "dashboard" ? "active" : ""}
            href="/dashboard"
          >
            我的作品
          </Link>
        </nav>
        <div className="header-account"><AuthControls /><Link className="button button-small button-ghost" href="/create">
          进入工作室 <ArrowUpRight size={16} />
        </Link></div>
      </div>
    </header>
  );
}
