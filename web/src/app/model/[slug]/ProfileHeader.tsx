"use client";

import type { Account } from "@/types";
import { useTemplate } from "@/templates/_shared/TemplateContext";

interface ProfileHeaderProps {
  account: Account;
}

export function ProfileHeader(props: ProfileHeaderProps) {
  const { ProfileHeader: TemplateProfileHeader } = useTemplate();
  return <TemplateProfileHeader {...props} />;
}
