"use client";
import Link from "next/link";
export default function ErrorPage({ reset }) {
  return (
    <main className="empty-state">
      <h1>创作空间暂时遇到了问题</h1>
      <p>请尝试重新打开页面。本地已保存的草稿不会因此被删除。</p>
      <button className="button button-primary" onClick={reset}>
        重新加载
      </button>
      <Link href="/dashboard" className="text-link">
        返回作品库
      </Link>
    </main>
  );
}
