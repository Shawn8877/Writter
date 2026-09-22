import { SiteHeader } from "@/components/site-header";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata = { title: "我的作品" };
export default function DashboardPage() {
  return (
    <>
      <SiteHeader active="dashboard" />
      <DashboardView />
    </>
  );
}
