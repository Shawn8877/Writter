import "./globals.css";
import { StudioProvider } from "@/components/studio-provider";

export const metadata = {
  title: {
    default: "NovelAI Studio · 一个想法，写出一个世界",
    template: "%s | NovelAI Studio",
  },
  description:
    "从故事设定、人物、大纲到百万字正文，让 AI 帮你完成网络小说创作。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>
        <StudioProvider>{children}</StudioProvider>
      </body>
    </html>
  );
}
