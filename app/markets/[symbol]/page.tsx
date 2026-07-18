import { AssetDetailContent } from "@/components/AssetDetailContent";

interface PageProps {
  params: Promise<{ symbol: string }>;
}

export default async function Page({ params }: PageProps) {
  const { symbol } = await params;
  return <AssetDetailContent symbol={symbol} />;
}
