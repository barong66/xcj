import type { SiteTemplate } from "../_shared/types";
import { theme } from "./theme";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";
import { Footer } from "./Footer";
import { VideoCard } from "./VideoCard";
import { ProfileGrid } from "./ProfileGrid";
import { ProfileHeader } from "./ProfileHeader";
import { SortControls } from "./SortControls";

export const template: SiteTemplate = {
  name: "default",
  theme,
  Header,
  BottomNav,
  Footer,
  VideoCard,
  ProfileGrid,
  ProfileHeader,
  SortControls,
};
