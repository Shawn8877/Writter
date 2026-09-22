import Link from "next/link";
import { ArrowUpRight, BookOpen, Clock3 } from "lucide-react";
import { formatDate, formatNumber, novelWordCount } from "@/lib/domain/novel";
import { Badge } from "@/components/ui";

export function NovelCard({ novel }) {
  const words = novelWordCount(novel);
  return (
    <Link href={`/novel/${novel.id}`} className="novel-card group">
      <div className={`book-cover cover-${novel.cover}`}>
        <div className="cover-top">
          <span>NOVELAI ORIGINAL</span>
          <Badge>{novel.genre}</Badge>
        </div>
        <div className="cover-title">{novel.title}</div>
        <div className="cover-line" />
        <span className="cover-bottom">
          {novel.style} / {novel.isDemo ? "示例作品" : "我的创作"}
        </span>
        <ArrowUpRight size={22} className="cover-arrow" />
      </div>
      <div className="novel-card-body">
        <div className="novel-card-title">
          <h3>{novel.title}</h3>
          <Badge tone={novel.status === "创作中" ? "green" : "neutral"}>
            {novel.status}
          </Badge>
        </div>
        <p>{novel.idea}</p>
        <div className="novel-card-stats">
          <span>
            <BookOpen size={13} />
            {novel.chapters.length} 章
          </span>
          <span>{formatNumber(words)} 字</span>
          <span>
            <Clock3 size={12} />
            {formatDate(novel.updatedAt)}
          </span>
        </div>
        <div className="progress-track">
          <span
            style={{
              width: `${Math.min(100, (words / novel.targetWords) * 100)}%`,
            }}
          />
        </div>
        <div className="progress-label">
          <span>创作进度</span>
          <span>目标 {formatNumber(novel.targetWords)} 字</span>
        </div>
      </div>
    </Link>
  );
}
