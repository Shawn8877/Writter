import Link from "next/link";
import { Brand } from "@/components/brand";
import { ArrowLeft } from "lucide-react";
export default function NotFound() {
  return (
    <div className="missing-novel">
      <Brand />
      <main className="empty-state">
        <span className="section-kicker">404 · AN UNWRITTEN PAGE</span>
        <h1>这一页，还没有故事。</h1>
        <p>你访问的页面不存在，回到作品库继续创作吧。</p>
        <Link href="/dashboard" className="button button-primary">
          <ArrowLeft size={16} />
          返回我的作品
        </Link>
      </main>
    </div>
  );
}
