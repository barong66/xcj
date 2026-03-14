"use server";

import { ProfileStories as ProfileStoriesComponent } from "@/components/ProfileStories";
import type { ProfileStoriesProps } from "@/templates/_shared/types";

export async function ProfileStories(props: ProfileStoriesProps) {
  return <ProfileStoriesComponent />;
}
