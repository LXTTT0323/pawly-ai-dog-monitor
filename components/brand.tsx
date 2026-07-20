import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Pawly Coach home">
      <span className="brand-mark" aria-hidden="true">P</span>
      <span>Pawly</span>
    </Link>
  );
}
