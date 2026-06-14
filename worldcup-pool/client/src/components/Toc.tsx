export interface TocItem {
  id: string;
  label: string;
}

// Sticky pill-link bar for jumping between page sections. Plain hash anchors
// — React Router ignores them, so the browser scrolls natively. Target
// sections need `scroll-mt-14` so this bar doesn't cover their headings.
export function Toc({ items }: { items: (TocItem | string)[] }) {
  return (
    <nav
      aria-label="Page sections"
      className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-b flex flex-wrap items-center gap-1.5 text-xs"
    >
      {items.map((item) =>
        typeof item === 'string' ? (
          <span key={item} className="text-muted-foreground ml-1 first:ml-0">
            {item}
          </span>
        ) : (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="px-2 py-1 rounded-full border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {item.label}
          </a>
        )
      )}
    </nav>
  );
}
