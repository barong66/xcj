import type { Account } from "@/types";
import type { FeedItem } from "@/lib/feed-types";
import { ProfileGrid } from "./ProfileGrid";

interface ProfileContentProps {
  account: Account;
  initialFeed: FeedItem[];
}

export function ProfileContent({ account, initialFeed }: ProfileContentProps) {
  const videos = initialFeed.map((item) => item.video);
  return <ProfileGrid videos={videos} accountId={account.id} />;
}
