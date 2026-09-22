import Link from "next/link";
import { Sparkles } from "lucide-react";

export function Brand({ compact = false }) {
  return (
    <Link href="/" className="brand" aria-label="NovelAI Studio 首页">
      <span className="brand-mark">
        <Sparkles size={21} strokeWidth={1.7} />
      </span>
      <span>
        NovelAI{" "}
        <span className={compact ? "brand-sub compact" : "brand-sub"}>
          Studio
        </span>
      </span>
    </Link>
  );
}
