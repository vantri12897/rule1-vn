import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-extrabold tracking-tight text-ink">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-sm text-white">YD</span>
      <span className="text-lg">
        YD-<span className="text-primary">English</span>
      </span>
    </Link>
  );
}
