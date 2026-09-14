interface Props {
  categories: number;
  links: number;
}

export default function Footer({ categories, links }: Props) {
  return (
    <footer className="pb-4 pt-2 text-center text-xs text-faint">
      © NavBook · {categories} 个分类 · {links} 个链接
    </footer>
  );
}
