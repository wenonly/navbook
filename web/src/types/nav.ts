export interface NavLink {
  id: number;
  fid: number;
  title: string;
  url: string;
  description: string | null;
  font_icon: string | null;
  url_standby: string | null;
}
export interface NavCategory {
  id: number;
  name: string;
  font_icon: string | null;
  description: string | null;
  children: NavCategory[];
  links: NavLink[];
}
export interface NavData {
  site_title: string;
  site_subtitle: string;
  categories: NavCategory[];
}
